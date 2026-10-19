-- Revert every fixture; do not consume identity values or retain accounts.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
set local role service_role;
do $security_acceptance$
declare
  uid constant bigint := 900719925452001;
  h1 constant text := repeat('a5f0d4c3',8);
  h2 constant text := repeat('b5f0d4c3',8);
  response jsonb;
  exposed_count integer;
begin
  if exists(select 1 from mp_shared_private.users where id=uid)
    or exists(select 1 from mp_shared_private.sessions where token_hash in(h1,h2)) then
    raise exception 'Reserved security fixture exists; refusing to touch it';
  end if;
  assert not has_schema_privilege('anon','mp_shared_private','USAGE');
  assert not has_schema_privilege('authenticated','mp_shared_private','USAGE');
  select count(*) into exposed_count from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='mp_shared_private' and c.relkind in('r','p')
      and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'));
  assert exposed_count=0,'A private table is exposed';
  select count(*) into exposed_count from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where ((n.nspname='public' and p.proname like 'mp_shared_%') or n.nspname='mp_shared_private')
      and (p.prosecdef or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'));
  assert exposed_count=0,'An RPC or helper is exposed or became definer';
  assert position($clause$and deleted_at is null and session_version = p_payload->>'version' for update;$clause$
    in pg_get_functiondef('public.mp_shared_store(text,jsonb,jsonb)'::regprocedure))>0,'Login still upgrades a shared row lock';
  insert into mp_shared_private.users(id,username,username_normalized,display_name,branch,password_proof,session_version)
    values(uid,'qa_security_login','qa_security_login','QA Security Fixture','Araraquara','{}','qa-security-version');
  response:=public.mp_shared_store('create_session',jsonb_build_object('tokenHash',h1,'role','user','userId',uid,
    'version','qa-security-version','expiresAt',clock_timestamp()+interval '10 minutes'),null);
  assert response->>'ok'='true','First session failed';
  response:=public.mp_shared_store('create_session',jsonb_build_object('tokenHash',h2,'role','user','userId',uid,
    'version','qa-security-version','expiresAt',clock_timestamp()+interval '10 minutes'),null);
  assert response->>'ok'='true','Second session failed';
  assert (select count(*)=2 from mp_shared_private.sessions where token_hash in(h1,h2));
  assert (select last_login_at is not null and last_active_at is not null from mp_shared_private.users where id=uid);
  assert (select count(*)=1 from mp_shared_private.daily_snapshots where user_id=uid);
  response:=public.mp_shared_store('create_session',jsonb_build_object('tokenHash',repeat('c5f0d4c3',8),'role','user','userId',uid,
    'version','wrong-version','expiresAt',clock_timestamp()+interval '10 minutes'),null);
  assert response->>'status'='version-conflict','A stale account version created a session';
end;
$security_acceptance$;
rollback;
select not exists(select 1 from mp_shared_private.users where id=900719925452001) as no_fixture_users,
 not exists(select 1 from mp_shared_private.sessions where token_hash in(repeat('a5f0d4c3',8),repeat('b5f0d4c3',8),repeat('c5f0d4c3',8))) as no_fixture_sessions,
 not exists(select 1 from mp_shared_private.daily_snapshots where user_id=900719925452001) as no_fixture_backups;
