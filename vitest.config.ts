import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./supabase/functions/_shared', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text', 'json-summary'],
      include: ['src/lib/**/*.ts', 'src/app/lib/**/*.ts', 'src/app/paths.ts', 'src/app/boot.ts', 'src/config/**/*.ts', 'supabase/functions/_shared/**/*.ts', 'supabase/functions/waitlist-join/*.ts', 'supabase/functions/account-delete/*.ts', 'supabase/functions/prospects-search/*.ts', 'supabase/functions/opposition-register/*.ts'],
      exclude: ['**/*.test.ts', 'supabase/functions/*/index.ts', 'src/app/lib/queries.ts', 'src/app/lib/prospectQueries.ts'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
