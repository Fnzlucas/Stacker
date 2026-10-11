-- =============================================================================
-- Stacker — Lot 5 : deals (signature du client) et gains (commissions)
--
-- Principes :
--   * Le catalogue (offers) est lu par le stacker via deal_catalog() ; seul
--     l'admin le modifie (SQL / futur back-office). Une offre désactivée
--     disparaît du catalogue sans toucher aux deals déjà signés.
--   * Le contrat est rendu PAR LE SERVEUR à partir d'un modèle versionné
--     (deal_settings.contract_template). Aperçu (deal_preview) et signature
--     (deal_sign) rendent le même texte ; la signature est refusée si
--     l'empreinte SHA-256 vue par le client ne correspond plus.
--   * Signature électronique simple : tracé au doigt (PNG), horodatage,
--     adresse IP et navigateur, empreinte du contrat, référence unique de
--     mandat (RUM). L'IBAN du client est chiffré (pgp_sym_encrypt, clé en
--     base illisible des rôles clients) ; seuls le pays et les 4 derniers
--     caractères sont lisibles.
--   * Délai de rétractation de 14 jours accordé à tous les clients ; le
--     premier prélèvement intervient après ce délai.
--   * Commission : créée quand le CLIENT A PAYÉ, disponible au virement
--     14 jours après l'encaissement (30 jours pour le premier paiement d'un
--     nouveau client), comme annoncé dans les CGU. Virements regroupés et
--     traités chaque semaine.
--   * Commission (suite) : due quand le CLIENT A PAYÉ (deal_record_payment, appelée
--     par le serveur : webhook Mollie ou admin). Taux = niveau du stacker au
--     moment du paiement (commission_tiers). Le premier paiement rend le
--     client « actif » et fait progresser le niveau (profiles.active_clients).
--   * Le stacker n'écrit jamais directement : tout passe par des fonctions
--     SECURITY DEFINER (search_path vide). Aucune table n'est lisible
--     directement par les rôles clients.
--   * Le deal appartient à Stacker (contrat avec le client) : si le compte du
--     stacker est supprimé, le deal et l'historique comptable restent,
--     anonymisés (stacker_id = null).
-- =============================================================================

create type public.deal_status as enum ('signe', 'actif', 'suspendu', 'resilie', 'annule');
create type public.commission_status as enum ('disponible', 'demandee', 'versee');
create type public.payout_status as enum ('demande', 'verse', 'refuse');

-- -----------------------------------------------------------------------------
-- Réglages
-- -----------------------------------------------------------------------------

create table public.deal_settings (
  id                    boolean primary key default true,
  max_deals_per_day     integer not null default 20,
  min_payout_cents      integer not null default 1000,
  withdrawal_days       integer not null default 14,
  -- Délai entre l'encaissement du client et la disponibilité de la commission
  -- (remboursements SEPA possibles) : identique aux CGU et au site.
  availability_days            integer not null default 14,
  availability_days_new_client integer not null default 30,
  contract_version      text not null default '2026-10-12',
  contract_template     text not null,
  updated_at            timestamptz not null default now(),
  constraint deal_settings_singleton check (id),
  constraint deal_settings_bounds check (max_deals_per_day between 1 and 200 and min_payout_cents between 0 and 100000 and withdrawal_days between 14 and 60
    and availability_days between 0 and 90 and availability_days_new_client between 0 and 120)
);

insert into public.deal_settings (contract_template) values ($tpl$CONTRAT D'ABONNEMENT ET MANDAT DE PRÉLÈVEMENT SEPA
Référence : {{reference}} · Modèle {{version}} · {{date}}

ENTRE
Le prestataire : {{prestataire}}, ci-après « Stacker ».
ET
Le client : {{client_raison_sociale}}, SIRET {{client_siret}}, {{client_adresse}}, représenté par {{client_representant}} ({{client_qualite}}), joignable au {{client_telephone}} et à {{client_email}}, ci-après « le Client ».

1. OBJET
Stacker fournit au Client le service suivant : {{offre}}.
Contenu : {{offre_details}}.

2. PRIX
{{quantite_ligne}}Prix : {{prix_mensuel}} par mois. TVA non applicable, art. 293 B du CGI.
Le prix est payé chaque mois par prélèvement SEPA.

3. DURÉE
{{engagement}}

4. DROIT DE RÉTRACTATION
Le Client dispose de {{retractation}} jours à compter de la signature pour se rétracter, sans motif ni frais, par email à stacker-contact@outlook.com. Le premier prélèvement intervient à l'issue de ce délai.

5. RÉSILIATION
Après la période d'engagement éventuelle, chaque partie peut résilier à tout moment par email, avec effet à la fin du mois en cours. En cas d'impayé non régularisé sous 15 jours, Stacker peut suspendre le service.

6. DONNÉES PERSONNELLES
Les données du Client sont traitées par Stacker pour l'exécution du contrat et la facturation, conservées pendant la durée légale, et ne sont jamais revendues. Le Client peut exercer ses droits à stacker-contact@outlook.com.

7. APPORTEUR D'AFFAIRES
Ce contrat a été présenté par {{apporteur}}, apporteur d'affaires indépendant de Stacker. Seul Stacker est engagé envers le Client.

8. DROIT APPLICABLE
Droit français. À défaut d'accord amiable, les tribunaux du ressort du siège de Stacker sont compétents.

MANDAT DE PRÉLÈVEMENT SEPA
Référence unique du mandat (RUM) : {{rum}}
Créancier : Stacker, via son prestataire de paiement Mollie B.V.
Débiteur : {{titulaire}} · IBAN {{iban_masque}}
Type de paiement : récurrent.
En signant ce mandat, le Client autorise Stacker (via Mollie) à envoyer des instructions à sa banque pour débiter son compte, et sa banque à débiter son compte conformément à ces instructions. Le Client bénéficie du droit d'être remboursé par sa banque selon les conditions décrites dans la convention passée avec elle ; une demande de remboursement doit être présentée dans les 8 semaines suivant la date de débit pour un prélèvement autorisé.

Signé électroniquement le {{date}} par {{client_representant}}, pour {{client_raison_sociale}}.$tpl$);

-- -----------------------------------------------------------------------------
-- Catalogue
-- -----------------------------------------------------------------------------

create table public.offers (
  id                 text primary key,
  brand              text not null,
  category           text not null,
  description        text not null default '',
  name               text not null,
  price_cents        integer not null,
  unit_label         text,
  qty_min            integer not null default 1,
  qty_max            integer not null default 1,
  engagement_months  integer not null default 0,
  features           text[] not null default '{}',
  recommended        boolean not null default false,
  active             boolean not null default true,
  sort_order         integer not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint offers_id_format check (id ~ '^[a-z0-9-]{2,60}$'),
  constraint offers_price check (price_cents between 100 and 10000000),
  constraint offers_qty check (qty_min between 1 and 10000 and qty_max between qty_min and 10000),
  constraint offers_unit check ((qty_max = 1 and qty_min = 1) or unit_label is not null),
  constraint offers_engagement check (engagement_months between 0 and 36),
  constraint offers_texts check (char_length(brand) between 1 and 80 and char_length(name) between 1 and 80 and char_length(category) <= 120)
);

comment on table public.offers is
  'Offres vendues par les stackers (prix mensuels HT = TTC, franchise de TVA). Catalogue repris de l''ancienne app ; '
  'les offres de logiciels tiers sont créées désactivées en attendant confirmation.';

