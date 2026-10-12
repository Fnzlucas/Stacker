# Mise en route des paiements Mollie (à faire une fois, par Lucas)

Deux flux passent par Mollie :

1. **L'abonnement des stackers** (6,99 €/mois) : le premier mois se paie par carte sur la page Mollie, ce qui crée un mandat. Ensuite, chaque mois, l'abonnement est payé avec les gains disponibles du stacker s'ils suffisent, sinon il est prélevé sur ce mandat.
2. **Le prélèvement SEPA des clients signés** : pour chaque contrat signé, le serveur crée chez Mollie le client, le mandat SEPA (IBAN, RUM et date de signature du contrat) et un abonnement mensuel. Le premier prélèvement a lieu le lendemain de la fin des 14 jours de rétractation.

Chaque paiement confirmé crée la commission du stacker. Un prélèvement refusé suspend le deal. Un remboursement demandé par le client à sa banque (possible pendant 8 semaines) reprend la commission.

## 1. Clé API Mollie

Mollie → Développeurs → Clés API.

**Ne colle jamais la clé dans une conversation, un email ou le code.** Elle va uniquement dans les secrets Supabase :

Supabase → Project Settings → Edge Functions → Secrets → `MOLLIE_API_KEY`

- Commence avec la clé **`test_…`** : les paiements sont simulés et rien n'est débité.
- Passe à la clé **`live_…`** le jour du lancement.

Les autres secrets (`SUPABASE_ANON_KEY`, `SITE_URL`, `ALLOWED_ORIGINS`, `CRON_SECRET`) existent déjà depuis les lots précédents.

## 2. Vérifications côté Mollie

- **Prélèvement SEPA** et **Carte bancaire** activés (Paramètres → Moyens de paiement).
- La création de mandats par l'API doit être autorisée. Si le premier passage de `mollie-run` renvoie une erreur 403 sur `/mandates`, demande au support Mollie : « activer la création de mandats SEPA via l'API (Mandates API) ».
- Rien à configurer pour le webhook : chaque paiement indique lui-même l'adresse `https://<PROJET>.supabase.co/functions/v1/mollie-webhook`.

## 3. Déploiement

```bash
supabase db push
supabase functions deploy billing-checkout mollie-webhook mollie-run prospects-search email-run
```

## 4. Tâche planifiée (SQL Editor)

```sql
-- Prélèvements clients, résiliations et renouvellements : toutes les heures
select cron.schedule('mollie-run', '7 * * * *', $$
  select net.http_post('https://<PROJET>.supabase.co/functions/v1/mollie-run',
    headers := '{"x-cron-secret": "<CRON_SECRET>"}'::jsonb, timeout_milliseconds := 120000)
$$);
```

## 4 bis. Emails automatiques (Brevo)

Secrets Supabase (déjà utilisés par la liste d'attente) : `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` (adresse d'un domaine validé dans Brevo), `BREVO_SENDER_NAME` (facultatif, « Stacker » par défaut) et `CONTACT_EMAIL` (adresse de réponse, sinon stacker-contact@outlook.com, celle du contrat).

```sql
-- Emails : toutes les 5 minutes
select cron.schedule('email-run', '*/5 * * * *', $$
  select net.http_post('https://<PROJET>.supabase.co/functions/v1/email-run',
    headers := '{"x-cron-secret": "<CRON_SECRET>"}'::jsonb, timeout_milliseconds := 120000)
$$);
```

Ce qui part tout seul :

- le contrat signé en PDF, au client et au stacker ;
- l'avis de prélèvement, 3 à 6 jours avant chaque prélèvement SEPA (obligation : au moins 2 jours) ;
- la bienvenue à la fin de l'inscription ;
- au stacker : son paiement d'abonnement refusé (avec la date de coupure), puis son abonnement coupé, et le prélèvement refusé d'un de ses clients.

Un envoi refusé par Brevo est retenté 5 fois (15 min, 1 h, 4 h…). Les emails envoyés sont effacés après 90 jours.

## 5. Essai complet en mode test (avec la clé `test_…`)

1. Dans l'app : Profil → Abonnement → « Payer 6,99 € et activer ». Sur la page Mollie de test, choisis « Paid ». Au retour, l'abonnement s'affiche comme actif.
2. Fais signer un client de test, avec l'IBAN de test `NL55INGB0000000000` ou ton propre IBAN (en mode test, rien n'est débité).
3. Lance `mollie-run` à la main (SQL ci-dessus, sans `cron.schedule`). Le client, le mandat et l'abonnement apparaissent dans le tableau de bord Mollie de test.

## 6. Rendre l'abonnement obligatoire (le jour du lancement)

Tant que l'interrupteur est coupé, tout le monde a accès à tout. La page Abonnement fonctionne déjà, et les premiers inscrits peuvent prendre leur place de lancement.

```sql
update public.app_flags set enabled = true where key = 'billing_required';
```

Une fois l'interrupteur activé, il faut un abonnement à jour pour réserver un prospect, chercher, lancer une campagne ou faire signer un client. Il y a 3 jours de grâce après un paiement refusé. Sans abonnement, la campagne est mise en pause. Les gains restent toujours consultables et virables.

## 7. Espace admin

Une fois connecté à l'app avec ton compte, donne-toi le rôle admin (SQL Editor, une seule fois) :

```sql
insert into public.admins (user_id) select id from auth.users where email = '<TON EMAIL>';
```

Un lien « Admin » apparaît alors dans Profil. Il donne accès à :

- la vue d'ensemble : chiffres clés et incidents ;
- les virements à faire, avec l'IBAN complet à copier. Une fois le virement fait depuis ta banque, clique « Marquer versé » : le stacker reçoit un email. Un refus demande un motif, qui est envoyé au stacker ;
- les deals : recherche, suspendre, résilier ou annuler (avec motif). Une résiliation arrête aussi le prélèvement Mollie ;
- les offres : activer ou désactiver ;
- la liste des stackers ;
- les interrupteurs : abonnement obligatoire, prospection, campagnes, moteur.

Chaque action est notée dans le journal. Personne ne peut se donner le rôle depuis l'app.

## Réglages (table `billing_settings`)

| Champ | Défaut | Rôle |
|---|---|---|
| `price_cents` | 699 | Prix mensuel |
| `launch_seats` | 100 | Places de l'offre de lancement (les inscrits prioritaires de la liste d'attente en ont toujours une) |
| `launch_months` | 12 | Durée de l'offre de lancement |
| `grace_days` | 3 | Délai avant coupure après un paiement refusé |

## À savoir

- **Un stacker qui conteste son propre paiement d'abonnement** : c'est seulement journalisé (`stacker_chargeback`), sans coupure automatique. Ces cas sont à traiter à la main dans Mollie.
- **Un contrat résilié ou annulé** (`deal_set_status`) : son abonnement Mollie est arrêté au passage suivant de `mollie-run`.
