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
- [ ] Contrat de prestation des offres sur mesure (`deal_settings.contract_template_unique`) : délais, corrections incluses, propriété du site, hébergement 12 mois.

### 3. Offres gros ticket (Stacker Studio) : à vérifier avant la première vente

Neuf offres sur mesure payées en une fois sont actives en tête du catalogue : site vitrine 1 490 €, image de marque (logo, photos, vidéos) 1 990 €, assistant IA appels et messages 2 490 €, campagne publicitaire Google + réseaux 2 990 €, site e-commerce 3 490 €, site + réservation 4 990 €, application mobile 5 990 €, pack transformation digitale 9 900 €, pack complet site + application + image de marque 12 400 €. La commission du stacker est son taux (15 à 25 %) sur le prix total, débloquée le jour du prélèvement.

- [ ] **Capacité de livraison** : tu (ou ton prestataire) peux livrer chaque offre dans le délai écrit (3 à 8 semaines). L'assistant IA et l'hébergement ont un coût mensuel pour toi pendant les 12 mois inclus : intègre-le dans le prix. Sinon, désactive-la depuis l'admin (catalogue) avant l'ouverture.
- [ ] **Prix et contenu** : modifiables dans la table `offers` (`price_cents`, `features`). Les contrats déjà signés gardent leur version.
- [ ] **Plafond de prélèvement SEPA chez Mollie** : un prélèvement de plusieurs milliers d'euros peut dépasser la limite par défaut d'un compte récent. Vérifie-la dans le tableau de bord Mollie (ou demande au support de la relever) avant la première vente à 3 490 € ou plus.
- [ ] **TVA** : avec des tickets à 1 490 € et plus, ton chiffre d'affaires peut vite dépasser le seuil de la franchise en base. Les contrats affichent « TVA non applicable, art. 293 B du CGI » : fais valider le moment où il faudra passer à la TVA avec ton comptable.

---

## B. Configuration (J-7 à J-2)

### 3. Supabase (projet de production)

- [ ] Extensions **pg_cron** et **pg_net** activées.
- [ ] Base à jour : `supabase db push`. Toutes les migrations jusqu'à `20261101120000_gratuit_gros_ticket.sql`.
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
| `ANTHROPIC_API_KEY` | l'IA de l'entraînement à l'appel (console.anthropic.com → API Keys) |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID` | notifications de l'app iPhone (voir `APP_STORE.md`) ; sans elles, rien n'est envoyé et rien ne casse |
| `ROLEPLAY_MODEL` | facultatif : modèle utilisé (par défaut `claude-haiku-5-5`, rapide et économique) |

- [ ] Déployer toutes les fonctions :

```bash
supabase functions deploy waitlist-join account-delete prospects-search opposition-register leads-enrich mail-connect mail-callback campaign-run billing-checkout mollie-webhook mollie-run email-run roleplay push-run
```

- [ ] Tâches planifiées. 5 sont à créer à la main (SQL dans les docs) : `campaign-run`, `leads-enrich`, `mollie-run`, `email-run`, et `push-run` (notifications iPhone, voir `APP_STORE.md`). Les autres sont créées par les migrations.
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
- [ ] Entraînement : appeler un commerçant (au micro, sur ton téléphone), raccrocher, vérifier le bilan. Le coût de chaque appel est visible dans la console Anthropic.

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
3. [ ] Admin → Réglages : activer **Abonnement obligatoire** et **Entraînement obligatoire** (une simulation d'appel réussie avant la première signature).
4. [ ] Admin → Offres : ne laisser actives que les offres ouvertes au lancement.
5. [ ] Contrôle rapide en production : inscription, page Abonnement, recherche de prospects. Tu peux payer ton propre abonnement pour vérifier toute la chaîne.
6. [ ] Prévenir la liste d'attente.
7. [ ] Référencement : Google Search Console et Bing Webmaster Tools, avec envoi du sitemap (voir `SEO_GEO.md`).

## D. Les jours suivants

- Chaque matin, Admin → Vue d'ensemble :
  - **virements à faire** (au moins une fois par semaine) ;
  - **incidents** : deals bloqués chez Mollie, emails non envoyés.
- Contestation de prélèvement d'abonnement par un stacker : à traiter à la main dans Mollie.
- Rétractation d'un stacker dans les 14 jours : rembourser au prorata depuis Mollie (Paiements → Rembourser), puis résilier son abonnement.
