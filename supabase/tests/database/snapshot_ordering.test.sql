begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users(id, email) values
  ('81000000-0000-4000-8000-000000000001', 'snapshot-owner@example.invalid'),
  ('81000000-0000-4000-8000-000000000002', 'snapshot-viewer@example.invalid'),
  ('81000000-0000-4000-8000-000000000003', 'snapshot-other-owner@example.invalid');
insert into public.organisations(id, name, is_demo) values
  ('82000000-0000-4000-8000-000000000001', 'Snapshot ordering test', false),
  ('82000000-0000-4000-8000-000000000002', 'Other snapshot workspace', false);
insert into public.organisation_members(organisation_id, user_id, role) values
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'owner'),
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 'viewer'),
  ('82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000003', 'owner');
insert into public.entities(id, organisation_id, name, kind) values
  ('83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'Kilcoy test', 'clinic'),
  ('83000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', 'Burpengary test', 'clinic');
insert into private.banking_profiles(id, organisation_id, entity_id, provider_user_id) values
  ('84000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', 'snapshot-kilcoy-user'),
  ('84000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000002', 'snapshot-burpengary-user');

create temporary table snapshot_fixture (name text primary key, dataset jsonb not null);
insert into snapshot_fixture values ('newer', '{
  "connections":[{"id":"85000000-0000-4000-8000-000000000001","provider_connection_id":"ordered-nab","institution_id":"AU01001","institution_name":"NAB","status":"active","last_synced_at":"2026-10-13T02:00:00Z","consent_expires_at":"2027-09-01T00:00:00Z"}],
  "accounts":[{"id":"86000000-0000-4000-8000-000000000001","connection_id":"85000000-0000-4000-8000-000000000001","name":"Operating","institution":"NAB","kind":"operating","balance_cents":220000,"available_funds_cents":220000,"masked_number":"xxxx1234","updated_at":"2026-10-13T02:00:00Z"}],
  "transactions":[{"id":"87000000-0000-4000-8000-000000000001","account_id":"86000000-0000-4000-8000-000000000001","provider_transaction_id":"ordered-transaction","posted_at":"2026-10-13","description":"Newer provider description","merchant":null,"amount_cents":-3000,"status":"posted"}]
}'::jsonb), ('older', '{"connections":[],"accounts":[],"transactions":[]}'::jsonb);
grant select on snapshot_fixture to service_role;

set local role service_role;
select throws_ok(
  $$select public.claim_basiq_snapshot('84000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'A viewer cannot claim a sync generation'
);
select throws_ok(
  $$select public.claim_basiq_snapshot('84000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000003')$$,
  '42501', null, 'An owner of another workspace cannot claim a sync generation'
);
select is(public.claim_basiq_snapshot('84000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001'), 1::bigint, 'The first fetch claims generation one');
select is(public.claim_basiq_snapshot('84000000-0000-4000-8000-000000000001', null), 2::bigint, 'A scheduled fetch claims the next generation');
select is(public.claim_basiq_snapshot('84000000-0000-4000-8000-000000000002', null), 1::bigint, 'Another legal entity has an independent sequence');
select throws_ok(
  $$select public.ingest_basiq_snapshot_ordered('84000000-0000-4000-8000-000000000001', null, 3, (select dataset from snapshot_fixture where name='newer'))$$,
  '22023', null, 'An unclaimed future generation is rejected'
);
select throws_ok(
  $$select public.ingest_basiq_snapshot_ordered('84000000-0000-4000-8000-000000000001', null, 0, (select dataset from snapshot_fixture where name='newer'))$$,
  '22023', null, 'Generation zero cannot ingest a snapshot'
);
select throws_ok(
  $$select public.ingest_basiq_snapshot_ordered('84000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 2, (select dataset from snapshot_fixture where name='newer'))$$,
  '42501', null, 'A viewer cannot apply a claimed snapshot'
);
select is(
  public.ingest_basiq_snapshot_ordered('84000000-0000-4000-8000-000000000001', null, 2, (select dataset from snapshot_fixture where name='newer'))->>'skipped',
  'false', 'The newer generation applies first'
);
select is((select balance_cents from public.accounts where id='86000000-0000-4000-8000-000000000001'), 220000::bigint, 'The newest provider balance is stored');
select is((select last_applied_sync_generation from private.banking_profiles where id='84000000-0000-4000-8000-000000000001'), 2::bigint, 'Applying a snapshot advances the profile marker');
select is(
  public.ingest_basiq_snapshot_ordered('84000000-0000-4000-8000-000000000001', null, 1, (select dataset from snapshot_fixture where name='older'))->>'reason',
  'stale_snapshot', 'An older completed fetch is skipped'
);
select is((select count(*) from public.accounts where organisation_id='82000000-0000-4000-8000-000000000001'), 1::bigint, 'An older empty snapshot cannot remove the newest account');
select is((select description from public.transactions where id='87000000-0000-4000-8000-000000000001'), 'Newer provider description', 'An older fetch cannot overwrite transaction facts');
select is((select count(*) from public.processing_jobs where organisation_id='82000000-0000-4000-8000-000000000001'), 1::bigint, 'A skipped snapshot creates no processing job');
select is(public.purge_basiq_snapshot('84000000-0000-4000-8000-000000000001', null, 1), false, 'An older consent result cannot purge newer data');
select is(public.purge_basiq_snapshot('84000000-0000-4000-8000-000000000001', null, 2), false, 'A repeated generation cannot purge applied data');
select is(public.claim_basiq_snapshot('84000000-0000-4000-8000-000000000001', null), 3::bigint, 'A later consent check claims generation three');
select is(public.purge_basiq_snapshot('84000000-0000-4000-8000-000000000001', null, 3), true, 'The newest consent result can purge local banking data');
select is((select count(*) from public.accounts where organisation_id='82000000-0000-4000-8000-000000000001'), 0::bigint, 'A fresh purge removes imported accounts');
select is((select last_applied_sync_generation from private.banking_profiles where id='84000000-0000-4000-8000-000000000001'), 3::bigint, 'A fresh purge advances the applied marker');
select is(
  public.ingest_basiq_snapshot_ordered('84000000-0000-4000-8000-000000000001', null, 2, (select dataset from snapshot_fixture where name='newer'))->>'skipped',
  'true', 'An old fetch cannot restore data after a newer consent purge'
);
select is((select count(*) from public.accounts where organisation_id='82000000-0000-4000-8000-000000000001'), 0::bigint, 'Purged data stays absent after a delayed fetch');
select is((select last_applied_sync_generation from private.banking_profiles where id='84000000-0000-4000-8000-000000000002'), 0::bigint, 'Another legal entity remains untouched');

set local role authenticated;
set local request.jwt.claims = '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.claim_basiq_snapshot('84000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'Browser roles cannot claim trusted snapshot generations'
);
select throws_ok(
  $$select public.ingest_basiq_snapshot_ordered('84000000-0000-4000-8000-000000000001', null, 3, '{}'::jsonb)$$,
  '42501', null, 'Browser roles cannot invoke ordered ingestion'
);
select throws_ok(
  $$select public.purge_basiq_snapshot('84000000-0000-4000-8000-000000000001', null, 3)$$,
  '42501', null, 'Browser roles cannot invoke ordered purge'
);

select * from finish();
rollback;
