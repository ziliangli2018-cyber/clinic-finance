import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { validatePublicConfig } from './src/services/config-validation';

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, process.cwd(), 'VITE_'),
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('VITE_'))),
  };
  validatePublicConfig(env, mode === 'production', mode === 'hosted-demo');
  const mockDatasetModule =
    env.VITE_DATA_MODE === 'mock' ? './src/domain/mock.ts' : './src/domain/mock-disabled.ts';
  const demoSimulationModule =
    env.VITE_DATA_MODE === 'mock'
      ? './src/domain/simulation.ts'
      : './src/domain/simulation-disabled.ts';
  return {
    plugins: [react()],
    base: env.VITE_BASE_PATH || '/',
    resolve: {
      alias: {
        '@clinic-finance/mock-dataset': fileURLToPath(new URL(mockDatasetModule, import.meta.url)),
        '@clinic-finance/demo-simulation': fileURLToPath(
          new URL(demoSimulationModule, import.meta.url),
        ),
      },
    },
    build: { sourcemap: false },
    test: { include: ['tests/**/*.test.ts'] },
  };
});
