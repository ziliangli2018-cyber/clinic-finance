export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function headersFor(request: Request): Headers {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Vary': 'Origin', 'Cache-Control': 'no-store' });
  const origin = request.headers.get('Origin');
  const allowed = (Deno.env.get('CORS_ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map((value) => value.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return headers;
}

export function response(request: Request, status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: headersFor(request) });
}

export function preflight(request: Request): Response | undefined {
  const origin = request.headers.get('Origin');
  if (origin && !headersFor(request).has('Access-Control-Allow-Origin')) {
    return response(request, 403, { error: 'Origin not allowed' });
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headersFor(request) });
  if (request.method !== 'POST') return response(request, 405, { error: 'POST required' });
}

export function failure(request: Request, error: unknown): Response {
  if (error instanceof HttpError) return response(request, error.status, { error: error.message });
  // No financial payloads, credentials, provider error bodies or JWTs in application logs.
  console.error('Request failed', { code: 'INTERNAL_ERROR' });
  return response(request, 500, { error: 'Request failed. Try again or contact your administrator.' });
}

export async function organisationIdFrom(request: Request): Promise<string> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new HttpError(415, 'JSON body required');
  const raw = await request.text();
  if (raw.length > 4096) throw new HttpError(413, 'Request too large');
  let body: { organisationId?: unknown };
  try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON'); }
  if (!body || typeof body.organisationId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.organisationId)) {
    throw new HttpError(400, 'A valid organisationId is required');
  }
  return body.organisationId;
}
