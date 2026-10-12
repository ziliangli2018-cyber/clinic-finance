-- Legal ownership is established by the entity-specific bank consent. There is
-- no supported browser operation that can move an imported account to a
-- different legal entity.
drop function public.set_account_entity(uuid, uuid);

-- Cover every multi-column foreign key used by live banking reads and cascades.
create index accounts_org_entity_connection_idx
  on public.accounts(organisation_id, entity_id, connection_id);
create index accounts_org_connection_idx
  on public.accounts(organisation_id, connection_id);
create index audit_events_actor_idx
  on public.audit_events(actor_user_id);
create index forecast_scenarios_org_entity_idx
  on public.forecast_scenarios(organisation_id, entity_id);
create index receipts_org_transaction_idx
  on public.receipts(organisation_id, transaction_id);
create index transactions_category_idx
  on public.transactions(category_id);
