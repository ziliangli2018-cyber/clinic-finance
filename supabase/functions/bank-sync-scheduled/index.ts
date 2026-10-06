import { createClient } from '@supabase/supabase-js';
import { basiqConfig, configuredBasiq } from '../_shared/basiq.ts';
import { failure, HttpError, preflight, response } from '../_shared/http.ts';

function equalSecret(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1)
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
}

export async function handler(request: Request): Promise<Response> {
  const early = preflight(request);
  if (early) return early;
  try {
    const expected = Deno.env.get('BANK_SYNC_SCHEDULER_SECRET') ?? '';
    const supplied = request.headers.get('x-scheduler-secret') ?? '';
    if (expected.length < 32 || !equalSecret(supplied, expected))
      throw new HttpError(401, 'Scheduler authentication required');
    const config = basiqConfig();
    if (!config || !config.automaticSync)
      throw new HttpError(503, 'Automatic banking sync is not configured');
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) throw new HttpError(503, 'Server configuration unavailable');
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profiles, error } = await admin.rpc('list_basiq_profiles');
    if (error) throw new Error('Unable to list banking profiles');
    const basiq = configuredBasiq(config);
    let synced = 0;
    let purged = 0;
    let failed = 0;
    for (const profile of profiles ?? []) {
      try {
        const dataset = await basiq.snapshot(
          String(profile.provider_user_id),
          String(profile.organisation_id),
        );
        if (dataset.connectionState !== 'active') {
          if (
            dataset.connectionState === 'not_connected' ||
            dataset.connectionState === 'consent_required'
          ) {
            const { error: purgeError } = await admin.rpc('purge_basiq_data', {
              profile_id: profile.profile_id,
              actor_user_id: null,
              remove_profile: false,
            });
            if (purgeError) throw new Error('Bank data cleanup failed');
            purged += 1;
          }
          continue;
        }
        const syncedAt = new Date().toISOString();
        dataset.connections = dataset.connections.map((connection) => ({
          ...connection,
          last_synced_at: connection.status === 'active' ? syncedAt : connection.last_synced_at,
        }));
        const { error: ingestError } = await admin.rpc('ingest_basiq_snapshot', {
          profile_id: profile.profile_id,
          actor_user_id: null,
          dataset,
        });
        if (ingestError) throw new Error('Banking ingestion failed');
        synced += 1;
      } catch {
        // Per-profile failures are counted without logging financial data or provider responses.
        failed += 1;
      }
    }
    return response(request, failed ? 207 : 200, {
      processed: (profiles ?? []).length,
      synced,
      purged,
      failed,
    });
  } catch (error) {
    return failure(request, error);
  }
}

Deno.serve(handler);
