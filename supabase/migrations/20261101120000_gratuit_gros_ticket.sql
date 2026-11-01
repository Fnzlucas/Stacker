-- =============================================================================
-- Stacker — Formule gratuite et offres gros ticket
--
--   * Formule gratuite : tout stacker inscrit peut faire signer des clients et
--     toucher ses commissions, aux mêmes taux (15 à 25 % selon son niveau),
--     sans abonnement. Seule condition gardée : l'appel d'habilitation réussi
--     avant la première signature (si l'interrupteur roleplay_required est
--     actif), ouvert à tous.
--     Pro reste nécessaire pour la prospection (recherche, réservation de
--     prospects, campagnes) ; Academy pour l'entraînement libre et la formation.
--   * Offres gros ticket (« Stacker Studio ») : prestations sur mesure payées en
--     une fois (offers.billing = 'unique'). Contrat de prestation dédié, un seul
--     prélèvement SEPA à la fin du délai de rétractation (abonnement Mollie
--     limité à un paiement), commission au taux du stacker sur le montant total,
--     disponible dès le prélèvement.
--     Ces clients ne comptent pas dans les « clients actifs » (niveaux) ni dans
--     le revenu mensuel récurrent.
-- =============================================================================

alter table public.offers add column billing text not null default 'mensuel';
alter table public.offers add constraint offers_billing check (billing in ('mensuel', 'unique'));
alter table public.offers add constraint offers_unique_shape check (billing = 'mensuel' or (engagement_months = 0 and qty_min = 1 and qty_max = 1));
comment on column public.offers.billing is
  'mensuel : abonnement prélevé chaque mois ; unique : prestation payée en une fois (price_cents = prix total).';

alter table public.deal_settings add column contract_template_unique text;

update public.deal_settings set contract_version = '2026-11-01', contract_template_unique = $tpl$CONTRAT DE PRESTATION ET MANDAT DE PRÉLÈVEMENT SEPA
Référence : {{reference}} · Modèle {{version}} · {{date}}

ENTRE
Le prestataire : {{prestataire}}, ci-après « Stacker ».
ET
Le client : {{client_raison_sociale}}, SIRET {{client_siret}}, {{client_adresse}}, représenté par {{client_representant}} ({{client_qualite}}), joignable au {{client_telephone}} et à {{client_email}}, ci-après « le Client ».

1. OBJET
Stacker réalise pour le Client la prestation suivante : {{offre}}.
Contenu : {{offre_details}}.

2. PRIX
Prix : {{prix_total}}, payable en une seule fois. TVA non applicable, art. 293 B du CGI.
Le prix est payé par un prélèvement SEPA unique, effectué à l'issue du délai de rétractation. Aucun autre prélèvement n'est prévu au titre de ce contrat.

3. RÉALISATION
Stacker contacte le Client dans les 5 jours ouvrés suivant le prélèvement pour recueillir ses contenus (textes, photos, logo, accès) et ses souhaits. Le délai de livraison indiqué dans le contenu de l'offre court à compter de la réception de ces éléments. Deux séries de corrections sont incluses. La livraison est réputée acceptée à la mise en ligne, ou 15 jours après sa présentation au Client sans réserve écrite de sa part.
Une fois le prix payé, le Client est propriétaire des contenus et du design créés pour lui. L'hébergement inclus est fourni pendant la durée indiquée dans l'offre ; au-delà, il peut être prolongé par un contrat distinct, sans aucune obligation.

4. DROIT DE RÉTRACTATION
Le Client dispose de {{retractation}} jours à compter de la signature pour se rétracter, sans motif ni frais, par email à stacker-contact@outlook.com. Aucun prélèvement n'intervient avant la fin de ce délai.

