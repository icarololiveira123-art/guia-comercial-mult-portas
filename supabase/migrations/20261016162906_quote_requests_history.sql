-- Requests and all their revisions live outside the replaceable workspace
-- JSON. Older browsers and the Marketing desktop app cannot erase them.
create table mp_shared_private.quote_requests (
  id uuid primary key,
  user_id bigint not null references mp_shared_private.users(id),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 180000),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  archived_at timestamptz
);
create index mp_quote_requests_owner_created on mp_shared_private.quote_requests (user_id,created_at desc,id desc);
create table mp_shared_private.quote_request_versions (
  request_id uuid not null references mp_shared_private.quote_requests(id),
  revision integer not null,
  mutation_id uuid not null,
  action text not null check (action in ('created','updated','sent','unsent','archived','restored')),
  changed_at timestamptz not null default clock_timestamp(),
  snapshot jsonb not null,
  input jsonb not null,
  primary key (request_id,revision),
  unique (request_id,mutation_id)
);
alter table mp_shared_private.quote_requests enable row level security;
alter table mp_shared_private.quote_request_versions enable row level security;
revoke all on mp_shared_private.quote_requests,mp_shared_private.quote_request_versions from public,anon,authenticated;
grant select,insert,update on mp_shared_private.quote_requests to service_role;
grant select,insert on mp_shared_private.quote_request_versions to service_role;
create policy mp_backend_only on mp_shared_private.quote_requests for all to service_role using (true) with check (true);
create policy mp_backend_only on mp_shared_private.quote_request_versions for all to service_role using (true) with check (true);

create function mp_shared_private.quote_request_json(r mp_shared_private.quote_requests)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select r.data || jsonb_build_object('id',r.id,'revision',r.revision,'createdAt',r.created_at,
    'updatedAt',r.updated_at,'sentAt',r.sent_at,'archivedAt',r.archived_at);
$$;
revoke all on function mp_shared_private.quote_request_json(mp_shared_private.quote_requests) from public,anon,authenticated;
grant execute on function mp_shared_private.quote_request_json(mp_shared_private.quote_requests) to service_role;

