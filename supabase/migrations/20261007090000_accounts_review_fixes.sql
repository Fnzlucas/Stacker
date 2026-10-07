-- =============================================================================
-- Stacker — Lot 2, corrections de la revue Lead (7 octobre 2026)
--
-- 1. Effacement RGPD incomplet après un changement d'adresse email.
--    account_erase_prepare() n'effaçait l'inscription à la liste d'attente
--    que par l'adresse ACTUELLE du compte. Un stacker rattaché à la liste
--    d'attente avec a@…, puis passé à b@…, gardait après suppression de son
--    compte la ligne waitlist de a@… (prénom, département, consentements,
--    code de parrainage). On efface désormais aussi la ligne rattachée
--    (profiles.waitlist_id).
--
-- 2. Consentements et déclaration de majorité figés par un tiers.
--    Le profil et les consentements sont créés à l'INSERT dans auth.users,
--    avant toute preuve de possession de l'adresse. Or Supabase Auth, quand
--    on se réinscrit avec une adresse encore non confirmée, remplace les
--    métadonnées (et le mot de passe) sans recréer la ligne. Quelqu'un qui
--    inscrit l'adresse d'un tiers en premier figeait donc SES choix
--    (consentement marketing, version des CGU, prénom, horodatage de la
--    majorité) sur le compte que le vrai titulaire confirmera ensuite.
--    À la confirmation, on rejoue les métadonnées COURANTES (celles de la
--    dernière inscription, donc du titulaire de l'adresse) : nouvelles
--    lignes de consentement (journal append-only, la plus récente par
--    finalité fait foi), majorité ré-horodatée, prénom repris si
--    l'onboarding n'est pas fait.
-- =============================================================================

create or replace function public.account_erase_prepare(p_user_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email       text;
  v_waitlist_id uuid;
begin
  if p_user_id is null then
    raise exception 'invalid_user' using errcode = '22023';
  end if;
  select u.email into v_email from auth.users u where u.id = p_user_id;
  if not found then
    return false;
  end if;
  select p.waitlist_id into v_waitlist_id from public.profiles p where p.id = p_user_id;

  perform set_config('stacker.erasure', 'on', true);
  delete from public.waitlist w
  where (v_email is not null and w.email = lower(btrim(v_email)))
     or (v_waitlist_id is not null and w.id = v_waitlist_id);
  perform set_config('stacker.erasure', 'off', true);
  return true;
end;
$$;

revoke all on function public.account_erase_prepare(uuid) from public, anon, authenticated, service_role;
grant execute on function public.account_erase_prepare(uuid) to service_role;

create or replace function public.handle_user_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta       jsonb;
  v_terms      text;
  v_first_name text;
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    v_meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    v_terms := nullif(btrim(coalesce(v_meta ->> 'terms_version', '')), '');
    v_first_name := nullif(btrim(coalesce(v_meta ->> 'first_name', '')), '');

    -- Mêmes exigences qu'à l'inscription, appliquées aux métadonnées de la
    -- personne qui prouve posséder l'adresse.
    if coalesce(v_meta ->> 'adult_declared', '') <> 'true' then
      raise exception 'adult_declaration_required' using errcode = '22023';
    end if;
    if v_terms is null or char_length(v_terms) > 40 then
      raise exception 'terms_not_accepted' using errcode = '22023';
    end if;
    if v_first_name is not null and char_length(v_first_name) > 50 then
      v_first_name := null;
    end if;

    update public.profiles p
    set adult_declared_at = now(),
        first_name = case when p.onboarding_completed_at is null then coalesce(v_first_name, p.first_name) else p.first_name end
    where p.id = new.id;

    insert into public.user_consents (user_id, purpose, granted, document_version, source)
    values
      (new.id, 'terms_privacy', true, v_terms, 'email_confirmed'),
      (new.id, 'marketing_email', coalesce(v_meta ->> 'marketing_opt_in', '') = 'true', v_terms, 'email_confirmed');

    if new.email is not null then
      perform public.link_waitlist(new.id, new.email);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.handle_user_email_confirmed() from public, anon, authenticated, service_role;

comment on table public.user_consents is
  'Journal append-only des consentements des comptes. Pour une finalité donnée, la ligne la plus récente fait foi. Effacé uniquement avec le compte (cascade).';
