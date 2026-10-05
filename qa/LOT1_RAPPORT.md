# Lot 1 : site public, liste d'attente, pages légales

Date : lundi 5 octobre 2026. Dossier : `stacker/app`.
Statut : **terminé côté code. `pnpm run ci` passe en entier (code de sortie 0).** Avant la mise en production, Lucas doit encore compléter et configurer les points de la section 4.

---

## 1. Ce qui est fait

**Site public (HTML pré-rendu, sans JS sur les pages légales)**
- `/` : la landing. Héro sans promesse de gain. « Comment ça marche » en 3 étapes : l'app trouve les entreprises, tu appelles et tu closes, Stacker réalise le service et tu touches ta commission. Ensuite les 4 services, les niveaux 15 / 18 / 22 / 25 %, la règle de disponibilité (signature, puis encaissement + 14 j, ou 30 j pour un nouveau client, puis versement hebdomadaire), l'abonnement à 6,99 € avec ce qu'il contient, l'offre des 100 premiers, le formulaire de liste d'attente et une FAQ honnête de 12 questions.
- `/tarifs`, `/liste-attente`, `/contact` (formulaire `mailto:`, inactif tant que l'email de contact n'est pas renseigné), et une page 404.
- Pages légales : `/mentions-legales`, `/cgu`, `/cgv` (rétractation de 14 jours, résiliation depuis le profil, offre des 100 premiers), `/confidentialite` (RGPD, tableau des traitements empilé sur mobile) et `/remboursement` (avec le formulaire type de rétractation). Chaque fichier source commence par `/* À faire valider par un juriste… */`. Ce commentaire n'apparaît pas dans le HTML, et un test le vérifie.
- Design system `design/` repris tel quel (tokens, composants, logo, icônes, polices locales). Seul ajout : un correctif de contraste AA sur `.level-rate`, dont l'opacité de 0,85 ne passait pas le contrôle axe.

**Liste d'attente**
- La migration Supabase existante a été gardée telle quelle. RLS activée et forcée, aucun droit pour `anon` ni `authenticated`. L'inscription passe uniquement par la RPC `waitlist_join` (security definer, `service_role`), appelée par l'Edge Function. La seule exposition publique est `waitlist_count()`, qui renvoie un entier. L'email normalisé est unique. Le consentement est enregistré, horodaté et versionné dans `consents`, qui n'accepte que des ajouts.
- Edge Function `waitlist-join`, contrôles dans cet ordre : origine autorisée, méthode, type et taille du corps, validation Zod (la même que dans le navigateur), rate limit Postgres (10 requêtes / 10 min par IP hachée avec un sel), Turnstile si `TURNSTILE_SECRET_KEY` est défini, inscription idempotente, puis email de confirmation Brevo. Sans clé Brevo, l'email passe en **mode « log »** : il n'est pas envoyé et l'événement est journalisé sans donnée personnelle.
- Le compteur affiche le vrai nombre renvoyé par la RPC. Si l'appel échoue ou si Supabase n'est pas configuré, rien ne s'affiche.
- **Sans `VITE_SUPABASE_*`**, le site fonctionne : le formulaire est désactivé, avec le message « Les inscriptions … ne sont pas encore ouvertes ». Testé en e2e.

**Sécurité et livraison**
- `vercel.json` : URLs propres (`/tarifs`, `/cgv`…), CSP stricte (`script-src 'self'` plus Cloudflare Turnstile, `style-src 'self'`, aucun `unsafe-inline` ni `unsafe-eval`), HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP et CORP. Le serveur e2e applique les mêmes en-têtes, si bien que les tests tournent avec la vraie CSP.
- Aucune ressource tierce n'est chargée au runtime. Turnstile n'est chargé que si une clé de site est fournie. Le seul secret présent côté front est la clé publique anon.
- ESLint interdit `dangerouslySetInnerHTML`, `innerHTML`, `Math.random` et `localStorage` dans le code livré.
- Le build liste les jetons `{{À COMPLÉTER}}` restants et **refuse un déploiement de production Vercel** tant qu'il en reste. On peut passer outre avec `ALLOW_PLACEHOLDERS=1`, ce qui est déconseillé.
- Le workflow `.github/workflows/ci.yml` est prêt.

**Commits** (en français, auteur « Stacker Dev ») : outillage, Edge Function, build, site, pages légales, e2e, CI, puis ce rapport avec les captures.

## 2. Résultats chiffrés