5. INEXÉCUTION
Si Stacker ne livre pas la prestation dans un délai raisonnable après mise en demeure restée sans effet pendant 30 jours, le Client peut résilier le contrat par écrit et obtenir le remboursement des sommes versées pour la part non réalisée. Si le prélèvement est rejeté et non régularisé sous 15 jours, Stacker peut suspendre la réalisation.

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
Type de paiement : récurrent ; un seul prélèvement est prévu au titre de ce contrat, d'un montant de {{prix_total}}.
Pré-notification : le présent contrat vaut information préalable du montant prélevé. Le Client est en outre prévenu par email au moins 2 jours avant le prélèvement, avec son montant et sa date.
En signant ce mandat, le Client autorise Stacker (via Mollie) à envoyer des instructions à sa banque pour débiter son compte, et sa banque à débiter son compte conformément à ces instructions. Le Client bénéficie du droit d'être remboursé par sa banque selon les conditions décrites dans la convention passée avec elle ; une demande de remboursement doit être présentée dans les 8 semaines suivant la date de débit de son compte pour un prélèvement autorisé.

Signé électroniquement le {{date}} par {{client_representant}}, pour {{client_raison_sociale}}.$tpl$;

alter table public.deal_settings alter column contract_template_unique set not null;

-- Catalogue gros ticket, en tête du catalogue. Prix modifiables dans la table offers.
insert into public.offers (id, brand, category, description, name, price_cents, unit_label, qty_min, qty_max, engagement_months, features, recommended, active, sort_order, billing) values
('studio-site-vitrine', 'Stacker Studio', 'Sur mesure · paiement unique',
 'Un site créé de zéro pour l''entreprise, à son image : pas un modèle rempli à la va-vite. Le commerçant paie une seule fois, sans abonnement, et le site lui appartient.',
 'Site vitrine sur mesure', 149000, null, 1, 1, 0,
 array['Design unique, créé pour l''entreprise', 'Jusqu''à 8 pages', 'Textes rédigés et optimisés pour Google', 'Formulaire de contact et fiche Google reliée', 'Livré en 3 semaines', '2 séries de corrections', 'Hébergement inclus 12 mois']::text[],
 true, true, 5, 'unique'),
('studio-site-ecommerce', 'Stacker Studio', 'Sur mesure · paiement unique',
 'Une boutique en ligne complète pour vendre en ligne ce que le commerçant vend déjà en magasin : produits, paiement, commandes. Payée une fois, sans commission sur les ventes.',
 'Site e-commerce sur mesure', 349000, null, 1, 1, 0,
 array['Design unique', 'Jusqu''à 100 produits mis en ligne', 'Paiement en ligne par carte', 'Gestion des stocks et des commandes', 'Livré en 5 semaines', '2 séries de corrections', 'Prise en main d''une heure', 'Hébergement inclus 12 mois']::text[],
 false, true, 6, 'unique'),
('studio-reservation', 'Stacker Studio', 'Sur mesure · paiement unique',
 'Pour les restaurants, salons, instituts et artisans : un site sur mesure avec réservation ou commande en ligne, rappels automatiques aux clients et acompte en ligne. Moins de rendez-vous oubliés, plus de commandes.',
 'Site + réservation ou commande en ligne', 499000, null, 1, 1, 0,
 array['Site vitrine sur mesure inclus', 'Réservation ou click & collect en ligne', 'Rappels SMS et emails aux clients', 'Acompte payé en ligne', 'Livré en 6 semaines', '2 séries de corrections', 'Hébergement inclus 12 mois']::text[],
 false, true, 7, 'unique'),
('studio-transformation', 'Stacker Studio', 'Sur mesure · paiement unique',
 'Tout le digital de l''entreprise refait d''un coup, par une seule équipe : identité visuelle, site avec réservation ou boutique, fiche Google, lancement sur les réseaux, puis 3 mois d''accompagnement.',
 'Pack transformation digitale', 990000, null, 1, 1, 0,
 array['Identité visuelle : logo, couleurs, cartes de visite', 'Site sur mesure avec réservation ou boutique', 'Fiche Google optimisée et QR code avis', 'Campagne de lancement sur les réseaux sociaux', '3 mois d''accompagnement', 'Livré en 8 semaines', 'Hébergement inclus 12 mois']::text[],
 false, true, 13, 'unique'),
