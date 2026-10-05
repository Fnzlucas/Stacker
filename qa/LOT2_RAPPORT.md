# Lot 2 : comptes utilisateurs et coquille de l'application connectée

Date : lundi 5 octobre 2026. Dossier : `stacker/app`.
Statut : **terminé côté code. `pnpm run ci` passe en entier (code de sortie 0).** Le lot 1 n'est pas cassé : ses 55 tests e2e passent toujours. Avant la mise en ligne, Lucas doit configurer Supabase Auth (section 4).

---

## 1. Ce qui est fait

### Base de données (`supabase/migrations/20261006090000_accounts.sql`)
- **`profiles`**. Champs déclaratifs : prénom, nom, téléphone (E.164), département, ville, statut juridique déclaré, SIRET (clé de Luhn vérifiée en base) et objectif. Champs serveur : `tier`, `active_clients`, `xp`, `adult_declared_at`, `launch_priority`, `waitlist_id`, `waitlist_joined_at`, `onboarding_completed_at`, `created_at` et `updated_at`.
- **Création du profil par trigger** sur `auth.users`. L'inscription est **refusée en base** sans `adult_declared = true` et sans version des CGU. **Aucune date de naissance** n'est transmise ni stockée : seul l'horodatage de la déclaration est conservé.
- **Consentements des comptes** dans `user_consents` : append-only et versionnés. Les CGU et la confidentialité sont obligatoires ; le marketing est facultatif et enregistré séparément. Le journal n'est effacé qu'avec le compte, par cascade.
- **Lien avec la liste d'attente.** La priorité de lancement est rattachée **à la confirmation de l'adresse uniquement**, jamais à une adresse non prouvée. Le prénom et le département inscrits sur la liste servent de valeurs par défaut.
- **RLS forcée.** Chaque stacker lit uniquement SA ligne. Il ne peut modifier que les 8 colonnes déclaratives (`GRANT UPDATE` colonne par colonne). Un trigger de garde bloque en plus toute écriture client sur les champs serveur, même si un GRANT était élargi par erreur. Aucun `INSERT` ni `DELETE` côté client.
- **Niveaux** dans `commission_tiers`, une configuration serveur.

  | Niveau | Taux | Clients actifs |
  |---|---|---|
  | Rookie | 15 % | 0 à 2 |
  | Pro | 18 % | 3 à 9 |
  | Legend | 22 % | 10 à 24 |
  | Elite | 25 % | 25 et plus |

  Les seuils sont **marqués `criteria_provisional = true`** et l'app affiche « seuils provisoires ». Le niveau est **toujours recalculé côté serveur** à partir des clients actifs : même le serveur ne peut pas le poser à la main. Si Lucas modifie les seuils, tous les niveaux sont recalculés.
- **Fonctions** :
  - `complete_onboarding` : horodatage fait par le serveur.
  - `export_my_data` : JSON limité aux données de l'appelant (compte, profil, consentements, liste d'attente).
  - `account_erase_prepare` : réservée à `service_role`.

### Edge Function `account-delete` (effacement RGPD)
- L'identité vient **uniquement du jeton**, validé auprès de Supabase Auth. Le corps ne contient aucun identifiant : on ne peut supprimer que son propre compte.
- La fonction exige :
  - une **connexion datant de moins de 10 minutes** (revendication `amr`) ; l'app redemande donc le mot de passe ;
  - la confirmation « SUPPRIMER » ;
  - le respect du rate limit par compte (identifiant haché).
- Elle efface ensuite l'inscription à la liste d'attente, puis supprime l'utilisateur via l'API admin. Profil et consentements suivent par cascade.

### Authentification (SPA `/app`)
- **Inscription** :
  - mot de passe d'au moins 12 caractères, avec une minuscule, une majuscule et un chiffre, sans l'adresse email, limité à 72 octets ; checklist en direct ;
  - date de naissance contrôlée **dans le navigateur seulement**, plus une case « Je certifie être majeur(e) » ;
  - CGU obligatoires, marketing facultatif.
