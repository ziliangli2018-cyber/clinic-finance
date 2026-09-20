import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e-auth',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:4174/clinic-finance/',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --mode hosted-demo --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/clinic-finance/',
    env: {
      VITE_APP_ENV: 'demo',
      VITE_DATA_MODE: 'supabase',
      VITE_BASE_PATH: '/clinic-finance/',
      VITE_SUPABASE_URL: 'https://ci-example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_ci_build_placeholder',
    },
    reuseExistingServer: false,
  },
});
