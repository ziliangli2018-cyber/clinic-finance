export function validatePublicConfig(
  env: Record<string, string | undefined>,
  productionBuild = false,
) {
  const appEnv = env.VITE_APP_ENV || 'development';
  const mode = env.VITE_DATA_MODE || 'mock';
  if (!['development', 'demo', 'production'].includes(appEnv))
    throw new Error('Invalid VITE_APP_ENV');
  if (!['mock', 'supabase'].includes(mode)) throw new Error('Invalid VITE_DATA_MODE');
  if (productionBuild && appEnv !== 'production')
    throw new Error('Production builds require VITE_APP_ENV=production');
  if (appEnv === 'production' && mode !== 'supabase')
    throw new Error('Production forbids mock data');
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('VITE_') &&
      ![
        'VITE_APP_ENV',
        'VITE_DATA_MODE',
        'VITE_SUPABASE_URL',
        'VITE_SUPABASE_PUBLISHABLE_KEY',
        'VITE_BASE_PATH',
      ].includes(key)
    )
      throw new Error(`Unapproved public configuration is forbidden: ${key}`);
  }
  const publicKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  if (publicKey.startsWith('sb_secret_')) throw new Error('Supabase secret keys cannot be public');
  if (publicKey.split('.').length === 3) {
    try {
      const payload = JSON.parse(
        atob(publicKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
      ) as { role?: string };
      if (payload.role !== 'anon') throw new Error('Only the Supabase anon JWT may be public');
    } catch {
      throw new Error('Invalid public Supabase JWT; use an anon or publishable key');
    }
  }
  if (mode === 'supabase') {
    if (!env.VITE_SUPABASE_URL || !publicKey || publicKey.startsWith('replace-'))
      throw new Error('Supabase mode requires its public URL and publishable/anon key');
    const url = new URL(env.VITE_SUPABASE_URL);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol))
      throw new Error('Invalid public Supabase URL');
    if (!publicKey.startsWith('sb_publishable_') && publicKey.split('.').length !== 3)
      throw new Error('Use a Supabase publishable key or anon JWT');
    if (appEnv === 'production' && url.protocol !== 'https:')
      throw new Error('Production Supabase requires HTTPS');
  }
  const base = env.VITE_BASE_PATH || '/';
  if (!base.startsWith('/') || !base.endsWith('/') || base.includes('..') || base.includes('//'))
    throw new Error('VITE_BASE_PATH must be an absolute path with leading and trailing slashes');
  return { appEnv, mode };
}