- **Confirmation** de l'adresse par lien (`token_hash`, vérifié puis retiré de l'URL et de l'historique) **ou** par code à 6 chiffres saisi dans l'app. Renvoi de l'email avec un délai de 60 s.
- **Connexion** :
  - par mot de passe : le choix « Rester connecté » place la session en localStorage, sinon en sessionStorage ;
  - **par code reçu par email** (`shouldCreateUser: false`).
- **Mot de passe oublié** → lien de récupération → nouveau mot de passe. Le serveur refuse un mot de passe faible, ayant fuité ou identique à l'ancien.
- **Déconnexion locale.** Une session révoquée côté serveur (réponse 401) déconnecte l'app et renvoie vers la connexion.
- **Aucune énumération de comptes.** Une adresse déjà inscrite affiche le même écran « Vérifie ta boîte mail », sans email envoyé. Le mot de passe oublié et le code de connexion renvoient la même réponse neutre. Un compte inconnu et un mauvais mot de passe donnent le même message.
- **Turnstile** sur l'inscription, la connexion, le code, le mot de passe oublié, le renvoi et la réauthentification avant suppression. Le jeton est vérifié par Supabase Auth (captcha natif), selon la même logique « clé de site = widget » que le lot 1.

### Onboarding (4 écrans)
1. Prénom.
2. Département.
3. Objectif.
4. Niveaux (lus en base, seuils provisoires signalés) et règle de disponibilité : signature, puis encaissement plus 14 j (30 j pour un nouveau client), puis versement hebdomadaire. Mention « aucun montant de gain n'est promis ». Jamais « immédiat ».

