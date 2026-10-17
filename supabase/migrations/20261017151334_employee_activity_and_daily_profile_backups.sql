-- Real employee presence is separate from writes performed through the panel.
alter table mp_shared_private.users add column last_login_at timestamptz,
  add column last_active_at timestamptz, add column last_changed_at timestamptz;
update mp_shared_private.users u set
  last_login_at=(select max(created_at) from mp_shared_private.sessions where role='user' and user_id=u.id),
  last_active_at=(select max(created_at) from mp_shared_private.sessions where role='user' and user_id=u.id),
  last_changed_at=greatest((select updated_at from mp_shared_private.user_state where user_id=u.id),
    (select max(updated_at) from mp_shared_private.quote_requests where user_id=u.id));

create table mp_shared_private.activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references mp_shared_private.users(id),
  changed_at timestamptz not null default clock_timestamp(),
  business_day date not null default (clock_timestamp() at time zone 'America/Sao_Paulo')::date,
  actor_role text not null check (actor_role in ('user','admin','system')),
  actor_user_id bigint,
  kind text not null check (kind in ('workspace','quote','profile')),
  action text not null,
  title text not null,
  changed_fields jsonb not null,
  before_data jsonb,
  after_data jsonb
);
create index mp_activity_owner_date on mp_shared_private.activity_events(user_id,changed_at desc,id desc);
create table mp_shared_private.daily_snapshots (
  user_id bigint not null references mp_shared_private.users(id),
  business_day date not null,
  captured_at timestamptz not null default clock_timestamp(),
  state jsonb,
  client_state jsonb not null,
  profile jsonb not null,
  quote_references jsonb not null,
  primary key(user_id,business_day)
);
alter table mp_shared_private.activity_events enable row level security;
alter table mp_shared_private.daily_snapshots enable row level security;
revoke all on mp_shared_private.activity_events,mp_shared_private.daily_snapshots from public,anon,authenticated;
grant select,insert on mp_shared_private.activity_events to service_role;
grant select,insert,update on mp_shared_private.daily_snapshots to service_role;
create policy mp_backend_only on mp_shared_private.activity_events for all to service_role using(true) with check(true);
create policy mp_backend_only on mp_shared_private.daily_snapshots for all to service_role using(true) with check(true);

-- Only changed top-level fields are retained in the append-only audit. Access
-- proofs, session tokens and password hashes never enter these records.
create function mp_shared_private.changed_values(a jsonb,b jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(k,coalesce(a->k,'null'::jsonb)),'{}'::jsonb)
 from (select jsonb_object_keys(coalesce(a,'{}'::jsonb)) k union select jsonb_object_keys(coalesce(b,'{}'::jsonb))) keys
 where a->k is distinct from b->k;
$$;
create function mp_shared_private.capture_daily(p_user bigint) returns void
language plpgsql security invoker set search_path='' as $$
begin
 insert into mp_shared_private.daily_snapshots(user_id,business_day,state,client_state,profile,quote_references)
 select u.id,(clock_timestamp() at time zone 'America/Sao_Paulo')::date,s.state,
   coalesce(s.client_state,'{"schemaVersion":1}'::jsonb),
   jsonb_build_object('id',u.id,'username',u.username,'displayName',u.display_name,'branch',u.branch),
   (select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'revision',q.revision) order by q.id),'[]'::jsonb)
    from mp_shared_private.quote_requests q where q.user_id=u.id)
 from mp_shared_private.users u left join mp_shared_private.user_state s on s.user_id=u.id where u.id=p_user
 on conflict(user_id,business_day) do update set captured_at=clock_timestamp(),state=excluded.state,
  client_state=excluded.client_state,profile=excluded.profile,quote_references=excluded.quote_references;
end;
$$;
create function mp_shared_private.capture_activity() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
 v_user bigint; v_kind text; v_action text; v_title text;
 v_before jsonb; v_after jsonb; v_fields jsonb;
 v_role text := coalesce(nullif(current_setting('mp.actor_role',true),''),'system');
 v_actor bigint := nullif(current_setting('mp.actor_user_id',true),'')::bigint;
