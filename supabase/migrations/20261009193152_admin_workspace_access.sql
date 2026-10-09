-- Workspace access retains the original panel session. No employee credential
-- or employee session is issued, and each operation revalidates that session.
create table mp_shared_private.workspace_access_log (
  id bigint generated always as identity primary key,
  target_user_id bigint not null references mp_shared_private.users(id),
  session_token_hash text not null check (session_token_hash ~ '^[a-f0-9]{64}$'),
  opened_at timestamptz not null default clock_timestamp()
);
create index mp_workspace_access_user_time on mp_shared_private.workspace_access_log (target_user_id, opened_at desc);
alter table mp_shared_private.workspace_access_log enable row level security;
revoke all on mp_shared_private.workspace_access_log from public, anon, authenticated;
grant select, insert on mp_shared_private.workspace_access_log to service_role;
grant usage, select on sequence mp_shared_private.workspace_access_log_id_seq to service_role;
create policy mp_backend_only on mp_shared_private.workspace_access_log
  for all to service_role using (true) with check (true);

create function public.mp_shared_workspace_access(p_action text, p_payload jsonb default '{}'::jsonb, p_auth jsonb default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
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
$$;
revoke all on function public.mp_shared_workspace_access(text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.mp_shared_workspace_access(text,jsonb,jsonb) to service_role;
