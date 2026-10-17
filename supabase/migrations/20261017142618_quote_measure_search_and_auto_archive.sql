-- Search helpers are private, pure and never read another user's rows.
create function mp_shared_private.search_number(p_value text, p_scale integer default 0)
returns text language plpgsql immutable parallel safe security invoker set search_path = '' as $$
declare
  v_parts text[] := string_to_array(replace(p_value,',','.'),'.');
  v_padded text;
  v_cut integer;
  v_whole text;
  v_fraction text;
begin
  v_padded := '000' || v_parts[1];
  v_cut := length(v_padded) - p_scale;
  v_whole := regexp_replace(substr(v_padded,1,v_cut),'^0+(?=[0-9])','');
  v_fraction := regexp_replace(substr(v_padded,v_cut+1) || coalesce(v_parts[2],''),'0+$','');
  return v_whole || case when v_fraction <> '' then '.' || v_fraction else '' end;
end;
$$;

create function mp_shared_private.search_tokens(p_text text)
returns text[] language plpgsql immutable parallel safe security invoker set search_path = '' as $$
declare
  v_text text := lower(regexp_replace(normalize(coalesce(p_text,''), NFD), U&'[\0300-\036f]', '', 'g'));
  v_match text[];
  v_tokens text[] := '{}';
  v_first_unit text;
  v_second_unit text;
begin
  for v_match in select regexp_matches(v_text,'(([0-9]+(?:[.,][0-9]+)?)[[:space:]]*(mm|cm|m)?[[:space:]]*[al]?[[:space:]]*[x×][[:space:]]*([0-9]+(?:[.,][0-9]+)?)[[:space:]]*((?:mm|cm|m)(?![a-z]))?[[:space:]]*(?:[al](?![a-z]))?)','g') loop
    v_first_unit := coalesce(v_match[3],v_match[5]);
    v_second_unit := coalesce(v_match[5],v_match[3]);
    v_text := replace(v_text,v_match[1],
      mp_shared_private.search_number(v_match[2],case v_first_unit when 'mm' then 3 when 'cm' then 2 else 0 end) || ' ' ||
      mp_shared_private.search_number(v_match[4],case v_second_unit when 'mm' then 3 when 'cm' then 2 else 0 end));
  end loop;
  for v_match in select regexp_matches(v_text,'(([0-9]+(?:[.,][0-9]+)?)[[:space:]]*(mm|cm|m)(?![a-z]))','g') loop
    v_text := replace(v_text,v_match[1],mp_shared_private.search_number(v_match[2],case v_match[3] when 'mm' then 3 when 'cm' then 2 else 0 end));
  end loop;
  for v_match in select regexp_matches(v_text,'([0-9]+(?:[.,][0-9]+)?|[a-z]+)','g') loop
    v_tokens := array_append(v_tokens,case when v_match[1] ~ '^[0-9]' then 'n:' || mp_shared_private.search_number(v_match[1]) else 'w:' || v_match[1] end);
  end loop;
  return v_tokens;
end;
$$;

create function mp_shared_private.search_text_matches(p_source text, p_query text, p_dimensions text default null)
returns boolean language plpgsql immutable parallel safe security invoker set search_path = '' as $$
declare
  v_source text[];
  v_query text[];
  v_needed text[];
  v_numbers text[];
  v_token text;
  v_has_number boolean;
  v_is_measure boolean;
begin
  if btrim(coalesce(p_query,''))='' then return true; end if;
  v_source := mp_shared_private.search_tokens(p_source);
  v_query := mp_shared_private.search_tokens(p_query);
  select exists(select 1 from unnest(v_query) t where t like 'n:%') into v_has_number;
  select coalesce(array_agg(t),'{}'::text[]) into v_needed from unnest(v_query) t
    where not (v_has_number and substr(t,3)=any(array['x','ax','lx','a','l','m','cm','mm','altura','largura','medida','medidas']));
  if cardinality(v_needed)=0 then return false; end if;
  v_is_measure := lower(p_query) ~ '[0-9][.,][0-9]|[0-9][[:space:]]*(mm|cm|m)(?![a-z])|[0-9][[:space:]]*[al]?[[:space:]]*[x×][[:space:]]*[0-9]';
  v_numbers := case when v_is_measure then mp_shared_private.search_tokens(coalesce(p_dimensions,p_source)) else v_source end;
  foreach v_token in array v_needed loop
    if v_token like 'n:%' then
      if (select count(*) from unnest(v_numbers) t where t=v_token) < (select count(*) from unnest(v_needed) t where t=v_token) then return false; end if;
    elsif not exists(select 1 from unnest(v_source) t where t like 'w:%' and strpos(substr(t,3),substr(v_token,3))>0) then return false;
    end if;
  end loop;
  return true;
