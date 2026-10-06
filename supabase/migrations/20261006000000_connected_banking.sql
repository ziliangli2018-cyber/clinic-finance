-- Production connected banking: multi-institution Basiq consent, ingestion and cleanup.
-- Provider credentials and provider-user identifiers remain server-side.

alter table public.entities drop constraint if exists entities_kind_check;
alter table public.entities
  add constraint entities_kind_check check (kind in ('clinic', 'group', 'personal'));

alter table public.bank_connections drop constraint if exists bank_connections_status_check;
alter table public.bank_connections
  add constraint bank_connections_status_check
  check (status in ('pending', 'active', 'error', 'consent_required', 'disconnected'));
alter table public.bank_connections add column if not exists institution_id text;
alter table public.bank_connections add column if not exists institution_name text;
alter table public.bank_connections add column if not exists consent_expires_at timestamptz;

alter table public.accounts drop constraint if exists accounts_kind_check;
alter table public.accounts
  add constraint accounts_kind_check
  check (kind in ('operating', 'savings', 'credit_card', 'transaction', 'loan', 'mortgage', 'term_deposit'));
alter table public.accounts add column if not exists available_funds_cents bigint;
alter table public.accounts
  add constraint accounts_available_funds_safe
  check (available_funds_cents is null or abs(available_funds_cents::numeric) <= 9007199254740991);

-- An imported connection belongs to the group, while each account can be assigned
-- independently to Kilcoy, Burpengary, or Group finance.
alter table public.accounts
  drop constraint if exists accounts_organisation_id_entity_id_connection_id_fkey;
alter table public.accounts
  add constraint accounts_organisation_id_connection_id_fkey
  foreign key (organisation_id, connection_id)
  references public.bank_connections(organisation_id, id) on delete cascade;

alter table public.transactions
  drop constraint if exists transactions_organisation_id_account_id_fkey;
alter table public.transactions
  add constraint transactions_organisation_id_account_id_fkey
  foreign key (organisation_id, account_id)
  references public.accounts(organisation_id, id) on delete cascade;
alter table public.receipts
  drop constraint if exists receipts_organisation_id_transaction_id_fkey;
alter table public.receipts
  add constraint receipts_organisation_id_transaction_id_fkey
  foreign key (organisation_id, transaction_id)
  references public.transactions(organisation_id, id) on delete cascade;

