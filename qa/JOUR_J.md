# Ouverture de Stacker — checklist (20 octobre 2026)

Tout le code est prêt sur la branche `refonte`. Ce qui reste, c'est de la configuration et deux informations légales que toi seul peux fournir. Fais les étapes dans l'ordre.

Le détail de chaque service est dans `MISE_EN_ROUTE_CAMPAGNES.md` (Google, Outlook, moteur) et `MISE_EN_ROUTE_PAIEMENTS.md` (Mollie, Brevo, admin).

---

## A. À faire dès maintenant (bloquant)

### 1. Deux informations légales

Tant qu'il en manque, Vercel refuse le déploiement de production : le site affiche encore deux champs « À COMPLÉTER ».

- [x] **Ton numéro de téléphone professionnel** : renseigné (07 50 98 33 67).
- [ ] **Un médiateur de la consommation.** C'est obligatoire dès qu'on vend à des particuliers, et les stackers peuvent en être. Choisis-en un sur la liste officielle (economie.gouv.fr, « liste des médiateurs notifiés ») et souscris l'adhésion. Mets son nom, son adresse et son site dans `src/config/site.ts`, bloc `MEDIATOR`.

- [ ] **La région de ton projet Supabase** (Paris eu-west-3 ou Francfort eu-central-1), affichée dans la politique de confidentialité.

Envoie-moi le médiateur choisi et la région, et je les intègre.

### 2. Relecture juridique (recommandée avant les premiers vrais clients)

- [ ] Contrat client et mandat SEPA : le modèle est dans la base, table `deal_settings`.
- [ ] CGV et CGU (pages `/cgv` et `/cgu`). Les CGV ont été mises à jour le 12 octobre avec les vraies règles : paiement par les gains, 3 jours de grâce, Mollie.

---

## B. Configuration (J-7 à J-2)

### 3. Supabase (projet de production)

- [ ] Extensions **pg_cron** et **pg_net** activées.
- [ ] Base à jour : `supabase db push`. Toutes les migrations jusqu'à `20261016090000_launch.sql`.
- [ ] Secrets des Edge Functions (Project Settings → Edge Functions → Secrets) :

| Secret | Pour quoi |
|---|---|
| `SITE_URL`, `ALLOWED_ORIGINS` | URL publique du site (la même, en https) |
| `SUPABASE_ANON_KEY` | clé publique (fonctions appelées par l'app) |
| `RATE_LIMIT_PEPPER` | anti-abus (déjà créé au lot 1) |
| `TURNSTILE_SECRET_KEY` | anti-robot de la liste d'attente |
| `CRON_SECRET` | protège les tâches planifiées |
| `MAIL_TOKEN_KEY`, `MAIL_STATE_KEY` | connexion des boîtes mail des stackers |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Gmail |
| `MS_OAUTH_CLIENT_ID`, `MS_OAUTH_CLIENT_SECRET` | Outlook (facultatif) |
| `GOOGLE_PLACES_SERVER_KEY` | moteur de recherche d'emails (**une nouvelle clé**, jamais l'ancienne clé Huntlist) |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `CONTACT_EMAIL` | emails automatiques |
| `MOLLIE_API_KEY` | `test_…` pour les essais, `live_…` le jour J |

- [ ] Déployer toutes les fonctions :

```bash
supabase functions deploy waitlist-join account-delete prospects-search opposition-register leads-enrich mail-connect mail-callback campaign-run billing-checkout mollie-webhook mollie-run email-run
```

- [ ] Tâches planifiées. 4 sont à créer à la main (SQL dans les deux docs) : `campaign-run`, `leads-enrich`, `mollie-run`, `email-run`. Les autres sont créées par les migrations.
- [ ] Te donner le rôle admin (une ligne SQL, voir `MISE_EN_ROUTE_PAIEMENTS.md` §7).
- [ ] Si le domaine final n'est pas `stacker-topaz.vercel.app`, mets-le à jour en SQL : `update public.prospect_settings set site_url = 'https://…';`. C'est utilisé dans les liens d'opposition des emails.

### 4. Vercel

- [ ] Variables : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`, `SITE_URL` (https).
- [ ] Domaine branché, HTTPS actif.

### 5. Brevo

- [ ] Domaine d'envoi validé (SPF et DKIM), sinon les contrats risquent d'arriver en spam.

### 6. Essai complet en mode test (clé Mollie `test_…`)

- [ ] Créer un compte stacker, finir l'inscription. L'email de bienvenue doit arriver.
- [ ] Abonnement : cocher les deux cases, payer (« Paid » sur la page Mollie de test). L'email de confirmation doit arriver.
- [ ] Réserver un prospect, préparer un email, faire signer un client de test avec ton propre email. Le contrat PDF doit arriver chez le client et chez toi.
- [ ] Lancer `mollie-run` à la main. Le client, le mandat et l'abonnement apparaissent chez Mollie (test).
- [ ] Admin : vue d'ensemble, faire un virement de test (« Marquer versé »). L'email au stacker doit arriver.
- [ ] Résilier l'abonnement de test. L'email de résiliation doit arriver.

---

## C. Le jour J

1. [ ] **Garder une copie de l'ancienne app**, puis mettre la nouvelle sur `main` :

```bash
git fetch origin
git tag ancienne-app origin/main
git push origin ancienne-app
git push origin origin/refonte:main --force-with-lease=main:origin/main
```

   Vercel redéploie la production tout seul. Si le build échoue, c'est qu'il reste un champ « À COMPLÉTER » (étape 1).

2. [ ] Secret `MOLLIE_API_KEY` : remplacer la clé `test_…` par la clé `live_…`, puis redéployer `billing-checkout mollie-webhook mollie-run`.
3. [ ] Admin → Réglages : activer **Abonnement obligatoire**.
4. [ ] Admin → Offres : ne laisser actives que les offres ouvertes au lancement.
5. [ ] Contrôle rapide en production : inscription, page Abonnement, recherche de prospects. Tu peux payer ton propre abonnement pour vérifier toute la chaîne.
6. [ ] Prévenir la liste d'attente.

## D. Les jours suivants

- Chaque matin, Admin → Vue d'ensemble :
  - **virements à faire** (au moins une fois par semaine) ;
  - **incidents** : deals bloqués chez Mollie, emails non envoyés.
- Contestation de prélèvement d'abonnement par un stacker : à traiter à la main dans Mollie.
- Rétractation d'un stacker dans les 14 jours : rembourser au prorata depuis Mollie (Paiements → Rembourser), puis résilier son abonnement.