insert into public.offers (id, brand, category, description, name, price_cents, unit_label, qty_min, qty_max, engagement_months, features, recommended, active, sort_order) values
('pack-site-pack-starter', 'Packs Site + SEO', 'Pack · Site + SEO', 'Le pack d''entrée idéal pour les commerçants et entrepreneurs qui veulent une présence en ligne complète sans se ruiner. Un site vitrine professionnel livré en 7 jours + un suivi SEO mensuel pour être trouvé sur Google. Tout inclus, aucune surprise.', 'Pack Starter', 5499, null, 1, 1, 12, array['Site vitrine 5 pages', 'Livraison en 7 jours', 'SEO de base mensuel', 'Hébergement inclus', 'Support email']::text[], false, true, 10),
('pack-site-pack-visibilite', 'Packs Site + SEO', 'Pack · Site + SEO', 'Le pack d''entrée idéal pour les commerçants et entrepreneurs qui veulent une présence en ligne complète sans se ruiner. Un site vitrine professionnel livré en 7 jours + un suivi SEO mensuel pour être trouvé sur Google. Tout inclus, aucune surprise.', 'Pack Visibilité', 7499, null, 1, 1, 12, array['Site jusqu''à 15 pages', 'Blog intégré', 'SEO avancé + Google My Business', 'E-Réputation Google', 'Support prioritaire']::text[], true, true, 20),
('pack-site-pack-digital-complet', 'Packs Site + SEO', 'Pack · Site + SEO', 'Le pack d''entrée idéal pour les commerçants et entrepreneurs qui veulent une présence en ligne complète sans se ruiner. Un site vitrine professionnel livré en 7 jours + un suivi SEO mensuel pour être trouvé sur Google. Tout inclus, aucune surprise.', 'Pack Digital Complet', 9999, null, 1, 1, 12, array['Pages illimitées', 'SEO premium + IA (ChatGPT/Perplexity)', 'Gestion réseaux sociaux', 'Modifications illimitées', 'Manager dédié']::text[], false, true, 30),
('pack-local-pack-local-pro', 'Packs Visibilité locale', 'Pack · Visibilité Locale Complète', 'Le pack tout-en-un pour les commerçants qui veulent dominer leur zone de chalandise. Site web + SEO local + gestion réseaux sociaux + carte de fidélité digitale. Tout géré par une seule équipe, une seule facture.', 'Pack Local Pro', 11999, null, 1, 1, 12, array['Site web professionnel', 'SEO local + GMB', '2 posts réseaux/semaine', 'Carte fidélité digitale', 'Support prioritaire']::text[], true, true, 40),
('pack-local-pack-local-elite', 'Packs Visibilité locale', 'Pack · Visibilité Locale Complète', 'Le pack tout-en-un pour les commerçants qui veulent dominer leur zone de chalandise. Site web + SEO local + gestion réseaux sociaux + carte de fidélité digitale. Tout géré par une seule équipe, une seule facture.', 'Pack Local Elite', 15999, null, 1, 1, 12, array['Tout Local Pro inclus', 'SEO avancé + IA', '5 posts réseaux/semaine + stories', 'UGC vidéo mensuelle', 'Manager dédié']::text[], false, true, 50),
('qr-avis-qr-avis-solo', 'QR Avis Google', 'Collecte d''avis Google instantanée', 'QR Avis Google c''est un QR code physique livré chez le commerçant en 48h. Le client scanne depuis la caisse ou la vitrine et tombe directement sur la fiche Google du commerce pour laisser un avis — sans chercher, sans taper. Zéro friction. Les commerçants qui le posent voient leurs avis exploser dès la première semaine.', 'QR Avis Solo', 900, null, 1, 1, 0, array['1 QR code physique livré en 48h', 'Redirection directe fiche Google Reviews', 'Page trackée — compteur de scans mensuel', 'Mise à jour du lien si Google change']::text[], false, true, 60),
('qr-avis-qr-avis-pro', 'QR Avis Google', 'Collecte d''avis Google instantanée', 'QR Avis Google c''est un QR code physique livré chez le commerçant en 48h. Le client scanne depuis la caisse ou la vitrine et tombe directement sur la fiche Google du commerce pour laisser un avis — sans chercher, sans taper. Zéro friction. Les commerçants qui le posent voient leurs avis exploser dès la première semaine.', 'QR Avis Pro', 1900, null, 1, 1, 0, array['3 QR codes physiques (caisse, vitrine, table)', 'Tout Solo inclus', 'Rapport mensuel : scans + avis gagnés', 'Relance automatique par SMS après passage']::text[], true, true, 70),
('qr-avis-qr-avis-max', 'QR Avis Google', 'Collecte d''avis Google instantanée', 'QR Avis Google c''est un QR code physique livré chez le commerçant en 48h. Le client scanne depuis la caisse ou la vitrine et tombe directement sur la fiche Google du commerce pour laisser un avis — sans chercher, sans taper. Zéro friction. Les commerçants qui le posent voient leurs avis exploser dès la première semaine.', 'QR Avis Max', 3900, null, 1, 1, 0, array['10 QR codes physiques', 'Tout Pro inclus', 'Multi-établissements', 'Réponses aux avis rédigées par IA', 'Support prioritaire 7j/7']::text[], false, true, 80),
('seoia-starter', 'Seoia Partners', 'SEO Traditionnel & SEO IA', 'Seoia Partners positionne les commerçants en tête de Google ET sur les nouveaux moteurs de recherche IA comme ChatGPT, Perplexity et Google AI Overview. Double stratégie : SEO traditionnel pour Google classique + optimisation IA pour être cité quand un client pose une question à une IA. Le premier service qui couvre les deux.', 'Starter', 3499, null, 1, 1, 6, array['Audit SEO complet du site', 'Optimisation on-page et technique', 'Référencement IA de base (ChatGPT)', 'Rapport mensuel détaillé']::text[], false, true, 90),
('seoia-pro', 'Seoia Partners', 'SEO Traditionnel & SEO IA', 'Seoia Partners positionne les commerçants en tête de Google ET sur les nouveaux moteurs de recherche IA comme ChatGPT, Perplexity et Google AI Overview. Double stratégie : SEO traditionnel pour Google classique + optimisation IA pour être cité quand un client pose une question à une IA. Le premier service qui couvre les deux.', 'Pro', 6499, null, 1, 1, 9, array['Tout Starter inclus', 'Contenu IA publié chaque semaine', 'Optimisation Google AI Overview + Perplexity', 'SEO local Google My Business', 'Support prioritaire 24h']::text[], true, true, 100),
('seoia-premium', 'Seoia Partners', 'SEO Traditionnel & SEO IA', 'Seoia Partners positionne les commerçants en tête de Google ET sur les nouveaux moteurs de recherche IA comme ChatGPT, Perplexity et Google AI Overview. Double stratégie : SEO traditionnel pour Google classique + optimisation IA pour être cité quand un client pose une question à une IA. Le premier service qui couvre les deux.', 'Premium', 9999, null, 1, 1, 12, array['Tout Pro inclus', 'Stratégie IA sur mesure multi-plateformes', 'Session stratégique mensuelle 1h', 'Manager SEO dédié']::text[], false, true, 110),
('fastfood-os-starter', 'Fast Food OS', 'Logiciel Restauration Rapide', 'Fast Food OS est le logiciel tout-en-un conçu spécifiquement pour la restauration rapide. Gestion des commandes, suivi des stocks en temps réel, CRM clients, facturation électronique conforme aux obligations 2026 et analytics de performance.', 'Starter', 7900, null, 1, 1, 12, array['Caisse digitale tactile', 'Gestion stocks basique', 'Facturation électronique conforme', 'Support email']::text[], false, false, 120),
('fastfood-os-pro', 'Fast Food OS', 'Logiciel Restauration Rapide', 'Fast Food OS est le logiciel tout-en-un conçu spécifiquement pour la restauration rapide. Gestion des commandes, suivi des stocks en temps réel, CRM clients, facturation électronique conforme aux obligations 2026 et analytics de performance.', 'Pro', 12900, null, 1, 1, 12, array['Tout Starter inclus', 'CRM clients complet', 'Alertes stocks automatiques', 'Dashboard analytics', 'Support prioritaire 7j/7']::text[], true, false, 130),
('fastfood-os-premium', 'Fast Food OS', 'Logiciel Restauration Rapide', 'Fast Food OS est le logiciel tout-en-un conçu spécifiquement pour la restauration rapide. Gestion des commandes, suivi des stocks en temps réel, CRM clients, facturation électronique conforme aux obligations 2026 et analytics de performance.', 'Premium', 19900, null, 1, 1, 12, array['Tout Pro inclus', 'Multi-établissements', 'API UberEats & Deliveroo', 'Manager compte dédié']::text[], false, false, 140),
('huntlist-starter', 'Huntlist', 'Prospection B2B Automatisée', 'Huntlist automatise entièrement la prospection B2B. Il scrape les données de prospects qualifiés sur LinkedIn, Google Maps et les annuaires professionnels, puis les exporte directement vers votre CRM. Fini les recherches manuelles chronophages.', 'Starter', 9900, null, 1, 1, 6, array['500 contacts qualifiés/mois', 'LinkedIn + Google Maps', 'Export CSV illimité', 'Support email']::text[], false, true, 150),
('huntlist-pro', 'Huntlist', 'Prospection B2B Automatisée', 'Huntlist automatise entièrement la prospection B2B. Il scrape les données de prospects qualifiés sur LinkedIn, Google Maps et les annuaires professionnels, puis les exporte directement vers votre CRM. Fini les recherches manuelles chronophages.', 'Pro', 19900, null, 1, 1, 6, array['2 000 contacts/mois', 'Toutes les sources disponibles', 'Export CRM direct (HubSpot, etc.)', 'Enrichissement email + téléphone', 'Support prioritaire']::text[], true, true, 160),
('huntlist-premium', 'Huntlist', 'Prospection B2B Automatisée', 'Huntlist automatise entièrement la prospection B2B. Il scrape les données de prospects qualifiés sur LinkedIn, Google Maps et les annuaires professionnels, puis les exporte directement vers votre CRM. Fini les recherches manuelles chronophages.', 'Premium', 34900, null, 1, 1, 12, array['Contacts illimités', 'IA de qualification des prospects', 'Séquences email automatiques intégrées', 'Manager dédié']::text[], false, true, 170),
('rh-pme-starter', 'RH PME', 'Ressources Humaines', 'RH PME centralise toute la gestion des ressources humaines pour les PME françaises. Fiches de paie automatisées, gestion des congés, suivi des entretiens et formations, conformité URSSAF garantie — le tout en un seul outil, 100% conforme au droit du travail français.', 'Starter', 14900, null, 1, 1, 12, array['Max 10 salariés', 'Gestion congés & absences', 'Fiches de paie automatisées', 'Support email']::text[], false, false, 180),
('rh-pme-pro', 'RH PME', 'Ressources Humaines', 'RH PME centralise toute la gestion des ressources humaines pour les PME françaises. Fiches de paie automatisées, gestion des congés, suivi des entretiens et formations, conformité URSSAF garantie — le tout en un seul outil, 100% conforme au droit du travail français.', 'Pro', 29900, null, 1, 1, 12, array['Max 50 salariés', 'Entretiens & plans de formation', 'Alertes conformité automatiques', 'Export URSSAF direct', 'Support prioritaire']::text[], true, false, 190),
('rh-pme-premium', 'RH PME', 'Ressources Humaines', 'RH PME centralise toute la gestion des ressources humaines pour les PME françaises. Fiches de paie automatisées, gestion des congés, suivi des entretiens et formations, conformité URSSAF garantie — le tout en un seul outil, 100% conforme au droit du travail français.', 'Premium', 49900, null, 1, 1, 12, array['Salariés illimités', 'Module recrutement intégré', 'IA analyse et prédiction RH', 'CSE & BDES inclus', 'Manager RH dédié']::text[], false, false, 200),
('fidelite-starter', 'Carte Fidélité', 'Marketing & Fidélisation', 'Une carte de fidélité digitale directement dans le wallet Apple ou Google du client, avec notifications push gratuites et illimitées. Zéro application à télécharger pour le client, zéro commission sur les transactions pour le commerçant.', 'Starter', 2900, null, 1, 1, 0, array['Max 200 clients', '2 notifications push/mois', 'Wallet Apple & Google', 'Support email']::text[], false, false, 210),
('fidelite-pro', 'Carte Fidélité', 'Marketing & Fidélisation', 'Une carte de fidélité digitale directement dans le wallet Apple ou Google du client, avec notifications push gratuites et illimitées. Zéro application à télécharger pour le client, zéro commission sur les transactions pour le commerçant.', 'Pro', 5900, null, 1, 1, 0, array['Clients illimités', 'Notifications push illimitées', 'Statistiques clients détaillées', 'QR Code personnalisé', 'Support prioritaire']::text[], true, false, 220),
('fidelite-premium', 'Carte Fidélité', 'Marketing & Fidélisation', 'Une carte de fidélité digitale directement dans le wallet Apple ou Google du client, avec notifications push gratuites et illimitées. Zéro application à télécharger pour le client, zéro commission sur les transactions pour le commerçant.', 'Premium', 9900, null, 1, 1, 0, array['Tout Pro inclus', 'Multi-établissements', 'Segmentation clients avancée', 'Campagnes ciblées par profil', 'Manager dédié']::text[], false, false, 230),
('alma-starter', 'Alma Company', 'Création de Sites Web', 'Alma Company crée des sites web professionnels, modernes et optimisés pour le référencement naturel. Design sur mesure adapté au secteur, hébergement inclus, maintenance assurée et modifications incluses. Livraison garantie en 7 jours.', 'Starter', 3999, null, 1, 1, 12, array['Site vitrine 5 pages', 'Design professionnel', 'Hébergement inclus', 'SEO de base intégré', 'Support email']::text[], false, true, 240),
('alma-pro', 'Alma Company', 'Création de Sites Web', 'Alma Company crée des sites web professionnels, modernes et optimisés pour le référencement naturel. Design sur mesure adapté au secteur, hébergement inclus, maintenance assurée et modifications incluses. Livraison garantie en 7 jours.', 'Pro', 6999, null, 1, 1, 12, array['Max 15 pages', 'Blog intégré', 'Formulaires avancés', '3 modifications/mois', 'Support prioritaire']::text[], true, true, 250),
('alma-premium', 'Alma Company', 'Création de Sites Web', 'Alma Company crée des sites web professionnels, modernes et optimisés pour le référencement naturel. Design sur mesure adapté au secteur, hébergement inclus, maintenance assurée et modifications incluses. Livraison garantie en 7 jours.', 'Premium', 11999, null, 1, 1, 12, array['Pages illimitées', 'E-commerce complet', 'Modifications illimitées', 'SEO avancé mensuel', 'Manager dédié']::text[], false, true, 260),
('inroom-petite-structure', 'InRoom', 'Conciergerie Hôtelière', 'InRoom est une marketplace de services de conciergerie à la demande pour les hôtels. Sans avoir besoin d''un concierge interne, l''hôtel offre à ses clients des services premium directement en chambre : massage, coiffeur, chasseur, pressing, baby-sitter, cours particuliers et bien plus. Le client commande depuis son téléphone via QR code, InRoom coordonne les prestataires.', 'Petite structure', 500, 'chambre', 1, 20, 0, array['Max 20 chambres', 'Marketplace services premium', 'QR Code par chambre', 'Coordination prestataires incluse', 'Support email']::text[], false, true, 270),
('inroom-hotel-moyen', 'InRoom', 'Conciergerie Hôtelière', 'InRoom est une marketplace de services de conciergerie à la demande pour les hôtels. Sans avoir besoin d''un concierge interne, l''hôtel offre à ses clients des services premium directement en chambre : massage, coiffeur, chasseur, pressing, baby-sitter, cours particuliers et bien plus. Le client commande depuis son téléphone via QR code, InRoom coordonne les prestataires.', 'Hôtel moyen', 500, 'chambre', 21, 80, 12, array['21 à 80 chambres', 'Tout Petite structure inclus', 'Intégration PMS hôtelier', 'Statistiques satisfaction', 'Support prioritaire']::text[], true, true, 280),
('inroom-grand-hotel', 'InRoom', 'Conciergerie Hôtelière', 'InRoom est une marketplace de services de conciergerie à la demande pour les hôtels. Sans avoir besoin d''un concierge interne, l''hôtel offre à ses clients des services premium directement en chambre : massage, coiffeur, chasseur, pressing, baby-sitter, cours particuliers et bien plus. Le client commande depuis son téléphone via QR code, InRoom coordonne les prestataires.', 'Grand hôtel', 500, 'chambre', 81, 1000, 12, array['80+ chambres', 'Tout Hôtel moyen inclus', 'Multi-établissements', 'API sur mesure', 'Manager dédié']::text[], false, true, 290),
('e-reputation-starter', 'E-Réputation Google', 'Avis & Réputation en ligne', 'Un système clé en main pour générer des avis Google 5 étoiles automatiquement après chaque client, gérer et répondre aux avis négatifs, et améliorer le score de réputation en ligne. Le commerçant reçoit un QR code à poser en caisse — le client scanne et laisse son avis en 20 secondes.', 'Starter', 2900, null, 1, 1, 0, array['QR code de collecte d''avis', 'Alertes nouveaux avis', 'Tableau de bord avis', 'Support email']::text[], false, true, 300),
('e-reputation-pro', 'E-Réputation Google', 'Avis & Réputation en ligne', 'Un système clé en main pour générer des avis Google 5 étoiles automatiquement après chaque client, gérer et répondre aux avis négatifs, et améliorer le score de réputation en ligne. Le commerçant reçoit un QR code à poser en caisse — le client scanne et laisse son avis en 20 secondes.', 'Pro', 4900, null, 1, 1, 0, array['Tout Starter inclus', 'Réponses automatiques IA', 'Rapport mensuel réputation', 'Support prioritaire']::text[], true, true, 310),
('e-reputation-premium', 'E-Réputation Google', 'Avis & Réputation en ligne', 'Un système clé en main pour générer des avis Google 5 étoiles automatiquement après chaque client, gérer et répondre aux avis négatifs, et améliorer le score de réputation en ligne. Le commerçant reçoit un QR code à poser en caisse — le client scanne et laisse son avis en 20 secondes.', 'Premium', 8900, null, 1, 1, 12, array['Tout Pro inclus', 'Multi-établissements', 'Veille concurrents locaux', 'Manager dédié']::text[], false, true, 320),
('gmb-starter', 'Google My Business', 'Référencement Local', 'Optimisation complète et gestion mensuelle de la fiche Google My Business — photos professionnelles, horaires à jour, posts hebdomadaires, réponses aux avis, catégories optimisées. La fiche GMB est souvent la première chose que voit un client avant même le site web.', 'Starter', 3900, null, 1, 1, 0, array['Optimisation complète initiale', 'Mise à jour horaires et infos', 'Support email']::text[], false, true, 330),
('gmb-pro', 'Google My Business', 'Référencement Local', 'Optimisation complète et gestion mensuelle de la fiche Google My Business — photos professionnelles, horaires à jour, posts hebdomadaires, réponses aux avis, catégories optimisées. La fiche GMB est souvent la première chose que voit un client avant même le site web.', 'Pro', 6900, null, 1, 1, 0, array['Tout Starter inclus', '1 post Google/semaine', 'Réponses aux avis incluses', 'Rapport mensuel visibilité', 'Support prioritaire']::text[], true, true, 340),
('gmb-premium', 'Google My Business', 'Référencement Local', 'Optimisation complète et gestion mensuelle de la fiche Google My Business — photos professionnelles, horaires à jour, posts hebdomadaires, réponses aux avis, catégories optimisées. La fiche GMB est souvent la première chose que voit un client avant même le site web.', 'Premium', 11900, null, 1, 1, 12, array['Tout Pro inclus', 'Photos pro mensuelles', 'Multi-établissements', 'Stratégie saisonnière', 'Manager dédié']::text[], false, true, 350),
('reseaux-sociaux-starter', 'Contenu Réseaux Sociaux', 'Marketing Digital', 'Création et publication de 12 posts par mois sur Instagram et Facebook — visuels professionnels, textes engageants, hashtags optimisés. Le commerçant n''a rien à faire : il envoie quelques photos de son établissement une fois, on s''occupe de tout le reste chaque mois.', 'Starter', 4900, null, 1, 1, 0, array['8 posts/mois', 'Instagram ou Facebook', 'Visuels professionnels', 'Support email']::text[], false, true, 360),
('reseaux-sociaux-pro', 'Contenu Réseaux Sociaux', 'Marketing Digital', 'Création et publication de 12 posts par mois sur Instagram et Facebook — visuels professionnels, textes engageants, hashtags optimisés. Le commerçant n''a rien à faire : il envoie quelques photos de son établissement une fois, on s''occupe de tout le reste chaque mois.', 'Pro', 9900, null, 1, 1, 0, array['12 posts/mois', 'Instagram + Facebook', 'Stories incluses', 'Rapport engagement mensuel', 'Support prioritaire']::text[], true, true, 370),
('reseaux-sociaux-premium', 'Contenu Réseaux Sociaux', 'Marketing Digital', 'Création et publication de 12 posts par mois sur Instagram et Facebook — visuels professionnels, textes engageants, hashtags optimisés. Le commerçant n''a rien à faire : il envoie quelques photos de son établissement une fois, on s''occupe de tout le reste chaque mois.', 'Premium', 19900, null, 1, 1, 12, array['20 posts/mois', 'Toutes plateformes', 'Reels et vidéos courtes', 'Community management', 'Manager dédié']::text[], false, true, 380);

