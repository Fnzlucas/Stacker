// Serveur des tests e2e : construit DEUX variantes du site puis les sert
// comme Vercel (en-têtes et CSP de vercel.json) :
//   - http://localhost:4174 : Supabase « configuré » vers une URL factice
//     (https://e2e-stacker.supabase.co), interceptée par Playwright ;
//   - http://localhost:4175 : Supabase NON configuré (formulaire désactivé).
// Les builds sont séquentiels (ils partagent les gabarits HTML générés).
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const E2E_SUPABASE_URL = 'https://e2e-stacker.supabase.co';

const variants = [
  {
    dir: '.e2e/configured',
    port: 4174,
    env: { VITE_SUPABASE_URL: E2E_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: 'sb_publishable_e2e_test_key', VITE_TURNSTILE_SITE_KEY: '', SITE_URL: 'http://localhost:4174' },
  },
  {
    dir: '.e2e/unconfigured',
    port: 4175,
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_TURNSTILE_SITE_KEY: '', SITE_URL: 'http://localhost:4175' },
  },
];

if (process.env.E2E_SKIP_BUILD !== '1') {
  for (const v of variants) {
    const res = spawnSync(process.execPath, ['scripts/build.mjs', `--outDir=${v.dir}`], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ...v.env, VERCEL_ENV: '' },
    });
    if (res.status !== 0) process.exit(res.status ?? 1);
  }
}

const children = variants.map((v) =>
  spawn(process.execPath, ['scripts/serve-dist.mjs', `--dir=${v.dir}`, `--port=${String(v.port)}`], { cwd: root, stdio: 'inherit' }),
);
const stop = () => {
  for (const c of children) c.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
