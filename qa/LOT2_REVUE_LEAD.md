# Lot 2 : revue du Lead technique

Date : mercredi 7 octobre 2026 (J-13). Relecteur : Lead (je n'ai pas écrit ce code).
Référentiel : `audit/00_verdict_lead.md` (§1 architecture, §6 DoD, §7 promesses), `qa/LOT1_REVUE_LEAD.md`.
Périmètre : comptes, auth, profils, onboarding, coquille de l'app (partie A) ; écran de démarrage et PWA (partie B, développés par moi).

## Verdict : VALIDÉ AVEC RÉSERVES

Le lot est sérieux : RLS forcée, GRANT par colonne, garde par trigger, SECURITY DEFINER durcies, liste blanche exacte des privilèges testée, énumération de comptes neutralisée, suppression par jeton avec réauthentification serveur. J'ai cependant trouvé **deux trous RGPD réels** que les 45 tests d'intrusion du dev ne couvraient pas, et **un test e2e instable** alors que le rapport annonçait « 0 instable ». Les trois sont corrigés et couverts. Les réserves R1 à R6 restent à lever avant l'ouverture publique ; elles relèvent de la configuration Supabase (Lucas) ou de la recette en staging, pas du code.

---

## 1. CI relancée par moi

`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm run ci`

| Étape | Code du dev (a340294) | Après mes corrections et la partie B (e5cea17) |
|---|---|---|
| Lint (`--max-warnings=0`), typecheck (tsc + deno check ×2) | 0 erreur | 0 erreur |
| Vitest | 223/223, lignes 100 %, branches 96,34 % | **231/231**, lignes 100 %, branches 96,53 % (`boot.ts` à 100 %) |
| pgTAP | 163 assertions vertes | **177** assertions vertes (fichier `07_accounts_review_test.sql`) |
| Build + budget | app : JS 141,7 Ko gzip, CSS 12,4 Ko | app : **JS 142,2 Ko** (budget 170), **CSS 13,0 Ko** ; site public inchangé (106,4 / 10,5 Ko) |
| Secrets (sources + dist) | 0 | 0 |
| Playwright Chromium 390 + 1280 | 1er passage : interrompu (serveur e2e tombé, `ERR_CONNECTION_REFUSED`, non reproduit). 2e passage : **121 verts, 1 échec** | voir §1.1 |

Le chiffre du dev (« 122 verts ») est exact sur un passage chanceux, mais « 0 test instable » est faux. J'en ai trouvé **deux** :
- « connexion par code reçu par email » lisait la boîte d'envoi simulée **avant** la réponse du serveur (course). Corrigé : attente du message neutre.
- « clavier : les onglets… » posait le focus sur l'onglet Gains pendant que l'accueil, chargé à la demande, plaçait ensuite le focus sur son titre (1 échec sur 3 passages). Corrigé : attente du focus sur le titre. Stress : 10/10.

### 1.1 Résultat final

| Contrôle (e5cea17 + test clavier) | Résultat |
|---|---|
| `pnpm run ci` complet | **code de sortie 0** |
| Playwright | **134 verts**, 32 ignorés (captures et vidéo à la demande, clavier en mobile), 0 échec |
| Stabilité | specs lot 2 `--repeat-each=3` : 200/201 avant le correctif du test clavier, puis 10/10 sur ce test ; splash `--repeat-each=5` : 60/60 |

Écarts DoD toujours ouverts (déjà signalés aux lots 1 et 2) : **WebKit** absent de la machine, Lighthouse CI, k6, ZAP, Sentry, `check:audit` hors de `pnpm run ci`.

---

## 2. Sécurité, ligne à ligne

### 2.1 Migration `20261006090000_accounts.sql` : conforme, sauf deux trous (corrigés)

Ce qui tient (vérifié et tenté) :
- RLS **activée et forcée** sur `commission_tiers`, `profiles`, `user_consents` ; `revoke all` pour `public`, `anon`, `authenticated`, `service_role` ; politiques par commande (`select` et `update` propres, aucune `insert`/`delete` client).
- Colonnes modifiables : `GRANT UPDATE` sur les 8 champs déclaratifs seulement. J'ai tenté de modifier `tier`, `xp`, `active_clients`, `launch_priority`, `adult_declared_at`, `onboarding_completed_at`, `id` : refus 42501 par le GRANT, et le trigger `profiles_guard` (fonction **non** SECURITY DEFINER, donc `current_user` = rôle appelant) bloque même si un GRANT était élargi. Même le serveur ne pose pas `tier` à la main : il est dérivé de `active_clients`.
- Lecture d'un autre profil : 0 ligne (par id, par téléphone). `export_my_data()` ne lit que `auth.uid()`. Aucune vue, aucune fonction ne fuit une autre ligne.
- Toutes les SECURITY DEFINER ont `search_path = ''` et des noms qualifiés ; EXECUTE révoqué partout puis accordé au seul rôle utile. Les listes blanches exactes (tables, colonnes, fonctions par rôle) sont testées par `00_structure_test.sql`, qui échoue si une table publique arrive sans RLS forcée.

**Trou 1 — consentements et majorité figés par un tiers (corrigé).** Le profil et les consentements étaient créés à l'INSERT dans `auth.users`, **avant** toute preuve de possession de l'adresse. Or Supabase Auth, quand on se réinscrit avec une adresse encore non confirmée, remplace les métadonnées (et le mot de passe) de la ligne existante sans recréer le profil. Scénario : X inscrit `victime@…` en cochant le marketing, avec le prénom « Pirate » ; la victime s'inscrit ensuite elle-même en refusant le marketing, puis confirme. Résultat avant correctif : le journal de consentements de la victime prouvait un **consentement marketing qu'elle n'a jamais donné**, et la majorité horodatée était celle déclarée par X. C'est une preuve RGPD fausse. Correctif : à la confirmation, `handle_user_email_confirmed()` rejoue les métadonnées **courantes** (celles du titulaire) : nouvelles lignes de consentement (`source = 'email_confirmed'`, la plus récente par finalité fait foi), majorité ré-horodatée, prénom repris si l'onboarding n'est pas fait, et confirmation refusée si les métadonnées ne déclarent plus la majorité.

**Trou 2 — effacement RGPD incomplet après changement d'adresse (corrigé).** `account_erase_prepare()` n'effaçait l'inscription à la liste d'attente que par l'adresse **actuelle**. Un stacker rattaché avec `a@…` puis passé à `b@…` gardait après suppression de son compte la ligne `waitlist` de `a@…` (prénom, département, code de parrainage, consentements). Correctif : on efface aussi la ligne rattachée (`profiles.waitlist_id`).

Les deux correctifs sont dans une **nouvelle migration** `20261007090000_accounts_review_fixes.sql` (rien n'est encore poussé en base, mais on ne réécrit pas une migration relue). Tests d'intrusion : `07_accounts_review_test.sql`, **14 assertions, dont 6 en échec avant le correctif** (vérifié en retirant la migration).

### 2.2 Edge Function `account-delete` : conforme
- Identité tirée **uniquement** du jeton, validé par `GET /auth/v1/user` (signature, expiration, session révoquée) ; `verify_jwt = true` en plus dans `config.toml`. Le corps ne contient aucun identifiant.
- Réauthentification vérifiée **côté serveur** : `amr` du JWT (lu seulement après validation par Auth) de moins de 10 min. Les jetons rafraîchis gardent l'horodatage d'origine, donc un jeton volé ne suffit pas sans le mot de passe.
- Rate limit 5/h par compte (identifiant haché avec un poivre), CORS en liste blanche, corps ≤ 1 Ko, Content-Type vérifié, journaux sans PII, 503 sur config invalide.
- Effacement : liste d'attente (et ses consentements en cascade), puis suppression **définitive** de l'utilisateur par l'API admin (profil et consentements en cascade). Idempotent (404 accepté). Après correctif 2, l'effacement des données Stacker est complet. **Reste hors de notre base** : `auth.audit_log_entries` de Supabase conserve des emails ; à mentionner dans la politique de confidentialité (durée de rétention Supabase), voir R4.

### 2.3 Export : conforme
JSON limité à l'appelant (compte, profil, consentements, liste d'attente), validé par Zod côté client, téléchargé en Blob local. Pas de rate limit, acceptable (lecture de sa propre ligne).

### 2.4 Session côté client : conforme
auth-js + postgrest-js seuls (pas de supabase-js complet), clé publique uniquement. Session en localStorage (« Rester connecté ») ou sessionStorage, seule clé écrite (`stacker-auth`, testé). `detectSessionInUrl: false`, le `token_hash` est vérifié une fois puis retiré de l'URL et de l'historique. 401 → déconnexion locale. Redirection après connexion limitée aux chemins internes `/app/...` (pas de redirection ouverte). CSP stricte inchangée.

### 2.5 Énumération de comptes : conforme
Inscription d'une adresse existante, mot de passe oublié, code de connexion, renvoi : même réponse neutre (testé e2e, aucun email envoyé). Connexion : même message pour compte inconnu et mauvais mot de passe. Résiduel accepté : `email_not_confirmed` n'apparaît qu'avec le bon mot de passe.

### 2.6 Turnstile : conforme côté code, à activer côté serveur
Widget sur inscription, connexion, code, oubli, renvoi et réauthentification ; jeton vérifié par le **captcha natif de Supabase Auth**. Le build de production refuse déjà l'absence de clé de site. Mais si Lucas oublie d'activer le captcha dans Supabase, le jeton n'est vérifié par personne : voir R1.

---

## 3. Produit et UX

Parcours relu sur les captures (`qa/shots-lot2/`) et en e2e : inscription → vérification (lien ou code) → onboarding 4 étapes → accueil.

- **Textes** : aucune promesse de gain, aucun « immédiat », « garanti », « solde », « virer » ni montant dans `src/app` (vérifié par recherche). Seuils affichés « provisoires » (accueil, onboarding, gains). « Aucun montant de gain n'est promis » sur l'onboarding et Gains. Date du jour calculée (« LUNDI 5 OCTOBRE » sur la capture : juste). Aucune fausse donnée (XP et clients actifs à 0, carte sombre « Aucune pour l'instant »).
- **Correction faite** : l'accueil disait « Commissions acquises… elles apparaîtront ici dès qu'un client signera ». Une commission n'est pas **acquise** à la signature : elle est estimée, puis disponible après encaissement et délai (verdict C3, §3.1 n° 8). Nouveau texte : « Quand un client que tu as apporté signe, ta commission apparaît d'abord comme estimée. Elle est acquise après l'encaissement et le délai prévu, puis virée avec le lot de la semaine. » Les captures n'ont pas été régénérées pour ce seul paragraphe (`pnpm qa:shots:app`).
- **Fidélité aux maquettes** (`design/shots/screen-home.png` vs `accueil.png`) : bonne. En-tête, carte sombre à filigrane, pilule de niveau, titre avec accent serif, barre de progression, cartes de stats, barre basse à 5 onglets. Les écarts sont **voulus** et conformes au verdict §7 : pas de « Solde total », pas de « Virer », progression en clients actifs et non en XP, pas de série « 7 jours » ni de « RDV ».
- **Accessibilité** : axe-core sans violation sérieuse sur chaque écran, focus sur le H1 à chaque navigation, dialogue natif pour la suppression, `role="status"` sur les chargements, navigation clavier des onglets testée en desktop.
- Recommandations visuelles (non bloquantes) : le champ date affiche deux icônes calendrier (celle du design system et celle du navigateur) ; la date de naissance **et** la case « je certifie être majeur(e) » font doublon (voir L2).

---

## 4. Partie B : écran de démarrage et PWA (fait par moi)

- **`#boot` dans `app.html`**, hors de `#root`, peint par le HTML et la CSS **avant tout JavaScript** (aucun écran blanc). Fond `#ececf0` avec le grain papier du design system (`body.grain`), tuile noire au centre ; les 3 barres arrivent **de bas en haut** (orange, violet, vert, à 140 / 260 / 380 ms) avec un léger rebond (compression puis rebond), puis le wordmark « Stacker » en Inter Display ExtraBold (600 ms). Entrée complète : 920 ms. Animations en **transform et opacity uniquement**, aucun script ni style inline (CSP intacte, le build le vérifie).
- **Barre de progression** fine et unie, seulement si le chargement dépasse 1,2 s. Après 10 s, un message honnête « Le chargement prend plus de temps que prévu. Recharger ». Sans JavaScript, le message `noscript` s'affiche dans l'écran.
- **Sortie** (`src/app/boot.ts`) : quand plus aucun écran d'attente n'est monté (restauration de session, chargement de l'écran, du profil) **et** que l'animation d'entrée est finie, lue via l'API Web Animations, avec repli sur le premier rendu. Aucun délai artificiel au-delà : si l'app est prête plus tard, la sortie part aussitôt. La tuile monte et se réduit, l'écran s'efface (420 ms), puis l'élément est retiré du DOM.
- **`prefers-reduced-motion`** : écran statique, pas de barre animée, sortie immédiate.
- **Pages publiques** : aucun impact (ni `#boot`, ni manifeste, ni CSS du splash ; testé).
- **PWA** : `manifest.webmanifest` (`start_url` et `scope` `/app`, `standalone`, couleurs du fond), icônes 192 et 512 (« any »), 512 « maskable » plein cadre avec barres dans la zone sûre, `apple-touch-icon` 180 opaque plein cadre (iOS arrondit lui-même). Toutes générées depuis le logo par `pnpm icons` (`scripts/gen-icons.mjs`, Chromium local), puis allégées : 52 Ko en tout, non chargés par la page. Métadonnées `theme-color`, `apple-mobile-web-app-*`, `mobile-web-app-capable`. `manifest-src 'self'` est déjà dans la CSP. Pas de service worker (pas de mode hors ligne, voulu : `worker-src 'none'`).
- **Poids** : +0,5 Ko de JS et +0,6 Ko de CSS gzip sur l'app.
- **Tests** : 6 scénarios e2e × 2 formats (`e2e/splash.spec.ts`) : apparition puis disparition, jamais avant la fin de l'entrée et sans faux délai, HTML statique avant le JS avec barre après 1,2 s, restauration de session, mouvement réduit, pages publiques intactes, manifeste et dimensions réelles des PNG. 0 erreur console (fixture). Stabilité : `--repeat-each=5` → **60/60**. Vitest : 8 tests, 100 % de `boot.ts`. `expectAccessible` attend désormais la fin du splash pour qu'axe analyse l'écran réel.
- **Vidéo** : `qa/demo/splash.mp4` (H.264, 390×844, 11 s) : un lancement rapide, puis un lancement lent où la barre de progression apparaît. Régénérable avec `pnpm qa:demo:splash`.

---

## 5. Réserves (bloquantes pour l'ouverture publique, non corrigeables dans le code)

- **R1. Configuration Supabase Auth en prod et en staging** (rapport du dev, §4) : *Confirm email* activé (sinon la liste d'attente se rattache à une adresse non prouvée), **captcha Turnstile activé** avec la clé secrète, HIBP, SMTP Brevo, longueur 12, rate limits, sessions. À vérifier par une capture du tableau de bord jointe à la PR.
- **R2. Recette des parcours contre le vrai Supabase en staging** : les e2e tournent contre un faux GoTrue/PostgREST. Le comportement « réinscription d'une adresse non confirmée » (base du trou 1) et le format exact de `amr` doivent être vérifiés sur la vraie instance.
- **R3. DoD §6 encore ouverte** : WebKit (crucial pour la PWA iPhone), Lighthouse CI, k6, ZAP, Sentry.
- **R4. Politique de confidentialité** : mentionner les journaux d'audit de Supabase Auth (emails conservés hors de notre base après suppression) et leur durée.
- **R5. Ouverture par vagues** : `enable_signup = false` en production tant que l'admin (L9) n'existe pas.
- **R6. Installation iPhone** : à tester sur un vrai appareil (icône, nom, barre d'état, lancement en plein écran) une fois le domaine en HTTPS.

Recommandations non bloquantes : renvoyer le même message pour `user_banned` que pour des identifiants faux (à vérifier quand l'admin pourra bannir) ; supprimer l'icône calendrier en double du champ date ; ajouter `check:audit` à `pnpm run ci` (déjà recommandé au lot 1).

## 6. Décisions pour Lucas

- **L1. Seuils de niveau** (0-2 / 3-9 / 10-24 / 25+ clients actifs) : toujours provisoires et affichés comme tels. À figer avant le contrat d'apporteur (verdict §4 n° 6).
- **L2. Contrôle de majorité** : aujourd'hui date de naissance (contrôlée dans le navigateur, jamais envoyée) **plus** case « je certifie ». Garder les deux (plus dissuasif) ou seulement la case (plus simple, même valeur juridique : une déclaration). Mon avis : garder la case seule et retirer la date.
- **L3. Connexion** : mot de passe en principal, code par email en alternative (le verdict retenait l'OTP seul). Je valide le choix du dev ; à confirmer.
- **L4. PWA** : le nom affiché sous l'icône est « Stacker ». Le changer si tu préfères un autre libellé.

## 7. Commits de la revue (auteur « Stacker Lead »)

- `e5f9403` fix(securite) : effacement RGPD complet après changement d'adresse ; consentements rejoués à la confirmation de l'email.
- `841a5a0` fix(contenu) : commission estimée à la signature, acquise après encaissement et délai ; test e2e instable stabilisé.
- `e5cea17` feat(app) : écran de démarrage animé et installation PWA.
- dernier commit : test e2e clavier stabilisé et cette revue.

CI finale : `pnpm run ci` vert (code 0) ; lint 0, typecheck 0, Vitest 231/231 (lignes 100 %), pgTAP 177/177, budget respecté, 0 secret, Playwright 134/134 exécutés.