-- -----------------------------------------------------------------------------
-- Deals, paiements, commissions, virements
-- -----------------------------------------------------------------------------

create table public.deals (
  id                   uuid primary key default gen_random_uuid(),
  reference            text not null unique,
  stacker_id           uuid references public.profiles (id) on delete set null,
  claim_id             uuid references public.prospect_claims (id) on delete set null,
  offer_id             text not null references public.offers (id),
  offer_snapshot       jsonb not null,
  quantity             integer not null default 1,
  monthly_price_cents  integer not null,
  company_siret        text not null,
  company_name         text not null,
  company_address      text not null,
  contact_first_name   text not null,
  contact_last_name    text not null,
  contact_role         text not null,
  contact_email        text not null,
  contact_phone        text not null,
  iban_holder          text not null,
  iban_country         text not null,
  iban_last4           text not null,
  iban_enc             bytea not null,
  mandate_ref          text not null unique,
  contract_version     text not null,
  contract_text        text not null,
  contract_sha256      text not null,
  signature_png        text not null,
  signer_ip            text,
  signer_ua            text,
  signed_at            timestamptz not null default now(),
  withdrawal_until     timestamptz not null,
  status               public.deal_status not null default 'signe',
  activated_at         timestamptz,
  ended_at             timestamptz,
  end_reason           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint deals_quantity check (quantity between 1 and 10000),
  constraint deals_price check (monthly_price_cents between 100 and 100000000),
  constraint deals_siret check (company_siret ~ '^[0-9]{14}$'),
  constraint deals_sha check (contract_sha256 ~ '^[0-9a-f]{64}$')
);