| Contrôle | Résultat |
|---|---|
| Lint (`eslint --max-warnings=0`, règles TypeScript strictes avec typage) | 0 erreur, 0 avertissement |
| Typecheck (`tsc -b` + `deno check` de l'Edge Function) | 0 erreur |
| Vitest | **127 tests / 4 fichiers, tous verts.** Couverture : lignes 100 %, instructions 99,4 %, branches 94,9 %, fonctions 98,4 % |
| Tests SQL pgTAP (`scripts/test-db.sh`, Postgres 16 local) | **74 assertions / 4 fichiers, toutes vertes** (structure, RLS par intrusion, `waitlist_join`, rate limit) |
| Playwright, Chromium 390×844 et 1280×800 | **53 tests verts**, et **159 sur 159 avec `--repeat-each=3`** (0 test instable). 23 ignorés : les captures, qui se lancent à la demande, et le test clavier sur mobile |
| Contrôles e2e couverts | toutes les pages, liens internes, en-têtes et CSP, SEO sans JS (canonical, sitemap, robots), 0 erreur console, 0 requête en échec, axe-core sans violation sérieuse ou critique (WCAG 2.1/2.2 AA), aucun débordement horizontal, formulaire (succès, erreurs de champs, erreur serveur, rate limit, parrainage, clavier), site sans Supabase |
| Poids par page (gzip) | JS 104,0 Ko sur les pages avec formulaire (budget 170 Ko), 0 Ko sur les pages légales ; CSS 9,4 Ko |
| Recherche de secrets | 0 secret (111 fichiers : sources et build) |
| `pnpm audit --prod` | 0 vulnérabilité. En dev : 1 « high » sur `braces`, via `tailwindcss` puis `chokidar`, outil de build uniquement, sans correctif publié |
| Captures 390×844 | 13 fichiers dans `qa/shots-lot1/` (10 pages et 3 états du formulaire), relues une par une |

Commande unique : **`pnpm run ci`**. `pnpm ci` est une commande réservée par pnpm 10 et renvoie `ERR_PNPM_CI_NOT_IMPLEMENTED`. Captures : `pnpm qa:shots`.

## 3. Reste à faire (hors périmètre du code de ce lot, ou bloqué par Lucas)

- **Validation par un juriste** des 5 pages légales. Points à lui signaler :
  - L'article « Garanties légales » des CGV s'appelle « Conformité du service », parce que le mot « garanti » est banni. Le juriste peut rétablir le terme légal.
  - Les durées de conservation RGPD sont des propositions.
- **Durée de l'offre de lancement** : non fixée, jeton dans les CGV §4.
- **Critères de passage d'un niveau à l'autre** : volontairement non publiés. Ils iront dans le contrat d'apporteur.
- DoD encore à faire avant la porte G3 :
  - Lighthouse CI (perf et a11y).
  - k6 sur la liste d'attente (200 inscriptions/s).
  - E2E WebKit : seul Chromium est installé ici.
  - ZAP baseline et Sentry.
  - Test de restauration PITR.
- Adhésion à un **médiateur de la consommation**, obligatoire.

Choix faits en appliquant ta consigne « aucune invention » :
- Retirés de l'existant : le minimum de virement de 20 €, le virement le mardi, la règle « SIRET dès 1 000 € », l'« accès anticipé à la formation », la durée « 12 mois » et les critères de niveau chiffrés.
- Le nom commercial « Alma Company » ne figure plus : la consigne dit « marque Stacker ». À réintroduire si l'entité qui vend est Alma Company.
- J'ai écrit « 0 % prélevé sur ton chiffre d'affaires », comme dans ta consigne. Le verdict du Lead disait « sur tes commissions ».
- La coquille d'app `/app` (React Router) est supprimée : elle sera recréée au lot suivant, avec l'authentification.

## 4. Ce que Lucas doit configurer

### 4.1 Compléter `src/config/site.ts` (12 jetons, listés par `pnpm build`)
- Email de contact, téléphone, adresse, SIRET, immatriculation (RNE), mention TVA.
- Médiateur : nom, adresse, site.
- Durée de l'offre de lancement.
- Région Supabase : dans `src/pages/legal/Confidentialite.tsx`.
- Adresse de Vercel Inc. à vérifier : « 440 N Barranca Ave #4133, Covina, CA 91723 », à confirmer sur le site de Vercel.

### 4.2 Variables d'environnement Vercel (Settings > Environment Variables)
| Variable | Valeur | Environnements |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | Production (+ Preview avec le projet de staging) |
| `VITE_SUPABASE_ANON_KEY` | clé publique anon ou publishable | idem |
| `VITE_TURNSTILE_SITE_KEY` | clé de **site** Turnstile (vide = désactivé) | idem |
| `SITE_URL` | `https://<domaine>` sans « / » final | Production |

Projet Vercel en plan **Pro** (usage commercial). Si le dépôt contient `stacker/`, réglez Root Directory sur `app`. Le reste est lu dans `vercel.json` (installation, build, dossier `dist`).

### 4.3 Secrets de l'Edge Function (Supabase, région UE)
Fichier `supabase/functions/.env`, jamais commité, modèle dans `supabase/functions/.env.example` :
- `SITE_URL` : `https://<domaine>`
- `ALLOWED_ORIGINS` : `https://<domaine>` (ajouter l'URL de preview si besoin)
- `RATE_LIMIT_PEPPER` : sortie de `openssl rand -hex 32`
- `TURNSTILE_SECRET_KEY` : clé **secrète** Turnstile, à renseigner avec la clé de site
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME=Stacker` : expéditeur sur un domaine authentifié SPF/DKIM/DMARC
- `CONTACT_EMAIL`

`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont injectées par Supabase. Ne les mettez jamais dans Vercel.

### 4.4 Commandes de déploiement (depuis `app/`)
```bash
# Supabase : base, secrets, fonction
pnpm dlx supabase login
pnpm dlx supabase link --project-ref <REF_PROJET>
pnpm dlx supabase db push                     # applique supabase/migrations
pnpm dlx supabase secrets set --env-file supabase/functions/.env
pnpm dlx supabase functions deploy waitlist-join --no-verify-jwt

# Vérification : doit renvoyer un entier (0 au départ)
curl -s -X POST "https://<REF_PROJET>.supabase.co/rest/v1/rpc/waitlist_count" \
  -H "apikey: <CLE_ANON>" -H "content-type: application/json" -d '{}'

# Vercel
pnpm dlx vercel link
pnpm dlx vercel env add VITE_SUPABASE_URL production
pnpm dlx vercel env add VITE_SUPABASE_ANON_KEY production
pnpm dlx vercel env add VITE_TURNSTILE_SITE_KEY production
pnpm dlx vercel env add SITE_URL production
pnpm dlx vercel --prod      # refusé tant qu'un {{À COMPLÉTER}} subsiste
```
Effacement RGPD d'une inscription, depuis le SQL Editor : `select public.waitlist_erase('adresse@exemple.fr');`
