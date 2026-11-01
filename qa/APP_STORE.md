# Stacker sur l'App Store

L'app iPhone est dans `ios/` (Capacitor). Elle affiche l'app en ligne
(`https://stacker-topaz.vercel.app/app`), avec en plus :

- **dictée vocale d'Apple** pour l'entraînement à l'appel ;
- **notifications push** : commission débloquée, virement envoyé, boîte mail à reconnecter ;
- **règles App Store** : aucun prix, aucun paiement, aucun lien vers le site pour s'abonner. L'abonnement se prend uniquement sur le site.

Toute mise à jour du site met l'app à jour. Il n'y a rien à renvoyer à Apple, sauf si on touche au dossier `ios/`.

---

## 1. Ce qu'il te faut

| Quoi | Où | Délai |
|---|---|---|
| Compte **Apple Developer** (99 $/an) | developer.apple.com/programs : choisis **Individual** (pas de numéro D-U-N-S) | 1 à 2 jours |
| Un **Mac avec Xcode**, ou **Codemagic** (compilation en ligne, gratuit pour démarrer) | codemagic.io | — |
| Le site en production sur `stacker-topaz.vercel.app` | — | — |

Si le domaine change, mets à jour l'URL dans `capacitor.config.json` (`server.url`) et dans `ios-shell/index.html`, puis lance `pnpm ios:sync`.

## 2. Dans le compte Apple Developer

1. **Identifiant de l'app** : *Certificates, Identifiers & Profiles* → *Identifiers* → `+` → App IDs → `fr.stacker.app`. Coche **Push Notifications**.
2. **Clé pour les notifications** : *Keys* → `+` → coche **Apple Push Notifications service (APNs)** → télécharge le fichier `.p8` (une seule fois !). Note le **Key ID** et ton **Team ID** (en haut à droite du compte).
3. Dans **Supabase → Edge Functions → Secrets** :

| Secret | Valeur |
|---|---|
| `APNS_KEY_ID` | le Key ID (10 caractères) |
| `APNS_TEAM_ID` | le Team ID (10 caractères) |
| `APNS_PRIVATE_KEY` | tout le contenu du fichier `.p8`, lignes `BEGIN` et `END` comprises |
| `APNS_BUNDLE_ID` | `fr.stacker.app` |

Puis déploie et planifie l'envoi, toutes les minutes :

```bash
supabase functions deploy push-run
```

```sql
select cron.schedule('push-run', '* * * * *', $$
  select net.http_post('https://<PROJET>.supabase.co/functions/v1/push-run',
    headers := '{"x-cron-secret": "<CRON_SECRET>"}'::jsonb)
$$);
```

## 3. Compiler et envoyer à Apple

### Avec un Mac

```bash
pnpm install
pnpm ios:sync          # copie la config et les plugins dans ios/
open ios/App/App.xcodeproj
```

Dans Xcode :
1. Cible **App** → *Signing & Capabilities* → choisis ton équipe (Team). Vérifie que **Push Notifications** apparaît, sinon `+ Capability` → Push Notifications.
2. Choisis l'appareil **Any iOS Device (arm64)** → *Product* → **Archive** → **Distribute App** → **App Store Connect** → Upload.

### Sans Mac (Codemagic)

Connecte le dépôt GitHub `Fnzlucas/Stacker` sur codemagic.io, ajoute l'intégration App Store Connect (clé API, dans *App Store Connect → Users and Access → Integrations*), puis lance le workflow `ios-appstore` du fichier `codemagic.yaml`. Dans Codemagic, nomme l'intégration `stacker-asc` et ajoute la variable `APP_STORE_APPLE_ID`, l'identifiant numérique de l'app, visible dans App Store Connect → *Informations sur l'app*. Le build part ensuite sur TestFlight, d'où tu le soumets à la validation.

## 4. La fiche App Store Connect

**Nom** : Stacker
**Sous-titre** (30 caractères max) : `Entraîne-toi. Puis appelle.`
**Catégorie** : Business (secondaire : Productivité)
**Âge** : réponds « aucun » à chaque question du questionnaire (classement 4+) ; l’inscription reste réservée aux majeurs dans l’app.
**URL de confidentialité** : `https://stacker-topaz.vercel.app/confidentialite`
**URL d'assistance** : `https://stacker-topaz.vercel.app/contact`
**Prix** : Gratuit, **sans achat intégré**.

**Description** :

> Apporte des clients aux commerçants et touche une commission, gratuitement.
>
> GRATUIT
> • Un catalogue de services pour les commerces : fiche Google, avis, réseaux sociaux, et des sites sur mesure payés en une fois.
> • Signature du contrat client sur ton téléphone.
> • Suivi de tes commissions client par client, notifications quand elles sont débloquées.
>
> STACKER ACADEMY
> • Appels d'entraînement : un commerçant joué par une IA décroche, hésite, objecte… et peut raccrocher. Tu parles comme au téléphone.
> • Ta note sur 100 et des conseils précis : présentation, accroche, questions, offre, conclusion.
> • Une formation complète en 13 modules : cibler, appeler, répondre aux objections, obtenir le oui.
>
> STACKER PRO
> • Recherche d'entreprises par département et par secteur (registre officiel SIRENE).
> • Campagnes d'emails envoyées depuis ta propre boîte Gmail ou Outlook, au bon rythme, avec lien de désinscription.
>
> Les commissions dépendent uniquement des clients que tu apportes et qui paient : aucun revenu n'est garanti. Réservé aux personnes majeures.