('studio-image-de-marque', 'Stacker Studio', 'Sur mesure · paiement unique',
 'Tout ce qu''il faut pour donner envie : un logo et une identité visuelle propres, puis un shooting photo et vidéo dans l''établissement. Le commerçant repart avec des visuels pro pour sa vitrine, son site, Google et ses réseaux.',
 'Image de marque : logo, photos et vidéos', 199000, null, 1, 1, 0,
 array['Logo, couleurs et cartes de visite', 'Une demi-journée de shooting dans l''établissement', '30 photos retouchées', '3 vidéos courtes pour les réseaux', 'Livré en 4 semaines', 'Droits d''utilisation inclus']::text[],
 false, true, 9, 'unique'),
('studio-assistant-ia', 'Stacker Studio', 'Sur mesure · paiement unique',
 'Un assistant qui répond au téléphone et aux messages 24 h/24 quand le commerçant est occupé : il renseigne les clients, prend les rendez-vous ou les commandes et envoie un résumé. Plus aucun appel perdu.',
 'Assistant IA : appels et messages 24 h/24', 249000, null, 1, 1, 0,
 array['Répond au téléphone, sur WhatsApp et sur le site', 'Prend les rendez-vous ou les commandes', 'Résumé de chaque échange par SMS ou email', 'Paramétré avec les infos du commerce', 'Mis en place en 3 semaines', '12 mois d''utilisation inclus']::text[],
 false, true, 10, 'unique'),
('studio-campagne-pub', 'Stacker Studio', 'Sur mesure · paiement unique',
 'Une campagne de publicité Google et Facebook/Instagram montée de A à Z pour faire venir de nouveaux clients dans la zone du commerce, puis pilotée pendant 3 mois avec un point chaque mois.',
 'Campagne publicitaire Google + réseaux', 299000, null, 1, 1, 0,
 array['Stratégie et ciblage local', 'Annonces Google et Facebook/Instagram créées', 'Visuels et textes des publicités', 'Pilotage et optimisation pendant 3 mois', 'Bilan chaque mois', 'Budget publicitaire payé à part par le client']::text[],
 false, true, 11, 'unique'),
('studio-application', 'Stacker Studio', 'Sur mesure · paiement unique',
 'Une application iPhone et Android aux couleurs du commerce : commande ou réservation, carte de fidélité, notifications pour faire revenir les clients. Publiée sur l''App Store et Google Play.',
 'Application mobile sur mesure', 599000, null, 1, 1, 0,
 array['Application iPhone et Android', 'Commande, réservation ou prise de rendez-vous', 'Carte de fidélité intégrée', 'Notifications aux clients', 'Publication sur les stores', 'Livrée en 8 semaines', 'Hébergement inclus 12 mois']::text[],
 false, true, 12, 'unique'),
('studio-pack-complet', 'Stacker Studio', 'Sur mesure · paiement unique',
 'Le pack le plus complet : une image de marque créée de zéro, un site sur mesure et une application mobile iPhone et Android, le tout cohérent et livré par une seule équipe. Le commerçant n''a plus rien à faire côté digital.',
 'Pack complet : site + application + image de marque', 1240000, null, 1, 1, 0,
 array['Branding complet : logo, couleurs, typographies, supports', 'Shooting photo et vidéo dans l''établissement', 'Site sur mesure (vitrine, réservation ou boutique)', 'Application iPhone et Android avec fidélité et notifications', 'Publication sur l''App Store et Google Play', 'Fiche Google optimisée', 'Livré en 10 semaines', 'Hébergement inclus 12 mois']::text[],
 false, true, 14, 'unique');

create or replace function public.deal_preview(p_input jsonb)
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
    'billing', v -> 'offer' ->> 'billing',
    'rate_bps', v_rate,
    'commission_cents', ((v ->> 'monthly_price_cents')::integer * v_rate) / 10000
  );
