-- The only table-access role is the private Edge Function backend. Employee
-- sessions are checked atomically by mp_shared_store; browser roles get no
-- schema, table or RPC grants. These policies document that access model.
create policy mp_backend_only on mp_shared_private.users
  for all to service_role using (true) with check (true);
create policy mp_backend_only on mp_shared_private.user_state
  for all to service_role using (true) with check (true);
create policy mp_backend_only on mp_shared_private.sessions
  for all to service_role using (true) with check (true);
create policy mp_backend_only on mp_shared_private.rate_limits
  for all to service_role using (true) with check (true);
create policy mp_backend_only on mp_shared_private.access_config
  for all to service_role using (true) with check (true);
create policy mp_backend_only on mp_shared_private.import_batches
  for all to service_role using (true) with check (true);
create policy mp_backend_only on mp_shared_private.import_records
  for all to service_role using (true) with check (true);

-- Cover the retained imported-account reference for owner lookups and FK
-- maintenance without changing the historical-record retention behavior.
create index mp_import_records_user on mp_shared_private.import_records(user_id);
