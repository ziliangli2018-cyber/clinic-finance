-- Resolve PL/pgSQL output/input name ambiguity and reject a concurrent attempt
-- to attach a different provider user to the same legal entity.
create or replace function public.save_basiq_profile(
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

revoke all on function public.save_basiq_profile(uuid, uuid, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.save_basiq_profile(uuid, uuid, uuid, text)
to service_role;