end;
$$;

create or replace function public.deal_sign(p_input jsonb, p_signature text, p_contract_sha256 text)
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
    'billing', v -> 'offer' ->> 'billing',
    'rate_bps', v_rate,
    'commission_cents', ((v ->> 'monthly_price_cents')::integer * v_rate) / 10000
  );
end;
$$;

create or replace function public.deal_render_contract(p_v jsonb, p_reference text, p_rum text, p_stacker uuid)
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
    'prix_total', public.eur((p_v ->> 'monthly_price_cents')::integer),
    'engagement', case when v_eng = 0 then 'Sans engagement : le contrat est conclu pour une durée indéterminée, résiliable à tout moment.'
                       else 'Engagement de ' || v_eng || ' mois à compter du premier prélèvement, puis reconduction tacite de mois en mois.' end,
    'retractation', s.withdrawal_days::text,
    'apporteur', v_apporteur,
    'rum', p_rum,
    'titulaire', p_v ->> 'iban_holder',
    'iban_masque', left(p_v ->> 'iban', 4) || ' •••• •••• ' || right(p_v ->> 'iban', 4)
  );
  v_text := case when v_offer ->> 'billing' = 'unique' then s.contract_template_unique else s.contract_template end;
  for k in select jsonb_object_keys(v_vars) loop
    v_text := replace(v_text, '{{' || k || '}}', coalesce(v_vars ->> k, ''));
  end loop;
  return v_text;
end;
$$;

create or replace function public.deal_catalog()
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
        'engagement_months', o.engagement_months, 'features', to_jsonb(o.features), 'recommended', o.recommended, 'billing', o.billing) order by o.sort_order)
      from public.offers o where o.active), '[]'::jsonb)
  );
end;
$$;

create or replace function public.my_deals()
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
      'monthly_price_cents', d.monthly_price_cents, 'billing', coalesce(d.offer_snapshot ->> 'billing', 'mensuel'), 'signed_at', d.signed_at, 'activated_at', d.activated_at,
      'withdrawal_until', d.withdrawal_until,
      'earned_cents', coalesce((select sum(e.amount_cents) from public.commission_entries e where e.deal_id = d.id), 0)
    ) order by d.signed_at desc)
    from public.deals d where d.stacker_id = v_uid), '[]'::jsonb);
end;
$$;

create or replace function public.deal_refresh_active_clients(p_stacker uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.profiles p
  set active_clients = (select count(*) from public.deals d where d.stacker_id = p_stacker and d.status = 'actif'
                        and coalesce(d.offer_snapshot ->> 'billing', 'mensuel') = 'mensuel')
  where p.id = p_stacker;
$$;

create or replace function public.deal_mollie_pending(p_limit integer)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with picked as (
    select d.id from public.deals d
    where d.mollie_status = 'a_faire' and d.status in ('signe', 'actif') and d.mollie_attempts < 8
    order by d.signed_at limit greatest(1, least(p_limit, 100))
    for update skip locked
  ), bumped as (
    update public.deals d set mollie_attempts = d.mollie_attempts + 1
    from picked where d.id = picked.id
    returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'deal_id', b.id, 'reference', b.reference, 'customer_id', b.mollie_customer_id, 'mandate_id', b.mollie_mandate_id,
    'company_name', b.company_name, 'email', b.contact_email,
    'iban', extensions.pgp_sym_decrypt(b.iban_enc, public.iban_key()), 'iban_holder', b.iban_holder,
    'mandate_ref', b.mandate_ref, 'signed_on', (b.signed_at at time zone 'Europe/Paris')::date,
    'first_debit_on', greatest((b.withdrawal_until at time zone 'Europe/Paris')::date + 1, public.paris_today() + 3),
    'amount_cents', b.monthly_price_cents,
    'times', case when b.offer_snapshot ->> 'billing' = 'unique' then 1 end)), '[]'::jsonb)
  from bumped b;
