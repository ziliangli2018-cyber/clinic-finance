-- Each legal entity owns an independent Basiq business user and consent profile.
-- Imported accounts inherit that legal entity permanently; they cannot be moved
-- across clinic boundaries after consent.

alter table private.banking_profiles add column entity_id uuid;

-- The previous single-profile model placed every import in Group finance. Keep
-- existing installations valid by attaching any legacy profile to that bucket.
update private.banking_profiles p
set entity_id = (
  select e.id
  from public.entities e
  where e.organisation_id = p.organisation_id and e.kind = 'group'
  order by e.id
  limit 1
)
where p.entity_id is null;

do $$
begin
  if exists (select 1 from private.banking_profiles where entity_id is null) then
    raise exception 'A legacy banking profile has no group entity';
  end if;
end $$;

alter table private.banking_profiles alter column entity_id set not null;
alter table private.banking_profiles
  drop constraint banking_profiles_organisation_id_key;
alter table private.banking_profiles
  add constraint banking_profiles_organisation_id_entity_id_key
    unique (organisation_id, entity_id),
  add constraint banking_profiles_organisation_id_entity_id_fkey
    foreign key (organisation_id, entity_id)
    references public.entities(organisation_id, id) on delete cascade;

-- Normalise legacy imports before reinstating the invariant that an account and
-- its connection always belong to the same legal entity.
update public.bank_connections c
set entity_id = p.entity_id
from private.provider_connections pc
join private.banking_profiles p on p.id = pc.profile_id
where c.id = pc.connection_id
  and c.organisation_id = p.organisation_id
  and c.provider = 'basiq';

update public.accounts a
set entity_id = c.entity_id
from public.bank_connections c
where c.id = a.connection_id
  and c.organisation_id = a.organisation_id
  and a.entity_id <> c.entity_id;

alter table public.accounts
  add constraint accounts_organisation_id_entity_id_connection_id_fkey
  foreign key (organisation_id, entity_id, connection_id)
  references public.bank_connections(organisation_id, entity_id, id) on delete cascade;