create function public.mp_shared_quote_requests(p_action text,p_payload jsonb default '{}'::jsonb,p_auth jsonb default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_auth jsonb;
  v_owner bigint;
  v_request mp_shared_private.quote_requests%rowtype;
  v_previous mp_shared_private.quote_request_versions%rowtype;
  v_result jsonb;
  v_data jsonb;
  v_input jsonb;
  v_action text;
  v_sent_at timestamptz;
  v_archived_at timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  if p_action not in ('quote_list','quote_get','quote_history','quote_create','quote_update','quote_action') then
    return '{"status":"forbidden"}'::jsonb;
  end if;
  -- Reuse the existing atomic expiry/revocation/version check. Its user and
  -- session locks stay held through the record write and history insert.
  v_auth := public.mp_shared_store('resolve_session','{}'::jsonb,p_auth);
  if v_auth->>'status' = 'unauthorized' or v_auth->'session' is null then return '{"status":"unauthorized"}'::jsonb; end if;
  v_owner := (p_payload->>'userId')::bigint;
  if v_auth->'session'->>'role' = 'user' then
    if v_owner is distinct from (v_auth->'session'->>'userId')::bigint then return '{"status":"forbidden"}'::jsonb; end if;
  elsif v_auth->'session'->>'role' is distinct from 'admin' or v_owner is null then return '{"status":"forbidden"}'::jsonb;
  end if;
  perform 1 from mp_shared_private.users where id=v_owner and deleted_at is null for update;
  if not found then return '{"status":"not-found"}'::jsonb; end if;

  if p_action = 'quote_list' then
    select coalesce(jsonb_agg(mp_shared_private.quote_request_json(t.record) order by (t.record).created_at desc,(t.record).id desc),'[]'::jsonb) into v_result from (
      select q as record from mp_shared_private.quote_requests q
      where q.user_id=v_owner
        and (p_payload->>'scope' = 'history' or q.archived_at is null)
        and (p_payload->>'filter' = 'all' or (p_payload->>'filter' = 'sent' and q.data->>'sent'='true')
          or (p_payload->>'filter' = 'pending' and q.data->>'sent'='false'))
        and (coalesce(p_payload->>'search','')='' or strpos(lower(q.data->>'clientName'),lower(p_payload->>'search'))>0)
        and (p_payload->>'cursorId' is null or (q.created_at,q.id) < ((p_payload->>'cursorAt')::timestamptz,(p_payload->>'cursorId')::uuid))
      order by q.created_at desc,q.id desc limit 26
    ) t;
    return jsonb_build_object('requests',v_result,'counts',(
      select jsonb_build_object('total',count(*),'pending',count(*) filter (where archived_at is null and data->>'sent'='false'),
        'sent',count(*) filter (where archived_at is null and data->>'sent'='true'),'archived',count(*) filter (where archived_at is not null))
      from mp_shared_private.quote_requests where user_id=v_owner));
  end if;

  select * into v_request from mp_shared_private.quote_requests
    where id=(p_payload->>'id')::uuid and user_id=v_owner for update;
  if p_action = 'quote_get' then
    if not found then return '{"status":"quote-not-found"}'::jsonb; end if;
    return jsonb_build_object('request',mp_shared_private.quote_request_json(v_request));
  elsif p_action = 'quote_history' then
    if not found then return '{"status":"quote-not-found"}'::jsonb; end if;
    select coalesce(jsonb_agg(t.entry order by (t.entry->>'revision')::integer desc),'[]'::jsonb) into v_result from (
      select jsonb_build_object('revision',revision,'action',action,'changedAt',changed_at,'snapshot',snapshot) as entry
      from mp_shared_private.quote_request_versions where request_id=v_request.id
        and (p_payload->>'beforeRevision' is null or revision < (p_payload->>'beforeRevision')::integer)
      order by revision desc limit 26
    ) t;
    return jsonb_build_object('request',mp_shared_private.quote_request_json(v_request),'versions',v_result);
  end if;

  v_input := jsonb_build_object('action',p_action,'body',p_payload-'userId');
  if v_request.id is not null then
    select * into v_previous from mp_shared_private.quote_request_versions
      where request_id=v_request.id and mutation_id=(p_payload->>'mutationId')::uuid;
    if found then
      if v_previous.input is distinct from v_input then
        return jsonb_build_object('status','quote-conflict','request',mp_shared_private.quote_request_json(v_request));
      end if;
      return jsonb_build_object('request',mp_shared_private.quote_request_json(v_request),'replayed',true);
    end if;
  end if;
  if p_action = 'quote_create' then
    if v_request.id is not null then return jsonb_build_object('status','quote-conflict','request',mp_shared_private.quote_request_json(v_request)); end if;
    v_data := p_payload->'data';
    insert into mp_shared_private.quote_requests (id,user_id,data,created_at,updated_at,sent_at)
      values ((p_payload->>'id')::uuid,v_owner,v_data,v_now,v_now,case when v_data->>'sent'='true' then v_now else null end)
      on conflict (id) do nothing returning * into v_request;
    if not found then return '{"status":"quote-conflict"}'::jsonb; end if;
    v_action := 'created';
  else
    if v_request.id is null then return '{"status":"quote-not-found"}'::jsonb; end if;
    if v_request.revision is distinct from (p_payload->>'baseRevision')::integer then
      return jsonb_build_object('status','quote-conflict','request',mp_shared_private.quote_request_json(v_request));
    end if;
    v_data := v_request.data;
    v_archived_at := v_request.archived_at;
    if p_action = 'quote_update' then
      v_data := p_payload->'data'; v_action := 'updated';
    else
      v_action := p_payload->>'action';
      if v_action='sent' then v_data:=jsonb_set(v_data,'{sent}','true'::jsonb);
      elsif v_action='unsent' then v_data:=jsonb_set(v_data,'{sent}','false'::jsonb);
      elsif v_action='archived' then v_archived_at:=v_now;
      elsif v_action='restored' then v_archived_at:=null;
      else return '{"status":"forbidden"}'::jsonb; end if;
    end if;
    v_sent_at := case when v_data->>'sent'='false' then null
      when v_request.data->>'sent'='true' then v_request.sent_at else v_now end;
    update mp_shared_private.quote_requests set data=v_data,revision=revision+1,
      updated_at=v_now,sent_at=v_sent_at,archived_at=v_archived_at where id=v_request.id returning * into v_request;
  end if;
  v_result := mp_shared_private.quote_request_json(v_request);
  -- Insert-only history: no expiration, truncation or delete operation exists.
  insert into mp_shared_private.quote_request_versions (request_id,revision,mutation_id,action,changed_at,snapshot,input)
    values (v_request.id,v_request.revision,(p_payload->>'mutationId')::uuid,v_action,v_now,v_result,v_input);
  return jsonb_build_object('request',v_result);
end;
$$;
revoke all on function public.mp_shared_quote_requests(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.mp_shared_quote_requests(text,jsonb,jsonb) to service_role;