begin
 if tg_table_name='user_state' then
  if tg_op='UPDATE' and new.state is not distinct from old.state and new.client_state is not distinct from old.client_state then return new; end if;
  v_user:=new.user_id; v_kind:='workspace'; v_action:='saved'; v_title:='Dados e progresso atualizados';
  v_before:=jsonb_build_object('state',mp_shared_private.changed_values(case when tg_op='UPDATE' then old.state end,new.state),
   'clientState',mp_shared_private.changed_values(case when tg_op='UPDATE' then old.client_state end,new.client_state));
  v_after:=jsonb_build_object('state',mp_shared_private.changed_values(new.state,case when tg_op='UPDATE' then old.state end),
   'clientState',mp_shared_private.changed_values(new.client_state,case when tg_op='UPDATE' then old.client_state end));
  select coalesce(jsonb_agg(k),'[]'::jsonb) into v_fields from
   (select jsonb_object_keys(v_after->'state') k union select jsonb_object_keys(v_after->'clientState')) keys;
 elsif tg_table_name='quote_request_versions' then
  select user_id into v_user from mp_shared_private.quote_requests where id=new.request_id;
  v_kind:='quote'; v_action:=new.action; v_title:='Pedido: '||coalesce(new.snapshot->>'clientName','Cliente');
  select snapshot into v_before from mp_shared_private.quote_request_versions where request_id=new.request_id and revision=new.revision-1;
  v_after:=new.snapshot;
  select coalesce(jsonb_agg(k),'[]'::jsonb) into v_fields from jsonb_object_keys(mp_shared_private.changed_values(v_after,v_before)) k;
 elsif tg_table_name='users' then
  v_user:=new.id; v_kind:='profile'; v_action:=case when tg_op='INSERT' then 'created' when new.deleted_at is not null then 'removed' else 'updated' end;
  v_title:='Cadastro do funcionário';
  if tg_op='UPDATE' then
   v_before:=jsonb_build_object('username',old.username,'displayName',old.display_name,'branch',old.branch,'removed',old.deleted_at is not null);
   v_after:=jsonb_build_object('username',new.username,'displayName',new.display_name,'branch',new.branch,'removed',new.deleted_at is not null);
   if v_before=v_after and new.password_proof is not distinct from old.password_proof then return new; end if;
   v_after:=v_after||jsonb_build_object('accessChanged',new.password_proof is distinct from old.password_proof);
  else
   v_after:=jsonb_build_object('username',new.username,'displayName',new.display_name,'branch',new.branch);
  end if;
  select coalesce(jsonb_agg(k),'[]'::jsonb) into v_fields from jsonb_object_keys(mp_shared_private.changed_values(v_after,v_before)) k;
 end if;
 insert into mp_shared_private.activity_events(user_id,actor_role,actor_user_id,kind,action,title,changed_fields,before_data,after_data)
 values(v_user,v_role,v_actor,v_kind,v_action,v_title,v_fields,v_before,v_after);
 update mp_shared_private.users set last_changed_at=clock_timestamp() where id=v_user;
 perform mp_shared_private.capture_daily(v_user);
 return new;
end;
$$;
create trigger mp_workspace_activity after insert or update on mp_shared_private.user_state for each row execute function mp_shared_private.capture_activity();
create trigger mp_quote_activity after insert on mp_shared_private.quote_request_versions for each row execute function mp_shared_private.capture_activity();
create trigger mp_profile_activity after insert or update on mp_shared_private.users for each row execute function mp_shared_private.capture_activity();

create function mp_shared_private.capture_employee_login() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.role='user' then
  update mp_shared_private.users set last_login_at=new.created_at,last_active_at=greatest(last_active_at,new.created_at) where id=new.user_id;
  perform mp_shared_private.capture_daily(new.user_id);
 end if;
 return new;
end;
$$;
create trigger mp_employee_login after insert on mp_shared_private.sessions for each row execute function mp_shared_private.capture_employee_login();

