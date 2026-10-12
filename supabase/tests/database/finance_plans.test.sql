begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users(id, email) values
  ('91000000-0000-4000-8000-000000000001', 'plan-owner-a@example.invalid'),
  ('91000000-0000-4000-8000-000000000002', 'plan-owner-b@example.invalid'),
  ('91000000-0000-4000-8000-000000000003', 'plan-viewer-a@example.invalid'),
  ('91000000-0000-4000-8000-000000000004', 'plan-admin-a@example.invalid');
insert into public.organisations(id, name, is_demo) values
  ('92000000-0000-4000-8000-000000000001', 'Plan workspace A', false),
  ('92000000-0000-4000-8000-000000000002', 'Plan workspace B', false);
insert into public.organisation_members(organisation_id, user_id, role) values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'owner'),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', 'owner'),
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000003', 'viewer'),
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000004', 'admin');
insert into public.entities(id, organisation_id, name, kind) values
  ('93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'Kilcoy test', 'clinic'),
  ('93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', 'Burpengary test', 'clinic'),
  ('93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000002', 'Other clinic', 'clinic');
insert into public.bank_connections(id, organisation_id, entity_id, provider, status) values
  ('94000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'mock', 'active'),
  ('94000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000003', 'mock', 'active');
insert into public.accounts(id, organisation_id, entity_id, connection_id, name, institution, kind, balance_cents, masked_number) values
  ('95000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', 'Reserve A', 'Test', 'savings', 200000, 'xxxx1111'),
  ('95000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000002', 'Reserve B', 'Test', 'savings', 300000, 'xxxx2222');
insert into public.categories(id, name, kind, colour) values
  ('96000000-0000-4000-8000-000000000001', 'Plan test supplies', 'expense', '#336699');
insert into public.finance_plans(id, organisation_id, entity_id, kind, name, amount_cents, saved_cents, account_id) values
  ('97000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'goal', 'Reserve A', 500000, 100000, '95000000-0000-4000-8000-000000000001'),
  ('97000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000003', 'goal', 'Reserve B', 600000, 0, '95000000-0000-4000-8000-000000000002');

set local role anon;
select throws_ok('select * from public.finance_plans', '42501', null, 'Anonymous users cannot read plans');

set local role authenticated;
set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*) from public.finance_plans), 1::bigint, 'An owner reads only plans in their workspace');
select lives_ok($sql$
  insert into public.finance_plans(id, organisation_id, entity_id, kind, name, amount_cents, category_id)
  values ('97000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'budget', 'Supplies', 120000, '96000000-0000-4000-8000-000000000001')
$sql$, 'An owner can create a budget in their workspace');
select lives_ok(
  $$update public.finance_plans set amount_cents=140000 where id='97000000-0000-4000-8000-000000000003'$$,
  'An owner can edit their budget'
);
select is((select amount_cents from public.finance_plans where id='97000000-0000-4000-8000-000000000003'), 140000::bigint, 'The authorised budget edit persists');
select throws_ok($sql$
  insert into public.finance_plans(organisation_id, kind, name, amount_cents)
  values ('92000000-0000-4000-8000-000000000002', 'budget', 'Forged', 10000)
$sql$, '42501', null, 'An owner cannot insert a plan into another workspace');
select throws_ok(
  $$update public.finance_plans set organisation_id='92000000-0000-4000-8000-000000000002', entity_id=null where id='97000000-0000-4000-8000-000000000003'$$,
  '42501', null, 'Update checks prevent a plan being moved to another workspace'
);
with changed as (
  update public.finance_plans set name='Unauthorised' where id='97000000-0000-4000-8000-000000000002' returning id
) select is(count(*), 0::bigint, 'An owner cannot update an invisible foreign plan') from changed;

set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*) from public.finance_plans), 2::bigint, 'A viewer can read plans in their workspace');
select throws_ok($sql$
  insert into public.finance_plans(organisation_id, kind, name, amount_cents)
  values ('92000000-0000-4000-8000-000000000001', 'budget', 'Viewer budget', 10000)
$sql$, '42501', null, 'A viewer cannot create plans');
with changed as (
  update public.finance_plans set amount_cents=1 returning id
) select is(count(*), 0::bigint, 'A viewer cannot update plans') from changed;
with removed as (
  delete from public.finance_plans returning id
) select is(count(*), 0::bigint, 'A viewer cannot remove plans') from removed;

