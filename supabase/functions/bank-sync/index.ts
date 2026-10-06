import { authenticate, authoriseEditor } from '../_shared/auth.ts';
import { basiqConfig, configuredBasiq } from '../_shared/basiq.ts';
import { failure, HttpError, organisationIdFrom, preflight, response } from '../_shared/http.ts';
import { bankProvider } from '../_shared/provider.ts';

export async function handler(request: Request): Promise<Response> {
  const early = preflight(request);
  if (early) return early;
  try {
    const context = await authenticate(request);
    const organisationId = await organisationIdFrom(request);
    await authoriseEditor(context, organisationId);
    const { data: organisation, error } = await context.admin
      .from('organisations')
      .select('id,is_demo')
      .eq('id', organisationId)
      .single();
    if (error || !organisation) throw new HttpError(403, 'Organisation unavailable');
    if (organisation.is_demo) {
      const provider = bankProvider(
        'mock',
        Deno.env.get('APP_ENV'),
        Deno.env.get('ALLOW_MOCK_DATA'),
        true,
      );
      const dataset = await provider.fetchDataset(organisationId);
      const { data, error: ingestError } = await context.admin.rpc('ingest_mock_dataset', {
        organisation_id: organisationId,
        actor_user_id: context.user.id,
        dataset,
      });
      if (ingestError) {
        if (ingestError.code === '42501')
          throw new HttpError(403, 'Demo sync disabled or access revoked');
        throw new Error('Atomic ingestion failed');
      }
      return response(request, 200, data);
    }

    const config = basiqConfig();
    if (!config) throw new HttpError(503, 'Connected banking setup is incomplete');
    const { data: profileRows, error: profileError } = await context.admin.rpc(
      'claim_basiq_manual_refresh',
      { organisation_id: organisationId, actor_user_id: context.user.id },
    );
    const profile = Array.isArray(profileRows) ? profileRows[0] : null;
    if (profileError || !profile) {
      throw new HttpError(409, 'Connect a bank before refreshing data');
    }
    const basiq = configuredBasiq(config);
    if (profile.should_refresh) await basiq.refreshUser(String(profile.provider_user_id));
    const dataset = await basiq.snapshot(String(profile.provider_user_id), organisationId);
    if (dataset.connectionState !== 'active') {
      if (
        dataset.connectionState === 'consent_required' ||
        dataset.connectionState === 'not_connected'
      )
        await context.admin.rpc('purge_basiq_data', {
          profile_id: profile.profile_id,
          actor_user_id: context.user.id,
          remove_profile: false,
        });
      throw new HttpError(
        409,
        dataset.connectionState === 'pending'
          ? 'Bank connection is still being prepared'
          : 'Bank consent is required before refreshing',
      );
    }
    const syncedAt = new Date().toISOString();
    dataset.connections = dataset.connections.map((connection) => ({
      ...connection,
      last_synced_at: connection.status === 'active' ? syncedAt : connection.last_synced_at,
    }));
    const { data, error: ingestError } = await context.admin.rpc('ingest_basiq_snapshot', {
      profile_id: profile.profile_id,
      actor_user_id: context.user.id,
      dataset,
    });
    if (ingestError) throw new Error('Atomic banking ingestion failed');
    return response(request, 200, data);
  } catch (error) {
    return failure(request, error);
  }
}

Deno.serve(handler);