-- Authorize inside the same transaction as every read. Panel inspection never
-- changes an employee's presence, and reports have no client-side delete API.
create function public.mp_shared_activity(p_action text,p_payload jsonb default '{}'::jsonb,p_auth jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_auth jsonb; v_user bigint := (p_payload->>'userId')::bigint;
 v_result jsonb; v_day date; v_row mp_shared_private.daily_snapshots%rowtype;
begin
 if p_action not in ('activity_touch','activity_list','activity_get','daily_list','daily_get','daily_quotes','daily_accounts') then return '{"status":"forbidden"}'::jsonb; end if;
 v_auth:=public.mp_shared_store('resolve_session','{}',p_auth);
 if v_auth->>'status'='unauthorized' or v_auth->'session' is null then return '{"status":"unauthorized"}'::jsonb; end if;
 if p_action='activity_touch' then
  if v_auth->'session'->>'role' <> 'user' or (v_auth->'session'->>'userId')::bigint is distinct from v_user then return '{"status":"forbidden"}'::jsonb; end if;
  update mp_shared_private.users set last_active_at=clock_timestamp() where id=v_user;
  -- One daily checkpoint also covers days spent reading without changing data.
  if not exists(select 1 from mp_shared_private.daily_snapshots where user_id=v_user and business_day=(clock_timestamp() at time zone 'America/Sao_Paulo')::date) then
   perform mp_shared_private.capture_daily(v_user);
  end if;
  return jsonb_build_object('ok',true,'lastActiveAt',clock_timestamp());
 end if;
 if v_auth->'session'->>'role' is distinct from 'admin' then return '{"status":"forbidden"}'::jsonb; end if;
 if p_action='daily_accounts' then
  v_day:=(p_payload->>'day')::date;
  select coalesce(jsonb_agg(jsonb_build_object('userId',d.user_id,'profile',d.profile,'day',d.business_day,
   'capturedAt',d.captured_at,'quoteCount',jsonb_array_length(d.quote_references),
   'closed',d.business_day<(clock_timestamp() at time zone 'America/Sao_Paulo')::date) order by d.user_id),'[]'::jsonb)
   into v_result from mp_shared_private.daily_snapshots d where d.business_day=v_day;
  return jsonb_build_object('day',v_day,'accounts',v_result);
 end if;
 perform 1 from mp_shared_private.users where id=v_user;
 if not found then return '{"status":"not-found"}'::jsonb; end if;
 if p_action='activity_list' then
  select coalesce(jsonb_agg(to_jsonb(t) order by t."changedAt" desc,t.id desc),'[]'::jsonb) into v_result from (
   select id,changed_at as "changedAt",business_day as "businessDay",actor_role as "actorRole",kind,action,title,changed_fields as "changedFields"
   from mp_shared_private.activity_events where user_id=v_user
    and (p_payload->>'cursorId' is null or (changed_at,id)<((p_payload->>'cursorAt')::timestamptz,(p_payload->>'cursorId')::uuid))
   order by changed_at desc,id desc limit 21) t;
  return jsonb_build_object('events',v_result);
 elsif p_action='activity_get' then
  select jsonb_build_object('id',id,'changedAt',changed_at,'businessDay',business_day,'actorRole',actor_role,'kind',kind,'action',action,
    'title',title,'changedFields',changed_fields,'beforeData',before_data,'afterData',after_data) into v_result
   from mp_shared_private.activity_events where user_id=v_user and id=(p_payload->>'id')::uuid;
  if v_result is null then return '{"status":"not-found"}'::jsonb; end if;
  return jsonb_build_object('event',v_result);
 elsif p_action='daily_list' then
  select coalesce(jsonb_agg(to_jsonb(t) order by t.day desc),'[]'::jsonb) into v_result from (
   select business_day as day,captured_at as "capturedAt",jsonb_array_length(quote_references) as "quoteCount",
    business_day<(clock_timestamp() at time zone 'America/Sao_Paulo')::date as closed
   from mp_shared_private.daily_snapshots where user_id=v_user
    and (p_payload->>'beforeDay' is null or business_day<(p_payload->>'beforeDay')::date)
   order by business_day desc limit 21) t;
  return jsonb_build_object('days',v_result);
 end if;
 v_day:=(p_payload->>'day')::date;
 select * into v_row from mp_shared_private.daily_snapshots where user_id=v_user and business_day=v_day;
 if not found then return '{"status":"not-found"}'::jsonb; end if;
 if p_action='daily_get' then
  return jsonb_build_object('snapshot',jsonb_build_object('day',v_day,'capturedAt',v_row.captured_at,
   'closed',v_day<(clock_timestamp() at time zone 'America/Sao_Paulo')::date,'profile',v_row.profile,
   'state',v_row.state,'clientState',v_row.client_state,'quoteCount',jsonb_array_length(v_row.quote_references)));
 end if;
 if p_payload->>'capturedAt' is null or v_row.captured_at is distinct from (p_payload->>'capturedAt')::timestamptz then return '{"status":"snapshot-conflict"}'::jsonb; end if;
 -- Bound each page by ten records (each record is limited to 180 KB).
 select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) into v_result from (
  select v.request_id as id,v.snapshot from jsonb_array_elements(v_row.quote_references) r
  join mp_shared_private.quote_request_versions v on v.request_id=(r->>'id')::uuid and v.revision=(r->>'revision')::integer
  where p_payload->>'afterId' is null or v.request_id>(p_payload->>'afterId')::uuid order by v.request_id limit 10) t;
 return jsonb_build_object('quotes',v_result);