-- Retain the old RPC for deployed clients, but make it a no-op unless the
-- requested entity already matches the connection's legal entity.
create or replace function public.set_account_entity(account_id uuid, entity_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare target public.accounts;
begin
  select * into target from public.accounts a where a.id = account_id for update;
  if not found or not private.is_editor(target.organisation_id) then
    raise exception 'Account not found or access denied' using errcode = '42501';
  end if;
  if target.entity_id <> set_account_entity.entity_id then
    raise exception 'Accounts are fixed to their legal banking entity' using errcode = '22023';
  end if;
end $$;

drop function public.get_basiq_profile(uuid, uuid);
drop function public.save_basiq_profile(uuid, uuid, text);
drop function public.claim_basiq_manual_refresh(uuid, uuid);
drop function public.list_basiq_profiles();

create function public.get_basiq_profile(
  organisation_id uuid,
  entity_id uuid,
  actor_user_id uuid
) returns table(
  profile_id uuid,
  entity_id uuid,
  provider_user_id text,
  last_manual_refresh_at timestamptz
)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.entity_id, p.provider_user_id, p.last_manual_refresh_at
  from private.banking_profiles p
  where p.organisation_id = get_basiq_profile.organisation_id
    and p.entity_id = get_basiq_profile.entity_id
    and exists (
      select 1 from public.organisation_members m
      where m.organisation_id = p.organisation_id
        and m.user_id = actor_user_id and m.role in ('owner', 'admin')
    );
$$;

create function public.save_basiq_profile(
  organisation_id uuid,
  entity_id uuid,
  actor_user_id uuid,
  provider_user_id text
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare result uuid;
begin
  if not exists (
    select 1 from public.organisations o
    join public.organisation_members m on m.organisation_id = o.id
    join public.entities e on e.organisation_id = o.id
    where o.id = save_basiq_profile.organisation_id and not o.is_demo
      and e.id = save_basiq_profile.entity_id and e.kind in ('clinic', 'group')
      and m.user_id = save_basiq_profile.actor_user_id and m.role in ('owner', 'admin')
  ) then
    raise exception 'Live legal entity membership required' using errcode = '42501';
  end if;
  insert into private.banking_profiles(organisation_id, entity_id, provider_user_id)
  values (
    save_basiq_profile.organisation_id,
    save_basiq_profile.entity_id,
    save_basiq_profile.provider_user_id
  )
  on conflict on constraint banking_profiles_organisation_id_entity_id_key do update
    set updated_at = now()
    where private.banking_profiles.provider_user_id = excluded.provider_user_id
  returning private.banking_profiles.id into result;
  if result is null then
    raise exception 'Banking profile already exists for this legal entity'
      using errcode = '23505';
  end if;
  return result;
end $$;

create function public.claim_basiq_manual_refresh(
  organisation_id uuid,
  actor_user_id uuid,
  requested_entity_id uuid default null
) returns table(
  profile_id uuid,
  entity_id uuid,
  provider_user_id text,
  should_refresh boolean
)
language plpgsql security invoker set search_path = '' as $$
declare
  target record;
  refresh_due boolean;
begin
  if not exists (
    select 1 from public.organisation_members m
    where m.organisation_id = claim_basiq_manual_refresh.organisation_id
      and m.user_id = actor_user_id and m.role in ('owner', 'admin')
  ) then
    raise exception 'Banking profile unavailable' using errcode = '42501';
  end if;

  for target in
    select p.id, p.entity_id, p.provider_user_id, p.last_manual_refresh_at
    from private.banking_profiles p
    where p.organisation_id = claim_basiq_manual_refresh.organisation_id
      and (
        claim_basiq_manual_refresh.requested_entity_id is null
        or p.entity_id = claim_basiq_manual_refresh.requested_entity_id
      )
    order by p.entity_id
    for update
  loop
    refresh_due := target.last_manual_refresh_at is null
      or target.last_manual_refresh_at <= now() - interval '90 minutes';
    if refresh_due then
      update private.banking_profiles p
      set last_manual_refresh_at = now(), updated_at = now()
      where p.id = target.id;
    end if;
    profile_id := target.id;
    entity_id := target.entity_id;
    provider_user_id := target.provider_user_id;
    should_refresh := refresh_due;
    return next;
  end loop;
end $$;

create function public.list_basiq_profiles()
returns table(
  profile_id uuid,
  organisation_id uuid,
  entity_id uuid,
  provider_user_id text
)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.organisation_id, p.entity_id, p.provider_user_id
  from private.banking_profiles p order by p.id;
$$;

create or replace function public.ingest_basiq_snapshot(
  profile_id uuid,
  actor_user_id uuid,
  dataset jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  target_organisation_id uuid;
  target_entity_id uuid;
  job_id uuid;
  account_count integer := 0;
  transaction_count integer := 0;
begin
  select p.organisation_id, p.entity_id into target_organisation_id, target_entity_id
  from private.banking_profiles p where p.id = profile_id for update;
  if not found then raise exception 'Banking profile unavailable' using errcode = '42501'; end if;
  if actor_user_id is not null and not exists (
    select 1 from public.organisation_members m
    where m.organisation_id = target_organisation_id
      and m.user_id = actor_user_id and m.role in ('owner', 'admin')
  ) then raise exception 'Editor membership required' using errcode = '42501'; end if;
  if jsonb_typeof(dataset->'connections') <> 'array'
    or jsonb_typeof(dataset->'accounts') <> 'array'
    or jsonb_typeof(dataset->'transactions') <> 'array' then
    raise exception 'Invalid banking dataset' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(dataset->'connections') x(id uuid)
    join public.bank_connections c on c.id = x.id
    where c.organisation_id <> target_organisation_id
      or c.entity_id <> target_entity_id
      or c.provider <> 'basiq'
  ) or exists (
    select 1 from jsonb_to_recordset(dataset->'accounts') x(id uuid)
    join public.accounts a on a.id = x.id
    where a.organisation_id <> target_organisation_id or a.entity_id <> target_entity_id
  ) or exists (
    select 1 from jsonb_to_recordset(dataset->'transactions') x(id uuid)
    join public.transactions t on t.id = x.id
    where t.organisation_id <> target_organisation_id
  ) then raise exception 'Banking identifier collision' using errcode = '22023'; end if;

  insert into public.processing_jobs(organisation_id, kind, status)
  values (target_organisation_id, 'bank_sync', 'running') returning id into job_id;

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
  select x.id, target_organisation_id, target_entity_id, 'basiq', x.status, x.last_synced_at,
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
    and bank_connections.entity_id = excluded.entity_id
    and bank_connections.provider = 'basiq';

  insert into private.provider_connections(profile_id, connection_id, provider_connection_id)
  select ingest_basiq_snapshot.profile_id, x.id, x.provider_connection_id
  from jsonb_to_recordset(dataset->'connections') as x(
    id uuid, provider_connection_id text
  )
  on conflict (profile_id, provider_connection_id) do update
    set connection_id = excluded.connection_id;

  delete from public.accounts a
  using public.bank_connections c, private.provider_connections pc
  where a.organisation_id = target_organisation_id
    and a.connection_id = c.id
    and c.id = pc.connection_id
    and pc.profile_id = ingest_basiq_snapshot.profile_id
    and c.provider = 'basiq'
    and exists (
      select 1 from jsonb_to_recordset(dataset->'connections') x(id uuid, status text)
      where x.id = c.id and x.status <> 'active'
    );

  delete from public.accounts a
  using public.bank_connections c, private.provider_connections pc
  where a.organisation_id = target_organisation_id
    and a.connection_id = c.id
    and c.id = pc.connection_id
    and pc.profile_id = ingest_basiq_snapshot.profile_id
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
  select x.id, target_organisation_id, target_entity_id, x.connection_id, x.name, x.institution,
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
  where accounts.organisation_id = excluded.organisation_id
    and accounts.entity_id = excluded.entity_id;
  get diagnostics account_count = row_count;

  insert into public.transactions(
    id, organisation_id, account_id, provider_transaction_id, posted_at,
    description, merchant, amount_cents, currency, category_id, category_source,
    status, transfer_pair_id, receipt_status
  )
  select x.id, target_organisation_id, x.account_id, x.provider_transaction_id, x.posted_at,
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

  delete from public.transactions t
  using public.accounts a
  where t.organisation_id = target_organisation_id
    and t.account_id = a.id
    and a.entity_id = target_entity_id
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
    target_organisation_id,
    actor_user_id,
    'bank.basiq_synced',
    job_id,
    jsonb_build_object(
      'accounts', account_count,
      'transactions', transaction_count,
      'entityId', target_entity_id
    )
  );
  return jsonb_build_object(
    'syncedAccounts', account_count,
    'syncedTransactions', transaction_count,
    'provider', 'basiq',
    'entityId', target_entity_id,
    'jobId', job_id
  );
exception when others then
  if job_id is not null then
    update public.processing_jobs
      set status = 'failed', error_code = sqlstate, finished_at = now() where id = job_id;
  end if;
  raise;
end $$;

revoke all on function public.get_basiq_profile(uuid, uuid, uuid),
  public.save_basiq_profile(uuid, uuid, uuid, text),
  public.claim_basiq_manual_refresh(uuid, uuid, uuid),
  public.list_basiq_profiles(),
  public.ingest_basiq_snapshot(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.get_basiq_profile(uuid, uuid, uuid),
  public.save_basiq_profile(uuid, uuid, uuid, text),
  public.claim_basiq_manual_refresh(uuid, uuid, uuid),
  public.list_basiq_profiles(),
  public.ingest_basiq_snapshot(uuid, uuid, jsonb)
to service_role;