set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000004","role":"authenticated"}';
select lives_ok(
  $$update public.finance_plans set amount_cents=150000 where id='97000000-0000-4000-8000-000000000003'$$,
  'An administrator can update a workspace plan'
);
with removed as (
  delete from public.finance_plans where id='97000000-0000-4000-8000-000000000003' returning id
) select is(count(*), 1::bigint, 'An administrator can remove a workspace plan') from removed;

set local request.jwt.claims = '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select name from public.finance_plans), 'Reserve B', 'The other owner sees only their own plan');

reset role;
select throws_ok($sql$
  insert into public.finance_plans(organisation_id, entity_id, kind, name, amount_cents)
  values ('92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000003', 'budget', 'Cross workspace entity', 10000)
$sql$, '23503', null, 'A plan cannot reference an entity from another workspace');
select throws_ok($sql$
  insert into public.finance_plans(organisation_id, kind, name, amount_cents, account_id)
  values ('92000000-0000-4000-8000-000000000001', 'goal', 'Cross workspace account', 10000, '95000000-0000-4000-8000-000000000002')
$sql$, '23503', null, 'A plan cannot reference an account from another workspace');
select throws_ok($sql$
  insert into public.finance_plans(organisation_id, entity_id, kind, name, amount_cents, account_id)
  values ('92000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', 'goal', 'Wrong clinic account', 10000, '95000000-0000-4000-8000-000000000001')
$sql$, '23503', null, 'An entity-scoped plan cannot use another clinic account');
select throws_ok(
  $$update public.finance_plans set amount_cents=9007199254740992 where id='97000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'Amounts remain within the exact JavaScript integer range'
);
select throws_ok(
  $$update public.finance_plans set amount_cents=0 where id='97000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'A plan must have a positive target amount'
);
select throws_ok(
  $$update public.finance_plans set saved_cents=-1 where id='97000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'A manually tracked goal balance cannot be negative'
);
select throws_ok($sql$
  insert into public.finance_plans(organisation_id, kind, name, amount_cents, account_id)
  values ('92000000-0000-4000-8000-000000000001', 'budget', 'Invalid budget', 10000, '95000000-0000-4000-8000-000000000001')
$sql$, '23514', null, 'Monthly budgets cannot contain an account balance link');
select throws_ok(
  $$update public.finance_plans set category_id='96000000-0000-4000-8000-000000000001' where id='97000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'Savings goals cannot contain a spending category'
);
select throws_ok($sql$
  insert into public.finance_plans(organisation_id, kind, name, amount_cents, frequency)
  values ('92000000-0000-4000-8000-000000000001', 'bill', 'Undated bill', 10000, 'monthly')
$sql$, '23514', null, 'Recurring bills require a due date');
select throws_ok(
  $$update public.finance_plans set name='  ' where id='97000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'Blank plan names are rejected'
);
select throws_ok($sql$
  insert into public.finance_plans(organisation_id, kind, name, amount_cents, due_date, frequency)
  values ('92000000-0000-4000-8000-000000000001', 'bill', 'Unsupported recurrence', 10000, '2026-11-01', 'daily')
$sql$, '23514', null, 'Only supported bill frequencies are accepted');
select lives_ok(
  $$delete from public.bank_connections where id='94000000-0000-4000-8000-000000000001'$$,
  'Removing a revoked bank connection is not blocked by an account-linked goal'
);
select ok((select account_id is null and entity_id='93000000-0000-4000-8000-000000000001'::uuid and saved_cents=100000
  from public.finance_plans where id='97000000-0000-4000-8000-000000000001'),
  'Account removal retains the goal under its clinic with its manually tracked balance');
select is((select account_id from public.finance_plans where id='97000000-0000-4000-8000-000000000002'),
  '95000000-0000-4000-8000-000000000002'::uuid, 'Another workspace goal remains linked to its bank account');

select * from finish();
rollback;