end;
$$;
revoke all on function mp_shared_private.changed_values(jsonb,jsonb),mp_shared_private.capture_daily(bigint),
 mp_shared_private.capture_activity(),mp_shared_private.capture_employee_login(),public.mp_shared_activity(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function mp_shared_private.changed_values(jsonb,jsonb),mp_shared_private.capture_daily(bigint),
 mp_shared_private.capture_activity(),mp_shared_private.capture_employee_login(),public.mp_shared_activity(text,jsonb,jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.mp_shared_store(p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_auth jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_now timestamptz := clock_timestamp();
  v_session mp_shared_private.sessions%rowtype;
  v_user mp_shared_private.users%rowtype;
  v_target mp_shared_private.users%rowtype;
  v_state mp_shared_private.user_state%rowtype;
  v_count bigint;
  v_window timestamptz;
  v_seconds integer;
  v_max integer;
  v_client_state jsonb;
  v_existing jsonb;
  v_result jsonb;
  v_entry jsonb;
  v_results jsonb := '[]'::jsonb;
  v_imported integer := 0;
  v_conflicts integer := 0;
  v_batch_digest text;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid payload' using errcode = '22023';
  end if;
  if p_action in ('resolve_session','get_state','save_state','update_user','list_users','get_user_detail',
      'admin_create_user','admin_update_user','delete_user','import_local') then
    select * into v_session from mp_shared_private.sessions
      where token_hash = p_auth->>'tokenHash' and revoked_at is null and expires_at > v_now
      ;
    if not found then return '{"status":"unauthorized"}'::jsonb; end if;
    if v_session.role = 'user' then
      -- Lock the user before its state. Password reset/delete then serialize
      -- with this transaction and cannot leave an old session writing data.
      select * into v_user from mp_shared_private.users
        where id = v_session.user_id and deleted_at is null and session_version = v_session.user_version
        for update;
      if not found then return '{"status":"unauthorized"}'::jsonb; end if;
    elsif v_session.user_version is distinct from p_auth->>'adminVersion'
      or coalesce(p_auth->>'adminVersion','') = '' then
      return '{"status":"unauthorized"}'::jsonb;
    end if;
    -- Re-check after acquiring the user lock, then lock the session. Account
    -- writes use this same user -> session order, avoiding lock-upgrade and
    -- reset/delete deadlocks between devices.
    select * into v_session from mp_shared_private.sessions
      where token_hash = p_auth->>'tokenHash' and revoked_at is null and expires_at > clock_timestamp() for share;
    if not found then return '{"status":"unauthorized"}'::jsonb; end if;
    if v_session.role = 'user' and v_user.session_version is distinct from v_session.user_version then
      return '{"status":"unauthorized"}'::jsonb;
    end if;
    if p_action in ('list_users','get_user_detail','admin_create_user','admin_update_user','delete_user','import_local')
       and v_session.role <> 'admin' then return '{"status":"forbidden"}'::jsonb; end if;
    if p_action in ('get_state','save_state','update_user')
       and (v_session.role <> 'user' or v_session.user_id is distinct from (p_payload->>'userId')::bigint) then
      return '{"status":"forbidden"}'::jsonb;
    end if;
  end if;

  if v_session.role is not null then
    perform set_config('mp.actor_role',v_session.role,true);
    perform set_config('mp.actor_user_id',coalesce(v_session.user_id::text,''),true);
  end if;
  if p_action = 'get_access_proof' then
    return jsonb_build_object('proof', (select proof from mp_shared_private.access_config where id));
  elsif p_action = 'rate_limit' then
    v_seconds := greatest(1, least((p_payload->>'seconds')::integer, 86400));
    v_max := greatest(1, least((p_payload->>'max')::integer, 100000));
    insert into mp_shared_private.rate_limits (bucket, window_start, attempts)
      values (p_payload->>'bucket', v_now, 1)
    on conflict (bucket) do update set
      attempts = case when mp_shared_private.rate_limits.window_start + make_interval(secs => v_seconds) <= v_now
        then 1 else least(mp_shared_private.rate_limits.attempts + 1, 1000000000) end,
      window_start = case when mp_shared_private.rate_limits.window_start + make_interval(secs => v_seconds) <= v_now
        then v_now else mp_shared_private.rate_limits.window_start end
    returning attempts, window_start into v_count, v_window;
    delete from mp_shared_private.rate_limits where window_start < v_now - interval '2 days';
    return jsonb_build_object('allowed', v_count <= v_max,
      'retryAfter', greatest(1, ceil(extract(epoch from (v_window + make_interval(secs => v_seconds) - v_now)))::integer));
  elsif p_action = 'get_user_by_username' then
    select * into v_user from mp_shared_private.users
      where username_normalized = p_payload->>'usernameNormalized' and deleted_at is null;
    return jsonb_build_object('user', case when v_user.id is null then null else jsonb_build_object(
      'id',v_user.id,'username',v_user.username,'usernameNormalized',v_user.username_normalized,
      'displayName',v_user.display_name,'branch',v_user.branch,'password',v_user.password_proof,
      'sessionVersion',v_user.session_version,'createdAt',v_user.created_at) end);
  elsif p_action = 'resolve_session' then
    if v_session.role='user' and not exists(select 1 from mp_shared_private.daily_snapshots where user_id=v_user.id and business_day=(v_now at time zone 'America/Sao_Paulo')::date) then
      perform mp_shared_private.capture_daily(v_user.id);
    end if;
    if v_session.role='user' and (v_user.last_active_at is null or v_user.last_active_at < v_now-interval '1 minute') then
      update mp_shared_private.users set last_active_at=v_now where id=v_user.id;
    end if;
    return jsonb_build_object('session', jsonb_build_object('role',v_session.role,'userId',v_session.user_id,'expiresAt',v_session.expires_at),
      'user', case when v_user.id is null then null else jsonb_build_object(
        'id',v_user.id,'username',v_user.username,'usernameNormalized',v_user.username_normalized,
        'displayName',v_user.display_name,'branch',v_user.branch,'password',v_user.password_proof,
        'sessionVersion',v_user.session_version,'createdAt',v_user.created_at) end);
  elsif p_action = 'create_session' then
    if p_payload->>'role' = 'user' then
      select * into v_user from mp_shared_private.users where id = (p_payload->>'userId')::bigint
        and deleted_at is null and session_version = p_payload->>'version' for share;
      if not found then return '{"status":"version-conflict"}'::jsonb; end if;
    end if;
    insert into mp_shared_private.sessions (token_hash,role,user_id,user_version,created_at,expires_at)
      values (p_payload->>'tokenHash',p_payload->>'role',(p_payload->>'userId')::bigint,
        p_payload->>'version',v_now,(p_payload->>'expiresAt')::timestamptz);
    delete from mp_shared_private.sessions where expires_at < v_now - interval '7 days';
    return '{"ok":true}'::jsonb;
  elsif p_action = 'revoke_session' then
    update mp_shared_private.sessions set revoked_at = v_now where token_hash = p_payload->>'tokenHash';
    return '{"ok":true}'::jsonb;
  elsif p_action in ('create_user','admin_create_user') then
    insert into mp_shared_private.users (username,username_normalized,display_name,branch,password_proof)
      values (p_payload->>'username',p_payload->>'usernameNormalized',p_payload->>'displayName',p_payload->>'branch',p_payload->'password')
      on conflict (username_normalized) where deleted_at is null do nothing returning * into v_user;
    if not found then return '{"status":"username-conflict"}'::jsonb; end if;
    return jsonb_build_object('user', jsonb_build_object('id',v_user.id,'username',v_user.username,
      'usernameNormalized',v_user.username_normalized,'displayName',v_user.display_name,'branch',v_user.branch,
      'sessionVersion',v_user.session_version,'createdAt',v_user.created_at));
  elsif p_action = 'get_state' then
    select * into v_state from mp_shared_private.user_state where user_id = v_session.user_id;
    return jsonb_build_object('state',v_state.state,'revision',v_state.revision,
      'clientState',coalesce(v_state.client_state,'{"schemaVersion":1}'::jsonb));
  elsif p_action = 'save_state' then
    -- A lock on the user also serializes the first save when no state row exists.
    perform 1 from mp_shared_private.users where id = v_session.user_id for update;
    select * into v_state from mp_shared_private.user_state where user_id = v_session.user_id for update;
    v_client_state := case when p_payload ? 'clientState' then mp_shared_private.merge_client_progress(v_state.client_state,p_payload->'clientState')
      else coalesce(v_state.client_state,'{"schemaVersion":1}'::jsonb) end;
    if octet_length(v_client_state::text) > 150000 then return '{"status":"progress-too-large"}'::jsonb; end if;
    if v_state.user_id is not null and v_state.state = p_payload->'state' and v_state.client_state = v_client_state then
      return jsonb_build_object('ok',true,'revision',v_state.revision);
    end if;
    if not (p_payload ? 'baseRevision') or (p_payload->>'baseRevision') is distinct from v_state.revision then
      if v_state.user_id is not null and v_state.state = p_payload->'state' and v_state.client_state = v_client_state then
        return jsonb_build_object('ok',true,'revision',v_state.revision);
      end if;
      return jsonb_build_object('status','state-conflict','revision',v_state.revision);
    end if;
    insert into mp_shared_private.user_state (user_id,state,client_state,revision,updated_at)
      values (v_session.user_id,p_payload->'state',v_client_state,p_payload->>'revision',v_now)
      on conflict (user_id) do update set state = excluded.state, client_state = excluded.client_state,
        revision = excluded.revision, updated_at = excluded.updated_at;
    return jsonb_build_object('ok',true,'revision',p_payload->>'revision');
  elsif p_action in ('update_user','admin_update_user') then
    select * into v_target from mp_shared_private.users where id = (p_payload->>'userId')::bigint and deleted_at is null for update;
    if not found then return '{"status":"not-found"}'::jsonb; end if;
    if p_action = 'update_user' and v_target.session_version is distinct from p_payload->>'expectedVersion' then
      return '{"status":"version-conflict"}'::jsonb;
    end if;
    if exists(select 1 from mp_shared_private.users where username_normalized = p_payload->>'usernameNormalized' and id <> v_target.id and deleted_at is null) then
      return '{"status":"username-conflict"}'::jsonb;
    end if;
    update mp_shared_private.users set username = p_payload->>'username',
      username_normalized = p_payload->>'usernameNormalized', display_name = p_payload->>'displayName', branch = p_payload->>'branch',
      password_proof = case when jsonb_typeof(p_payload->'password') = 'object' then p_payload->'password' else password_proof end,
      session_version = gen_random_uuid()::text, updated_at = v_now where id = v_target.id returning * into v_user;
    update mp_shared_private.sessions set revoked_at = v_now where user_id = v_user.id and revoked_at is null;
    return jsonb_build_object('user', jsonb_build_object('id',v_user.id,'username',v_user.username,
      'usernameNormalized',v_user.username_normalized,'displayName',v_user.display_name,'branch',v_user.branch,
      'sessionVersion',v_user.session_version,'createdAt',v_user.created_at));
  elsif p_action = 'delete_user' then
    update mp_shared_private.users set deleted_at = v_now, session_version = gen_random_uuid()::text, updated_at = v_now
      where id = (p_payload->>'userId')::bigint and deleted_at is null returning * into v_target;
    if not found then return '{"status":"not-found"}'::jsonb; end if;
    update mp_shared_private.sessions set revoked_at = v_now where user_id = v_target.id and revoked_at is null;
    -- Retain the original state for recovery; no client has access after removal.
    return jsonb_build_object('ok',true,'id',v_target.id);
  elsif p_action = 'list_users' then
    select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'username',u.username,'displayName',u.display_name,'branch',u.branch,
      'createdAt',u.created_at,'dataUpdatedAt',s.updated_at,'lastActiveAt',u.last_active_at,'lastLoginAt',u.last_login_at,'lastChangedAt',u.last_changed_at,'state',s.state) order by u.id desc),'[]'::jsonb)
      into v_results from mp_shared_private.users u left join mp_shared_private.user_state s on s.user_id = u.id where u.deleted_at is null;
    return jsonb_build_object('users',v_results);
  elsif p_action = 'get_user_detail' then
    select * into v_target from mp_shared_private.users where id = (p_payload->>'userId')::bigint and deleted_at is null;
    if not found then return '{"status":"not-found"}'::jsonb; end if;
    select * into v_state from mp_shared_private.user_state where user_id = v_target.id;
    return jsonb_build_object('user',jsonb_build_object('id',v_target.id,'username',v_target.username,'displayName',v_target.display_name,
      'branch',v_target.branch,'createdAt',v_target.created_at,'dataUpdatedAt',v_state.updated_at,'lastActiveAt',v_target.last_active_at,'lastLoginAt',v_target.last_login_at,'lastChangedAt',v_target.last_changed_at,'state',v_state.state,
      'clientState',coalesce(v_state.client_state,'{"schemaVersion":1}'::jsonb)));
  elsif p_action = 'import_local' then
    -- Serialize matching batches and sources before reading, preventing two
    -- overlapping imports from creating divergent identity mappings.
    perform pg_advisory_xact_lock(hashtextextended('mp-import-global',0));
    select digest,result into v_batch_digest,v_existing from mp_shared_private.import_batches where batch_id = p_payload->>'batchId';
    if found then
      if v_batch_digest is distinct from p_payload->>'digest' then return '{"status":"batch-conflict"}'::jsonb; end if;
      return v_existing;
    end if;
    if jsonb_typeof(p_payload->'records') <> 'array' or jsonb_array_length(p_payload->'records') not between 1 and 120 then
      raise exception 'Invalid import' using errcode = '22023';
    end if;
    for v_entry in select value from jsonb_array_elements(p_payload->'records') loop
      select result,digest into v_existing,v_batch_digest from mp_shared_private.import_records where source_id = v_entry->>'sourceId';
      if found then
        if v_batch_digest = v_entry->>'digest' and v_existing->>'status' = 'imported'
          and exists(select 1 from mp_shared_private.users where id = (v_existing->>'userId')::bigint and deleted_at is null) then
          v_result := v_existing || '{"status":"already-imported"}'::jsonb;
        else
          v_result := jsonb_build_object('sourceId',v_entry->>'sourceId','username',v_entry->>'username','status','conflict');
          v_conflicts := v_conflicts + 1;
        end if;
      else
        insert into mp_shared_private.users (username,username_normalized,display_name,branch,password_proof)
          values (v_entry->>'username',v_entry->>'usernameNormalized',v_entry->>'displayName',v_entry->>'branch',v_entry->'password')
          on conflict (username_normalized) where deleted_at is null do nothing returning * into v_target;
        if found then
          if jsonb_typeof(v_entry->'state') = 'object' or v_entry->'clientState' <> '{"schemaVersion":1}'::jsonb then
            insert into mp_shared_private.user_state (user_id,state,client_state,revision,updated_at)
              values (v_target.id, nullif(v_entry->'state','null'::jsonb),v_entry->'clientState',v_now::text || '|' || gen_random_uuid()::text,v_now);
          end if;
          v_result := jsonb_build_object('sourceId',v_entry->>'sourceId','username',v_entry->>'username','status','imported','userId',v_target.id);
          v_imported := v_imported + 1;
        else
          v_result := jsonb_build_object('sourceId',v_entry->>'sourceId','username',v_entry->>'username','status','conflict');
          v_conflicts := v_conflicts + 1;
        end if;
        insert into mp_shared_private.import_records (source_id,digest,username_normalized,user_id,result)
          values (v_entry->>'sourceId',v_entry->>'digest',v_entry->>'usernameNormalized',case when v_result->>'status' = 'imported' then v_target.id else null end,v_result);
      end if;
      v_results := v_results || jsonb_build_array(v_result);
    end loop;
    v_result := jsonb_build_object('results',v_results,'imported',v_imported,'conflicts',v_conflicts);
    insert into mp_shared_private.import_batches (batch_id,digest,result) values (p_payload->>'batchId',p_payload->>'digest',v_result);
    return v_result;
  end if;
  raise exception 'Unknown store action' using errcode = '22023';