### Coquille de l'app
- **Routage protégé.** Toutes les routes `/app/*` sont bloquées sans session. L'utilisateur est renvoyé à la page demandée après connexion ; seuls les chemins internes sont acceptés (pas de redirection ouverte).
- **Barre basse à 5 onglets**, conforme aux maquettes.
- **Accueil réel** :
  - date du jour calculée (« LUNDI 5 OCTOBRE », c'est bien un lundi) ;
  - prénom, niveau serveur et progression vers le niveau suivant ;
  - XP et clients actifs réels, à 0 au départ ;
  - priorité de liste d'attente si elle est acquise ;
  - « Pour bien démarrer » calculé sur le profil réel.

  La carte sombre affiche « Commissions acquises — Aucune pour l'instant » : **pas de « Solde total », pas de bouton « Virer », pas de montant inventé**.
- **Prospects, Deals et Gains** : écrans « bientôt disponible » qui décrivent ce qui arrive, sans aucun chiffre factice. Gains affiche les vrais paliers (le niveau courant est mis en évidence), « Prochain virement : aucun prévu » et la règle de versement.
- **Profil** :
  - édition des champs autorisés, avec validation Zod côté navigateur puis contraintes en base ;
  - export JSON ;
  - déconnexion ;
  - suppression du compte (feuille de confirmation avec saisie de SUPPRIMER et du mot de passe).

### Sécurité et livraison
- **CSP inchangée** (stricte). `app.html` ne contient ni script ni style inline, et le build échoue s'il en trouve. La largeur des barres de progression passe par le CSSOM, autorisé par la CSP.
- **En-têtes** : `X-Robots-Tag: noindex` sur `/app`, et `Disallow: /app` dans `robots.txt`.
- **Rewrites** `/app/*` vers `app.html` dans Vercel et dans le serveur e2e.
- Le front n'utilise que la clé publique. La recherche de secrets ne trouve rien (sources et `dist/`).
- Aucune logique sensible côté client : niveau, onboarding, priorité, export et suppression sont faits par le serveur. Le navigateur ne fait qu'afficher et demander.
- `localStorage` ou `sessionStorage` ne contiennent que les jetons de session (`stacker-auth`). Un test e2e vérifie qu'aucune autre clé n'y est écrite.

## 2. Résultats chiffrés

| Contrôle | Résultat |
|---|---|
| Lint (`--max-warnings=0`) et typecheck (`tsc` + `deno check` des 2 fonctions) | 0 erreur, 0 avertissement |
| Vitest | **223 tests / 12 fichiers verts** (lot 1 : 130). Couverture : lignes 100 %, instructions 99,5 %, branches 96,3 %, fonctions 98,6 % |
| pgTAP (Postgres 16 local) | **163 assertions / 7 fichiers vertes**, dont 84 nouvelles : structure (liste blanche exacte des privilèges et colonnes), inscription et trigger, **45 tests d'intrusion** (A lit ou modifie B, s'auto-promeut, gonfle XP ou clients actifs, s'attribue la priorité, écrit un consentement, GRANT accidentel…), effacement |
| Playwright Chromium 390×844 + 1280×800 | **122 tests verts** en CI (30 ignorés : captures à la demande, clavier sur mobile). Lot 2 : 33 scénarios × 2 formats |
| Stabilité | specs lot 2 en `--repeat-each=3` : **201 / 201**, 0 test instable |
| Contrôles e2e sur chaque écran | 0 erreur console, 0 requête en échec inattendue, axe-core sans violation sérieuse ou critique, aucun débordement horizontal |
| Poids (gzip) | app : **JS initial 141,7 Ko** (budget 170, chaque écran chargé à la demande), CSS 12,4 Ko. Site public : JS 106,4 Ko (104,0 au lot 1, découpage de chunks partagé), CSS 10,5 Ko |
| `pnpm audit --prod` | 0 vulnérabilité |
| Secrets | 0 (207 fichiers : sources + `dist/`) |
| Captures | 29 fichiers dans `qa/shots-lot2/` : 23 en 390×844 (densité 2) et 6 en 1280×800, relues une par une. `pnpm qa:shots:app` les régénère |

La relecture des captures a révélé trois défauts, tous corrigés :
- Tailwind purgeait les classes de variantes construites dynamiquement : boutons verts et rouges sans fond, barre de progression Pro non violette.
- Les cartes étaient élargies par du texte insécable.
- Les champs sans icône avaient un retrait.

## 3. Écarts, limites et reste à faire

- **Mot de passe ou OTP.** Le verdict du Lead retient l'OTP email ; la mission demande email + mot de passe. J'ai fait les deux : mot de passe en principal, **code à 6 chiffres** comme alternative et en confirmation. **Pas de lien magique au sens « connexion par lien redirigé »** (refusé par le Lead, car il casse dans les webviews mail). Les emails contiennent un lien `token_hash` vérifié par l'app **et** le code.
- **Supabase Auth simulé en e2e.** Docker n'est pas disponible ici, donc pas d'instance locale. Le faux serveur `e2e/fake-supabase.ts` reproduit les routes, les réponses et les codes d'erreur de GoTrue et PostgREST, ainsi que les règles de la migration. La vraie base est testée par pgTAP. **À faire en staging** : un passage des mêmes parcours contre le vrai projet Supabase (avec Turnstile en clés de test Cloudflare et un vrai email Brevo).
- **DoD encore ouverte** (comme au lot 1) : WebKit (seul Chromium est installé ici), Lighthouse CI, k6, ZAP et Sentry.
- **Ouverture par vagues** (verdict §3.1 n° 3) : l'inscription est ouverte à tous dès que Supabase est configuré. Le contrôle par flag et les vagues arrivent avec l'admin (L9). D'ici là, `enable_signup` peut rester à `false` en production.
- **Seuils de niveau** : provisoires (décision de Lucas, verdict §4 n° 6). Pour les figer : `update public.commission_tiers set …, criteria_provisional = false;`.
- **Téléphone et SIRET** : seulement déclaratifs. Le contrôle du SIRET via l'API Recherche d'entreprises viendra avec le profil de paiement (SHOULD).
- **Session dans le stockage du navigateur.** C'est le choix standard d'un SPA Supabase. Il est mitigé par la CSP stricte, un jeton d'1 h et la rotation des jetons de rafraîchissement. ESLint interdit toujours `localStorage` pour les données métier.
- Le compteur `amr` est contrôlé par `account-delete` ; les autres fonctions à venir (paiements) devront exiger la même chose pour les actions sensibles.

## 4. Configuration Supabase Auth à faire par Lucas (projets staging et prod)

**Authentication > URL Configuration**
- *Site URL* : `https://<domaine>`. Il sert à construire les liens des emails.
- *Redirect URLs* : `https://<domaine>/app/auth/confirmer`, plus l'URL de preview de staging (`https://<preview>.vercel.app/app/auth/confirmer`). Aucune autre.

**Authentication > Providers > Email**
- Email : activé. *Confirm email* : **activé**. *Secure email change* et *Secure password change* : activés.
- *Minimum password length* : **12**. *Password requirements* : **lowercase, uppercase letters and digits**.
- **Prevent use of leaked passwords (HaveIBeenPwned)** : **à activer** (plan Pro). L'app traduit déjà le refus.
- *Email OTP length* : 6 ; *Email OTP expiration* : 3600 s.

**Authentication > Attack Protection**
- *Enable Captcha protection* : **Cloudflare Turnstile**, avec la clé **secrète** Turnstile (la même que `TURNSTILE_SECRET_KEY` du lot 1). La clé de **site** reste `VITE_TURNSTILE_SITE_KEY` dans Vercel.

**Authentication > Rate Limits** (valeurs de départ) : emails 30/h, connexions et inscriptions 30 / 5 min par IP, vérifications 30 / 5 min.

**Authentication > Sessions** (Pro) : *Time-box* de 30 jours et *Inactivity timeout* de 7 jours conseillés. Jeton d'accès : 3 600 s, rotation des jetons de rafraîchissement activée.

**Authentication > Emails > SMTP Settings (Brevo)**, obligatoire : le SMTP par défaut de Supabase est limité à quelques emails par heure.
- Host `smtp-relay.brevo.com`, port `587`, utilisateur = identifiant SMTP Brevo, mot de passe = **clé SMTP** Brevo (pas la clé API).
- Expéditeur : `no-reply@<domaine>` (domaine authentifié SPF/DKIM/DMARC), nom « Stacker ».

**Authentication > Emails > Templates** : copier le contenu de `supabase/templates/`.

| Modèle | Fichier | Sujet |
|---|---|---|
| Confirm signup | `confirmation.html` | « Confirme ton adresse email — Stacker » |
| Reset password | `recovery.html` | « Choisis un nouveau mot de passe — Stacker » |
| Magic link | `magic_link.html` | « Ton code de connexion — Stacker » (contient le code) |
| Change email | `email_change.html` | « Confirme ta nouvelle adresse email — Stacker » |

Les liens pointent vers `{{ .SiteURL }}/app/auth/confirmer?token_hash={{ .TokenHash }}&type=…`. Ne pas les remplacer par `{{ .ConfirmationURL }}`.

**Base, fonctions et secrets** (depuis `app/`)
```bash
pnpm dlx supabase db push                                   # migration lot 2
pnpm dlx supabase secrets set --env-file supabase/functions/.env   # ALLOWED_ORIGINS, RATE_LIMIT_PEPPER (déjà posés au lot 1)
pnpm dlx supabase functions deploy account-delete          # verify_jwt = true (ne PAS ajouter --no-verify-jwt)
```
`SUPABASE_ANON_KEY` est injectée automatiquement par Supabase. Vérifier ensuite que le *Security Advisor* est à 0 erreur.

**Vercel** : aucune nouvelle variable. `vercel.json` contient déjà la réécriture `/app/*`.
