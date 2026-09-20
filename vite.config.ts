import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { validatePublicConfig } from './src/services/config-validation';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('VITE_'))) };
  validatePublicConfig(env, mode === 'production');
  return { plugins: [react()], base: env.VITE_BASE_PATH || '/', build: { sourcemap: false }, test: { include: ['tests/**/*.test.ts'] } };
});