end;
$function$;

CREATE OR REPLACE FUNCTION public.mp_shared_workspace_access(p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_auth jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_auth jsonb;
  v_user mp_shared_private.users%rowtype;
  v_state mp_shared_private.user_state%rowtype;
  v_client_state jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_action not in ('workspace_open','workspace_read','workspace_save') then
    return '{"status":"forbidden"}'::jsonb;
  end if;
  -- resolve_session checks revocation, expiry and the current access version,
  -- and retains a SHARE lock on the panel session for this entire transaction.
  v_auth := public.mp_shared_store('resolve_session','{}'::jsonb,p_auth);
  if v_auth->>'status' = 'unauthorized' or v_auth->'session' is null then
    return '{"status":"unauthorized"}'::jsonb;
  end if;
  if v_auth->'session'->>'role' is distinct from 'admin' then
    return '{"status":"forbidden"}'::jsonb;
  end if;
  select * into v_user from mp_shared_private.users
    where id = (p_payload->>'userId')::bigint and deleted_at is null for update;
  if not found then return '{"status":"not-found"}'::jsonb; end if;

  if p_action = 'workspace_open' then
    if p_payload->>'recordAccess' = 'true' then
      insert into mp_shared_private.workspace_access_log (target_user_id,session_token_hash)
        values (v_user.id,p_auth->>'tokenHash');
    end if;
    return jsonb_build_object('user',jsonb_build_object('id',v_user.id,'username',v_user.username,
      'displayName',v_user.display_name,'branch',v_user.branch));
  elsif p_action = 'workspace_read' then
    select * into v_state from mp_shared_private.user_state where user_id = v_user.id;
    return jsonb_build_object('state',v_state.state,'revision',v_state.revision,
      'clientState',coalesce(v_state.client_state,'{"schemaVersion":1}'::jsonb));
  end if;

  -- Same user -> state locking order, revision check and bounded progress merge
  -- as employee saves. Concurrent employee and panel edits cannot overwrite.
  select * into v_state from mp_shared_private.user_state where user_id = v_user.id for update;
  v_client_state := case when p_payload ? 'clientState'
    then mp_shared_private.merge_client_progress(v_state.client_state,p_payload->'clientState')
    else coalesce(v_state.client_state,'{"schemaVersion":1}'::jsonb) end;
  if octet_length(v_client_state::text) > 150000 then return '{"status":"progress-too-large"}'::jsonb; end if;
  if v_state.user_id is not null and v_state.state = p_payload->'state' and v_state.client_state = v_client_state then
    return jsonb_build_object('ok',true,'revision',v_state.revision);
  end if;
  if not (p_payload ? 'baseRevision') or (p_payload->>'baseRevision') is distinct from v_state.revision then
    if v_state.user_id is not null and v_state.state = p_payload->'state' and v_state.client_state = v_client_state then
      return jsonb_build_object('ok',true,'revision',v_state.revision);
    end if;
    return jsonb_build_object('status','state-conflict','revision',v_state.revision);
  end if;
  insert into mp_shared_private.user_state (user_id,state,client_state,revision,updated_at)
    values (v_user.id,p_payload->'state',v_client_state,p_payload->>'revision',v_now)
    on conflict (user_id) do update set state = excluded.state,client_state = excluded.client_state,
      revision = excluded.revision,updated_at = excluded.updated_at;
  return jsonb_build_object('ok',true,'revision',p_payload->>'revision');
end;
$function$;
