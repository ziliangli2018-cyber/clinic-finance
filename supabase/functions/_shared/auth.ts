import { createClient } from '@supabase/supabase-js';
import { HttpError } from './http.ts';

export async function authenticate(request: Request) {
  const bearer = request.headers.get('Authorization');
  if (!bearer?.startsWith('Bearer ') || bearer.length < 15) throw new HttpError(401, 'Sign in required');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) throw new HttpError(503, 'Server configuration unavailable');
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // This remote Auth call validates the JWT and resolves the actual user. Never trust decode-only claims.
  const { data: { user }, error } = await admin.auth.getUser(bearer.slice(7));
  if (error || !user) throw new HttpError(401, 'Session expired or invalid');
  return { admin, user };
}

export async function authoriseEditor(context: Awaited<ReturnType<typeof authenticate>>, organisationId: string) {
  const { data: member, error } = await context.admin.from('organisation_members').select('role')
    .eq('organisation_id', organisationId).eq('user_id', context.user.id).maybeSingle();
  if (error) throw new HttpError(503, 'Unable to check organisation access');
  if (!member || !['owner', 'admin'].includes(member.role)) throw new HttpError(403, 'Organisation editor access required');
}