end;
$$;

create function mp_shared_private.quote_matches_search(p_data jsonb, p_query text)
returns boolean language sql immutable parallel safe security invoker set search_path = '' as $$
  select case when btrim(coalesce(p_query,''))='' then true else exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(p_data->'items')='array' and jsonb_array_length(p_data->'items')>0 then p_data->'items' else '[{}]'::jsonb end) item
    where mp_shared_private.search_text_matches(
      concat_ws(' ',p_data->>'clientName',p_data->>'contact',p_data->>'notes',item->>'description',item->>'height',item->>'width',item->>'measurements',item->>'details'),
      p_query,concat_ws(' ',item->>'height',item->>'width',item->>'measurements'))
  ) end;
$$;

revoke all on function mp_shared_private.search_number(text,integer),mp_shared_private.search_tokens(text),mp_shared_private.search_text_matches(text,text,text),mp_shared_private.quote_matches_search(jsonb,text) from public,anon,authenticated;
grant execute on function mp_shared_private.search_number(text,integer),mp_shared_private.search_tokens(text),mp_shared_private.search_text_matches(text,text,text),mp_shared_private.quote_matches_search(jsonb,text) to service_role;

CREATE OR REPLACE FUNCTION public.mp_shared_quote_requests(p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_auth jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
        and (p_payload->>'scope' = 'history' or (p_payload->>'scope' = 'active' and q.archived_at is null) or (p_payload->>'scope' = 'archived' and q.archived_at is not null))
        and (p_payload->>'filter' = 'all' or (p_payload->>'filter' = 'sent' and q.data->>'sent'='true')
          or (p_payload->>'filter' = 'pending' and q.data->>'sent'='false'))
        and mp_shared_private.quote_matches_search(q.data,coalesce(p_payload->>'search',''))
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
    insert into mp_shared_private.quote_requests (id,user_id,data,created_at,updated_at,sent_at,archived_at)
      values ((p_payload->>'id')::uuid,v_owner,v_data,v_now,v_now,case when v_data->>'sent'='true' then v_now else null end,case when v_data->>'sent'='true' then v_now else null end)
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
      if v_data->>'sent'='true' and v_request.data->>'sent' is distinct from 'true' then v_archived_at:=coalesce(v_archived_at,v_now); end if;
    else
      v_action := p_payload->>'action';
      if v_action='sent' then v_data:=jsonb_set(v_data,'{sent}','true'::jsonb); v_archived_at:=coalesce(v_archived_at,v_now);
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
$function$;

do $search_acceptance$
declare c jsonb; sample jsonb := $quote_sample${"clientName":"João Café","contact":"16981234567","notes":"Entrega na obra","items":[{"description":"Porta integrada 2 folhas","height":"2,30 m","width":"2,00 m","measurements":"","details":"Preto | Vidro temperado"},{"description":"Janela","height":"1,20 m","width":"1,50 m","measurements":"","details":"Branco"}]}$quote_sample$::jsonb;
begin
 for c in select jsonb_array_elements($search_cases$[["",true],["   ",true],["joao cafe",true],["CAFÉ",true],["cafe joao",true],["integrada",true],["temperado preto",true],["2,30",true],["2.30",true],["2.3 m",true],["2,30 x 2,00",true],["2.300 × 2.000",true],["2,30Ax2,00L",true],["Altura 2,30 largura 2,00",true],["230 × 200 cm",true],["230cm x 200cm",true],["2300 mm x 2000 mm",true],["João porta 230 cm",true],["2,35",false],["0,30",false],["1,2 x 2,3",false],["2,30 x 2,30",false],["2,30 x 1,50",false],["2,30 branco",false],["não existe",false],["%",false],["_",false],["16981234567",true],["entrega obra",true],["porta 3 folhas",false]]$search_cases$::jsonb) loop
  assert mp_shared_private.quote_matches_search(sample,c->>0) = (c->>1)::boolean, 'Search case failed: ' || (c->>0);
 end loop;
 assert not has_function_privilege('anon','mp_shared_private.quote_matches_search(jsonb,text)','execute'), 'Search helper exposed';
 assert not has_function_privilege('authenticated','mp_shared_private.search_tokens(text)','execute'), 'Search tokens exposed';
end;
$search_acceptance$;

