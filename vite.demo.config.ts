/**
 * Build de la démo navigateur (src/demo) : jamais déployée avec le site.
 *   VITE_SUPABASE_URL=https://demo.supabase.co VITE_SUPABASE_ANON_KEY=demo pnpm exec vite build --config vite.demo.config.ts
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: false,
  resolve: {
    alias: {
      '@shared': here('./supabase/functions/_shared'),
      'node:crypto': here('./src/demo/crypto-shim.ts'),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist-demo',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: here('./demo.html'), output: { inlineDynamicImports: true } },
  },
});
