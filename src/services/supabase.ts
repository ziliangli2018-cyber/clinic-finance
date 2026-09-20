import { createClient } from '@supabase/supabase-js';

export const isMock = (import.meta.env.VITE_DATA_MODE || 'mock') === 'mock';
export const isProduction = import.meta.env.VITE_APP_ENV === 'production';
export const supabase = !isMock
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;