create index deals_stacker_idx on public.deals (stacker_id, signed_at desc);
create index deals_stacker_day_idx on public.deals (stacker_id, created_at);

create table public.deal_payments (
  id            bigint generated always as identity primary key,
  deal_id       uuid not null references public.deals (id) on delete restrict,
  period        date not null,
  amount_cents  integer not null,
  provider_ref  text,
  paid_at       timestamptz not null default now(),
  constraint deal_payments_unique unique (deal_id, period),
  constraint deal_payments_period check (period = date_trunc('month', period)::date),
  constraint deal_payments_amount check (amount_cents between 1 and 100000000)
);

create table public.payouts (
  id            uuid primary key default gen_random_uuid(),
  stacker_id    uuid references public.profiles (id) on delete set null,
  amount_cents  integer not null,
  status        public.payout_status not null default 'demande',
  iban_last4    text not null,
  provider_ref  text,
  requested_at  timestamptz not null default now(),
  processed_at  timestamptz,
  constraint payouts_amount check (amount_cents > 0)
);

create unique index payouts_one_pending on public.payouts (stacker_id) where status = 'demande';

create table public.commission_entries (
  id                   bigint generated always as identity primary key,
  stacker_id           uuid references public.profiles (id) on delete set null,
  deal_id              uuid not null references public.deals (id) on delete restrict,
  payment_id           bigint not null unique references public.deal_payments (id) on delete restrict,
  period               date not null,
  client_amount_cents  integer not null,
  rate_bps             integer not null,
  amount_cents         integer not null,
  status               public.commission_status not null default 'disponible',
  available_at         timestamptz not null default now(),
  payout_id            uuid references public.payouts (id) on delete set null,
  created_at           timestamptz not null default now(),
  constraint commission_entries_rate check (rate_bps between 0 and 10000),
  constraint commission_entries_amount check (amount_cents >= 0)
);

