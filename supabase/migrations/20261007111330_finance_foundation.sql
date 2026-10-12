-- Only normalised, tenant-scoped data is exposed to the browser.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.runtime_config (
  singleton boolean primary key default true check (singleton),
  environment text not null default 'production' check (environment in ('development', 'demo', 'production')),
  allow_mock_data boolean not null default false
);
insert into private.runtime_config(singleton) values (true);

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.organisation_members (
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organisation_id, user_id)
);
create index organisation_members_user_idx on public.organisation_members(user_id, organisation_id);

-- Definer helper avoids recursive membership RLS; fixed search path blocks hijacking.
create function private.is_member(org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.organisation_members m
    where m.organisation_id = org_id and m.user_id = (select auth.uid()));
$$;
create function private.is_editor(org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.organisation_members m
    where m.organisation_id = org_id and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin'));
$$;
revoke all on function private.is_member(uuid), private.is_editor(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_member(uuid), private.is_editor(uuid) to authenticated;

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('clinic', 'personal')),
  unique (organisation_id, id)
);
create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  entity_id uuid not null,
  provider text not null check (provider in ('mock', 'basiq')),
  status text not null check (status in ('active', 'error', 'disconnected')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, entity_id, id),
  foreign key (organisation_id, entity_id) references public.entities(organisation_id, id)
);
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  entity_id uuid not null,
  connection_id uuid not null,
  name text not null,
  institution text not null,
  kind text not null check (kind in ('operating', 'savings', 'credit_card', 'transaction')),
  currency text not null default 'AUD' check (currency = 'AUD'),
  balance_cents bigint not null check (abs(balance_cents::numeric) <= 9007199254740991),
  masked_number text not null,
  updated_at timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, entity_id) references public.entities(organisation_id, id),
  foreign key (organisation_id, entity_id, connection_id)
    references public.bank_connections(organisation_id, entity_id, id)
);
create table public.categories (
  id uuid primary key,
  name text not null unique,
  kind text not null check (kind in ('income', 'expense', 'transfer')),
  colour text not null check (colour ~ '^#[0-9a-fA-F]{6}$')
);
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  account_id uuid not null,
  provider_transaction_id text not null,
  posted_at date not null,
  description text not null,
  merchant text,
  amount_cents bigint not null check (abs(amount_cents::numeric) <= 9007199254740991),
  currency text not null default 'AUD' check (currency = 'AUD'),
  category_id uuid references public.categories(id),
  category_source text not null default 'uncategorised' check (category_source in ('rule', 'manual', 'uncategorised')),
  status text not null check (status in ('posted', 'pending')),
  transfer_pair_id uuid,
  receipt_status text not null default 'missing' check (receipt_status in ('missing', 'attached', 'not_required')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, id),
  unique (organisation_id, account_id, provider_transaction_id),
  foreign key (organisation_id, account_id) references public.accounts(organisation_id, id),
  check ((category_id is null and category_source = 'uncategorised') or category_id is not null)
);
create index transactions_org_date_idx on public.transactions(organisation_id, posted_at desc, id);
create index transactions_account_idx on public.transactions(organisation_id, account_id);
create index transactions_transfer_idx on public.transactions(organisation_id, transfer_pair_id) where transfer_pair_id is not null;

create table private.provider_records (
  organisation_id uuid not null,
  connection_id uuid not null,
  provider_record_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  primary key (organisation_id, connection_id, provider_record_id),
  foreign key (organisation_id, connection_id) references public.bank_connections(organisation_id, id) on delete cascade
);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_org_created_idx on public.audit_events(organisation_id, created_at desc);
create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  kind text not null check (kind in ('bank_sync', 'receipt', 'transaction', 'economics')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  error_code text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (organisation_id, id)
);
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  transaction_id uuid,
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'review', 'complete', 'failed')),
  extracted_amount_cents bigint,
  extracted_merchant text,
  created_at timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, transaction_id) references public.transactions(organisation_id, id),
  check (split_part(storage_path, '/', 1) = organisation_id::text)
);
create table public.economic_indicators (
  id uuid primary key default gen_random_uuid(),
  series text not null,
  observation_date date not null,
  value numeric not null,
  unit text not null,
  source_url text not null,
  retrieved_at timestamptz not null default now(),
  unique (series, observation_date)
);
create table public.forecast_scenarios (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  entity_id uuid,
  name text not null,
  assumptions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organisation_id, entity_id) references public.entities(organisation_id, id)
);

