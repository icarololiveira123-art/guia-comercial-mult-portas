-- Native Supabase execute_sql acceptance test. No committed fixtures or DDL.
-- The fixture writes all occur in one atomic DO statement: an assertion error
-- rolls the statement back. On success the explicit ROLLBACK removes everything.
-- Explicit user IDs avoid advancing the production users identity sequence.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local role service_role;
do $test$
declare
  u1 constant bigint := 900719925440001;
  u2 constant bigint := 900719925440002;
  h1 constant text := repeat('197dc7f9a5364e78b1f012a47ab48117',2);
  h2 constant text := repeat('c7a319f9a5364e78b1f012a47ab48117',2);
  ha constant text := repeat('a73197f9a5364e78b1f012a47ab48117',2);
  v_request_id constant uuid := '6f430000-0010-4000-8000-000000000001';
  item_id constant uuid := '6f430000-0010-4000-8000-000000000002';
  create_mutation constant uuid := '6f430000-0010-4000-8000-000000000003';
  a1 jsonb := jsonb_build_object('tokenHash',h1,'adminVersion','quote-db-admin-version');
  a2 jsonb := jsonb_build_object('tokenHash',h2,'adminVersion','quote-db-admin-version');
  aa jsonb := jsonb_build_object('tokenHash',ha,'adminVersion','quote-db-admin-version');
  fields jsonb;
  original_create jsonb;
  original_update jsonb;
  result jsonb;
  previous jsonb;
  first_snapshot jsonb;
  list_page jsonb;
  second_page jsonb;
  record jsonb;
  current_revision integer;
  i integer;
  listed_ids uuid[] := '{}';
  privileged_role text;
