begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users(id, email) values
  ('31000000-0000-4000-8000-000000000001', 'bulk-owner@example.invalid'),
  ('31000000-0000-4000-8000-000000000002', 'bulk-viewer@example.invalid');
insert into public.organisations(id, name) values
  ('32000000-0000-4000-8000-000000000001', 'Bulk workspace'),
  ('32000000-0000-4000-8000-000000000002', 'Other workspace');
insert into public.organisation_members(organisation_id, user_id, role) values
  ('32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'owner'),
  ('32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002', 'viewer');
insert into public.entities(id, organisation_id, name, kind) values
  ('33000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', 'Kilcoy', 'clinic'),
  ('33000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000002', 'Other', 'clinic');
insert into public.bank_connections(id, organisation_id, entity_id, provider, status) values
  ('34000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000001', 'basiq', 'active'),
  ('34000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000002', 'basiq', 'active');
insert into public.accounts(id, organisation_id, entity_id, connection_id, name, institution, kind, balance_cents, masked_number) values
  ('35000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000001', '34000000-0000-4000-8000-000000000001', 'NAB', 'NAB', 'operating', 100000, 'xxxx1234'),
  ('35000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000002', '34000000-0000-4000-8000-000000000002', 'Other', 'NAB', 'operating', 100000, 'xxxx5678');
insert into public.transactions(id, organisation_id, account_id, provider_transaction_id, posted_at, description, amount_cents, status) values
  ('36000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000001', 'a', '2026-10-01', 'Dental supplies', -10000, 'posted'),
  ('36000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000001', 'b', '2026-10-02', 'Dental supplies', -20000, 'posted'),
  ('36000000-0000-4000-8000-000000000003', '32000000-0000-4000-8000-000000000002', '35000000-0000-4000-8000-000000000002', 'c', '2026-10-02', 'Other business', -30000, 'posted');

set local role authenticated;
set local request.jwt.claims = '{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.set_transaction_categories(
  array['36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000002']::uuid[],
  '389e3b2c-30d8-4896-a9c7-f50ab328519c'), 2, 'Owner updates both selected transactions');
select is((select count(*) from public.transactions where category_source='manual'), 2::bigint, 'Both edits are marked manual');
select throws_ok($$select public.set_transaction_categories(
  array['36000000-0000-4000-8000-000000000001','36000000-0000-4000-8000-000000000003']::uuid[],
  '210ec3ae-8e0b-4e4c-a942-e188137d06de')$$, '42501', null, 'An inaccessible transaction rejects the entire batch');
select is((select category_id from public.transactions where id='36000000-0000-4000-8000-000000000001'),
  '389e3b2c-30d8-4896-a9c7-f50ab328519c'::uuid, 'Rejected batch leaves the first transaction unchanged');
select throws_ok($$select public.set_transaction_categories(array[]::uuid[], null)$$, '22023', null, 'Empty selection is rejected');
select throws_ok($$select public.set_transaction_categories(
  array['36000000-0000-4000-8000-000000000001']::uuid[],
  '31000000-0000-4000-8000-000000000099')$$, '22023', null, 'Unknown category is rejected');
set local request.jwt.claims = '{"sub":"31000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select public.set_transaction_categories(
  array['36000000-0000-4000-8000-000000000001']::uuid[], null)$$, '42501', null, 'Viewers cannot bulk edit');
reset role;
select is((select count(*) from public.audit_events where metadata->>'bulk'='true'), 2::bigint, 'Each changed row has an audit event');
set local role anon;
select throws_ok($$select public.set_transaction_categories(
  array['36000000-0000-4000-8000-000000000001']::uuid[], null)$$, '42501', null, 'Anonymous callers cannot bulk edit');
reset role;
select * from finish(true);
rollback;
