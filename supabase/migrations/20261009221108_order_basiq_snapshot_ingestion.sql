-- Prevent overlapping manual and scheduled fetches from applying an older
-- provider snapshot after a newer one for the same legal-entity profile.

alter table private.banking_profiles
  add column next_sync_generation bigint not null default 0,
  add column last_applied_sync_generation bigint not null default 0,
  add constraint banking_profiles_sync_generation_order_check check (
    next_sync_generation >= 0
    and last_applied_sync_generation >= 0
    and last_applied_sync_generation <= next_sync_generation
  );

create function public.claim_basiq_snapshot(
  profile_id uuid,
  actor_user_id uuid
) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare
  target_organisation_id uuid;
  claimed_generation bigint;
begin
  select p.organisation_id into target_organisation_id
  from private.banking_profiles p
  where p.id = claim_basiq_snapshot.profile_id
  for update;

  if not found then
    raise exception 'Banking profile unavailable' using errcode = '42501';
  end if;
  if actor_user_id is not null and not exists (
    select 1 from public.organisation_members m
    where m.organisation_id = target_organisation_id
      and m.user_id = actor_user_id
      and m.role in ('owner', 'admin')
  ) then
    raise exception 'Editor membership required' using errcode = '42501';
  end if;

  update private.banking_profiles p
  set next_sync_generation = p.next_sync_generation + 1,
      updated_at = now()
  where p.id = claim_basiq_snapshot.profile_id
  returning p.next_sync_generation into claimed_generation;

  return claimed_generation;
end $$;

create function public.ingest_basiq_snapshot_ordered(
  profile_id uuid,
  actor_user_id uuid,
  sync_generation bigint,
  dataset jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  target private.banking_profiles;
  result jsonb;
begin
  select p.* into target
  from private.banking_profiles p
  where p.id = ingest_basiq_snapshot_ordered.profile_id
  for update;

  if not found then
    raise exception 'Banking profile unavailable' using errcode = '42501';
  end if;
  if actor_user_id is not null and not exists (
    select 1 from public.organisation_members m
    where m.organisation_id = target.organisation_id
      and m.user_id = actor_user_id
      and m.role in ('owner', 'admin')
  ) then
    raise exception 'Editor membership required' using errcode = '42501';
  end if;
  if sync_generation is null or sync_generation <= 0
    or sync_generation > target.next_sync_generation then
    raise exception 'Invalid banking sync generation' using errcode = '22023';
  end if;
  if sync_generation <= target.last_applied_sync_generation then
    return jsonb_build_object(
      'provider', 'basiq',
      'entityId', target.entity_id,
      'skipped', true,
      'reason', 'stale_snapshot',
      'syncGeneration', sync_generation
    );
  end if;

  result := public.ingest_basiq_snapshot(profile_id, actor_user_id, dataset);
  update private.banking_profiles p
  set last_applied_sync_generation = sync_generation,
      updated_at = now()
  where p.id = ingest_basiq_snapshot_ordered.profile_id;

  return result || jsonb_build_object(
    'skipped', false,
    'syncGeneration', sync_generation
  );
end $$;

create function public.purge_basiq_snapshot(
  profile_id uuid,
  actor_user_id uuid,
  sync_generation bigint
) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  target private.banking_profiles;
begin
  select p.* into target
  from private.banking_profiles p
  where p.id = purge_basiq_snapshot.profile_id
  for update;

  if not found then
    return false;
  end if;
  if actor_user_id is not null and not exists (
    select 1 from public.organisation_members m
    where m.organisation_id = target.organisation_id
      and m.user_id = actor_user_id
      and m.role in ('owner', 'admin')
  ) then
    raise exception 'Editor membership required' using errcode = '42501';
  end if;
  if sync_generation is null or sync_generation <= 0
    or sync_generation > target.next_sync_generation then
    raise exception 'Invalid banking sync generation' using errcode = '22023';
  end if;
  if sync_generation <= target.last_applied_sync_generation then
    return false;
  end if;

  perform public.purge_basiq_data(profile_id, actor_user_id, false);
  update private.banking_profiles p
  set last_applied_sync_generation = sync_generation,
      updated_at = now()
  where p.id = purge_basiq_snapshot.profile_id;
  return true;
end $$;

revoke all on function public.claim_basiq_snapshot(uuid, uuid),
  public.ingest_basiq_snapshot_ordered(uuid, uuid, bigint, jsonb),
  public.purge_basiq_snapshot(uuid, uuid, bigint)
from public, anon, authenticated, service_role;

grant execute on function public.claim_basiq_snapshot(uuid, uuid),
  public.ingest_basiq_snapshot_ordered(uuid, uuid, bigint, jsonb),
  public.purge_basiq_snapshot(uuid, uuid, bigint)
to service_role;