begin
  if exists(select 1 from mp_shared_private.users where id in (u1,u2))
    or exists(select 1 from mp_shared_private.sessions where token_hash in (h1,h2,ha)) then
    raise exception 'Reserved QA identifiers already exist; test refuses to touch them';
  end if;
  foreach privileged_role in array array['anon','authenticated'] loop
    assert not has_schema_privilege(privileged_role,'mp_shared_private','USAGE'), 'Private schema accessible to browser role';
    assert not has_function_privilege(privileged_role,'public.mp_shared_quote_requests(text,jsonb,jsonb)','EXECUTE'), 'RPC exposed to browser role';
    assert not has_table_privilege(privileged_role,'mp_shared_private.quote_requests','SELECT,INSERT,UPDATE,DELETE'), 'Requests exposed to browser role';
    assert not has_table_privilege(privileged_role,'mp_shared_private.quote_request_versions','SELECT,INSERT,UPDATE,DELETE'), 'History exposed to browser role';
  end loop;
  assert has_function_privilege('service_role','public.mp_shared_quote_requests(text,jsonb,jsonb)','EXECUTE'), 'Backend cannot execute RPC';
  assert not has_table_privilege('service_role','mp_shared_private.quote_requests','DELETE'), 'Requests can be deleted by backend';
  assert not has_table_privilege('service_role','mp_shared_private.quote_request_versions','UPDATE,DELETE,TRUNCATE'), 'History is mutable';
  assert (select bool_and(relrowsecurity) from pg_class where oid in ('mp_shared_private.quote_requests'::regclass,'mp_shared_private.quote_request_versions'::regclass)), 'RLS disabled';
  assert not (select prosecdef from pg_proc where oid='public.mp_shared_quote_requests(text,jsonb,jsonb)'::regprocedure), 'Unexpected SECURITY DEFINER';

  insert into mp_shared_private.users(id,username,username_normalized,display_name,branch,password_proof,session_version)
  values (u1,'qa_quote_db_owner','qa_quote_db_owner','QA Quote Owner','Araraquara','{}','qa-quote-version-1'),
         (u2,'qa_quote_db_other','qa_quote_db_other','QA Quote Other','São Carlos','{}','qa-quote-version-2');
  insert into mp_shared_private.sessions(token_hash,role,user_id,user_version,expires_at)
  values (h1,'user',u1,'qa-quote-version-1',clock_timestamp()+interval '1 hour'),
         (h2,'user',u2,'qa-quote-version-2',clock_timestamp()+interval '1 hour'),
         (ha,'admin',null,'quote-db-admin-version',clock_timestamp()+interval '1 hour');
  fields := jsonb_build_object('clientName','QA Cliente Café','contact','16900000000','requestedOn','2026-10-16',
    'notes','Dimensões livres e conservação do histórico','sent',false,'amountCents',125050,
    'items',jsonb_build_array(jsonb_build_object('id',item_id,'description','Porta integrada 2 folhas',
      'measurements','2,30Ax2,00L','quantity',1,'details','Preto | VD Temp')));
  original_create := jsonb_build_object('userId',u1,'id',v_request_id,'mutationId',create_mutation,'data',fields);
  result := public.mp_shared_quote_requests('quote_create',original_create,a1);
  assert (result->'request'->>'revision')::integer=1, 'Create revision incorrect';
  assert (result->'request'->>'amountCents')::integer=125050, 'Initial amount lost';
  assert result->'request'->'items'->0->>'measurements'='2,30Ax2,00L', 'Free-text measurements changed';
  assert not (result->'request' ? 'user_id') and not (result->'request' ? 'password'), 'Private metadata leaked';
  assert result->'request'->>'createdAt'=result->'request'->>'updatedAt', 'Creation timestamps inconsistent';
  first_snapshot := result->'request';
  result := public.mp_shared_quote_requests('quote_create',original_create,a1);
  assert result->>'replayed'='true' and (result->'request'->>'revision')::integer=1, 'Create is not idempotent';

  original_update := jsonb_build_object('userId',u1,'id',v_request_id,'mutationId',gen_random_uuid(),'baseRevision',1,
    'data',jsonb_set(fields,'{amountCents}','250000'::jsonb));
  result := public.mp_shared_quote_requests('quote_update',original_update,a1);
  assert (result->'request'->>'revision')::integer=2 and (result->'request'->>'amountCents')::integer=250000, 'Amount edit failed';
  assert result->'request'->>'createdAt'=first_snapshot->>'createdAt', 'Creation date changed on edit';
  result := public.mp_shared_quote_requests('quote_create',original_create,a1);
  assert result->>'replayed'='true' and (result->'request'->>'revision')::integer=2
    and (result->'request'->>'amountCents')::integer=250000, 'Retried create reverted newer data';
  result := public.mp_shared_quote_requests('quote_update',jsonb_set(original_update,'{data,amountCents}','1'::jsonb),a1);
  assert result->>'status'='quote-conflict', 'Mutation replay accepted different amount';
  result := public.mp_shared_quote_requests('quote_update',original_update||jsonb_build_object('mutationId',gen_random_uuid()),a1);
  assert result->>'status'='quote-conflict' and (result->'request'->>'revision')::integer=2, 'Stale CAS accepted';

  result := public.mp_shared_quote_requests('quote_update',jsonb_build_object('userId',u1,'id',v_request_id,
    'mutationId',gen_random_uuid(),'baseRevision',2,'data',jsonb_set(fields,'{amountCents}','null'::jsonb)),a1);
  assert (result->'request'->>'revision')::integer=3 and result->'request'->'amountCents'='null'::jsonb, 'Amount cannot be cleared';
  result := public.mp_shared_quote_requests('quote_update',jsonb_build_object('userId',u1,'id',v_request_id,
    'mutationId',gen_random_uuid(),'baseRevision',3,'data',jsonb_set(fields,'{amountCents}','0'::jsonb)),a1);
  assert (result->'request'->>'revision')::integer=4 and (result->'request'->>'amountCents')::integer=0, 'Zero amount lost';
  assert (select snapshot from mp_shared_private.quote_request_versions where request_id=(first_snapshot->>'id')::uuid and revision=1)=first_snapshot, 'First snapshot mutated';
  assert (select (snapshot->>'amountCents')::integer from mp_shared_private.quote_request_versions where request_id='6f430000-0010-4000-8000-000000000001' and revision=2)=250000, 'Prior edited amount lost';
  assert (select snapshot->'amountCents' from mp_shared_private.quote_request_versions where request_id='6f430000-0010-4000-8000-000000000001' and revision=3)='null'::jsonb, 'Cleared amount snapshot lost';

  result := public.mp_shared_quote_requests('quote_get',jsonb_build_object('userId',u1,'id',v_request_id),a2);
  assert result->>'status'='forbidden', 'Other user can forge owner ID';
  result := public.mp_shared_quote_requests('quote_get',jsonb_build_object('userId',u2,'id',v_request_id),a2);
  assert result->>'status'='quote-not-found' and not(result ? 'request'), 'Other account can read request';
  result := public.mp_shared_quote_requests('quote_history',jsonb_build_object('userId',u2,'id',v_request_id),a2);
  assert result->>'status'='quote-not-found', 'Other account can read revisions';
  result := public.mp_shared_quote_requests('quote_update',original_update||jsonb_build_object('userId',u2),a2);
  assert result->>'status'='quote-not-found', 'Other account can write request';
  result := public.mp_shared_quote_requests('quote_create',original_create||jsonb_build_object('userId',u2),a2);
  assert result->>'status'='quote-conflict' and not(result ? 'request'), 'Create collision leaks other account';
  result := public.mp_shared_quote_requests('quote_get',jsonb_build_object('userId',u1,'id',v_request_id),aa);
  assert (result->'request'->>'revision')::integer=4, 'Authorized scoped workspace cannot read';
  result := public.mp_shared_quote_requests('quote_get',jsonb_build_object('userId',u1,'id',v_request_id),aa||'{"adminVersion":"invalid"}'::jsonb);
  assert result->>'status'='unauthorized', 'Privileged version rotation ignored';
  result := public.mp_shared_quote_requests('quote_get',jsonb_build_object('userId',u1,'id',v_request_id),null);
  assert result->>'status'='unauthorized', 'Missing session accepted';

  current_revision:=4;
  foreach privileged_role in array array['sent','unsent','archived','restored'] loop
    result := public.mp_shared_quote_requests('quote_action',jsonb_build_object('userId',u1,'id',v_request_id,
      'mutationId',gen_random_uuid(),'baseRevision',current_revision,'action',privileged_role),a1);
    current_revision:=current_revision+1;
    assert (result->'request'->>'revision')::integer=current_revision, 'Action revision failed';
    assert (result->'request'->>'amountCents')::integer=0, 'Status action lost amount';
    if privileged_role='sent' then
      assert result->'request'->>'sent'='true' and result->'request'->>'sentAt' is not null, 'Sent status missing';
    elsif privileged_role='unsent' then
      assert result->'request'->>'sent'='false' and result->'request'->'sentAt'='null'::jsonb, 'Unsent timestamp retained';
    elsif privileged_role='archived' then
      assert result->'request'->>'archivedAt' is not null, 'Archive timestamp missing';
      previous := public.mp_shared_quote_requests('quote_list',jsonb_build_object('userId',u1,'scope','active','filter','all'),a1);
      assert jsonb_array_length(previous->'requests')=0, 'Archived request still in active list';
      previous := public.mp_shared_quote_requests('quote_list',jsonb_build_object('userId',u1,'scope','history','filter','all'),a1);
      assert jsonb_array_length(previous->'requests')=1 and (previous->'counts'->>'archived')::integer=1, 'Archived request missing from history';
    elsif privileged_role='restored' then
      assert result->'request'->'archivedAt'='null'::jsonb, 'Restore timestamp retained';
    end if;
  end loop;
  result := public.mp_shared_store('save_state',jsonb_build_object('userId',u1,'state','{}'::jsonb,
    'baseRevision',null,'revision','qa-state-1','clientState','{"schemaVersion":1}'::jsonb),a1);
  assert result->>'ok'='true', 'Legacy state save failed';
  result := public.mp_shared_store('save_state',jsonb_build_object('userId',u1,'state','{"marketingDaily":{}}'::jsonb,
    'baseRevision','qa-state-1','revision','qa-state-2'),a1);
  assert result->>'ok'='true', 'Legacy state replacement failed';
  result := public.mp_shared_quote_requests('quote_get',jsonb_build_object('userId',u1,'id',v_request_id),a1);
  assert (result->'request'->>'revision')::integer=current_revision, 'Legacy state save erased request';
  assert (select count(*) from mp_shared_private.quote_request_versions where request_id='6f430000-0010-4000-8000-000000000001')=current_revision, 'Legacy state save erased history';

  -- More than one history page: keyset must retain every older snapshot.
  for i in 1..26 loop
    result := public.mp_shared_quote_requests('quote_update',jsonb_build_object('userId',u1,'id',v_request_id,
      'mutationId',gen_random_uuid(),'baseRevision',current_revision,
      'data',jsonb_set(fields,'{amountCents}',to_jsonb(i))),a1);
    current_revision:=current_revision+1;
    assert (result->'request'->>'revision')::integer=current_revision, 'History fixture update failed';
  end loop;
  list_page := public.mp_shared_quote_requests('quote_history',jsonb_build_object('userId',u1,'id',v_request_id),a1);
  assert jsonb_array_length(list_page->'versions')=26, 'History sentinel page wrong';
  assert (list_page->'versions'->0->>'revision')::integer=current_revision, 'History newest first ordering wrong';
  second_page := public.mp_shared_quote_requests('quote_history',jsonb_build_object('userId',u1,'id',v_request_id,
    'beforeRevision',(list_page->'versions'->24->>'revision')::integer),a1);
  assert jsonb_array_length(second_page->'versions')=current_revision-25, 'History keyset skipped or repeated records';
  assert second_page->'versions'->-1->'snapshot'=first_snapshot, 'Oldest snapshot lost through pagination';

  -- 28 tied timestamps and microsecond precision must be disambiguated by ID.
  for i in 100..127 loop
    result := public.mp_shared_quote_requests('quote_create',jsonb_build_object('userId',u1,
      'id',('6f430000-0010-4000-8000-'||lpad(i::text,12,'0'))::uuid,'mutationId',gen_random_uuid(),
      'data',(fields-'amountCents')||'{"clientName":"QA Página"}'::jsonb),a1);
    assert result->'request'->>'revision'='1', 'List fixture create failed';
  end loop;
  update mp_shared_private.quote_requests set created_at='2026-10-16T18:00:00.123456Z'::timestamptz
    where user_id=u1 and id<>'6f430000-0010-4000-8000-000000000001';
  list_page := public.mp_shared_quote_requests('quote_list',jsonb_build_object('userId',u1,'scope','active','filter','all','search','página'),a1);
  assert jsonb_array_length(list_page->'requests')=26, 'List sentinel page wrong';
  second_page := public.mp_shared_quote_requests('quote_list',jsonb_build_object('userId',u1,'scope','active','filter','all','search','página',
    'cursorAt',list_page->'requests'->24->>'createdAt','cursorId',list_page->'requests'->24->>'id'),a1);
  assert jsonb_array_length(second_page->'requests')=3, 'List cursor skipped or duplicated tied timestamps';
  for record in select value from jsonb_array_elements(((list_page->'requests') - 25) || (second_page->'requests')) loop
    assert not((record->>'id')::uuid=any(listed_ids)), 'List cursor duplicated request';
    listed_ids:=array_append(listed_ids,(record->>'id')::uuid);
  end loop;
  assert cardinality(listed_ids)=28, 'List cursor omitted requests';
  assert not (second_page->'requests'->0 ? 'amountCents'), 'Legacy record without amount was fabricated';
  assert (list_page->'counts'->>'total')::integer=29, 'Total count excludes saved records';

  update mp_shared_private.sessions set revoked_at=clock_timestamp() where token_hash=h1;
  result := public.mp_shared_quote_requests('quote_get',jsonb_build_object('userId',u1,'id',v_request_id),a1);
  assert result->>'status'='unauthorized', 'Revoked session accepted';
  update mp_shared_private.sessions set revoked_at=null,expires_at=clock_timestamp()-interval '1 minute' where token_hash=h1;
  result := public.mp_shared_quote_requests('quote_get',jsonb_build_object('userId',u1,'id',v_request_id),a1);
  assert result->>'status'='unauthorized', 'Expired session accepted';
  update mp_shared_private.sessions set expires_at=clock_timestamp()+interval '1 hour' where token_hash=h1;
  update mp_shared_private.users set session_version='qa-quote-version-rotated' where id=u1;
  result := public.mp_shared_quote_requests('quote_get',jsonb_build_object('userId',u1,'id',v_request_id),a1);
  assert result->>'status'='unauthorized', 'Account version rotation ignored';
  update mp_shared_private.users set deleted_at=clock_timestamp() where id=u1;
  result := public.mp_shared_quote_requests('quote_get',jsonb_build_object('userId',u1,'id',v_request_id),aa);
  assert result->>'status'='not-found', 'Deleted target workspace still accessible';
end;
$test$;
rollback;
-- This final result is also the cleanup proof after the transaction.
select
  not exists(select 1 from mp_shared_private.users where id in (900719925440001,900719925440002)) as no_fixture_users,
  not exists(select 1 from mp_shared_private.quote_requests where user_id in (900719925440001,900719925440002)) as no_fixture_requests,
  not exists(select 1 from mp_shared_private.quote_request_versions where request_id='6f430000-0010-4000-8000-000000000001') as no_fixture_history,
  not exists(select 1 from mp_shared_private.sessions where token_hash in (
    repeat('197dc7f9a5364e78b1f012a47ab48117',2),repeat('c7a319f9a5364e78b1f012a47ab48117',2),repeat('a73197f9a5364e78b1f012a47ab48117',2))) as no_fixture_sessions;
