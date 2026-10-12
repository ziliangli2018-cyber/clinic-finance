-- Make the browser and server privilege contract independent of Supabase's
-- project-creation defaults. New objects remain private until a later migration
-- deliberately grants access and adds any required RLS policies.

revoke all on schema public from public, anon, authenticated, service_role;
grant usage on schema public to authenticated, service_role;

revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to authenticated, service_role;

-- PostgreSQL's built-in function default is EXECUTE for PUBLIC. A scoped
-- revoke cannot subtract that global default, so remove it before applying the
-- schema-specific Supabase privilege contract below.
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated, service_role;

-- Re-assert the complete existing table contract instead of inheriting grants
-- from older Supabase projects.
revoke all on all tables in schema public from public, anon, authenticated, service_role;
grant select on public.organisations, public.organisation_members, public.entities,
  public.bank_connections, public.accounts, public.categories, public.transactions,
  public.audit_events, public.processing_jobs, public.receipts,
  public.economic_indicators, public.forecast_scenarios
to authenticated;
grant all on all tables in schema public to service_role;

revoke all on all tables in schema private from public, anon, authenticated, service_role;
grant all on all tables in schema private to service_role;

-- Function EXECUTE defaults historically included PUBLIC. Remove every current
-- public/private function grant, then expose only the intended browser and
-- server RPCs.
revoke execute on all functions in schema public
from public, anon, authenticated, service_role;
revoke execute on all functions in schema private
from public, anon, authenticated, service_role;

grant execute on function private.is_member(uuid), private.is_editor(uuid)
to authenticated;

grant execute on function public.create_demo_organisation(text),
  public.set_transaction_category(uuid, uuid),
  public.create_live_organisation(text),
  public.set_account_entity(uuid, uuid)
to authenticated;

grant execute on function public.ingest_mock_dataset(uuid, uuid, jsonb),
  public.get_basiq_profile(uuid, uuid),
  public.save_basiq_profile(uuid, uuid, text),
  public.claim_basiq_manual_refresh(uuid, uuid),
  public.list_basiq_profiles(),
  public.ingest_basiq_snapshot(uuid, uuid, jsonb),
  public.purge_basiq_data(uuid, uuid, boolean)
to service_role;

-- These RPCs are server-only and the service role already has the explicit
-- table privileges it needs. Running as the invoker limits the impact of any
-- future EXECUTE-grant mistake instead of unnecessarily elevating to postgres.
alter function public.ingest_mock_dataset(uuid, uuid, jsonb) security invoker;
alter function public.get_basiq_profile(uuid, uuid) security invoker;
alter function public.save_basiq_profile(uuid, uuid, text) security invoker;
alter function public.claim_basiq_manual_refresh(uuid, uuid) security invoker;
alter function public.list_basiq_profiles() security invoker;
alter function public.ingest_basiq_snapshot(uuid, uuid, jsonb) security invoker;
alter function public.purge_basiq_data(uuid, uuid, boolean) security invoker;
