begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select ok(
  not has_schema_privilege('anon', 'public', 'USAGE'),
  'Anonymous clients cannot use the application schema'
);
select ok(
  has_schema_privilege('authenticated', 'public', 'USAGE'),
  'Authenticated clients can use the application schema'
);
select ok(
  has_schema_privilege('service_role', 'public', 'USAGE'),
  'The service role can use the application schema'
);
select ok(
  has_schema_privilege('authenticated', 'private', 'USAGE'),
  'Authenticated policies can call private membership helpers'
);

select ok(
  not has_table_privilege('anon', 'public.organisations', 'SELECT'),
  'Anonymous clients cannot read organisations'
);
select ok(
  has_table_privilege('authenticated', 'public.organisations', 'SELECT'),
  'Authenticated clients may read organisations subject to RLS'
);
select ok(
  not has_table_privilege('authenticated', 'public.transactions', 'UPDATE'),
  'Authenticated clients cannot rewrite transaction facts'
);
select ok(
  has_table_privilege('service_role', 'public.transactions', 'SELECT')
    and has_table_privilege('service_role', 'public.transactions', 'INSERT')
    and has_table_privilege('service_role', 'public.transactions', 'UPDATE')
    and has_table_privilege('service_role', 'public.transactions', 'DELETE'),
  'The service role has the table privileges required by trusted ingestion'
);
select ok(
  not has_table_privilege('authenticated', 'private.banking_profiles', 'SELECT'),
  'Provider identities remain hidden from authenticated clients'
);
select ok(
  has_table_privilege('service_role', 'private.banking_profiles', 'SELECT')
    and has_table_privilege('service_role', 'private.banking_profiles', 'INSERT')
    and has_table_privilege('service_role', 'private.banking_profiles', 'UPDATE')
    and has_table_privilege('service_role', 'private.banking_profiles', 'DELETE'),
  'The service role can manage protected provider identities'
);

select ok(
  has_function_privilege('authenticated', 'public.create_live_organisation(text)', 'EXECUTE'),
  'Authenticated owners can create a live workspace'
);
select ok(
  has_function_privilege('authenticated', 'public.set_account_entity(uuid,uuid)', 'EXECUTE'),
  'Authenticated editors can assign imported accounts'
);
select ok(
  not has_function_privilege('anon', 'public.create_live_organisation(text)', 'EXECUTE'),
  'Anonymous clients cannot provision a live workspace'
);
select ok(
  not has_function_privilege('authenticated', 'public.ingest_basiq_snapshot(uuid,uuid,jsonb)', 'EXECUTE'),
  'Authenticated browsers cannot invoke trusted Basiq ingestion'
);
select ok(
  has_function_privilege('service_role', 'public.ingest_basiq_snapshot(uuid,uuid,jsonb)', 'EXECUTE'),
  'The service role can invoke trusted Basiq ingestion'
);
select ok(
  has_function_privilege('service_role', 'public.purge_basiq_data(uuid,uuid,boolean)', 'EXECUTE'),
  'The service role can purge revoked banking data'
);

-- Objects created after the hardening migration must remain inaccessible until
-- a future migration grants them deliberately. The transaction rolls them back.
create table public.privilege_contract_table_probe(id bigint primary key);
create function public.privilege_contract_function_probe() returns integer
language sql as $$ select 1 $$;

select ok(
  not has_table_privilege('authenticated', 'public.privilege_contract_table_probe', 'SELECT'),
  'Future tables are not automatically exposed to authenticated clients'
);
select ok(
  not has_table_privilege('service_role', 'public.privilege_contract_table_probe', 'SELECT'),
  'Future tables require an explicit service-role grant'
);
select ok(
  not has_function_privilege('authenticated', 'public.privilege_contract_function_probe()', 'EXECUTE'),
  'Future functions are not automatically exposed to authenticated clients'
);
select ok(
  not has_function_privilege('service_role', 'public.privilege_contract_function_probe()', 'EXECUTE'),
  'Future functions require an explicit service-role grant'
);

select * from finish();
rollback;