create index commission_entries_stacker_idx on public.commission_entries (stacker_id, created_at desc);

create table public.payout_accounts (
  stacker_id  uuid primary key references public.profiles (id) on delete cascade,
  holder      text not null,
  iban_last4  text not null,
  iban_enc    bytea not null,
  updated_at  timestamptz not null default now()
);

insert into public.app_secrets (name, value) values ('iban_key', extensions.gen_random_bytes(32));

revoke all on table public.deal_settings, public.offers, public.deals, public.deal_payments, public.commission_entries,
  public.payouts, public.payout_accounts
  from public, anon, authenticated, service_role;
revoke all on sequence public.deal_payments_id_seq, public.commission_entries_id_seq from public, anon, authenticated, service_role;

alter table public.deal_settings enable row level security;
alter table public.deal_settings force row level security;
alter table public.offers enable row level security;
alter table public.offers force row level security;
alter table public.deals enable row level security;
alter table public.deals force row level security;
alter table public.deal_payments enable row level security;
alter table public.deal_payments force row level security;
alter table public.commission_entries enable row level security;
alter table public.commission_entries force row level security;
alter table public.payouts enable row level security;
alter table public.payouts force row level security;
alter table public.payout_accounts enable row level security;
alter table public.payout_accounts force row level security;

-- Propriétaire (migrations, fonctions SECURITY DEFINER) uniquement.
create policy deal_settings_owner on public.deal_settings for all to postgres using (true) with check (true);
create policy offers_owner on public.offers for all to postgres using (true) with check (true);
create policy deals_owner on public.deals for all to postgres using (true) with check (true);
create policy deal_payments_owner on public.deal_payments for all to postgres using (true) with check (true);
create policy commission_entries_owner on public.commission_entries for all to postgres using (true) with check (true);
create policy payouts_owner on public.payouts for all to postgres using (true) with check (true);
create policy payout_accounts_owner on public.payout_accounts for all to postgres using (true) with check (true);

-- -----------------------------------------------------------------------------
-- Aides : IBAN, montants, en-têtes de requête
-- -----------------------------------------------------------------------------

create function public.iban_normalize(p_iban text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_iban, ''), '[\s.-]', '', 'g'));
$$;

-- Clé de contrôle ISO 13616 (modulo 97 = 1), longueur par pays pour les pays SEPA courants.
create function public.iban_is_valid(p_iban text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := public.iban_normalize(p_iban);
  v_len integer;
  v_r text;
  v_rem bigint := 0;
  ch text;
  i integer;
begin
  if v !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' then
    return false;
  end if;
  v_len := case left(v, 2)
    when 'FR' then 27 when 'MC' then 27 when 'BE' then 16 when 'LU' then 20 when 'DE' then 22 when 'ES' then 24
    when 'IT' then 27 when 'NL' then 18 when 'PT' then 25 when 'CH' then 21 when 'AT' then 20 when 'IE' then 22
    when 'GP' then 27 when 'MQ' then 27 when 'GF' then 27 when 'RE' then 27 when 'YT' then 27
    else null end;
  if v_len is null or length(v) <> v_len then
    return false;
  end if;
  v_r := substr(v, 5) || substr(v, 1, 4);
  for i in 1 .. length(v_r) loop
    ch := substr(v_r, i, 1);
    if ch ~ '[0-9]' then
      v_rem := (v_rem * 10 + ch::integer) % 97;
    else
      v_rem := (v_rem * 100 + (ascii(ch) - 55)) % 97;
    end if;
  end loop;
  return v_rem = 1;
end;
$$;

create function public.eur(p_cents integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace((p_cents / 100)::text, '(\d)(?=(\d{3})+$)', '\1 ', 'g')
         || ',' || lpad((abs(p_cents) % 100)::text, 2, '0') || ' €';
$$;

create function public.iban_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(s.value, 'hex') from public.app_secrets s where s.name = 'iban_key';
$$;

create function public.request_header(p_name text)
returns text
language sql
stable
set search_path = ''
as $$
  select left(nullif(btrim(split_part(coalesce((current_setting('request.headers', true))::json ->> p_name, ''), ',', 1)), ''), 300);
$$;

create function public.deal_rate_bps(p_stacker uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select t.rate_bps from public.profiles p join public.commission_tiers t on t.code = p.tier where p.id = p_stacker), 0);
$$;

-- -----------------------------------------------------------------------------
-- Validation des données saisies et rendu du contrat
-- -----------------------------------------------------------------------------

-- Valide et normalise la saisie du stacker (consentements exigés à la signature). Renvoie un objet complet
-- (offre, prix, coordonnées normalisées, IBAN normalisé) ou lève un code.
create function public.deal_validate(p_input jsonb, p_require_consent boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.offers%rowtype;
  v_qty integer;
  v_siret text := regexp_replace(coalesce(p_input ->> 'siret', ''), '\s', '', 'g');
  v_email text := lower(btrim(coalesce(p_input ->> 'email', '')));
  v_phone text := btrim(coalesce(p_input ->> 'phone', ''));
  v_iban text := public.iban_normalize(p_input ->> 'iban');
  v_name text := btrim(coalesce(p_input ->> 'company_name', ''));
  v_addr text := btrim(coalesce(p_input ->> 'company_address', ''));
  v_first text := btrim(coalesce(p_input ->> 'first_name', ''));
  v_last text := btrim(coalesce(p_input ->> 'last_name', ''));
  v_role text := btrim(coalesce(p_input ->> 'role', ''));
  v_holder text := btrim(coalesce(p_input ->> 'iban_holder', ''));
begin
  if jsonb_typeof(p_input) is distinct from 'object' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  select * into o from public.offers x where x.id = p_input ->> 'offer_id' and x.active;
  if not found then
    raise exception 'offer_unavailable' using errcode = 'P0002';
  end if;
  begin
    v_qty := coalesce((p_input ->> 'quantity')::integer, 1);
  exception when others then
    raise exception 'invalid_quantity' using errcode = '22023';
  end;
  if v_qty < o.qty_min or v_qty > o.qty_max then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;
  if not public.siret_is_valid(v_siret) then
    raise exception 'invalid_siret' using errcode = '22023';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'invalid_company' using errcode = '22023';
  end if;
  if char_length(v_addr) not between 5 and 200 then
    raise exception 'invalid_address' using errcode = '22023';
  end if;
  if char_length(v_first) not between 1 and 50 or char_length(v_last) not between 1 and 80 then
    raise exception 'invalid_contact' using errcode = '22023';
  end if;
  if char_length(v_role) not between 2 and 60 then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if v_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' or char_length(v_email) > 254 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'invalid_phone' using errcode = '22023';
  end if;
  if char_length(v_holder) not between 2 and 120 then
    raise exception 'invalid_holder' using errcode = '22023';
  end if;
  if not public.iban_is_valid(v_iban) then
    raise exception 'invalid_iban' using errcode = '22023';
  end if;
  if p_require_consent and (coalesce((p_input ->> 'accept_terms')::boolean, false) is not true
     or coalesce((p_input ->> 'accept_mandate')::boolean, false) is not true) then
    raise exception 'consent_required' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'offer', to_jsonb(o), 'quantity', v_qty, 'monthly_price_cents', o.price_cents * v_qty,
    'siret', v_siret, 'company_name', v_name, 'company_address', v_addr,
    'first_name', v_first, 'last_name', v_last, 'role', v_role, 'email', v_email, 'phone', v_phone,
    'iban', v_iban, 'iban_holder', v_holder,
    'claim_id', nullif(p_input ->> 'claim_id', '')
  );
end;
$$;

-- Rend le contrat pour une saisie validée (même texte en aperçu et à la signature).
create function public.deal_render_contract(p_v jsonb, p_reference text, p_rum text, p_stacker uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.deal_settings%rowtype;
  v_text text;
  v_offer jsonb := p_v -> 'offer';
  v_eng integer := (v_offer ->> 'engagement_months')::integer;
  v_qty integer := (p_v ->> 'quantity')::integer;
  v_apporteur text;
  v_vars jsonb;
  k text;
begin
  select * into s from public.deal_settings where id;
  select coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'un stacker') into v_apporteur
  from public.profiles p where p.id = p_stacker;
  v_vars := jsonb_build_object(
    'reference', p_reference,
    'version', s.contract_version,
    'date', to_char(public.paris_today(), 'DD/MM/YYYY'),
    'prestataire', (select ps.sender_entity from public.prospect_settings ps where ps.id),
    'client_raison_sociale', p_v ->> 'company_name',
    'client_siret', p_v ->> 'siret',
    'client_adresse', p_v ->> 'company_address',
    'client_representant', (p_v ->> 'first_name') || ' ' || (p_v ->> 'last_name'),
    'client_qualite', p_v ->> 'role',
    'client_telephone', p_v ->> 'phone',
    'client_email', p_v ->> 'email',
    'offre', (v_offer ->> 'brand') || ' — ' || (v_offer ->> 'name'),
    'offre_details', coalesce(nullif(array_to_string(array(select jsonb_array_elements_text(v_offer -> 'features')), ' ; '), ''), (v_offer ->> 'category')),
    'quantite_ligne', case when v_offer ->> 'unit_label' is null then ''
                           else 'Quantité : ' || v_qty || ' ' || (v_offer ->> 'unit_label') || case when v_qty > 1 then 's' else '' end
                                || ' à ' || public.eur((v_offer ->> 'price_cents')::integer) || ' par ' || (v_offer ->> 'unit_label') || ' et par mois.' || chr(10) end,
    'prix_mensuel', public.eur((p_v ->> 'monthly_price_cents')::integer),
    'engagement', case when v_eng = 0 then 'Sans engagement : le contrat est conclu pour une durée indéterminée, résiliable à tout moment.'
                       else 'Engagement de ' || v_eng || ' mois à compter du premier prélèvement, puis reconduction tacite de mois en mois.' end,
    'retractation', s.withdrawal_days::text,
    'apporteur', v_apporteur,
    'rum', p_rum,
    'titulaire', p_v ->> 'iban_holder',
    'iban_masque', left(p_v ->> 'iban', 4) || ' •••• •••• ' || right(p_v ->> 'iban', 4)
  );
  v_text := s.contract_template;
  for k in select jsonb_object_keys(v_vars) loop
    v_text := replace(v_text, '{{' || k || '}}', coalesce(v_vars ->> k, ''));
  end loop;
  return v_text;
end;
$$;

-- Référence lisible pour l'aperçu : stable pour une même saisie et un même
-- jour, afin que le texte signé soit exactement celui affiché.
create function public.deal_preview_refs(p_v jsonb, p_stacker uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  select array[
    'STK-' || upper(substr(encode(extensions.digest(p_stacker::text || (p_v ->> 'siret') || (p_v -> 'offer' ->> 'id') || public.paris_today()::text, 'sha256'), 'hex'), 1, 8)),
    'STKM' || upper(substr(encode(extensions.digest('rum' || p_stacker::text || (p_v ->> 'siret') || (p_v ->> 'iban') || public.paris_today()::text, 'sha256'), 'hex'), 1, 16))
  ];
$$;

-- -----------------------------------------------------------------------------
-- Stacker : catalogue, aperçu, signature, suivi
-- -----------------------------------------------------------------------------

create function public.deal_require_stacker()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.onboarding_completed_at is not null) then
    raise exception 'onboarding_required' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create function public.deal_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.deal_require_stacker();
begin
  return jsonb_build_object(
    'rate_bps', public.deal_rate_bps(v_uid),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'brand', o.brand, 'category', o.category, 'description', o.description, 'name', o.name,
        'price_cents', o.price_cents, 'unit_label', o.unit_label, 'qty_min', o.qty_min, 'qty_max', o.qty_max,
        'engagement_months', o.engagement_months, 'features', to_jsonb(o.features), 'recommended', o.recommended) order by o.sort_order)
      from public.offers o where o.active), '[]'::jsonb)
  );
