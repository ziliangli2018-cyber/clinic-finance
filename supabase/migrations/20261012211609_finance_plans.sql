-- User-managed budgets, savings goals and bill schedules. No bank balances are
-- changed by this table; account-linked goals read the existing account feed.
create unique index accounts_organisation_entity_id_idx
  on public.accounts(organisation_id, entity_id, id);

create table public.finance_plans (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  entity_id uuid,
  kind text not null check (kind in ('budget', 'goal', 'bill')),
  name text not null check (char_length(trim(name)) between 1 and 120),
  amount_cents bigint not null check (amount_cents between 1 and 9007199254740991),
  saved_cents bigint not null default 0 check (saved_cents between 0 and 9007199254740991),
  category_id uuid references public.categories(id),
  account_id uuid,
  due_date date,
  frequency text check (frequency in ('weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly')),
  created_at timestamptz not null default now(),
  foreign key (organisation_id, entity_id) references public.entities(organisation_id, id),
  foreign key (organisation_id, account_id) references public.accounts(organisation_id, id)
    on delete set null (account_id),
  foreign key (organisation_id, entity_id, account_id) references public.accounts(organisation_id, entity_id, id)
    on delete set null (account_id),
  check (
    (kind = 'budget' and account_id is null and due_date is null and frequency is null and saved_cents = 0)
    or (kind = 'goal' and category_id is null and frequency is null)
    or (kind = 'bill' and due_date is not null and frequency is not null and saved_cents = 0)
  )
);

create index finance_plans_organisation_entity_idx on public.finance_plans(organisation_id, entity_id);
create index finance_plans_organisation_account_idx on public.finance_plans(organisation_id, account_id);
create index finance_plans_organisation_entity_account_idx on public.finance_plans(organisation_id, entity_id, account_id);
create index finance_plans_category_idx on public.finance_plans(category_id);

alter table public.finance_plans enable row level security;
create policy member_read on public.finance_plans
  for select to authenticated using (private.is_member(organisation_id));
create policy editor_insert on public.finance_plans
  for insert to authenticated with check (private.is_editor(organisation_id));
create policy editor_update on public.finance_plans
  for update to authenticated
  using (private.is_editor(organisation_id)) with check (private.is_editor(organisation_id));
create policy editor_delete on public.finance_plans
  for delete to authenticated using (private.is_editor(organisation_id));

revoke all on public.finance_plans from public, anon, authenticated;
grant select, insert, update, delete on public.finance_plans to authenticated;
grant all on public.finance_plans to service_role;