create table private.banking_profiles (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null unique references public.organisations(id) on delete cascade,
  provider text not null default 'basiq' check (provider = 'basiq'),
  provider_user_id text not null unique check (provider_user_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  last_manual_refresh_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.provider_connections (
  profile_id uuid not null references private.banking_profiles(id) on delete cascade,
  connection_id uuid not null,
  provider_connection_id text not null check (provider_connection_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  created_at timestamptz not null default now(),
  primary key (profile_id, provider_connection_id),
  unique (profile_id, connection_id)
);

alter table private.banking_profiles enable row level security;
alter table private.provider_connections enable row level security;
revoke all on private.banking_profiles, private.provider_connections from public, anon, authenticated;
grant all on private.banking_profiles, private.provider_connections to service_role;

-- Live workspaces never inherit demo records.
create function public.create_live_organisation(name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
  actor uuid := auth.uid();
  clean_name text := pg_catalog.regexp_replace(name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from private.runtime_config
    where singleton and environment = 'production' and not allow_mock_data
  ) then
    raise exception 'Live provisioning disabled' using errcode = '42501';
  end if;
  if clean_name is null or pg_catalog.char_length(clean_name) not between 1 and 120 then
    raise exception 'Invalid organisation name' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 0));
  select o.id into new_id
  from public.organisations o
  join public.organisation_members m on m.organisation_id = o.id
  where m.user_id = actor and m.role = 'owner' and not o.is_demo
  order by o.created_at, o.id
  limit 1;
  if new_id is not null then return new_id; end if;

  insert into public.organisations(name, is_demo)
    values (clean_name, false) returning id into new_id;
  insert into public.organisation_members(organisation_id, user_id, role)
    values (new_id, actor, 'owner');
  insert into public.entities(organisation_id, name, kind) values
    (new_id, 'Kilcoy', 'clinic'),
    (new_id, 'Burpengary', 'clinic'),
    (new_id, 'Group finance', 'group');
  insert into public.audit_events(organisation_id, actor_user_id, action, resource_id)
    values (new_id, actor, 'organisation.live_created', new_id);
  return new_id;
end $$;

create function public.set_account_entity(account_id uuid, entity_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  target public.accounts;
  previous_entity uuid;
begin
  select * into target from public.accounts a where a.id = account_id for update;
  if not found or not private.is_editor(target.organisation_id) then
    raise exception 'Account not found or access denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.entities e
    where e.id = entity_id and e.organisation_id = target.organisation_id and e.kind in ('clinic', 'group')
  ) then
    raise exception 'Invalid business entity' using errcode = '22023';
  end if;
  previous_entity := target.entity_id;
  update public.accounts a set entity_id = set_account_entity.entity_id where a.id = account_id;
  insert into public.audit_events(organisation_id, actor_user_id, action, resource_id, metadata)
  values (
    target.organisation_id,
    auth.uid(),
    'account.entity_changed',
    account_id,
    jsonb_build_object('previousEntityId', previous_entity, 'entityId', entity_id)
  );
end $$;

revoke all on function public.create_live_organisation(text), public.set_account_entity(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_live_organisation(text), public.set_account_entity(uuid, uuid)
  to authenticated;

-- Service-role RPCs expose only the minimum profile data required by Edge Functions.
create function public.get_basiq_profile(organisation_id uuid, actor_user_id uuid)
returns table(profile_id uuid, provider_user_id text, last_manual_refresh_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.provider_user_id, p.last_manual_refresh_at
  from private.banking_profiles p
  where p.organisation_id = get_basiq_profile.organisation_id
    and exists (
      select 1 from public.organisation_members m
      where m.organisation_id = p.organisation_id
        and m.user_id = actor_user_id and m.role in ('owner', 'admin')
    );
$$;

create function public.save_basiq_profile(
  organisation_id uuid,
  actor_user_id uuid,
  provider_user_id text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if not exists (
    select 1 from public.organisations o
    join public.organisation_members m on m.organisation_id = o.id
    where o.id = save_basiq_profile.organisation_id and not o.is_demo
      and m.user_id = save_basiq_profile.actor_user_id and m.role in ('owner', 'admin')
  ) then
    raise exception 'Live editor membership required' using errcode = '42501';
  end if;
  insert into private.banking_profiles(organisation_id, provider_user_id)
  values (save_basiq_profile.organisation_id, save_basiq_profile.provider_user_id)
  on conflict (organisation_id) do update
    set updated_at = now()
  returning id into result;
  return result;
end $$;

create function public.claim_basiq_manual_refresh(organisation_id uuid, actor_user_id uuid)
returns table(profile_id uuid, provider_user_id text, should_refresh boolean)
language plpgsql security definer set search_path = '' as $$
declare target private.banking_profiles;
begin
  select p.* into target from private.banking_profiles p
  where p.organisation_id = claim_basiq_manual_refresh.organisation_id for update;
  if not found or not exists (
    select 1 from public.organisation_members m
    where m.organisation_id = target.organisation_id
      and m.user_id = actor_user_id and m.role in ('owner', 'admin')
  ) then
    raise exception 'Banking profile unavailable' using errcode = '42501';
  end if;
  if target.last_manual_refresh_at is not null
    and target.last_manual_refresh_at > now() - interval '90 minutes' then
    return query select target.id, target.provider_user_id, false;
    return;
  end if;
  update private.banking_profiles
    set last_manual_refresh_at = now(), updated_at = now() where id = target.id;
  return query select target.id, target.provider_user_id, true;
end $$;

create function public.list_basiq_profiles()
returns table(profile_id uuid, organisation_id uuid, provider_user_id text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.organisation_id, p.provider_user_id
  from private.banking_profiles p order by p.id;
$$;

create function public.ingest_basiq_snapshot(
  profile_id uuid,
  actor_user_id uuid,
  dataset jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  organisation_id uuid;
  group_entity_id uuid;
  job_id uuid;
  account_count integer := 0;
  transaction_count integer := 0;
begin
  select p.organisation_id into organisation_id
  from private.banking_profiles p where p.id = profile_id for update;
  if not found then raise exception 'Banking profile unavailable' using errcode = '42501'; end if;
  if actor_user_id is not null and not exists (
    select 1 from public.organisation_members m
    where m.organisation_id = ingest_basiq_snapshot.organisation_id
      and m.user_id = actor_user_id and m.role in ('owner', 'admin')
  ) then raise exception 'Editor membership required' using errcode = '42501'; end if;
  if jsonb_typeof(dataset->'connections') <> 'array'
    or jsonb_typeof(dataset->'accounts') <> 'array'
    or jsonb_typeof(dataset->'transactions') <> 'array' then
    raise exception 'Invalid banking dataset' using errcode = '22023';
  end if;

  select e.id into group_entity_id from public.entities e
  where e.organisation_id = ingest_basiq_snapshot.organisation_id and e.kind = 'group'
  order by e.id limit 1;
  if group_entity_id is null then
    raise exception 'Group finance entity unavailable' using errcode = '55000';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(dataset->'connections') x(id uuid)
    join public.bank_connections c on c.id = x.id
    where c.organisation_id <> ingest_basiq_snapshot.organisation_id or c.provider <> 'basiq'
  ) or exists (
    select 1 from jsonb_to_recordset(dataset->'accounts') x(id uuid)
    join public.accounts a on a.id = x.id
    where a.organisation_id <> ingest_basiq_snapshot.organisation_id
  ) or exists (
    select 1 from jsonb_to_recordset(dataset->'transactions') x(id uuid)
    join public.transactions t on t.id = x.id
    where t.organisation_id <> ingest_basiq_snapshot.organisation_id
  ) then raise exception 'Banking identifier collision' using errcode = '22023'; end if;

  insert into public.processing_jobs(organisation_id, kind, status)
  values (organisation_id, 'bank_sync', 'running') returning id into job_id;

  -- Connections removed at the provider are removed locally even when another
  -- institution remains active for the same business user.
  delete from public.bank_connections c
  using private.provider_connections pc
  where pc.profile_id = ingest_basiq_snapshot.profile_id
    and c.id = pc.connection_id
    and not exists (
      select 1 from jsonb_to_recordset(dataset->'connections') x(id uuid) where x.id = c.id
    );
  delete from private.provider_connections pc
  where pc.profile_id = ingest_basiq_snapshot.profile_id
    and not exists (
      select 1 from jsonb_to_recordset(dataset->'connections') x(id uuid)
      where x.id = pc.connection_id
    );

  insert into public.bank_connections(
    id, organisation_id, entity_id, provider, status, last_synced_at,
    institution_id, institution_name, consent_expires_at
  )
  select x.id, organisation_id, group_entity_id, 'basiq', x.status, x.last_synced_at,
    x.institution_id, x.institution_name, x.consent_expires_at
  from jsonb_to_recordset(dataset->'connections') as x(
    id uuid, provider_connection_id text, institution_id text, institution_name text,
    status text, last_synced_at timestamptz, consent_expires_at timestamptz
  )
  on conflict (id) do update set
    status = excluded.status,
    last_synced_at = coalesce(excluded.last_synced_at, bank_connections.last_synced_at),
    institution_id = excluded.institution_id,
    institution_name = excluded.institution_name,
    consent_expires_at = coalesce(excluded.consent_expires_at, bank_connections.consent_expires_at)
  where bank_connections.organisation_id = excluded.organisation_id
    and bank_connections.provider = 'basiq';

  insert into private.provider_connections(profile_id, connection_id, provider_connection_id)
  select ingest_basiq_snapshot.profile_id, x.id, x.provider_connection_id
  from jsonb_to_recordset(dataset->'connections') as x(
    id uuid, provider_connection_id text
  )
  on conflict (profile_id, provider_connection_id) do update
    set connection_id = excluded.connection_id;

  -- Lost or expired consent for one institution removes that institution's
  -- imported accounts without disturbing another active institution.
  delete from public.accounts a
  using public.bank_connections c
  where a.organisation_id = ingest_basiq_snapshot.organisation_id
    and a.connection_id = c.id
    and c.provider = 'basiq'
    and exists (
      select 1 from jsonb_to_recordset(dataset->'connections') x(id uuid, status text)
      where x.id = c.id and x.status <> 'active'
    );

  -- An account deselected in consent is absent from the complete provider
  -- account snapshot. Remove its retained copy and cascade its transactions.
  delete from public.accounts a
  using public.bank_connections c
  where a.organisation_id = ingest_basiq_snapshot.organisation_id
    and a.connection_id = c.id
    and c.provider = 'basiq'
    and exists (
      select 1 from jsonb_to_recordset(dataset->'connections') x(id uuid, status text)
      where x.id = c.id and x.status = 'active'
    )
    and not exists (
      select 1 from jsonb_to_recordset(dataset->'accounts') x(id uuid)
      where x.id = a.id
    );

  insert into public.accounts(
    id, organisation_id, entity_id, connection_id, name, institution, kind,
    currency, balance_cents, available_funds_cents, masked_number, updated_at
  )
  select x.id, organisation_id, group_entity_id, x.connection_id, x.name, x.institution,
    x.kind, 'AUD', x.balance_cents, x.available_funds_cents, x.masked_number, x.updated_at
  from jsonb_to_recordset(dataset->'accounts') as x(
    id uuid, connection_id uuid, name text, institution text, kind text,
    balance_cents bigint, available_funds_cents bigint, masked_number text, updated_at timestamptz
  )
  on conflict (id) do update set
    connection_id = excluded.connection_id,
    name = excluded.name,
    institution = excluded.institution,
    kind = excluded.kind,
    balance_cents = excluded.balance_cents,
    available_funds_cents = excluded.available_funds_cents,
    masked_number = excluded.masked_number,
    updated_at = excluded.updated_at
  where accounts.organisation_id = excluded.organisation_id;
  get diagnostics account_count = row_count;

  insert into public.transactions(
    id, organisation_id, account_id, provider_transaction_id, posted_at,
    description, merchant, amount_cents, currency, category_id, category_source,
    status, transfer_pair_id, receipt_status
  )
  select x.id, organisation_id, x.account_id, x.provider_transaction_id, x.posted_at,
    x.description, x.merchant, x.amount_cents, 'AUD', x.category_id,
    coalesce(x.category_source, 'uncategorised'),
    x.status, null, case when x.amount_cents < 0 then 'missing' else 'not_required' end
  from jsonb_to_recordset(dataset->'transactions') as x(
    id uuid, account_id uuid, provider_transaction_id text, posted_at date,
    description text, merchant text, amount_cents bigint, status text,
    category_id uuid, category_source text
  )
  on conflict (organisation_id, account_id, provider_transaction_id) do update set
    posted_at = excluded.posted_at,
    description = excluded.description,
    merchant = excluded.merchant,
    amount_cents = excluded.amount_cents,
    status = excluded.status,
    category_id = case when transactions.category_source = 'manual'
      then transactions.category_id else excluded.category_id end,
    category_source = case when transactions.category_source = 'manual'
      then 'manual' else excluded.category_source end,
    updated_at = now();
  get diagnostics transaction_count = row_count;

  -- Pending provider identifiers may change when a transaction posts. Remove
  -- pending rows no longer present in the complete provider snapshot.
  delete from public.transactions t
  using public.accounts a
  where t.organisation_id = ingest_basiq_snapshot.organisation_id
    and t.account_id = a.id
    and t.status = 'pending'
    and a.connection_id in (
      select x.id from jsonb_to_recordset(dataset->'connections') x(id uuid)
    )
    and not exists (
      select 1 from jsonb_to_recordset(dataset->'transactions') x(
        account_id uuid, provider_transaction_id text
      )
      where x.account_id = t.account_id
        and x.provider_transaction_id = t.provider_transaction_id
    );

  update public.processing_jobs set status = 'succeeded', finished_at = now() where id = job_id;
  insert into public.audit_events(organisation_id, actor_user_id, action, resource_id, metadata)
  values (
    organisation_id,
    actor_user_id,
    'bank.basiq_synced',
    job_id,
    jsonb_build_object('accounts', account_count, 'transactions', transaction_count)
  );
  return jsonb_build_object(
    'syncedAccounts', account_count,
    'syncedTransactions', transaction_count,
    'provider', 'basiq',
    'jobId', job_id
  );
exception when others then
  if job_id is not null then
    update public.processing_jobs
      set status = 'failed', error_code = sqlstate, finished_at = now() where id = job_id;
  end if;
  raise;
end $$;

create function public.purge_basiq_data(
  profile_id uuid,
  actor_user_id uuid,
  remove_profile boolean default false
) returns void
language plpgsql security definer set search_path = '' as $$
declare organisation_id uuid;
begin
  select p.organisation_id into organisation_id
  from private.banking_profiles p where p.id = profile_id for update;
  if not found then return; end if;
  if actor_user_id is not null and not exists (
    select 1 from public.organisation_members m
    where m.organisation_id = purge_basiq_data.organisation_id
      and m.user_id = actor_user_id and m.role in ('owner', 'admin')
  ) then raise exception 'Editor membership required' using errcode = '42501'; end if;

  delete from public.bank_connections c
  using private.provider_connections pc
  where pc.profile_id = purge_basiq_data.profile_id and c.id = pc.connection_id
    and c.organisation_id = purge_basiq_data.organisation_id and c.provider = 'basiq';
  delete from private.provider_connections pc where pc.profile_id = purge_basiq_data.profile_id;
  if remove_profile then
    delete from private.banking_profiles p where p.id = purge_basiq_data.profile_id;
  end if;
  insert into public.audit_events(organisation_id, actor_user_id, action, resource_id, metadata)
  values (
    organisation_id,
    actor_user_id,
    case when remove_profile then 'bank.basiq_disconnected' else 'bank.basiq_data_purged' end,
    profile_id,
    jsonb_build_object('profileRemoved', remove_profile)
  );
end $$;

revoke all on function public.get_basiq_profile(uuid, uuid),
  public.save_basiq_profile(uuid, uuid, text),
  public.claim_basiq_manual_refresh(uuid, uuid),
  public.list_basiq_profiles(),
  public.ingest_basiq_snapshot(uuid, uuid, jsonb),
  public.purge_basiq_data(uuid, uuid, boolean)
from public, anon, authenticated;
grant execute on function public.get_basiq_profile(uuid, uuid),
  public.save_basiq_profile(uuid, uuid, text),
  public.claim_basiq_manual_refresh(uuid, uuid),
  public.list_basiq_profiles(),
  public.ingest_basiq_snapshot(uuid, uuid, jsonb),
  public.purge_basiq_data(uuid, uuid, boolean)
to service_role;

-- Shared category reference data is required before the first live import.
insert into public.categories(id, name, kind, colour) values
  ('c4e5e067-5567-4cf9-a1a7-134d591c1b17', 'Patient receipts', 'income', '#4f8d81'),
  ('a7858a97-f8bf-450d-a57d-bdc9712b42e7', 'Health fund receipts', 'income', '#77b5a1'),
  ('6f1ea3be-0230-48ec-a74b-45d86d337dee', 'Interest income', 'income', '#a6cfb7'),
  ('68d846a3-80bd-4079-a7f5-1f1dde6a6813', 'Wages & super', 'expense', '#456b5c'),
  ('ee0feaa4-c805-4b0a-a585-4a66b4f64614', 'Rent & premises', 'expense', '#8f9e75'),
  ('389e3b2c-30d8-4896-a9c7-f50ab328519c', 'Dental supplies', 'expense', '#91b5a9'),
  ('e2546575-4560-42cf-a4d1-5d5bf22b9805', 'Laboratory fees', 'expense', '#bea778'),
  ('c8d453c6-5666-48a4-ac39-28e81ee3a896', 'Equipment & maintenance', 'expense', '#a4adb5'),
  ('24b8e163-6a41-4485-a27b-af51866eb9d3', 'Utilities', 'expense', '#92a1bb'),
  ('e692d684-704a-43a6-a538-fd62deba0fb4', 'Software & subscriptions', 'expense', '#b0a4bf'),
  ('c8452d4b-d9ce-40b5-a885-d409dbe69f9b', 'Insurance', 'expense', '#c0ada1'),
  ('31fec648-65b4-417e-a245-6282f83dbcf8', 'Merchant & bank fees', 'expense', '#91aaa6'),
  ('f0eb4b9b-7f8b-4541-a0dc-85fd3e33568b', 'Marketing', 'expense', '#d0bb8e'),
  ('145a8df8-9d38-4236-a3ee-dd9a7f6c1648', 'Groceries', 'expense', '#a0b481'),
  ('7d3aa5e4-05f7-4e22-a73a-6fee77b93534', 'Dining', 'expense', '#c89e83'),
  ('2d40ed56-5746-4ce8-a1c2-c4fc6099be86', 'Transport', 'expense', '#88a8ba'),
  ('e050f2f3-50e4-4801-a69f-c71d584847c3', 'Personal spending', 'expense', '#c4a5b0'),
  ('1f75ade4-b0f5-45ba-a13c-53de4ca9eb94', 'Internal transfers', 'transfer', '#95a29d'),
  ('210ec3ae-8e0b-4e4c-a942-e188137d06de', 'Loan payments', 'expense', '#8e99b2'),
  ('22014f99-6de2-41d7-ac5c-be0313e18529', 'Tax & GST payments', 'expense', '#a8896f'),
  ('2f0252c7-c573-46bd-acba-3531ee5cb477', 'Interest expense', 'expense', '#9e8aa1'),
  ('1c050394-2ee2-450d-a57d-bdc9712b42e7', 'Miscellaneous business expenses', 'expense', '#98aaa3')
on conflict (id) do nothing;
