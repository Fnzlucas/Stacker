# Mise en route des campagnes (à faire une fois, par Lucas)

Aucune clé ne doit être collée dans une conversation ni dans le code : tout va dans
**Supabase → Project Settings → Edge Functions → Secrets** (ou `supabase secrets set`).

## 1. Google Cloud (moteur de recherche + Gmail)

Créer un projet **« Stacker »** (pas celui de Huntlist).

**a. Clé serveur Google Maps**
1. *APIs & Services → Library* : activer **Places API (New)**.
2. *Credentials → Create credentials → API key*.
3. *Restrict key* : **API restrictions** = « Places API (New) » uniquement. Pas de restriction de site (la clé est utilisée par le serveur, jamais par le navigateur).
4. *Quotas* : plafonner « Text Search » par jour (ex. 300/jour) : c'est le plafond dur côté Google, en plus du plafond de l'app (50 $/mois par défaut, réglable dans `prospect_settings.places_monthly_budget_usd`).
5. Secret Supabase : `GOOGLE_PLACES_SERVER_KEY`.

**b. Connexion Gmail (OAuth)**
1. *OAuth consent screen* : type **External**, nom « Stacker », email de contact, logo, liens `…/confidentialite` et `…/cgu`.
2. *Scopes* : `openid`, `email`, `https://www.googleapis.com/auth/gmail.send` (envoi seulement).
3. *Credentials → Create credentials → OAuth client ID* : type **Web application**.
   - Authorized redirect URI : `https://<PROJET>.supabase.co/functions/v1/mail-callback`
4. Secrets Supabase : `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.
5. Tant que Google n'a pas validé l'application : 100 utilisateurs maximum et un écran « application non vérifiée » (le stacker clique « Continuer »). Demander la validation dès maintenant (*Publish app* → *Prepare for verification*) : `gmail.send` est un périmètre « sensible », compter quelques semaines.

## 2. Microsoft (Outlook)

1. https://entra.microsoft.com → *App registrations → New registration* : « Stacker », comptes **« Any Entra ID tenant + personal Microsoft accounts »**.
2. Redirect URI (Web) : `https://<PROJET>.supabase.co/functions/v1/mail-callback`
3. *API permissions → Microsoft Graph → Delegated* : `Mail.Send`, `User.Read`, `offline_access`, `openid`, `email`.
4. *Certificates & secrets → New client secret* (24 mois ; noter la date d'expiration).
5. Secrets Supabase : `MS_OAUTH_CLIENT_ID` (Application ID), `MS_OAUTH_CLIENT_SECRET` (la *Value*).

## 3. Secrets générés (une fois)

```bash
# 32 octets aléatoires chacun (base64)
openssl rand -base64 32   # → MAIL_TOKEN_KEY  (chiffre les accès aux boîtes ; ne JAMAIS la changer sans reconnecter les boîtes)
openssl rand -base64 32   # → MAIL_STATE_KEY
openssl rand -hex 24      # → CRON_SECRET
```

Autres secrets : `SITE_URL` (URL publique du site), `ALLOWED_ORIGINS` (même URL), `RATE_LIMIT_PEPPER` (déjà créé au lot 1).

## 4. Déploiement des fonctions

```bash
supabase functions deploy prospects-search opposition-register leads-enrich mail-connect mail-callback campaign-run
```

## 5. Tâches planifiées (Supabase → Integrations → Cron)

Activer **pg_cron** et **pg_net**, puis (SQL Editor) :

```sql
-- Envoi des emails : toutes les 2 minutes en semaine, 8 h - 19 h (heure UTC+2 à ajuster l'hiver)
select cron.schedule('campaign-run', '*/2 6-17 * * 1-5', $$
  select net.http_post('https://<PROJET>.supabase.co/functions/v1/campaign-run',
    headers := '{"x-cron-secret": "<CRON_SECRET>"}'::jsonb)
$$);
-- Moteur (Google Maps → sites → emails) : toutes les 20 minutes
select cron.schedule('leads-enrich', '*/20 * * * *', $$
  select net.http_post('https://<PROJET>.supabase.co/functions/v1/leads-enrich',
    headers := '{"x-cron-secret": "<CRON_SECRET>"}'::jsonb, timeout_milliseconds := 150000)
$$);
```

(Le remplissage quotidien des campagnes et l'expiration des réservations sont planifiés par les migrations dès que pg_cron est actif.)

## 6. Réglages utiles (table `prospect_settings`, SQL Editor)

| Réglage | Défaut | Rôle |
|---|---|---|
| `campaign_max_per_day` | 200 | Plafond d'emails par stacker et par jour |
| `places_monthly_budget_usd` | 50 | Dépense Google Maps maximale par mois (coupe-circuit) |
| `campaign_no_reply_cooldown_days` | 90 | Pause d'une entreprise écrite sans réponse |

Coupe-circuits immédiats (table `app_flags`) : `campaigns_enabled`, `leads_enrich_enabled`, `prospects_enabled`.

## Ce qu'il faut savoir

- **Coût Google** : ~35 $ les 1 000 requêtes, une requête = 20 entreprises. Un stacker à 200 emails/jour ≈ 15 à 20 $/mois tant que la zone n'a pas été parcourue ; ensuite les entreprises déjà trouvées servent à tous.
- **Conditions Google (EEE)** : la constitution de fichiers de prospection à partir de Google Maps n'est pas dans les usages autorisés. Atténuation : rien de Google n'est conservé (seulement le `place_id`) ; l'email vient du site de l'entreprise, l'identité vient de SIRENE.
- **Délivrabilité** : montée progressive automatique (20 → 200/jour en 3 semaines), envoi étalé de 8 h 30 à 18 h 30 en semaine, en-tête de désinscription (Gmail).
