import { authenticate, authoriseEditor } from '../_shared/auth.ts';
import { basiqConfig, configuredBasiq } from '../_shared/basiq.ts';
import { failure, HttpError, preflight, response } from '../_shared/http.ts';

type Action = 'status' | 'connect' | 'manage' | 'extend' | 'reauthorise' | 'disconnect';

async function requestBody(request: Request): Promise<{ organisationId: string; action: Action }> {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new HttpError(415, 'JSON body required');
  const raw = await request.text();
  if (raw.length > 4096) throw new HttpError(413, 'Request too large');
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
  const organisationId = value.organisationId;
  const action = value.action;
  if (
    typeof organisationId !== 'string' ||
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(organisationId)
  )
    throw new HttpError(400, 'A valid organisationId is required');
  if (
    !['status', 'connect', 'manage', 'extend', 'reauthorise', 'disconnect'].includes(String(action))
  )
    throw new HttpError(400, 'Invalid banking action');
  return { organisationId, action: action as Action };
}

export async function handler(request: Request): Promise<Response> {
  const early = preflight(request);
  if (early) return early;
  try {
    const context = await authenticate(request);
    const { organisationId, action } = await requestBody(request);
    await authoriseEditor(context, organisationId);
    const { data: organisation, error: organisationError } = await context.admin
      .from('organisations')
      .select('id,is_demo')
      .eq('id', organisationId)
      .single();
    if (organisationError || !organisation || organisation.is_demo)
      throw new HttpError(403, 'Live organisation unavailable');

    const config = basiqConfig();
    if (!config) {
      if (action !== 'status') throw new HttpError(503, 'Connected banking setup is incomplete');
      return response(request, 200, {
        configured: false,
        provider: 'basiq',
        connectionState: 'not_connected',
        connections: [],
        lastSyncedAt: null,
        consentExpiresAt: null,
        automaticSync: false,
        reason: 'Basiq production approval and secure server configuration are still required.',
      });
    }

    const { data: profileRows, error: profileError } = await context.admin.rpc(
      'get_basiq_profile',
      { organisation_id: organisationId, actor_user_id: context.user.id },
    );
    if (profileError) throw new HttpError(503, 'Unable to read banking profile');
    let profile = Array.isArray(profileRows) ? profileRows[0] : null;
    const basiq = configuredBasiq(config);

    if (action === 'disconnect') {
      if (!profile) return response(request, 200, { disconnected: true });
      await basiq.disconnect(String(profile.provider_user_id));
      const { error } = await context.admin.rpc('purge_basiq_data', {
        profile_id: profile.profile_id,
        actor_user_id: context.user.id,
        remove_profile: true,
      });
      if (error) throw new Error('Banking cleanup failed');
      return response(request, 200, { disconnected: true });
    }

    if (action === 'connect' && !profile) {
      const email = context.user.email;
      if (!email) throw new HttpError(400, 'A verified account email is required');
      const providerUserId = await basiq.createUser(email);
      const { data: profileId, error } = await context.admin.rpc('save_basiq_profile', {
        organisation_id: organisationId,
        actor_user_id: context.user.id,
        provider_user_id: providerUserId,
      });
      if (error || typeof profileId !== 'string') {
        try {
          await basiq.disconnect(providerUserId);
        } catch {
          // Preserve the original failure and never expose provider details.
        }
        throw new Error('Unable to save banking profile');
      }
      profile = { profile_id: profileId, provider_user_id: providerUserId };
    }

    if (action !== 'status') {
      if (!profile) throw new HttpError(409, 'Connect a bank before managing consent');
      return response(request, 200, {
        url: await basiq.consentUrl(String(profile.provider_user_id), action),
      });
    }

    if (!profile)
      return response(request, 200, {
        configured: true,
        provider: 'basiq',
        connectionState: 'not_connected',
        connections: [],
        lastSyncedAt: null,
        consentExpiresAt: null,
        automaticSync: config.automaticSync,
      });

    const remote = await basiq.status(String(profile.provider_user_id), organisationId);
    const { data: stored, error: storedError } = await context.admin
      .from('bank_connections')
      .select('id,last_synced_at')
      .eq('organisation_id', organisationId)
      .eq('provider', 'basiq');
    if (storedError) throw new HttpError(503, 'Unable to read stored connections');
    const lastSyncedById = new Map(
      (stored ?? []).map((row) => [String(row.id), row.last_synced_at as string | null]),
    );
    const connections = remote.connections.map((connection) => ({
      id: String(connection.id),
      institutionId: String(connection.institution_id),
      institutionName: String(connection.institution_name),
      state: connection.status,
      lastSyncedAt: lastSyncedById.get(String(connection.id)) ?? null,
      consentExpiresAt: connection.consent_expires_at ?? null,
    }));
    const lastSyncedAt =
      [...lastSyncedById.values()]
        .filter((value): value is string => typeof value === 'string')
        .sort()
        .at(-1) ?? null;

    if (['not_connected', 'consent_required'].includes(remote.connectionState)) {
      const { error } = await context.admin.rpc('purge_basiq_data', {
        profile_id: profile.profile_id,
        actor_user_id: context.user.id,
        remove_profile: false,
      });
      if (error) throw new Error('Expired banking data cleanup failed');
    }

    return response(request, 200, {
      configured: true,
      provider: 'basiq',
      connectionState: remote.connectionState,
      connections,
      lastSyncedAt,
      consentExpiresAt: remote.consentExpiresAt,
      automaticSync: config.automaticSync,
    });
  } catch (error) {
    return failure(request, error);
  }
}

Deno.serve(handler);
