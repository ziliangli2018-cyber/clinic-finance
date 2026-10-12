-- Apply one category to a user-selected set atomically. A mixed-tenant or
-- inaccessible set fails without changing any transaction.
create or replace function public.set_transaction_categories(transaction_ids uuid[], category_id uuid)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  expected_count integer;
  updated_count integer := 0;
  target record;
begin
  if auth.uid() is null then
    raise exception 'Sign-in required' using errcode = '42501';
  end if;
  if transaction_ids is null or cardinality(transaction_ids) = 0
    or cardinality(transaction_ids) > 1000
    or array_position(transaction_ids, null) is not null then
    raise exception 'Select between 1 and 1000 transactions' using errcode = '22023';
  end if;
  select count(distinct value) into expected_count from unnest(transaction_ids) value;
  if category_id is not null and not exists (
    select 1 from public.categories c where c.id = category_id
  ) then
    raise exception 'Unknown category' using errcode = '22023';
  end if;
  -- Lock membership rows throughout the write so concurrent revocation cannot
  -- authorize a partial update.
  perform m.organisation_id from public.organisation_members m
  where m.user_id = auth.uid() and m.role in ('owner', 'admin')
    and m.organisation_id in (
      select t.organisation_id from public.transactions t where t.id = any(transaction_ids)
    ) for share;
  if (select count(*) from public.transactions t
    where t.id = any(transaction_ids) and private.is_editor(t.organisation_id)) <> expected_count then
    raise exception 'Editor access is required for every selected transaction' using errcode = '42501';
  end if;
  for target in select t.id, t.organisation_id, t.category_id from public.transactions t
    where t.id = any(transaction_ids) order by t.id for update
  loop
    update public.transactions t
    set category_id = set_transaction_categories.category_id,
        category_source = case when set_transaction_categories.category_id is null
          then 'uncategorised' else 'manual' end,
        updated_at = now()
    where t.id = target.id;
    insert into public.audit_events(organisation_id, actor_user_id, action, resource_id, metadata)
    values (target.organisation_id, auth.uid(), 'transaction.category_changed', target.id,
      jsonb_build_object('previousCategoryId', target.category_id,
        'categoryId', set_transaction_categories.category_id, 'bulk', true));
    updated_count := updated_count + 1;
  end loop;
  if updated_count <> expected_count then
    raise exception 'Selected transactions changed; refresh and try again' using errcode = '40001';
  end if;
  return updated_count;
end $$;

revoke all on function public.set_transaction_categories(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.set_transaction_categories(uuid[], uuid) to authenticated;
