-- One transaction commits all normalised records, raw provider evidence and audit.
-- EXECUTE is restricted to the server service role. Callers cannot submit ledger payloads.
create function public.ingest_mock_dataset(organisation_id uuid, actor_user_id uuid, dataset jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare job_id uuid; account_count integer; transaction_count integer;
begin
  if not exists(select 1 from private.runtime_config where singleton and environment in ('development','demo') and allow_mock_data)
    then raise exception 'Mock ingestion disabled' using errcode = '42501'; end if;
  -- Lock the tenant to serialise retries; the whole RPC is atomic.
  perform 1 from public.organisations o where o.id = organisation_id and o.is_demo for update;
  if not found then raise exception 'Demo organisation required' using errcode = '42501'; end if;
  if not exists(select 1 from public.organisation_members m where m.organisation_id = ingest_mock_dataset.organisation_id
    and m.user_id = actor_user_id and m.role in ('owner','admin')) then
    raise exception 'Editor membership required' using errcode = '42501';
  end if;
  if jsonb_typeof(dataset->'entities') <> 'array' or jsonb_typeof(dataset->'connections') <> 'array'
    or jsonb_typeof(dataset->'accounts') <> 'array' or jsonb_typeof(dataset->'transactions') <> 'array'
    or jsonb_typeof(dataset->'categories') <> 'array' or jsonb_typeof(dataset->'raw_records') <> 'array'
    or not (dataset ?& array['entities','connections','accounts','transactions','categories','raw_records']) then
    raise exception 'Invalid dataset' using errcode = '22023';
  end if;
  insert into public.processing_jobs(organisation_id, kind, status)
    values (organisation_id, 'bank_sync', 'running') returning id into job_id;

  insert into public.categories(id, name, kind, colour)
    select id, name, kind, colour from jsonb_to_recordset(dataset->'categories')
      as x(id uuid, name text, kind text, colour text)
    on conflict (id) do nothing;
  insert into public.entities(id, organisation_id, name, kind)
    select id, organisation_id, name, kind from jsonb_to_recordset(dataset->'entities') as x(id uuid, name text, kind text)
    on conflict (id) do update set name = excluded.name, kind = excluded.kind
      where entities.organisation_id = excluded.organisation_id;
  insert into public.bank_connections(id, organisation_id, entity_id, provider, status, last_synced_at)
    select id, organisation_id, entity_id, 'mock', 'active', now()
    from jsonb_to_recordset(dataset->'connections') as x(id uuid, entity_id uuid)
    on conflict (id) do update set status = 'active', last_synced_at = now()
      where bank_connections.organisation_id = excluded.organisation_id and bank_connections.provider = 'mock';
  insert into public.accounts(id, organisation_id, entity_id, connection_id, name, institution, kind,
    currency, balance_cents, masked_number, updated_at)
    select id, organisation_id, entity_id, connection_id, name, institution, kind, 'AUD', balance_cents, masked_number, updated_at
    from jsonb_to_recordset(dataset->'accounts') as x(id uuid, entity_id uuid, connection_id uuid, name text,
      institution text, kind text, balance_cents bigint, masked_number text, updated_at timestamptz)
    on conflict (id) do update set balance_cents = excluded.balance_cents, updated_at = excluded.updated_at
      where accounts.organisation_id = excluded.organisation_id;
  get diagnostics account_count = row_count;
  insert into public.transactions(id, organisation_id, account_id, provider_transaction_id, posted_at,
    description, merchant, amount_cents, currency, category_id, category_source, status, transfer_pair_id, receipt_status)
    select id, organisation_id, account_id, provider_transaction_id, posted_at, description, merchant,
      amount_cents, 'AUD', category_id, category_source, status, transfer_pair_id, receipt_status
    from jsonb_to_recordset(dataset->'transactions') as x(id uuid, account_id uuid, provider_transaction_id text,
      posted_at date, description text, merchant text, amount_cents bigint, category_id uuid, category_source text,
      status text, transfer_pair_id uuid, receipt_status text)
    on conflict (organisation_id, account_id, provider_transaction_id) do update
      set posted_at = excluded.posted_at, description = excluded.description, merchant = excluded.merchant,
      amount_cents = excluded.amount_cents, status = excluded.status, transfer_pair_id = excluded.transfer_pair_id,
      category_id = case when transactions.category_source = 'manual' then transactions.category_id else excluded.category_id end,
      category_source = case when transactions.category_source = 'manual' then 'manual' else excluded.category_source end,
      updated_at = now();
  get diagnostics transaction_count = row_count;
  insert into private.provider_records(organisation_id, connection_id, provider_record_id, payload)
    select organisation_id, connection_id, provider_record_id, payload
    from jsonb_to_recordset(dataset->'raw_records') as x(connection_id uuid, provider_record_id text, payload jsonb)
    on conflict (organisation_id, connection_id, provider_record_id) do update
      set payload = excluded.payload, received_at = now();
  update public.processing_jobs set status = 'succeeded', finished_at = now() where id = job_id;
  insert into public.audit_events(organisation_id, actor_user_id, action, resource_id, metadata)
    values (organisation_id, actor_user_id, 'bank.mock_synced', job_id,
      jsonb_build_object('accounts', account_count, 'transactions', transaction_count));
  return jsonb_build_object('syncedAccounts', account_count, 'syncedTransactions', transaction_count, 'provider', 'mock', 'jobId', job_id);
end $$;
revoke all on function public.ingest_mock_dataset(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_mock_dataset(uuid, uuid, jsonb) to service_role;
