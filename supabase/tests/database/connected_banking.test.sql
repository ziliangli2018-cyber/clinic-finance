begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users(id, email)
values ('11000000-0000-4000-8000-000000000001', 'clinic-owner@example.invalid');
update private.runtime_config set environment = 'production', allow_mock_data = false where singleton;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$select public.create_live_organisation('Kilcoy & Burpengary Dental Group')$$,
  'Owner can create a production workspace'
);
select is((select count(*) from public.organisations), 1::bigint, 'One live organisation is visible');
select is((select count(*) from public.entities), 3::bigint, 'Live workspace has three business entities');
select results_eq(
  $$select name from public.entities order by name$$,
  $$values ('Burpengary'::text), ('Group finance'::text), ('Kilcoy'::text)$$,
  'The two clinics and group-finance bucket are provisioned'
);
select is(
  (select public.create_live_organisation('Retry')), (select id from public.organisations),
  'Live provisioning is idempotent for an owner'
);

reset role;
insert into private.banking_profiles(id, organisation_id, provider_user_id)
select '12000000-0000-4000-8000-000000000001', id, 'provider-user-one'
from public.organisations where name = 'Kilcoy & Burpengary Dental Group';

set local role service_role;
select lives_ok($sql$
  select public.ingest_basiq_snapshot(
    '12000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    '{
      "connections":[{"id":"13000000-0000-4000-8000-000000000001","provider_connection_id":"connection-boqs","institution_id":"AU20130","institution_name":"BOQ Specialist","status":"active","last_synced_at":"2026-10-06T01:00:00Z","consent_expires_at":"2027-09-01T00:00:00Z"}],
      "accounts":[{"id":"14000000-0000-4000-8000-000000000001","connection_id":"13000000-0000-4000-8000-000000000001","name":"Practice loan","institution":"BOQ Specialist","kind":"loan","balance_cents":-58400000,"available_funds_cents":null,"masked_number":"xxxx2217","updated_at":"2026-10-06T01:00:00Z"}],
      "transactions":[{"id":"15000000-0000-4000-8000-000000000001","account_id":"14000000-0000-4000-8000-000000000001","provider_transaction_id":"repayment-one","posted_at":"2026-10-01","description":"Loan repayment","merchant":null,"amount_cents":-185500,"status":"posted"}]
    }'::jsonb
  )
$sql$, 'Service ingestion accepts a BOQ Specialist loan snapshot');
select is(
  (select kind || ':' || balance_cents from public.accounts where id = '14000000-0000-4000-8000-000000000001'),
  'loan:-58400000',
  'Loan is stored as a liability account in integer cents'
);
select is(
  (select e.kind from public.accounts a join public.entities e on e.id = a.entity_id
    where a.id = '14000000-0000-4000-8000-000000000001'),
  'group',
  'New accounts default to Group finance'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$select public.set_account_entity(
    '14000000-0000-4000-8000-000000000001',
    (select id from public.entities where name = 'Kilcoy')
  )$$,
  'Owner can assign an account to Kilcoy'
);
select throws_ok(
  $$select public.set_account_entity('14000000-0000-4000-8000-000000000001','99999999-0000-4000-8000-000000000999')$$,
  '22023', null, 'Unknown or foreign entities are rejected'
);
select lives_ok(
  $$select public.set_transaction_category(
    '15000000-0000-4000-8000-000000000001',
    '210ec3ae-8e0b-4e4c-a942-e188137d06de'
  )$$,
  'Owner can categorise an imported transaction'
);

reset role;
set local role service_role;
select lives_ok($sql$
  select public.ingest_basiq_snapshot(
    '12000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    '{
      "connections":[{"id":"13000000-0000-4000-8000-000000000001","provider_connection_id":"connection-boqs","institution_id":"AU20130","institution_name":"BOQ Specialist","status":"active","last_synced_at":"2026-10-06T02:00:00Z","consent_expires_at":"2027-09-01T00:00:00Z"}],
      "accounts":[{"id":"14000000-0000-4000-8000-000000000001","connection_id":"13000000-0000-4000-8000-000000000001","name":"Practice loan","institution":"BOQ Specialist","kind":"loan","balance_cents":-57000000,"available_funds_cents":null,"masked_number":"xxxx2217","updated_at":"2026-10-06T02:00:00Z"}],
      "transactions":[{"id":"15000000-0000-4000-8000-000000000001","account_id":"14000000-0000-4000-8000-000000000001","provider_transaction_id":"repayment-one","posted_at":"2026-10-01","description":"Updated provider description","merchant":null,"amount_cents":-185500,"status":"posted"}]
    }'::jsonb
  )
$sql$, 'A repeated snapshot updates provider facts atomically');
select is(
  (select e.name from public.accounts a join public.entities e on e.id = a.entity_id
    where a.id = '14000000-0000-4000-8000-000000000001'),
  'Kilcoy',
  'Refresh preserves the manual clinic assignment'
);
select is(
  (select category_source || ':' || category_id from public.transactions
    where id = '15000000-0000-4000-8000-000000000001'),
  'manual:210ec3ae-8e0b-4e4c-a942-e188137d06de',
  'Refresh preserves a manual category'
);

select lives_ok($sql$
  select public.ingest_basiq_snapshot(
    '12000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    '{
      "connections":[{"id":"13000000-0000-4000-8000-000000000001","provider_connection_id":"connection-boqs","institution_id":"AU20130","institution_name":"BOQ Specialist","status":"active","last_synced_at":"2026-10-06T03:00:00Z","consent_expires_at":"2027-09-01T00:00:00Z"}],
      "accounts":[],
      "transactions":[]
    }'::jsonb
  )
$sql$, 'A complete snapshot may remove an account deselected in consent');
select is(
  (select count(*) from public.accounts)::text || ':' ||
    (select count(*) from public.transactions)::text,
  '0:0',
  'A deselected account and its transactions are removed locally'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok('select * from private.banking_profiles', '42501', null, 'Provider users are hidden from browsers');
select throws_ok(
  $$select public.ingest_basiq_snapshot('12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','{}')$$,
  '42501', null, 'Browser cannot invoke trusted Basiq ingestion'
);

reset role;
set local role service_role;
select lives_ok(
  $$select public.purge_basiq_data('12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001',false)$$,
  'Consent cleanup removes imported banking data'
);
select is((select count(*) from public.accounts), 0::bigint, 'Cleanup cascades through imported accounts');
select is((select count(*) from private.banking_profiles), 1::bigint, 'Consent renewal retains the provider profile');
select lives_ok(
  $$select public.purge_basiq_data('12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001',true)$$,
  'Full disconnection removes the banking profile'
);
select is((select count(*) from private.banking_profiles), 0::bigint, 'Disconnected profile is deleted');

select * from finish();
rollback;