$$;

create or replace function public.my_earnings()
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
    'monthly_cents', coalesce((select sum(d.monthly_price_cents) from public.deals d where d.stacker_id = v_uid and d.status = 'actif' and coalesce(d.offer_snapshot ->> 'billing', 'mensuel') = 'mensuel'), 0) * v_rate / 10000,
    'pending_monthly_cents', coalesce((select sum(d.monthly_price_cents) from public.deals d where d.stacker_id = v_uid and d.status = 'signe' and coalesce(d.offer_snapshot ->> 'billing', 'mensuel') = 'mensuel'), 0) * v_rate / 10000,
    -- En attente : contrats signés, débloqués dès le premier prélèvement du client.
    'pending_cents', coalesce((select sum(d.monthly_price_cents * v_rate / 10000) from public.deals d where d.stacker_id = v_uid and d.status = 'signe'), 0),
    'pending_deals', coalesce((
      select jsonb_agg(jsonb_build_object('deal_id', d.id, 'company_name', d.company_name, 'expected_cents', d.monthly_price_cents * v_rate / 10000,
                                          'one_time', d.offer_snapshot ->> 'billing' = 'unique',
                                          'first_debit_on', (d.withdrawal_until at time zone 'Europe/Paris')::date + 1, 'signed_at', d.signed_at)
                       order by d.signed_at desc)
      from public.deals d where d.stacker_id = v_uid and d.status = 'signe'), '[]'::jsonb),
    'signed_count', (select count(*) from public.deals d where d.stacker_id = v_uid and d.status in ('signe', 'actif', 'suspendu')),
    'active_count', (select count(*) from public.deals d where d.stacker_id = v_uid and d.status = 'actif'),
    'year_paid_cents', public.payout_year_total(v_uid),
    'siret_threshold_cents', (select s.siret_threshold_cents from public.deal_settings s where s.id),
    'siret_warning_cents', (select s.siret_warning_cents from public.deal_settings s where s.id),
    'has_siret', (select p.siret is not null from public.profiles p where p.id = v_uid),
    'min_payout_cents', (select s.min_payout_cents from public.deal_settings s where s.id),
    'payout_account', (select jsonb_build_object('holder', a.holder, 'iban_last4', a.iban_last4) from public.payout_accounts a where a.stacker_id = v_uid),
    'entries', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select jsonb_build_object('id', e.id, 'period', e.period, 'amount_cents', e.amount_cents, 'rate_bps', e.rate_bps,
                                  'client_amount_cents', e.client_amount_cents, 'status', e.status, 'created_at', e.created_at,
                                  'available_at', e.available_at, 'kind', e.kind,
                                  'company_name', d.company_name, 'deal_id', d.id) j, e.created_at
        from public.commission_entries e left join public.deals d on d.id = e.deal_id
        where e.stacker_id = v_uid order by e.created_at desc limit 100) x), '[]'::jsonb),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'amount_cents', p.amount_cents, 'status', p.status, 'iban_last4', p.iban_last4,
                                          'requested_at', p.requested_at, 'processed_at', p.processed_at) order by p.requested_at desc)
      from public.payouts p where p.stacker_id = v_uid), '[]'::jsonb)
  );
end;
$$;

