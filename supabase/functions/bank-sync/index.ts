import { authenticate, authoriseEditor } from '../_shared/auth.ts';
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
    const { data: connections, error: connectionError } = await context.admin
      .from('bank_connections')
      .select('provider')
      .eq('organisation_id', organisationId);
    if (connectionError) throw new HttpError(503, 'Unable to read bank connections');
    if (connections?.some((row) => row.provider !== 'mock'))
      throw new HttpError(501, 'Live bank sync is not available in version 0.1');
    const provider = bankProvider(
      'mock',
      Deno.env.get('APP_ENV'),
      Deno.env.get('ALLOW_MOCK_DATA'),
      organisation.is_demo,
    );
    // Empty demo organisations are intentionally provisioned here, including their connections.
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
  } catch (error) {
    return failure(request, error);
  }
}

Deno.serve(handler);
