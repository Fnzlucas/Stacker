import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

interface PageEntry {
  id: string;
  file: string;
}

const root = fileURLToPath(new URL('.', import.meta.url));
const pages = JSON.parse(readFileSync(new URL('./src/site/pages.json', import.meta.url), 'utf8')) as PageEntry[];

/**
 * En développement, rend chaque page côté serveur à la volée (même fonction
 * que le pré-rendu de production : src/ssr/render.tsx) pour que `pnpm dev`
 * affiche exactement ce que les robots et les navigateurs reçoivent.
 */
function devPrerender(): Plugin {
  let server: ViteDevServer | undefined;
  return {
    name: 'stacker:dev-prerender',
    apply: 'serve',
    configureServer(s) {
      server = s;
    },
    async transformIndexHtml(html) {
      const match = /data-page="([\w-]+)"/.exec(html);
      const withUrl = html.replaceAll('%%SITE_URL%%', 'http://localhost:5173');
      if (!match?.[1] || !server) return withUrl;
      const mod = (await server.ssrLoadModule('/src/ssr/render.tsx')) as {
        renderPage: (id: string) => string;
      };
      return withUrl.replace('<!--ssr-outlet-->', mod.renderPage(match[1]));
    },
  };
}

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react(), devPrerender()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./supabase/functions/_shared', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    sourcemap: false,
    // Le pré-rendu (build SSR) a sa propre entrée : src/ssr/render.tsx.
    rollupOptions: {
      ...(isSsrBuild ? {} : { input: Object.fromEntries(pages.map((p) => [p.id, `${root}${p.file}`])) }),
      // Bruit connu de zod 4 (commentaires @__PURE__ mal placés), sans effet sur le bundle.
      onwarn(warning, warn) {
        if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('/zod/')) return;
        warn(warning);
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
}));
