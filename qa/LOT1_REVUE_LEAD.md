# Lot 1 : revue du Lead technique

Date : lundi 5 octobre 2026. Relecteur : Lead (je n'ai pas écrit ce code).
Référentiel : `audit/00_verdict_lead.md` (§1 architecture, §6 DoD, §7 promesses).

## Verdict : VALIDÉ AVEC RÉSERVES

Le code est solide, mais **pas déployable en production en l'état**. Quatre défauts bloquants trouvés en revue sont corrigés (commits `c272d10`, `725d188`, `30939af`, `d2594fb`, auteur « Stacker Lead »). Les réserves B1 à B6 ci-dessous restent bloquantes pour la **mise en ligne publique**. Elles relèvent de Lucas ou de la recette en staging, pas du code. Le site peut partir en **preview** dès maintenant.

---

## 1. CI relancée par moi

`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm run ci`

| Étape | Avant mes corrections | Après mes corrections |
|---|---|---|
| Lint, typecheck (tsc + deno check) | 0 erreur | 0 erreur |
| Vitest | 127/127. Lignes 100 %, branches 94,94 % | **130/130**. Lignes 100 %, branches 95,04 % |
| pgTAP | 74 assertions vertes | 74 assertions vertes |
| Build + budget | JS 104,0 Ko gzip (formulaire), 0 Ko (légal), CSS 9,4 Ko | identique |
| Secrets (sources + dist) | 0 | 0 |
| Playwright Chromium 390 + 1280 | 53 verts, 23 ignorés | **55 verts**, 23 ignorés, code 0 |
| `--repeat-each=3` | non relancé | **165/165**, 0 instable |
| `pnpm audit --prod` | 0 vulnérabilité | idem. En dev : 1 « high » (`braces` via tailwind, outil de build) |

Les chiffres du rapport du dev sont exacts. En revanche, **la CI ne vérifiait pas** les défauts listés en §2.

Écarts DoD non couverts (déjà signalés par le dev, je les confirme) : **WebKit absent** (DoD §6.4 : Chromium **et** WebKit), Lighthouse CI, k6 (200 inscriptions/s), ZAP, Sentry. Aucun e2e ne couvre le chemin **Turnstile activé** sous la vraie CSP. `check:audit` est dans le workflow GitHub mais pas dans `pnpm run ci`.

---

## 2. Corrections bloquantes appliquées par moi

1. **Fuite des données d'un tiers à la réinscription** (`handler.ts`). Avant : soumettre l'email de quelqu'un renvoyait **sa** position et **son** code de parrainage, et confirmait son inscription. Le commentaire « même forme de réponse » masquait le problème : la forme était identique, mais les données étaient celles d'une autre personne. Maintenant : `{ ok: true, status: "already_registered" }`, sans aucune donnée, aucun email envoyé, et un message neutre côté site (« Cette adresse est déjà sur la liste d'attente… »). Couvert par un test unitaire (le code n'apparaît pas dans le corps de la réponse), un test de schéma et un test e2e. Au passage, l'écran affichait « Un email de confirmation vient de partir » à une personne déjà inscrite, ce qui était faux.
2. **Turnstile facultatif par défaut** (`config.ts`), contraire à DoD §1 (« Turnstile sur la liste d'attente »). Sans `TURNSTILE_SECRET_KEY`, la fonction répond maintenant **503 (fail closed)**. La seule exception est `TURNSTILE_DISABLED=1`, explicite, réservé au développement local. `.env.example` ne propose plus `localhost` dans `ALLOWED_ORIGINS` de production.
3. **Build de production trop permissif** (`build.mjs`). Le build est maintenant refusé si Supabase est configuré sans `VITE_TURNSTILE_SITE_KEY`, sinon tout le monde recevrait `captcha_failed`. Il est aussi refusé si `SITE_URL` n'est pas en HTTPS ou pointe sur localhost. Le `dist/` actuel contient `canonical = http://localhost:4173/`. Vérifié avec `VERCEL_ENV=production` : le build est bien refusé.
4. **Textes (§7 et cohérence juridique)**
   - Le H1 et le `<title>` disaient « Touche ta commission chaque mois » sans condition. Ils disent maintenant « Touche une commission récurrente ». La condition « tant que ton client reste abonné » suit juste après.
   - « Tu appelles et tu closes », « tu as conclu la vente », « tu conclus » : un apporteur d'affaires **sans pouvoir de représentation** (CGU art. 6, verdict §5 n° 5) ne conclut pas la vente. Écrire l'inverse sur la landing nourrit un risque de requalification en agent commercial, et « closes » n'est pas du français. Nouvelle formulation : « tu convaincs », puis « l'entreprise reçoit un lien sécurisé et signe elle-même avec Stacker ». Un test interdit désormais ces formulations sur toutes les pages. **Si Lucas tient à « closer » pour le ton, il doit d'abord obtenir l'accord du juriste.**
   - Apostrophes droites dans deux `<title>` (« Liste d'attente », « CGU ») : corrigées.
   - Mentions légales : le **téléphone de l'hébergeur** est obligatoire (LCEN art. 6) et manquait. Il est ajouté sous forme de jeton `{{À VÉRIFIER}}`.

---

## 3. Revue sécurité, ligne à ligne

### Migration `20261005090000_waitlist.sql` : conforme
- RLS activée **et forcée** sur `waitlist`, `consents` et `rate_limits`. `revoke all` sur les tables et séquences pour `public`, `anon`, `authenticated` et `service_role`. Les politiques ne concernent que `postgres`.
- Les 4 fonctions `security definer` ont `set search_path = ''` et des noms qualifiés. `execute` est révoqué puis accordé au seul rôle utile : `waitlist_count` à anon, les autres à `service_role`. La fonction trigger est révoquée.
- `waitlist_count()` ne renvoie qu'un entier. Une **fuite résiduelle** existe : l'écart du compteur avant et après une soumission révèle si une adresse existait déjà (énumération lente, limitée par Turnstile). Voir R3.
- `consents` est append-only par trigger. Le drapeau `stacker.erasure` est une GUC que tout rôle peut poser, mais sans effet : seul le propriétaire a des droits.

### Edge Function `waitlist-join`
- Conforme : Zod partagé avec le front (`strictObject`), normalisation NFKC + trim + minuscules, corps limité à 8 Ko, Content-Type vérifié, CORS en liste blanche stricte avec `Vary: Origin`, réponses d'erreur génériques, logs sans donnée personnelle, appels réseau avec timeout, fail closed sur config invalide.
- Email Brevo : le prénom est limité à `\p{L}` plus espace, apostrophe, point et tiret, le HTML est échappé, l'URL vient de la config. **Pas d'injection possible.** Un seul email par adresse, jamais à la réinscription : pas de bombardement d'un tiers.
- **Réserve B2, rate limit contournable.** `clientIp()` prend la valeur la plus **à gauche** de `X-Forwarded-For`, que le client contrôle. Faire tourner cet en-tête contourne la limite de 10 requêtes / 10 min. Je n'ai pas corrigé à l'aveugle : prendre la valeur la plus à droite pourrait regrouper tout le monde sur l'IP d'un proxy interne et bloquer toutes les inscriptions. Turnstile, désormais obligatoire, couvre le risque principal.

### `vercel.json` : conforme
CSP : `script-src 'self' https://challenges.cloudflare.com`, `style-src 'self'`, aucun `unsafe-*`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'`. Le HTML ne contient aucun script inline ni attribut `style`, et le build échoue s'il en trouve. HSTS sur 2 ans avec `includeSubDomains`. `X-Frame-Options DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, COOP et CORP sont présents.

### Bundle `dist/` : propre
Aucun JWT, aucun `sb_secret`, aucune clé Brevo ni secret Turnstile, ni dans `dist/`, ni dans `.e2e/`, ni dans l'historique git. Seules la clé publique et l'URL factice e2e figurent dans le build e2e.

---

## 4. Revue produit et légale des textes (10 pages lues dans `dist/`)

- Aucune promesse de gain. Aucun « immédiat », « aussitôt » ou « garanti ». Aucun montant payé par le client. Aucun emoji (vérifié par plages Unicode sur le HTML et le JS).
- Paliers 15 / 18 / 22 / 25 %, 6,99 €/mois, offre des 100 premiers et « 20 octobre 2026 » sont présents et cohérents sur toutes les pages.
- La carte d'app du héros est marquée « Exemple illustratif ». Le seul exemple chiffré (calcul de rétractation sur `/remboursement`) est aussi marqué.
- Orthographe : correcte après mes corrections. Restent à arbitrer par Lucas : « 0 % prélevé sur ton chiffre d'affaires » et « TTC » si la TVA est en franchise (voir L2 et L3).

### Ce qui manque légalement (micro-entreprise, abonnement vendu à des consommateurs)
| Point | État |
|---|---|
| Identité EI, adresse, SIRET, RNE, mention TVA, email, téléphone | Jetons à compléter (build de production bloqué tant qu'ils restent) |
| **Médiateur de la consommation** (L612-1, adhésion obligatoire avant la 1re vente, amende jusqu'à 15 000 €) | Jeton : **adhésion à faire** (CM2C, Médicys, etc.) |
| Téléphone de l'hébergeur (LCEN art. 6) | Ajouté, à vérifier |
| Rétractation 14 j, demande expresse d'exécution immédiate, prorata (L221-18, L221-25), formulaire type | Présent |
| Résiliation « en 3 clics » (L215-1-1, décret 2023-417) | Présente dans le texte. **La fonction n'existe pas encore** (lot 6) : ne rien vendre avant |
| Garantie légale de conformité des services numériques (L224-25-12 et suivants) | Article présent, mais l'**encadré d'information imposé par le décret 2022-424** manque (à faire par le juriste). Le titre « Conformité du service » évite le mot « garantie » : le juriste doit rétablir les termes légaux, le §7 ne vise pas les mentions légales |
| Étapes de conclusion du contrat en ligne, correction des erreurs, langue (art. 1127-1 C. civ.) | Partiel (§5 CGV). Ajouter la langue (français) et l'archivage |
| Information sur la reconduction mensuelle (L215-1), au cas où elle s'applique | À trancher par le juriste |
| Durée de l'offre des 100 premiers (DoD : « durée bornée ») | Jeton : **décision de Lucas** |
| Plateforme européenne de RLL | Inutile : supprimée en juillet 2025. Absence correcte |

---

## 5. Revue visuelle

Captures du dev (`qa/shots-lot1/`, 390×844) et les miennes en 1280 et en défilement (`qa/shots-lot1-lead/`).

**Niveau agence premium : atteint à environ 85 %.** La fidélité au design system est bonne : tokens, cartes à 28 px, ransom réservé aux moments forts, accent serif, pilules de niveau aux bonnes couleurs, carte sombre. La grille desktop est propre et la hiérarchie claire. La correction de la maquette (pas de « Solde total », pas de « Virer », pas de montants) est bien respectée.

Défauts visuels (recommandés, non bloquants) :
- V1. Les captures du dev sont en 1x malgré `deviceScaleFactor: 2` : on ne peut pas les juger au pixel. Les refaire en 2x, et ajouter le desktop.
- V2. L'étiquette « sans engagement » collée sous la carte « Tes commissions » laisse croire que la *commission* est sans engagement. La remplacer par « exemple illustratif » ou la supprimer.
- V3. Pages légales en desktop : la bande de fond change de teinte au milieu de l'article (vers y ≈ 800 px) et crée une couture visible. Mettre un fond uniforme sur `.legal`.
- V4. Dans la mention RGPD sous le formulaire, le lien « politique de confidentialité » n'a ni soulignement ni couleur (WCAG 1.4.1).
- V5. En-tête mobile au défilement : la translucidité à 82 % laisse lire le texte en dessous. Le rendu est conforme au design system, mais il fait chargé sur les cartes blanches. Passer à 92 % pour le site public.
- V6. Trop de vide entre le héros et « Comment ça marche » en desktop (environ 150 px de plus que le rythme des autres sections).

---

## 6. Réserves bloquantes pour la mise en ligne publique (non corrigées : relèvent de Lucas ou de la recette)

- **B1.** Compléter les 12 jetons de `src/config/site.ts` (identité, SIRET, RNE, TVA, contacts, région Supabase, téléphone et adresse Vercel). **Adhérer à un médiateur** de la consommation.
- **B2.** En staging, journaliser les **noms** des en-têtes reçus par la fonction et le nombre d'entrées de `X-Forwarded-For`, puis fixer `clientIp()` sur l'en-tête que le client ne peut pas forger (probablement `cf-connecting-ip`, sinon l'entrée ajoutée par la passerelle). Ajouter un test de non-contournement.
- **B3.** Activer Turnstile (clé de site + clé secrète) et ajouter un e2e avec les **clés de test Cloudflare**, sous la vraie CSP.
- **B4.** E2E **WebKit** (DoD §6.4), Lighthouse CI (perf ≥ 90, a11y ≥ 95), k6 liste d'attente (200/s, p95 < 600 ms), ZAP baseline : exigés avant G3.
- **B5.** Durée de l'offre des 100 premiers (décision de Lucas, voir L1).
- **B6.** Relecture du juriste des 5 pages légales (encadré de conformité, art. 1127-1, L215-1).

## 7. Recommandations (non bloquantes)
- R1. Turnstile siteverify : vérifier aussi `hostname` (domaine attendu) et `action` (`waitlist_join`), aujourd'hui ignorés.
- R2. CSP : remplacer `connect-src https://*.supabase.co` par l'URL exacte du projet (injectée au build), pour qu'une injection ne puisse pas exfiltrer vers un autre projet Supabase. Ajouter `report-to`. HSTS : `preload` une fois le domaine stable.
- R3. Compteur public : l'arrondir (par exemple à la dizaine) pour supprimer l'énumération par différence, ou l'accepter consciemment.
- R4. `waitlist_erase()` supprime aussi la preuve de consentement (cascade), alors que la politique annonce « puis 5 ans ». Aligner le texte ou garder une preuve pseudonymisée.
- R5. Purge à 12 mois après l'ouverture (politique §2) : aucun job n'existe. La planifier (`pg_cron`).
- R6. Ajouter `check:audit` à `pnpm run ci`.
- R7. (Vérifié, rien à faire : `00_structure` et `01_intrusion` couvrent déjà les droits EXECUTE d'anon, authenticated et service_role sur les 4 fonctions.)

## 8. Choix produit qui relèvent de Lucas (je n'y ai pas touché)
- L1. Durée de l'offre des 100 premiers, et ce que veut dire « Le tarif évoluera » : quel tarif, pour qui, à partir de quand.
- L2. « 0 % prélevé sur ton **chiffre d'affaires** » (ta consigne) ou « sur tes **commissions** » (mon verdict §7). Pour un stacker, son chiffre d'affaires, ce sont ses commissions. La phrase sous-entend qu'un pourcentage sera prélevé après les 100 premiers : il faut l'écrire noir sur blanc ou retirer la mention.
- L3. « 6,99 € TTC » : en franchise de TVA (art. 293 B), écrire « 6,99 € par mois, TVA non applicable ».
- L4. Le compteur public d'inscrits (R3), et l'affichage de la position à l'écran plutôt que seulement par email.
- L5. Entité qui vend : « Lucas Fernandez EI » partout. Si c'est « Alma Company », tout le légal change.
- L6. Formulation « tu convaincs » (mon remplacement de « tu closes ») : modifiable, mais **jamais** « tu conclus la vente » sans l'accord du juriste.