end;
$$;

create function public.deal_preview(p_input jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.deal_require_stacker();
  v jsonb := public.deal_validate(p_input, false);
  v_refs text[] := public.deal_preview_refs(v, v_uid);
  v_text text := public.deal_render_contract(v, v_refs[1], v_refs[2], v_uid);
  v_rate integer := public.deal_rate_bps(v_uid);
begin
  return jsonb_build_object(
    'reference', v_refs[1], 'mandate_ref', v_refs[2],
    'contract_text', v_text, 'contract_sha256', encode(extensions.digest(v_text, 'sha256'), 'hex'),
    'monthly_price_cents', (v ->> 'monthly_price_cents')::integer,
    'rate_bps', v_rate,
    'commission_cents', ((v ->> 'monthly_price_cents')::integer * v_rate) / 10000
  );
end;
$$;

create function public.deal_sign(p_input jsonb, p_signature text, p_contract_sha256 text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.deal_require_stacker();
  s public.deal_settings%rowtype;
  v jsonb;
  v_refs text[];
  v_text text;
  v_sha text;
  v_claim uuid;
  v_id uuid;
  v_rate integer;
begin
  select * into s from public.deal_settings where id;
  if (select count(*) from public.deals d where d.stacker_id = v_uid and d.created_at >= now() - interval '24 hours') >= s.max_deals_per_day then
    raise exception 'daily_quota' using errcode = '54000';
  end if;
  v := public.deal_validate(p_input, true);
  if p_signature is null or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$'
     or char_length(p_signature) not between 1500 and 400000 then
    raise exception 'invalid_signature' using errcode = '22023';
  end if;
  v_refs := public.deal_preview_refs(v, v_uid);
  if exists (select 1 from public.deals d where d.reference = v_refs[1] or d.mandate_ref = v_refs[2]) then
    raise exception 'already_signed' using errcode = '23505';
  end if;
  v_text := public.deal_render_contract(v, v_refs[1], v_refs[2], v_uid);
  v_sha := encode(extensions.digest(v_text, 'sha256'), 'hex');
  if p_contract_sha256 is distinct from v_sha then
    raise exception 'contract_changed' using errcode = '40001';
  end if;
  if v ->> 'claim_id' is not null then
    begin
      v_claim := (v ->> 'claim_id')::uuid;
    exception when others then
      raise exception 'not_found' using errcode = 'P0002';
    end;
    if not exists (select 1 from public.prospect_claims c where c.id = v_claim and c.stacker_id = v_uid and c.released_at is null and c.status <> 'signe') then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.deals (
    reference, stacker_id, claim_id, offer_id, offer_snapshot, quantity, monthly_price_cents,
    company_siret, company_name, company_address, contact_first_name, contact_last_name, contact_role, contact_email, contact_phone,
    iban_holder, iban_country, iban_last4, iban_enc, mandate_ref,
    contract_version, contract_text, contract_sha256, signature_png, signer_ip, signer_ua, withdrawal_until
  ) values (
    v_refs[1], v_uid, v_claim, v -> 'offer' ->> 'id', v -> 'offer', (v ->> 'quantity')::integer, (v ->> 'monthly_price_cents')::integer,
    v ->> 'siret', v ->> 'company_name', v ->> 'company_address', v ->> 'first_name', v ->> 'last_name', v ->> 'role', v ->> 'email', v ->> 'phone',
    v ->> 'iban_holder', left(v ->> 'iban', 2), right(v ->> 'iban', 4),
    extensions.pgp_sym_encrypt(v ->> 'iban', public.iban_key()), v_refs[2],
    s.contract_version, v_text, v_sha, p_signature,
    public.request_header('x-forwarded-for'), public.request_header('user-agent'),
    now() + make_interval(days => s.withdrawal_days)
  ) returning id into v_id;

  if v_claim is not null then
    perform public.prospect_mark_signed(v_claim, v_refs[1]);
  end if;

  v_rate := public.deal_rate_bps(v_uid);
  return jsonb_build_object(
    'id', v_id, 'reference', v_refs[1],
    'monthly_price_cents', (v ->> 'monthly_price_cents')::integer,
    'rate_bps', v_rate,
    'commission_cents', ((v ->> 'monthly_price_cents')::integer * v_rate) / 10000
  );
end;
$$;

create function public.my_deals()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.deal_require_stacker();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'reference', d.reference, 'status', d.status, 'company_name', d.company_name,
      'offer_label', (d.offer_snapshot ->> 'brand') || ' · ' || (d.offer_snapshot ->> 'name'),
      'monthly_price_cents', d.monthly_price_cents, 'signed_at', d.signed_at, 'activated_at', d.activated_at,
      'withdrawal_until', d.withdrawal_until,
      'earned_cents', coalesce((select sum(e.amount_cents) from public.commission_entries e where e.deal_id = d.id), 0)
    ) order by d.signed_at desc)
    from public.deals d where d.stacker_id = v_uid), '[]'::jsonb);
