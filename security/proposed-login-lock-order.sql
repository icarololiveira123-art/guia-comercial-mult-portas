-- PROPOSAL ONLY: not applied. Requires approval before production execution.
-- Lock the user exclusively before the login trigger updates presence.
-- This prevents two FOR SHARE holders from both attempting a lock upgrade.
set lock_timeout = '3s';
set statement_timeout = '20s';

do $security_lock_order$
declare
  current_definition text;
  old_clause constant text := $old$and deleted_at is null and session_version = p_payload->>'version' for share;$old$;
  new_clause constant text := $new$and deleted_at is null and session_version = p_payload->>'version' for update;$new$;
begin
  select pg_get_functiondef('public.mp_shared_store(text,jsonb,jsonb)'::regprocedure) into current_definition;
  if position(old_clause in current_definition) = 0 then
    if position(new_clause in current_definition) > 0 then return; end if;
    raise exception 'Unexpected create_session definition; refusing automatic replacement';
  end if;
  if (length(current_definition)-length(replace(current_definition,old_clause,''))) / length(old_clause) <> 1 then
    raise exception 'Ambiguous create_session definition; refusing automatic replacement';
  end if;
  execute replace(current_definition,old_clause,new_clause);
end;
$security_lock_order$;

reset lock_timeout;
reset statement_timeout;
