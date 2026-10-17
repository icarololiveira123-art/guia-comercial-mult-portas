-- Native acceptance test. Every fixture is rolled back, including trigger
-- records. Fixed IDs avoid advancing any production identity sequence.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local role service_role;
do $test$
declare
 u1 constant bigint:=900719925450001; u2 constant bigint:=900719925450002;
 h1 constant text:=repeat('c517e7c9',8); h2 constant text:=repeat('d517e7c9',8); ha constant text:=repeat('e517e7c9',8);
 a1 jsonb:=jsonb_build_object('tokenHash',h1,'adminVersion','qa-activity-version');
 a2 jsonb:=jsonb_build_object('tokenHash',h2,'adminVersion','qa-activity-version');
 aa jsonb:=jsonb_build_object('tokenHash',ha,'adminVersion','qa-activity-version');
 today date:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date;
 r jsonb; d jsonb; s jsonb; original jsonb; before_activity timestamptz; changed timestamptz;
 event_id uuid; count_before integer; old_capture timestamptz;
 q constant uuid:='7f430000-0010-4000-8000-000000000001';
begin
 if exists(select 1 from mp_shared_private.users where id in(u1,u2)) or exists(select 1 from mp_shared_private.sessions where token_hash in(h1,h2,ha)) or exists(select 1 from mp_shared_private.quote_requests where id=q) then raise exception 'Reserved QA IDs exist; refusing to touch them'; end if;
 assert not has_function_privilege('anon','public.mp_shared_activity(text,jsonb,jsonb)','EXECUTE');
 assert not has_function_privilege('authenticated','public.mp_shared_activity(text,jsonb,jsonb)','EXECUTE');
 assert not has_table_privilege('service_role','mp_shared_private.activity_events','UPDATE,DELETE,TRUNCATE');
 assert not has_table_privilege('service_role','mp_shared_private.daily_snapshots','DELETE,TRUNCATE');
 assert (select bool_and(relrowsecurity) from pg_class where oid in('mp_shared_private.activity_events'::regclass,'mp_shared_private.daily_snapshots'::regclass));
 assert ('2026-10-18T02:59:59Z'::timestamptz at time zone 'America/Sao_Paulo')::date='2026-10-17';
 assert ('2026-10-18T03:00:00Z'::timestamptz at time zone 'America/Sao_Paulo')::date='2026-10-18';
 insert into mp_shared_private.users(id,username,username_normalized,display_name,branch,password_proof,session_version) values
 (u1,'qa_activity_owner','qa_activity_owner','QA Activity Owner','Araraquara','{"hash":"never-export-this-proof"}','qa-a1'),
 (u2,'qa_activity_other','qa_activity_other','QA Activity Other','São Carlos','{}','qa-a2');
 insert into mp_shared_private.sessions(token_hash,role,user_id,user_version,expires_at) values
 (h1,'user',u1,'qa-a1',clock_timestamp()+interval '1 hour'),(h2,'user',u2,'qa-a2',clock_timestamp()+interval '1 hour'),
 (ha,'admin',null,'qa-activity-version',clock_timestamp()+interval '1 hour');
 assert (select last_login_at is not null and last_active_at is not null from mp_shared_private.users where id=u1), 'Employee login not recorded';
 assert (select count(*)=2 from mp_shared_private.daily_snapshots where user_id in(u1,u2)), 'Read-only users missing daily copy';
 s:='{"schemaVersion":4,"marketingDaily":{"days":[{"date":"2026-10-17","counters":{"novos":4}}]},"metrics":{"quotes":2}}';
 r:=public.mp_shared_store('save_state',jsonb_build_object('userId',u1,'state',s,'baseRevision',null,'clientState','{"schemaVersion":1}'::jsonb,'revision','qa-r1'),a1);
 assert r->>'revision'='qa-r1','First save failed';
 select id into event_id from mp_shared_private.activity_events where user_id=u1 and kind='workspace';
 assert (select actor_role='user' and actor_user_id=u1 and after_data->'state'=s from mp_shared_private.activity_events where id=event_id),'Audit missing employee attribution or full changed values';
 d:=public.mp_shared_activity('daily_get',jsonb_build_object('userId',u1,'day',today),aa);
 assert d->'snapshot'->'state'=s,'Cloud copy differs from workspace';
 select last_changed_at into changed from mp_shared_private.users where id=u1;
 select count(*) into count_before from mp_shared_private.activity_events where user_id=u1;
 r:=public.mp_shared_store('save_state',jsonb_build_object('userId',u1,'state',s,'baseRevision','qa-r1','revision','qa-noop'),a1);
 assert r->>'revision'='qa-r1','Identical state created a false new revision';
 assert (select last_changed_at=changed from mp_shared_private.users where id=u1),'Identical save changed timestamp';
 assert (select count(*)=count_before from mp_shared_private.activity_events where user_id=u1),'Identical save created false audit';
 -- Give the fixture an older genuine presence, then inspect and edit via panel.
 update mp_shared_private.users set last_active_at=clock_timestamp()-interval '2 hours' where id=u1 returning last_active_at into before_activity;
 r:=public.mp_shared_store('get_user_detail',jsonb_build_object('userId',u1),aa);
 assert (r->'user'->>'lastActiveAt')::timestamptz=before_activity,'Directory shows save time instead of employee presence';
 r:=public.mp_shared_workspace_access('workspace_open',jsonb_build_object('userId',u1,'recordAccess',true),aa);
 r:=public.mp_shared_workspace_access('workspace_read',jsonb_build_object('userId',u1),aa);
 r:=public.mp_shared_workspace_access('workspace_save',jsonb_build_object('userId',u1,'state',jsonb_set(s,'{metrics,quotes}','3'),'baseRevision','qa-r1','revision','qa-r2'),aa);
 assert r->>'revision'='qa-r2';
 assert (select last_active_at=before_activity from mp_shared_private.users where id=u1),'Panel view/edit overwrote employee presence';
 assert (select actor_role='admin' and before_data->'state'->'metrics'->>'quotes'='2' and after_data->'state'->'metrics'->>'quotes'='3' from mp_shared_private.activity_events where user_id=u1 and kind='workspace' order by changed_at desc limit 1),'Panel changes not distinguishable';
 r:=public.mp_shared_activity('activity_list',jsonb_build_object('userId',u1),a2);
 assert r->>'status'='forbidden','Employee can read another audit';
 r:=public.mp_shared_activity('daily_accounts',jsonb_build_object('day',today),a1);
 assert r->>'status'='forbidden','Employee can read backup directory';
 r:=public.mp_shared_activity('activity_touch',jsonb_build_object('userId',u1),aa);
 assert r->>'status'='forbidden','Panel can forge employee heartbeat';
 r:=public.mp_shared_activity('activity_touch',jsonb_build_object('userId',u2),a1);
 assert r->>'status'='forbidden','Employee can forge another heartbeat';
 r:=public.mp_shared_activity('activity_touch',jsonb_build_object('userId',u1),a1);
 assert r->>'ok'='true' and (select last_active_at>before_activity from mp_shared_private.users where id=u1),'Genuine presence does not advance';
 r:=public.mp_shared_activity('activity_get',jsonb_build_object('userId',u2,'id',event_id),aa);
 assert r->>'status'='not-found','Audit ID crosses profile boundaries';
 r:=public.mp_shared_activity('daily_get',jsonb_build_object('userId',u2,'day',today),aa);
 assert r->'snapshot'->'state'='null'::jsonb,'State mixed between users';
 original:=d->'snapshot'->'state';
 update mp_shared_private.daily_snapshots set business_day=today-1 where user_id=u1 and business_day=today;
 select state,captured_at into original,old_capture from mp_shared_private.daily_snapshots where user_id=u1 and business_day=today-1;
 r:=public.mp_shared_store('save_state',jsonb_build_object('userId',u1,'state',jsonb_set(s,'{metrics,quotes}','4'),'baseRevision','qa-r2','revision','qa-r3'),a1);
 assert (select state=original and captured_at=old_capture from mp_shared_private.daily_snapshots where user_id=u1 and business_day=today-1),'Previous closing overwritten';
 r:=public.mp_shared_activity('daily_list',jsonb_build_object('userId',u1),aa);
 assert (r->'days'->0->>'closed')::boolean=false and (r->'days'->1->>'closed')::boolean=true,'Business day closing incorrect';
 r:=public.mp_shared_quote_requests('quote_create',jsonb_build_object('userId',u1,'id',q,'mutationId',gen_random_uuid(),'data',
  jsonb_build_object('clientName','QA Audit Client','contact','16900000000','requestedOn',today,'notes','','sent',false,'items','[]'::jsonb)),a1);
 assert r->'request'->>'revision'='1','Quote creation failed';
 assert (select actor_role='user' and title='Pedido: QA Audit Client' from mp_shared_private.activity_events where user_id=u1 and kind='quote'),'Quote changes missing from activity';
 d:=public.mp_shared_activity('daily_get',jsonb_build_object('userId',u1,'day',today),aa);
 r:=public.mp_shared_activity('daily_quotes',jsonb_build_object('userId',u1,'day',today,'capturedAt',d->'snapshot'->>'capturedAt'),aa);
 assert r->'quotes'->0->'snapshot'->>'clientName'='QA Audit Client','Daily copy lost quote';
 r:=public.mp_shared_activity('daily_quotes',jsonb_build_object('userId',u2,'day',today,'capturedAt',clock_timestamp()),aa);
 assert r->>'status'='snapshot-conflict','Download can silently mix snapshot versions';
 r:=public.mp_shared_activity('activity_get',jsonb_build_object('userId',u1,'id',event_id),aa);
 assert not r::text like '%never-export-this-proof%' and not r::text like '%tokenHash%', 'Secrets entered audit';
 update mp_shared_private.sessions set revoked_at=clock_timestamp() where token_hash=ha;
 r:=public.mp_shared_activity('daily_get',jsonb_build_object('userId',u1,'day',today),aa);
 assert r->>'status'='unauthorized','Revoked session can read backup';
end;
$test$;
rollback;
select not exists(select 1 from mp_shared_private.users where id in(900719925450001,900719925450002)) as no_fixture_users,
 not exists(select 1 from mp_shared_private.activity_events where user_id in(900719925450001,900719925450002)) as no_fixture_audit,
 not exists(select 1 from mp_shared_private.daily_snapshots where user_id in(900719925450001,900719925450002)) as no_fixture_backups,
 not exists(select 1 from mp_shared_private.quote_requests where id='7f430000-0010-4000-8000-000000000001') as no_fixture_quotes;
