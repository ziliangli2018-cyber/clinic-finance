import { authenticate, authoriseEditor } from '../_shared/auth.ts';
import { basiqConfig, configuredBasiq } from '../_shared/basiq.ts';
import { failure, HttpError, preflight, response } from '../_shared/http.ts';
import { bankProvider } from '../_shared/provider.ts';

async function requestBody(
  request: Request,
): Promise<{ organisationId: string; entityId: string | null }> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    throw new HttpError(415, 'JSON body required');
  }
  const raw = await request.text();
  if (raw.length > 4096) throw new HttpError(413, 'Request too large');
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
  const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
  if (typeof value.organisationId !== 'string' || !uuid.test(value.organisationId)) {
    throw new HttpError(400, 'A valid organisationId is required');
  }
  if (
    value.entityId !== undefined &&
    (typeof value.entityId !== 'string' || !uuid.test(value.entityId))
  ) {
    throw new HttpError(400, 'A valid entityId is required');
  }
  return {
    organisationId: value.organisationId,
    entityId: typeof value.entityId === 'string' ? value.entityId : null,
  };
}

function claimedGeneration(value: unknown): number {
  const generation = typeof value === 'string' ? Number(value) : value;
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation <= 0) {
    throw new Error('Unable to order banking refresh');
  }
  return generation;
}

function staleResult(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as Record<string, unknown>).skipped);
}

export async function handler(request: Request): Promise<Response> {
  const early = preflight(request);
  if (early) return early;
  try {
    const context = await authenticate(request);
    const { organisationId, entityId } = await requestBody(request);
    await authoriseEditor(context, organisationId);
    const { data: organisation, error } = await context.admin
      .from('organisations')
      .select('id,is_demo')
      .eq('id', organisationId)
      .single();
    if (error || !organisation) {
      throw new HttpError(403, 'Organisation unavailable');
    }
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
        if (ingestError.code === '42501') {
          throw new HttpError(403, 'Demo sync disabled or access revoked');
        }
        throw new Error('Atomic ingestion failed');
      }
      return response(request, 200, data);
    }

    const config = basiqConfig();
    if (!config) {
      throw new HttpError(503, 'Connected banking setup is incomplete');
    }
    const { data: profiles, error: profileError } = await context.admin.rpc(
      'claim_basiq_manual_refresh',
      {
        organisation_id: organisationId,
        actor_user_id: context.user.id,
        requested_entity_id: entityId,
      },
    );
    if (profileError) {
      throw new HttpError(503, 'Unable to read banking profiles');
    }
    if (!Array.isArray(profiles) || !profiles.length) {
      throw new HttpError(409, 'Connect a bank before refreshing data');
    }
    const basiq = configuredBasiq(config);
    let synced = 0;
    let purged = 0;
    let pending = 0;
    let lastResult: unknown = null;
    for (const profile of profiles) {
      const { data: generationValue, error: generationError } = await context.admin.rpc(
        'claim_basiq_snapshot',
        {
          profile_id: profile.profile_id,
          actor_user_id: context.user.id,
        },
      );
      if (generationError) throw new Error('Unable to order banking refresh');
      const syncGeneration = claimedGeneration(generationValue);
      if (profile.should_refresh) {
        await basiq.refreshUser(String(profile.provider_user_id));
      }
      const dataset = await basiq.snapshot(String(profile.provider_user_id), organisationId);
      if (dataset.connectionState !== 'active') {
        if (
          dataset.connectionState === 'consent_required' ||
          dataset.connectionState === 'not_connected'
        ) {
          const { data: didPurge, error: purgeError } = await context.admin.rpc(
            'purge_basiq_snapshot',
            {
              profile_id: profile.profile_id,
              actor_user_id: context.user.id,
              sync_generation: syncGeneration,
            },
          );
          if (purgeError) {
            throw new Error('Expired banking data cleanup failed');
          }
          if (didPurge) purged += 1;
          else {
            lastResult = {
              provider: 'basiq',
              entityId: profile.entity_id,
              skipped: true,
              reason: 'stale_snapshot',
              syncGeneration,
            };
            continue;
          }
        } else {
          pending += 1;
        }
        if (entityId) {
          throw new HttpError(
            409,
            dataset.connectionState === 'pending'
              ? 'Bank connection is still being prepared'
              : 'Bank consent is required before refreshing',
          );
        }
        continue;
      }
      const syncedAt = new Date().toISOString();
      dataset.connections = dataset.connections.map((connection) => ({
        ...connection,
        last_synced_at: connection.status === 'active' ? syncedAt : connection.last_synced_at,
      }));
      const { data, error: ingestError } = await context.admin.rpc(
        'ingest_basiq_snapshot_ordered',
        {
          profile_id: profile.profile_id,
          actor_user_id: context.user.id,
          sync_generation: syncGeneration,
          dataset,
        },
      );
      if (ingestError) throw new Error('Atomic banking ingestion failed');
      lastResult = data;
      if (!staleResult(data)) synced += 1;
    }
    return response(
      request,
      200,
      entityId ? lastResult : { processed: profiles.length, synced, purged, pending },
    );
  } catch (error) {
    return failure(request, error);
  }
}

Deno.serve(handler);