-- Appel d'habilitation ouvert à tous les stackers (formule gratuite comprise).
create or replace function public.roleplay_start(p_stacker uuid, p_scenario text, p_opening text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.roleplay_settings%rowtype;
  v_id uuid;
begin
  select * into s from public.roleplay_settings where id;
  if not exists (select 1 from public.profiles p where p.id = p_stacker and p.onboarding_completed_at is not null) then
    raise exception 'onboarding_required' using errcode = '42501';
  end if;
  if (select p.ai_consent_at from public.profiles p where p.id = p_stacker) is null then
    raise exception 'consent_required' using errcode = '42501';
  end if;
  -- Formule Academy (ou Academy + Pro). Sans elle, seul l'appel d'habilitation
  -- exigé avant la première signature reste possible, pour tous les stackers
  -- (formule gratuite comprise : ils font signer des clients).
  if not public.stacker_has_academy(p_stacker)
     and not (public.app_flag('roleplay_required') and not public.roleplay_has_passed(p_stacker)) then
    raise exception 'academy_required' using errcode = 'P0001';
  end if;
  if p_scenario is null or p_scenario !~ '^[a-z0-9-]{2,40}$' or p_opening is null or char_length(p_opening) not between 1 and 400 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform 1 from public.profiles p where p.id = p_stacker for update;
  if (select count(*) from public.roleplay_sessions r
      where r.stacker_id = p_stacker and (r.started_at at time zone 'Europe/Paris')::date = public.paris_today()) >= s.sessions_per_day then
    raise exception 'daily_quota' using errcode = '54000';
  end if;
  if (select count(*) from public.roleplay_sessions r
      where r.started_at >= (date_trunc('month', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris')) >= s.monthly_sessions_cap then
    raise exception 'unavailable' using errcode = '54000';
  end if;
  update public.roleplay_sessions r set status = 'abandonnee', ended_at = now() where r.stacker_id = p_stacker and r.status = 'en_cours';
  insert into public.roleplay_sessions (stacker_id, scenario, turns)
  values (p_stacker, p_scenario, jsonb_build_array(jsonb_build_object('role', 'prospect', 'text', p_opening, 'at', now())))
  returning id into v_id;
  return jsonb_build_object('session_id', v_id, 'max_chars', s.max_chars, 'max_turns', s.max_turns);
end;
$$;

create or replace function public.my_roleplay()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  s public.roleplay_settings%rowtype;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  perform public.roleplay_expire(v_uid);
  select * into s from public.roleplay_settings where id;
  return jsonb_build_object(
    'required', public.app_flag('roleplay_required'),
    'passed', public.roleplay_has_passed(v_uid),
    'academy', public.stacker_has_academy(v_uid),
    'qualification', public.app_flag('roleplay_required') and not public.roleplay_has_passed(v_uid),
    'consented', (select p.ai_consent_at is not null from public.profiles p where p.id = v_uid),
    'pass_score', s.pass_score,
    'min_stacker_turns', s.min_stacker_turns,
    'today', jsonb_build_object(
      'used', (select count(*) from public.roleplay_sessions r
               where r.stacker_id = v_uid and (r.started_at at time zone 'Europe/Paris')::date = public.paris_today()),
      'limit', s.sessions_per_day),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'scenario', h.scenario, 'status', h.status, 'score', h.score,
                                                             'passed', h.passed, 'started_at', h.started_at) order by h.started_at desc)
                         from (select * from public.roleplay_sessions r where r.stacker_id = v_uid order by r.started_at desc limit 20) h), '[]'::jsonb));
end;
$$;

-- Pré-notification : une seule pour une offre à paiement unique.
create or replace function public.email_schedule_prenotifications()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := public.paris_today();
  v_count integer := 0;
  r record;
begin
  for r in
    select d.id, d.contact_email, d.monthly_price_cents, d.mandate_ref, d.reference, x.debit_on
    from public.deals d
    cross join lateral (
      select (d.first_debit_on + make_interval(months => n))::date as debit_on
      from generate_series(0, case when d.offer_snapshot ->> 'billing' = 'unique' then 0 else 240 end) n
      where (d.first_debit_on + make_interval(months => n))::date between v_today + 3 and v_today + 6
    ) x
    where d.mollie_status = 'fait' and d.status in ('signe', 'actif', 'suspendu') and d.first_debit_on is not null
  loop
    insert into public.email_outbox (kind, dedupe_key, stacker_id, deal_id, client_email, data)
    values ('prenotification', 'prenotification:' || r.id || ':' || r.debit_on, null, r.id, r.contact_email,
            jsonb_build_object('debit_on', r.debit_on, 'amount_cents', r.monthly_price_cents))
    on conflict (dedupe_key) do nothing;
    if found then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Emails : le deal indique s'il s'agit d'un paiement unique.
