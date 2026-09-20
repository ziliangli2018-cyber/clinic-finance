begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users(id, email) values
  ('10000000-0000-4000-8000-000000000001','owner-a@example.invalid'),
  ('10000000-0000-4000-8000-000000000002','owner-b@example.invalid'),
  ('10000000-0000-4000-8000-000000000003','viewer-a@example.invalid');
insert into public.organisations(id, name, is_demo) values
  ('20000000-0000-4000-8000-000000000001','Test A',true),
  ('20000000-0000-4000-8000-000000000002','Test B',true);
insert into public.organisation_members(organisation_id,user_id,role) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','owner'),
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','viewer');
insert into public.entities(id,organisation_id,name,kind) values
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Clinic A','clinic'),
  ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Clinic B','clinic');
insert into public.bank_connections(id,organisation_id,entity_id,provider,status) values
  ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','mock','active'),
  ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','mock','active');
insert into public.accounts(id,organisation_id,entity_id,connection_id,name,institution,kind,balance_cents,masked_number) values
  ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','A','Mock','operating',10000,'1234'),
  ('50000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','B','Mock','operating',20000,'5678');
insert into public.categories(id,name,kind,colour) values ('60000000-0000-4000-8000-000000000001','Test supplies','expense','#336699');
insert into public.transactions(id,organisation_id,account_id,provider_transaction_id,posted_at,description,amount_cents,status) values
  ('70000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','test-a','2026-09-20','A expense',-1000,'posted'),
  ('70000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000002','test-b','2026-09-20','B expense',-2000,'posted');

set local role anon;
select throws_ok('select * from public.organisations','42501',null,'Anonymous users cannot read tenants');
select throws_ok($$select public.create_demo_organisation('No auth')$$,'42501',null,'Anonymous cannot create an organisation');

set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.organisations),1::bigint,'Owner sees only own tenant');
select is((select count(*) from public.accounts),1::bigint,'Owner sees only own accounts');
select is((select count(*) from public.transactions),1::bigint,'Owner sees only own transactions');
select is((select count(*) from public.organisation_members),1::bigint,'Membership listing exposes only current user');
select throws_ok($$select public.set_transaction_category('70000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001')$$,
  '42501',null,'RPC rejects categorisation in another tenant');
select lives_ok($$select public.set_transaction_category('70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001')$$,'Owner can categorise own transaction');
select is((select category_source from public.transactions),'manual','Category change is recorded as manual');
select is((select count(*) from public.audit_events where action='transaction.category_changed'),1::bigint,'Category change writes audit event');
select throws_ok($$update public.transactions set amount_cents=0$$,'42501',null,'Browser cannot rewrite ledger amounts');
select throws_ok($$insert into public.organisations(name) values('Forged')$$,'42501',null,'Browser cannot insert tenants');
select throws_ok($$update public.organisation_members set role='owner'$$,'42501',null,'Browser cannot escalate memberships');
select throws_ok($$select public.ingest_mock_dataset('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','{}')$$,
  '42501',null,'Browser cannot invoke trusted ingest');
select throws_ok('select * from private.provider_records','42501',null,'Raw provider records unavailable to browser');
select throws_ok('select * from private.runtime_config','42501',null,'Server runtime settings unavailable to browser');

set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*) from public.transactions),1::bigint,'Viewer may read own tenant');
select throws_ok($$select public.set_transaction_category('70000000-0000-4000-8000-000000000001',null)$$,'42501',null,'Viewer cannot categorise');
select is((select count(*) from public.audit_events),0::bigint,'Viewer cannot read editor audit trail');

set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select name from public.organisations),'Test B','Second owner sees their own tenant');
select throws_ok($$select public.set_transaction_category('70000000-0000-4000-8000-000000000001',null)$$,'42501',null,'Reverse tenant isolation holds');

reset role;
select throws_ok($$update public.accounts set connection_id='40000000-0000-4000-8000-000000000002' where id='50000000-0000-4000-8000-000000000001'$$,
  '23503',null,'Composite key prevents account crossing tenants even for server');
select throws_ok($$update public.transactions set account_id='50000000-0000-4000-8000-000000000002' where id='70000000-0000-4000-8000-000000000001'$$,
  '23503',null,'Composite key prevents transaction crossing tenants');
select throws_ok($$insert into public.receipts(organisation_id,transaction_id,storage_path) values('20000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001/receipt.pdf')$$,
  '23503',null,'Receipt cannot reference another tenant transaction');
select throws_ok($$update public.bank_connections set entity_id='30000000-0000-4000-8000-000000000002' where id='40000000-0000-4000-8000-000000000001'$$,
  '23503',null,'Connection cannot reference another tenant entity');
select throws_ok($$update public.accounts set balance_cents=9007199254740992 where id='50000000-0000-4000-8000-000000000001'$$,
  '23514',null,'Amounts remain within exact JavaScript integer range');
update private.runtime_config set environment='production',allow_mock_data=true;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$select public.create_demo_organisation('Production demo')$$,'42501',null,'Production DB rejects demo onboarding even when allow flag is true');
reset role;
update private.runtime_config set environment='demo',allow_mock_data=true;
set local role authenticated;
select is(public.create_demo_organisation('Retry demo'),'20000000-0000-4000-8000-000000000001'::uuid,'Repeated onboarding returns owned demo organisation');
reset role;
select ok((select not public from storage.buckets where id='receipts'),'Receipt bucket is private');
select is((select count(*) from pg_policies where schemaname='public' and cmd in ('INSERT','UPDATE','DELETE','ALL')),0::bigint,'No broad browser write policies');
select is((select count(*) from pg_tables where schemaname in ('public','private') and not rowsecurity),0::bigint,'All application tables have RLS enabled');
select * from finish();
rollback;