-- Reads only. Browser writes go through narrow authorised RPCs, never broad policies.
alter table public.organisations enable row level security;
alter table public.organisation_members enable row level security;
alter table public.entities enable row level security;
alter table public.bank_connections enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.audit_events enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.receipts enable row level security;
alter table public.economic_indicators enable row level security;
alter table public.forecast_scenarios enable row level security;
alter table private.provider_records enable row level security;
alter table private.runtime_config enable row level security;

create policy member_read on public.organisations for select to authenticated using (private.is_member(id));
create policy own_membership_read on public.organisation_members for select to authenticated using (user_id = (select auth.uid()));
create policy member_read on public.entities for select to authenticated using (private.is_member(organisation_id));
create policy member_read on public.bank_connections for select to authenticated using (private.is_member(organisation_id));
create policy member_read on public.accounts for select to authenticated using (private.is_member(organisation_id));
create policy category_read on public.categories for select to authenticated using (true);
create policy member_read on public.transactions for select to authenticated using (private.is_member(organisation_id));
create policy editor_audit_read on public.audit_events for select to authenticated using (private.is_editor(organisation_id));
create policy member_read on public.processing_jobs for select to authenticated using (private.is_member(organisation_id));
create policy member_read on public.receipts for select to authenticated using (private.is_member(organisation_id));
create policy indicator_read on public.economic_indicators for select to authenticated using (true);
create policy member_read on public.forecast_scenarios for select to authenticated using (private.is_member(organisation_id));

revoke all on all tables in schema public from anon, authenticated;
grant select on public.organisations, public.organisation_members, public.entities, public.bank_connections,
  public.accounts, public.categories, public.transactions, public.audit_events, public.processing_jobs,
  public.receipts, public.economic_indicators, public.forecast_scenarios to authenticated;
grant all on all tables in schema public to service_role;
grant usage on schema private to service_role;
grant all on all tables in schema private to service_role;

create function public.create_demo_organisation(name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid; actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists(select 1 from private.runtime_config where singleton and environment in ('development','demo') and allow_mock_data)
    then raise exception 'Demo provisioning disabled' using errcode = '42501'; end if;
  if length(trim(name)) not between 1 and 120 then raise exception 'Invalid organisation name' using errcode = '22023'; end if;
  -- Serialise per-user requests and cap demo org creation to prevent accidental retry proliferation.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  select o.id into new_id from public.organisations o join public.organisation_members m on m.organisation_id = o.id
    where m.user_id = actor and m.role = 'owner' and o.is_demo order by o.created_at limit 1;
  if new_id is not null then return new_id; end if;
  insert into public.organisations(name, is_demo) values (trim(name), true) returning id into new_id;
  insert into public.organisation_members(organisation_id, user_id, role) values (new_id, actor, 'owner');
  insert into public.audit_events(organisation_id, actor_user_id, action, resource_id)
    values (new_id, actor, 'organisation.demo_created', new_id);
  return new_id;
end $$;

create function public.set_transaction_category(transaction_id uuid, category_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare target public.transactions; old_category uuid;
begin
  select * into target from public.transactions t where t.id = transaction_id for update;
  if not found or not private.is_editor(target.organisation_id) then
    raise exception 'Transaction not found or access denied' using errcode = '42501';
  end if;
  if category_id is not null and not exists(select 1 from public.categories c where c.id = category_id) then
    raise exception 'Unknown category' using errcode = '22023';
  end if;
  old_category := target.category_id;
  update public.transactions t set category_id = set_transaction_category.category_id,
    category_source = case when set_transaction_category.category_id is null then 'uncategorised' else 'manual' end,
    updated_at = now() where t.id = transaction_id;
  insert into public.audit_events(organisation_id, actor_user_id, action, resource_id, metadata)
    values (target.organisation_id, auth.uid(), 'transaction.category_changed', transaction_id,
      jsonb_build_object('previousCategoryId', old_category, 'categoryId', category_id));
end $$;
revoke all on function public.create_demo_organisation(text), public.set_transaction_category(uuid, uuid) from public, anon;
grant execute on function public.create_demo_organisation(text), public.set_transaction_category(uuid, uuid) to authenticated;

-- Future private receipt storage. Upload/modify is intentionally not exposed in 0.1.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 10485760, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;
create policy receipt_member_read on storage.objects for select to authenticated
using (bucket_id = 'receipts' and exists (
  select 1 from public.organisation_members m
  where m.user_id = (select auth.uid()) and m.organisation_id::text = (storage.foldername(name))[1]
));
