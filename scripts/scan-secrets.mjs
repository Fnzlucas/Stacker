// Recherche de secrets (équivalent léger de gitleaks, sans dépendance) :
//   - dans les fichiers suivis ou non ignorés par git (sources) ;
//   - dans le build (dist/) : seul ce qui est préfixé VITE_ peut s'y trouver.
// Échoue si une clé service_role, une clé secrète Supabase, Brevo, Turnstile,
// une clé privée ou un jeton d'API connu est détecté.
//
//   node scripts/scan-secrets.mjs [--dist=dist]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, process.argv.find((a) => a.startsWith('--dist='))?.slice(7) ?? 'dist');

export const RULES = [
  { id: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'supabase-secret-key', re: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
  { id: 'brevo-api-key', re: /\bxkeysib-[a-f0-9]{64}-[A-Za-z0-9]{16}\b/ },
  { id: 'brevo-smtp-key', re: /\bxsmtpsib-[a-f0-9]{64}-[A-Za-z0-9]{16}\b/ },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'stripe-or-mollie-live-key', re: /\b(sk_live_[A-Za-z0-9]{20,}|live_[A-Za-z0-9]{30,})\b/ },
  // Secret Turnstile réel (les clés de test publiques de Cloudflare sont tolérées).
  { id: 'turnstile-secret', re: /TURNSTILE_SECRET_KEY\s*[=:]\s*["']?0x4[A-Za-z0-9_-]{20,}/ },
  { id: 'service-role-assignment', re: /SERVICE_ROLE_KEY\s*[=:]\s*["']?eyJ[A-Za-z0-9_-]{10,}/ },
];

/** JWT dont la charge utile déclare le rôle service_role. */
function hasServiceRoleJwt(text) {
  for (const m of text.matchAll(/\beyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      if (payload && payload.role === 'service_role') return true;
    } catch {
      /* pas un JWT : ignoré */
    }
  }
  return false;
}

export function scanText(text) {
  const hits = RULES.filter((r) => r.re.test(text)).map((r) => r.id);
  if (hasServiceRoleJwt(text)) hits.push('service-role-jwt');
  return hits;
}

function sourceFiles() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) files.push(...walk(abs));
    else files.push(abs);
  }
  return files;
}

const BINARY = /\.(woff2?|png|jpe?g|gif|ico|pdf|zip)$/i;
const findings = [];
let scanned = 0;

for (const rel of sourceFiles()) {
  if (BINARY.test(rel) || rel === 'pnpm-lock.yaml') continue;
  const abs = join(root, rel);
  if (!existsSync(abs)) continue;
  scanned++;
  for (const id of scanText(readFileSync(abs, 'utf8'))) findings.push(`${rel} : ${id}`);
}

if (existsSync(distDir)) {
  for (const abs of walk(distDir)) {
    if (BINARY.test(abs)) continue;
    scanned++;
    const text = readFileSync(abs, 'utf8');
    for (const id of scanText(text)) findings.push(`${relative(root, abs)} : ${id}`);
    // Aucun nom de variable serveur ne doit atterrir dans le front.
    for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'BREVO_API_KEY', 'TURNSTILE_SECRET_KEY', 'RATE_LIMIT_PEPPER']) {
      if (text.includes(name)) findings.push(`${relative(root, abs)} : variable serveur ${name} dans le build`);
    }
  }
}

if (findings.length > 0) {
  console.error(`✗ ${String(findings.length)} secret(s) potentiel(s) :\n  ${findings.join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ Aucun secret détecté (${String(scanned)} fichiers analysés, sources + ${relative(root, distDir) || '.'})`);