end;
$$;

create function public.deal_detail(p_deal uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.deal_require_stacker();
  d public.deals%rowtype;
begin
  select * into d from public.deals x where x.id = p_deal and x.stacker_id = v_uid;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', d.id, 'reference', d.reference, 'status', d.status, 'claim_id', d.claim_id,
    'offer', d.offer_snapshot, 'quantity', d.quantity, 'monthly_price_cents', d.monthly_price_cents,
    'company_name', d.company_name, 'company_siret', d.company_siret, 'company_address', d.company_address,
    'contact_name', d.contact_first_name || ' ' || d.contact_last_name, 'contact_role', d.contact_role,
    'contact_email', d.contact_email, 'contact_phone', d.contact_phone,
    'iban_masked', d.iban_country || '•• •••• ' || d.iban_last4, 'mandate_ref', d.mandate_ref,
    'contract_text', d.contract_text, 'contract_sha256', d.contract_sha256, 'signature_png', d.signature_png,
    'signed_at', d.signed_at, 'withdrawal_until', d.withdrawal_until, 'activated_at', d.activated_at,
    'ended_at', d.ended_at,
    'payments', coalesce((select jsonb_agg(jsonb_build_object('period', p.period, 'amount_cents', p.amount_cents, 'paid_at', p.paid_at,
                                                              'commission_cents', e.amount_cents, 'rate_bps', e.rate_bps) order by p.period desc)
                          from public.deal_payments p left join public.commission_entries e on e.payment_id = p.id
                          where p.deal_id = d.id), '[]'::jsonb)
  );
end;
$$;

create function public.my_earnings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.deal_require_stacker();
  v_rate integer := public.deal_rate_bps(v_uid);
begin
  return jsonb_build_object(
    'rate_bps', v_rate,
    'available_cents', coalesce((select sum(e.amount_cents) from public.commission_entries e where e.stacker_id = v_uid and e.status = 'disponible' and e.available_at <= now()), 0),
    'validating_cents', coalesce((select sum(e.amount_cents) from public.commission_entries e where e.stacker_id = v_uid and e.status = 'disponible' and e.available_at > now()), 0),
    'next_available_at', (select min(e.available_at) from public.commission_entries e where e.stacker_id = v_uid and e.status = 'disponible' and e.available_at > now()),
    'requested_cents', coalesce((select sum(e.amount_cents) from public.commission_entries e where e.stacker_id = v_uid and e.status = 'demandee'), 0),
    'paid_cents', coalesce((select sum(e.amount_cents) from public.commission_entries e where e.stacker_id = v_uid and e.status = 'versee'), 0),
    'monthly_cents', coalesce((select sum(d.monthly_price_cents) from public.deals d where d.stacker_id = v_uid and d.status = 'actif'), 0) * v_rate / 10000,
    'pending_monthly_cents', coalesce((select sum(d.monthly_price_cents) from public.deals d where d.stacker_id = v_uid and d.status = 'signe'), 0) * v_rate / 10000,
    'signed_count', (select count(*) from public.deals d where d.stacker_id = v_uid and d.status in ('signe', 'actif', 'suspendu')),
    'active_count', (select count(*) from public.deals d where d.stacker_id = v_uid and d.status = 'actif'),
    'min_payout_cents', (select s.min_payout_cents from public.deal_settings s where s.id),
    'payout_account', (select jsonb_build_object('holder', a.holder, 'iban_last4', a.iban_last4) from public.payout_accounts a where a.stacker_id = v_uid),
    'entries', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select jsonb_build_object('id', e.id, 'period', e.period, 'amount_cents', e.amount_cents, 'rate_bps', e.rate_bps,
                                  'client_amount_cents', e.client_amount_cents, 'status', e.status, 'created_at', e.created_at,
                                  'available_at', e.available_at,
                                  'company_name', d.company_name, 'deal_id', d.id) j, e.created_at
        from public.commission_entries e join public.deals d on d.id = e.deal_id
        where e.stacker_id = v_uid order by e.created_at desc limit 100) x), '[]'::jsonb),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'amount_cents', p.amount_cents, 'status', p.status, 'iban_last4', p.iban_last4,
                                          'requested_at', p.requested_at, 'processed_at', p.processed_at) order by p.requested_at desc)
      from public.payouts p where p.stacker_id = v_uid), '[]'::jsonb)
  );
end;
$$;