**Mots-clés** (100 caractères max) : `academy,vente,entraînement,IA,appel,apporteur,affaires,commission,prospection,commercial`

**Captures d'écran** (iPhone 6,9 pouces, 1320 × 2868) : `qa/appstore/1-prospects.png` à `5-gains.png`. Pour les régénérer :

```bash
APPSTORE=1 pnpm exec playwright test e2e/appstore-shots.spec.ts --project=mobile-390
```

## 5. Confidentialité (« App Privacy »)

Réponds **Oui, des données sont collectées**, aucune n'est utilisée pour du suivi publicitaire (*tracking : non*) :

| Donnée | Usage | Liée à l'identité |
|---|---|---|
| Nom, email, téléphone | Fonctionnement de l'app | Oui |
| Informations financières (IBAN de virement) | Fonctionnement de l'app | Oui |
| Contenu utilisateur : textes de l'entraînement | Fonctionnement de l'app | Oui |
| Données audio | **Non** (la dictée est faite par l'iPhone ; seul le texte est envoyé) | — |
| Identifiants : ID utilisateur, jeton de notification | Fonctionnement de l'app | Oui |

## 6. Note pour le testeur d'Apple (*App Review Information*)

Crée d'abord un **compte de démonstration** sur le site : prénom « Apple », abonnement actif, département 30, quelques prospects. Mets son email et son mot de passe dans *Sign-In Information*. Puis colle cette note, en anglais :

> Stacker is a tool for independent business referral agents in France (French-language app).
>
> **Demo account** (credentials above) is fully set up: prospects, an email campaign, and earnings.
>
> **What to try:**
> 1. *Prospects → Recherche*: search companies by area and sector (official French company registry SIRENE).
> 2. *Accueil → Réussir un appel d'entraînement*: a voice role-play where an AI plays a shop owner. Tap "J'accepte" (consent to send the transcript to our AI provider, Anthropic), then call. The microphone and Apple speech recognition are used; you can also type.
> 3. *Gains*: commissions per client; a push notification is sent when a client payment is collected.
>
> **Payments:** the app contains no purchases and no payment links. Commissions are paid to agents by bank transfer for real-world B2B services (website, Google reviews, local visibility) sold to businesses; these are not digital goods.
>
> **Emails:** campaigns are B2B emails sent from the agent's own Gmail/Outlook account (send-only OAuth scope), only to generic business addresses published on the company's own website, capped at 50 per day, each with an unsubscribe link honoured immediately.
>
> **Income:** the app makes no earnings promise ("Aucun revenu n'est garanti"). Users must be 18+.
>
> **Account deletion:** Profil → Supprimer mon compte.

## 7. Après l'envoi

- Validation Apple : souvent 24 à 48 h. En cas de refus, Apple dit pourquoi. On corrige et on renvoie, ce n'est pas définitif.
- **Turnstile** (anti-robot de l'inscription) : rien à faire, l'app charge le vrai domaine.
- **Google (Gmail)** : la connexion s'ouvre dans Safari, comme l'exige Google. En revenant dans l'app, l'état se met à jour tout seul.

## 8. Point à surveiller : les abonnements et Apple

La formule gratuite (faire signer des clients, toucher ses commissions) fonctionne entièrement dans l'app : c'est elle que verra un testeur sans abonnement, ce qui renforce le dossier. Les formules payantes (Academy 12,99 €, Pro 9,99 €, Academy + Pro 14,99 €) donnent accès à du contenu et à des fonctions **utilisés dans l'app**. Pour Apple, un abonnement de ce type doit en principe pouvoir s'acheter **aussi dans l'app** (règle 3.1.3(b)). Dans l'app, on ne vend rien et on ne renvoie pas vers le site : c'est la version la plus simple, mais Apple peut la refuser.

Si Apple refuse pour cette raison, deux solutions :

| Solution | Commission Apple (Europe, depuis le 1er octobre 2026) | Travail |
|---|---|---|
| Lien vers le site depuis l'app (« Choisir ma formule ») | 15 %, ou 10 % avec le *Small Business Program* | Petit : un lien et la déclaration du lien chez Apple |
| Achat intégré Apple (In-App Purchase) | 26 %, ou 15 % avec le *Small Business Program* | Plus lourd : produits dans App Store Connect, achat via StoreKit, synchronisation avec Stacker |

Inscris-toi au **Small Business Program** dès l'ouverture du compte (gratuit, pour moins d'un million de dollars de revenus par an sur l'App Store) : toutes les commissions sont réduites.