create or replace function public.email_next(p_limit integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  -- Rétention : les emails envoyés ou abandonnés ne sont gardés que 90 jours.
  delete from public.email_outbox where status <> 'a_envoyer' and created_at < now() - interval '90 days';
  -- Deal résilié ou annulé avant l'envoi d'une pré-notification : plus rien à annoncer.
  update public.email_outbox o set status = 'annule'
  from public.deals d
  where o.status = 'a_envoyer' and o.kind = 'prenotification' and d.id = o.deal_id and d.status in ('resilie', 'annule');

  with picked as (
    select o.id from public.email_outbox o
    where o.status = 'a_envoyer' and o.send_after <= now()
    order by o.send_after, o.id
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  ), bumped as (
    update public.email_outbox o
    set attempts = o.attempts + 1,
        -- Nouvel essai dans 15 min, 1 h, 4 h… ; abandon après 6 tentatives.
        send_after = now() + make_interval(mins => 15 * (4 ^ least(o.attempts, 4))::integer),
        status = case when o.attempts + 1 >= 6 then 'echoue' else o.status end
    from picked where o.id = picked.id
    returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'kind', b.kind,
    'to', coalesce(b.client_email, (select u.email from auth.users u where u.id = b.stacker_id)),
    'to_name', case when b.client_email is not null then nullif(btrim(concat_ws(' ', d.contact_first_name, d.contact_last_name)), '')
                    else nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') end,
    'data', b.data,
    'stacker', case when p.id is null then null else jsonb_build_object('first_name', p.first_name, 'last_name', p.last_name) end,
    'deal', case when d.id is null then null else jsonb_build_object(
      'reference', d.reference, 'status', d.status, 'company_name', d.company_name, 'company_siret', d.company_siret,
      'contact_name', btrim(concat_ws(' ', d.contact_first_name, d.contact_last_name)),
      'offer_label', (d.offer_snapshot ->> 'brand') || ' · ' || (d.offer_snapshot ->> 'name'),
      'monthly_price_cents', d.monthly_price_cents, 'mandate_ref', d.mandate_ref,
      'one_time', coalesce(d.offer_snapshot ->> 'billing', 'mensuel') = 'unique',
      'iban_masked', d.iban_country || '•• •••• ' || d.iban_last4,
      'signed_at', d.signed_at, 'withdrawal_until', d.withdrawal_until,
      'first_debit_on', coalesce(d.first_debit_on, greatest((d.withdrawal_until at time zone 'Europe/Paris')::date + 1, public.paris_today() + 3)),
      'contract_text', case when b.kind in ('contrat_client', 'contrat_stacker') then d.contract_text end,
      'contract_sha256', case when b.kind in ('contrat_client', 'contrat_stacker') then d.contract_sha256 end,
      'signature_png', case when b.kind in ('contrat_client', 'contrat_stacker') then d.signature_png end) end
  ) order by b.send_after, b.id), '[]'::jsonb) into v_out
  from bumped b
  left join public.deals d on d.id = b.deal_id
  left join public.profiles p on p.id = coalesce(b.stacker_id, d.stacker_id);
  return v_out;
end;
$$;

-- Admin : catalogue avec le type de paiement.
create or replace function public.admin_offers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.admin_require();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', o.id, 'brand', o.brand, 'name', o.name, 'category', o.category, 'price_cents', o.price_cents,
                                        'unit_label', o.unit_label, 'engagement_months', o.engagement_months, 'active', o.active, 'billing', o.billing,
                                        'deals', (select count(*) from public.deals d where d.offer_id = o.id)) order by o.sort_order)
    from public.offers o), '[]'::jsonb);
end;
$$;