create function public.payout_set_account(p_holder text, p_iban text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.deal_require_stacker();
  v_iban text := public.iban_normalize(p_iban);
  v_holder text := btrim(coalesce(p_holder, ''));
begin
  if char_length(v_holder) not between 2 and 120 then
    raise exception 'invalid_holder' using errcode = '22023';
  end if;
  if not public.iban_is_valid(v_iban) then
    raise exception 'invalid_iban' using errcode = '22023';
  end if;
  if exists (select 1 from public.payouts p where p.stacker_id = v_uid and p.status = 'demande') then
    raise exception 'payout_pending' using errcode = '55000';
  end if;
  insert into public.payout_accounts (stacker_id, holder, iban_last4, iban_enc)
  values (v_uid, v_holder, right(v_iban, 4), extensions.pgp_sym_encrypt(v_iban, public.iban_key()))
  on conflict (stacker_id) do update
    set holder = excluded.holder, iban_last4 = excluded.iban_last4, iban_enc = excluded.iban_enc, updated_at = now();
end;
$$;

-- Demande de virement de tout le solde disponible (commissions dont le délai est passé).
create function public.payout_request()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.deal_require_stacker();
  a public.payout_accounts%rowtype;
  v_amount integer;
  v_id uuid;
begin
  select * into a from public.payout_accounts x where x.stacker_id = v_uid;
  if not found then
    raise exception 'payout_account_required' using errcode = '55000';
  end if;
  if exists (select 1 from public.payouts p where p.stacker_id = v_uid and p.status = 'demande') then
    raise exception 'payout_pending' using errcode = '55000';
  end if;
  perform 1 from public.commission_entries e where e.stacker_id = v_uid and e.status = 'disponible' and e.available_at <= now() for update;
  select coalesce(sum(e.amount_cents), 0) into v_amount from public.commission_entries e
  where e.stacker_id = v_uid and e.status = 'disponible' and e.available_at <= now();
  if v_amount < (select s.min_payout_cents from public.deal_settings s where s.id) or v_amount <= 0 then
    raise exception 'payout_too_small' using errcode = '22023';
  end if;
  insert into public.payouts (stacker_id, amount_cents, iban_last4) values (v_uid, v_amount, a.iban_last4) returning id into v_id;
  update public.commission_entries e set status = 'demandee', payout_id = v_id
  where e.stacker_id = v_uid and e.status = 'disponible' and e.available_at <= now();
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Serveur (webhook Mollie, admin) : paiements, statuts, virements
-- -----------------------------------------------------------------------------

create function public.deal_refresh_active_clients(p_stacker uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.profiles p
  set active_clients = (select count(*) from public.deals d where d.stacker_id = p_stacker and d.status = 'actif')
  where p.id = p_stacker;
$$;

-- Enregistre le paiement du client pour un mois : crée la commission au taux
-- du niveau ACTUEL du stacker, active le client au premier paiement.
-- Idempotent par (deal, mois) : renvoie l'id du paiement existant.
create function public.deal_record_payment(p_deal uuid, p_period date, p_amount_cents integer, p_provider_ref text)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d public.deals%rowtype;
  v_period date := date_trunc('month', p_period)::date;
  v_pay bigint;
  v_rate integer;
begin
  select * into d from public.deals x where x.id = p_deal for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if d.status in ('resilie', 'annule') then
    raise exception 'deal_closed' using errcode = '55000';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  select p.id into v_pay from public.deal_payments p where p.deal_id = d.id and p.period = v_period;
  if found then
    return v_pay;
  end if;
  insert into public.deal_payments (deal_id, period, amount_cents, provider_ref)
  values (d.id, v_period, p_amount_cents, left(p_provider_ref, 200)) returning id into v_pay;
  if d.stacker_id is not null then
    v_rate := public.deal_rate_bps(d.stacker_id);
    insert into public.commission_entries (stacker_id, deal_id, payment_id, period, client_amount_cents, rate_bps, amount_cents, available_at)
    select d.stacker_id, d.id, v_pay, v_period, p_amount_cents, v_rate, (p_amount_cents * v_rate) / 10000,
           now() + make_interval(days => case when d.status = 'signe' then s.availability_days_new_client else s.availability_days end)
    from public.deal_settings s where s.id;
  end if;
  if d.status in ('signe', 'suspendu') then
    update public.deals set status = 'actif', activated_at = coalesce(activated_at, now()), updated_at = now() where id = d.id;
    if d.stacker_id is not null then
      perform public.deal_refresh_active_clients(d.stacker_id);
    end if;
  end if;
  return v_pay;
end;
$$;

create function public.deal_set_status(p_deal uuid, p_status public.deal_status, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d public.deals%rowtype;
begin
  select * into d from public.deals x where x.id = p_deal for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_status = 'actif' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if d.status in ('resilie', 'annule') then
    raise exception 'deal_closed' using errcode = '55000';
  end if;
  if p_status = 'annule' and d.status <> 'signe' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  update public.deals
  set status = p_status, updated_at = now(),
      ended_at = case when p_status in ('resilie', 'annule') then now() else ended_at end,
      end_reason = case when p_status in ('resilie', 'annule', 'suspendu') then left(p_reason, 300) else end_reason end
  where id = d.id;
  if d.stacker_id is not null then
    perform public.deal_refresh_active_clients(d.stacker_id);
  end if;
end;
$$;

create function public.payout_mark(p_payout uuid, p_status public.payout_status, p_provider_ref text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.payouts%rowtype;
begin
  select * into p from public.payouts x where x.id = p_payout for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p.status <> 'demande' or p_status = 'demande' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  update public.payouts set status = p_status, processed_at = now(), provider_ref = left(p_provider_ref, 200) where id = p.id;
  if p_status = 'verse' then
    update public.commission_entries set status = 'versee' where payout_id = p.id;
  else
    update public.commission_entries set status = 'disponible', payout_id = null where payout_id = p.id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Export RGPD : ajoute deals (sans IBAN client), commissions et virements
-- -----------------------------------------------------------------------------

create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_out jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'format', 'stacker-export-v1',
    'exported_at', now(),
    'account', (
      select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at, 'email_confirmed_at', u.email_confirmed_at)
      from auth.users u where u.id = v_uid
    ),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'purpose', c.purpose, 'granted', c.granted, 'document_version', c.document_version,
        'source', c.source, 'created_at', c.created_at) order by c.id)
      from public.user_consents c where c.user_id = v_uid
    ), '[]'::jsonb),
    'waitlist', (
      select jsonb_build_object(
        'first_name', w.first_name, 'department', w.department, 'referral_code', w.referral_code,
        'created_at', w.created_at,
        'consents', coalesce((
          select jsonb_agg(jsonb_build_object(
            'purpose', wc.purpose, 'granted', wc.granted, 'document_version', wc.document_version, 'created_at', wc.created_at)
            order by wc.id)
          from public.consents wc where wc.waitlist_id = w.id
        ), '[]'::jsonb))
      from public.profiles p join public.waitlist w on w.id = p.waitlist_id
      where p.id = v_uid
    ),
    'mailbox', (select jsonb_build_object('provider', a.provider, 'email', a.email, 'connected_at', a.connected_at)
                from public.mail_accounts a where a.stacker_id = v_uid),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('department', k.department, 'preset', k.preset, 'daily_target', k.daily_target,
                                                                'status', k.status, 'created_at', k.created_at) order by k.created_at)
                           from public.campaigns k where k.stacker_id = v_uid), '[]'::jsonb),
    'prospects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'siret', c.siret, 'status', c.status, 'claimed_at', c.claimed_at, 'released_at', c.released_at,
        'release_reason', c.release_reason, 'contact_phone', c.contact_phone, 'contact_email', c.contact_email,
        'contact_source', c.contact_source,
        'notes', coalesce((select jsonb_agg(jsonb_build_object('body', n.body, 'created_at', n.created_at) order by n.created_at)
                           from public.prospect_notes n where n.claim_id = c.id), '[]'::jsonb),
        'emails', coalesce((select jsonb_agg(jsonb_build_object('subject', m.subject, 'recipient', m.recipient, 'created_at', m.created_at,
                                                                'marked_sent_at', m.marked_sent_at) order by m.created_at)
                            from public.prospect_emails m where m.claim_id = c.id), '[]'::jsonb)
      ) order by c.claimed_at)
      from public.prospect_claims c where c.stacker_id = v_uid
    ), '[]'::jsonb),
    'deals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reference', d.reference, 'status', d.status, 'company_name', d.company_name, 'company_siret', d.company_siret,
        'offer', (d.offer_snapshot ->> 'brand') || ' · ' || (d.offer_snapshot ->> 'name'),
        'monthly_price_cents', d.monthly_price_cents, 'signed_at', d.signed_at, 'activated_at', d.activated_at, 'ended_at', d.ended_at
      ) order by d.signed_at)
      from public.deals d where d.stacker_id = v_uid
    ), '[]'::jsonb),
    'commissions', coalesce((
      select jsonb_agg(jsonb_build_object('period', e.period, 'amount_cents', e.amount_cents, 'rate_bps', e.rate_bps,
                                          'status', e.status, 'created_at', e.created_at) order by e.created_at)
      from public.commission_entries e where e.stacker_id = v_uid
    ), '[]'::jsonb),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object('amount_cents', p.amount_cents, 'status', p.status, 'iban_last4', p.iban_last4,
                                          'requested_at', p.requested_at, 'processed_at', p.processed_at) order by p.requested_at)
      from public.payouts p where p.stacker_id = v_uid
    ), '[]'::jsonb),
    'payout_account', (select jsonb_build_object('holder', a.holder, 'iban_last4', a.iban_last4, 'updated_at', a.updated_at)
                       from public.payout_accounts a where a.stacker_id = v_uid)
  ) into v_out;
  return v_out;
end;
$$;

-- -----------------------------------------------------------------------------
-- Privilèges des fonctions
-- -----------------------------------------------------------------------------

revoke all on function
  public.iban_normalize(text), public.iban_is_valid(text), public.eur(integer), public.iban_key(), public.request_header(text),
  public.deal_rate_bps(uuid), public.deal_validate(jsonb, boolean), public.deal_render_contract(jsonb, text, text, uuid),
  public.deal_preview_refs(jsonb, uuid), public.deal_require_stacker(), public.deal_catalog(), public.deal_preview(jsonb),
  public.deal_sign(jsonb, text, text), public.my_deals(), public.deal_detail(uuid), public.my_earnings(),
  public.payout_set_account(text, text), public.payout_request(), public.deal_refresh_active_clients(uuid),
  public.deal_record_payment(uuid, date, integer, text), public.deal_set_status(uuid, public.deal_status, text),
  public.payout_mark(uuid, public.payout_status, text)
  from public, anon, authenticated, service_role;

grant execute on function
  public.deal_catalog(), public.deal_preview(jsonb), public.deal_sign(jsonb, text, text), public.my_deals(),
  public.deal_detail(uuid), public.my_earnings(), public.payout_set_account(text, text), public.payout_request()
  to authenticated;

grant execute on function
  public.deal_record_payment(uuid, date, integer, text), public.deal_set_status(uuid, public.deal_status, text),
  public.payout_mark(uuid, public.payout_status, text)
  to service_role;
