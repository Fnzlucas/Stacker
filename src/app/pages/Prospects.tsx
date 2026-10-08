import { useState, type ReactElement, type SyntheticEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { DEPARTMENTS } from '@shared/waitlist';
import { PRESETS, PRESET_KEYS, SIZES, SIZE_KEYS, type PresetKey, type SearchItem, type SearchRequest, type SizeKey, type Zone } from '@shared/prospects';
import { Icon } from '../../components/Icon';
import { useSignedIn } from '../auth/AuthProvider';
import { FormAlert, SelectField, TextField } from '../components/Form';
import { AppBar, usePageTitle } from '../components/Layouts';
import { Toast } from '../components/Ui';
import { useProfile } from '../lib/queries';
import { useAcceptRules, useClaim, useMyProspects, useProspectQuotas } from '../lib/prospectQueries';
import {
  STATUS_CHIP,
  STATUS_LABELS,
  ageLabel,
  daysLeft,
  displayName,
  isDueToday,
  prospectErrorMessage,
  searchProspects,
  type ProspectRow,
  type ProspectStatus,
} from '../lib/prospects';
import { formatLongDate } from '../lib/dates';
import { prospectPath } from '../paths';

type View = 'trouver' | 'mes';

export function ProspectsPage(): ReactElement {
  usePageTitle('Prospects');
  const [params, setParams] = useSearchParams();
  const view: View = params.get('vue') === 'mes' ? 'mes' : 'trouver';
  const quotas = useProspectQuotas();
  const mine = useMyProspects();
  const count = mine.data?.length;
  const location = useLocation();
  const [notice, setNotice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null);

  const setView = (v: View) => setParams(v === 'mes' ? { vue: 'mes' } : {}, { replace: true });

  return (
    <div className="app-container pros">
      <AppBar title="Prospects" />
      <div className="segmented pros-tabs" role="group" aria-label="Affichage">
        <button type="button" aria-pressed={view === 'trouver'} onClick={() => setView('trouver')}>
          Trouver
        </button>
        <button type="button" aria-pressed={view === 'mes'} onClick={() => setView('mes')}>
          Mes prospects{count !== undefined ? ` (${String(count)})` : ''}
        </button>
      </div>
      {quotas.data?.rules_version === null ? <RulesCard /> : null}
      {quotas.data && !quotas.data.enabled ? <FormAlert tone="info">La prospection est momentanément suspendue. Réessaie un peu plus tard.</FormAlert> : null}
      {notice ? <Toast onClose={() => setNotice(null)}>{notice}</Toast> : null}
      {view === 'trouver' ? <FindTab rulesAccepted={quotas.data ? quotas.data.rules_version !== null : false} /> : <MineTab rows={mine.data} loading={mine.isPending} error={mine.isError} onFind={() => setView('trouver')} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Règles (première visite)
// ---------------------------------------------------------------------------

const RULES = [
  'Tu ne contactes que des entreprises, jamais des particuliers.',
  'Écris d’abord aux adresses génériques (contact@, bonjour@…) ; une adresse personnelle seulement si elle est publiée pour le travail.',
  'Un email à la fois, depuis ta propre boîte, avec le lien d’opposition inclus.',
  'Si quelqu’un ne veut plus être contacté, c’est définitif, pour tous les stackers.',
];

function RulesCard(): ReactElement {
  const accept = useAcceptRules();
  return (
    <section className="card card-hero pros-rules" aria-labelledby="rules-title">
      <span className="sticker sticker-orange pros-rules-sticker">À lire</span>
      <h2 id="rules-title" className="h3">
        Les 4 règles de la prospection
      </h2>
      <ol className="pros-rules-list">
        {RULES.map((r, i) => (
          <li key={r}>
            <span className="pros-rules-num" aria-hidden="true">
              {i + 1}
            </span>
            <span>{r}</span>
          </li>
        ))}
      </ol>
      {accept.isError ? <FormAlert>{prospectErrorMessage(accept.error)}</FormAlert> : null}
      <button type="button" className={`btn btn-primary btn-block${accept.isPending ? ' is-loading' : ''}`} disabled={accept.isPending} onClick={() => accept.mutate()}>
        J’ai compris, je m’engage
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Trouver
// ---------------------------------------------------------------------------

type ZoneType = Zone['type'];

function FindTab({ rulesAccepted }: { rulesAccepted: boolean }): ReactElement {
  const { backend } = useSignedIn();
  const profile = useProfile();
  const quotas = useProspectQuotas();
  const claim = useClaim();
  const [zoneType, setZoneType] = useState<ZoneType>('departement');
  const [department, setDepartment] = useState<string>(profile.data?.department ?? '');
  const [postcode, setPostcode] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [radius, setRadius] = useState<5 | 10 | 20>(10);
  const [preset, setPreset] = useState<PresetKey | null>(null);
  const [sizes, setSizes] = useState<SizeKey[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [results, setResults] = useState<{ request: SearchRequest; items: SearchItem[]; total: number; hasMore: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<{ siret: string; message: string } | null>(null);

  const search = useMutation({
    mutationFn: (req: SearchRequest) => searchProspects(backend, req),
    onSuccess: (data, req) => {
      setResults((prev) => ({
        request: req,
        items: req.page > 1 && prev ? [...prev.items, ...data.items.filter((i) => !prev.items.some((p) => p.siret === i.siret))] : data.items,
        total: data.total,
        hasMore: data.hasMore,
      }));
      void quotas.refetch();
    },
  });

  function buildZone(): Zone | string {
    if (zoneType === 'departement') return department ? { type: 'departement', value: department } : 'Choisis un département.';
    if (zoneType === 'code_postal') return /^\d{5}$/.test(postcode.trim()) ? { type: 'code_postal', value: postcode.trim() } : 'Indique un code postal à 5 chiffres.';
    return coords ? { type: 'autour', lat: coords.lat, lng: coords.lng, radius_km: radius } : 'Autorise d’abord ta position.';
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (search.isPending) return;
    const zone = buildZone();
    if (typeof zone === 'string') {
      setFormError(zone);
      return;
    }
    setFormError(null);
    setClaimError(null);
    search.mutate({ zone, ...(preset ? { preset } : {}), ...(sizes.length ? { sizes } : {}), page: 1 });
  }

  function locate() {
    setGeoError(null);
    if (!('geolocation' in navigator)) {
      setGeoError('Ton appareil ne permet pas la géolocalisation.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setGeoError('Position refusée ou indisponible. Choisis plutôt un département ou un code postal.'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  function reserve(item: SearchItem) {
    setClaimError(null);
    claim.mutate(item.siret, {
      onSuccess: (claimId) => {
        setResults((prev) => (prev ? { ...prev, items: prev.items.map((i) => (i.siret === item.siret ? { ...i, state: 'a_moi', claim_id: claimId } : i)) } : prev));
        setToast(`${displayName(item.name)} est réservée pour toi.`);
      },
      onError: (e) => setClaimError({ siret: item.siret, message: prospectErrorMessage(e) }),
    });
  }

  const toggleSize = (s: SizeKey) => setSizes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  const q = quotas.data;

  return (
    <>
      <form className="card card-hero pros-search" noValidate onSubmit={onSubmit} aria-label="Rechercher des entreprises">
        <fieldset className="pros-fieldset">
          <legend className="field-label">Zone</legend>
          <div className="pros-chips" role="group" aria-label="Type de zone">
            {(
              [
                ['departement', 'Département', 'map-pin'],
                ['code_postal', 'Code postal', 'mail'],
                ['autour', 'Autour de moi', 'target'],
              ] as const
            ).map(([key, label, icon]) => (
              <button key={key} type="button" className="chip chip-filter" aria-pressed={zoneType === key} onClick={() => setZoneType(key)}>
                <Icon name={icon} />
                {label}
              </button>
            ))}
          </div>
          {zoneType === 'departement' ? (
            <SelectField label="Département" options={DEPARTMENTS.map(([c, n]) => [c, `${c} · ${n}`] as const)} placeholder="Choisis un département" value={department} onChange={(e) => setDepartment(e.target.value)} />
          ) : null}
          {zoneType === 'code_postal' ? (
            <TextField label="Code postal" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={postcode} onChange={(e) => setPostcode(e.target.value.replace(/\D/g, ''))} />
          ) : null}
          {zoneType === 'autour' ? (
            <div className="grid gap-3">
              <button type="button" className="btn btn-secondary" onClick={locate}>
                <Icon name="target" />
                {coords ? 'Position enregistrée · actualiser' : 'Utiliser ma position'}
              </button>
              {geoError ? <FormAlert>{geoError}</FormAlert> : null}
              <div className="pros-chips" role="group" aria-label="Rayon">
                {([5, 10, 20] as const).map((r) => (
                  <button key={r} type="button" className="chip chip-filter" aria-pressed={radius === r} onClick={() => setRadius(r)}>
                    {r} km
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </fieldset>

        <fieldset className="pros-fieldset">
          <legend className="field-label">Secteur</legend>
          <div className="pros-chips" role="group" aria-label="Secteur">
            <button type="button" className="chip chip-filter" aria-pressed={preset === null} onClick={() => setPreset(null)}>
              Tous
            </button>
            {PRESET_KEYS.map((k) => (
              <button key={k} type="button" className="chip chip-filter" aria-pressed={preset === k} onClick={() => setPreset(k)}>
                {PRESETS[k].label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="pros-fieldset">
          <legend className="field-label">Taille</legend>
          <div className="pros-chips" role="group" aria-label="Taille">
            {SIZE_KEYS.map((k) => (
              <button key={k} type="button" className="chip chip-filter" aria-pressed={sizes.includes(k)} onClick={() => toggleSize(k)}>
                {SIZES[k].label}
              </button>
            ))}
          </div>
        </fieldset>

        {formError ? <FormAlert>{formError}</FormAlert> : null}
        {search.isError ? <FormAlert>{prospectErrorMessage(search.error)}</FormAlert> : null}
        <button type="submit" className={`btn btn-primary btn-block btn-lg${search.isPending && !results ? ' is-loading' : ''}`} disabled={search.isPending}>
          <Icon name="search" />
          Rechercher
        </button>
        {q ? (
          <p className="text-small pros-quota">
            {q.searches.used}/{q.searches.limit} recherches aujourd’hui · {q.active.used}/{q.active.limit} prospects suivis
          </p>
        ) : null}
      </form>

      {search.isPending && !results ? <ResultsSkeleton /> : null}
      {results ? (
        <section aria-labelledby="results-title" className="pros-results">
          <div className="section-head">
            <h2 id="results-title" className="h2">
              {results.total === 0 ? 'Aucune entreprise' : `${results.total >= 1000 ? 'Plus de 1 000' : String(results.total)} entreprise${results.total > 1 ? 's' : ''}`}
            </h2>
            <span className="text-small">Source : registre SIRENE</span>
          </div>
          {results.items.length === 0 ? (
            <div className="card empty">
              <p>Aucune entreprise disponible avec ces critères. Élargis la zone ou change de secteur.</p>
            </div>
          ) : (
            <ul className="list pros-list">
              {results.items.map((item) => (
                <ResultRow
                  key={item.siret}
                  item={item}
                  canClaim={rulesAccepted}
                  claiming={claim.isPending && claim.variables === item.siret}
                  error={claimError?.siret === item.siret ? claimError.message : null}
                  onClaim={() => reserve(item)}
                />
              ))}
            </ul>
          )}
          {results.hasMore ? (
            <button
              type="button"
              className={`btn btn-secondary btn-block mt-4${search.isPending ? ' is-loading' : ''}`}
              disabled={search.isPending}
              onClick={() => search.mutate({ ...results.request, page: results.request.page + 1 })}
            >
              Voir plus d’entreprises
            </button>
          ) : null}
        </section>
      ) : null}
      {toast ? <Toast onClose={() => setToast(null)}>{toast}</Toast> : null}
    </>
  );
}

function ResultRow({ item, canClaim, claiming, error, onClaim }: { item: SearchItem; canClaim: boolean; claiming: boolean; error: string | null; onClaim: () => void }): ReactElement {
  const age = ageLabel(item.created_on, new Date());
  const name = displayName(item.name);
  return (
    <li>
      <div className={`list-row pros-row${item.state === 'deja_suivie' || item.state === 'en_pause' ? ' is-muted' : ''}`}>
        <div className="list-main">
          <span className="list-title">{name}</span>
          <span className="list-sub">
            <span>{[item.naf_label, item.city ? displayName(item.city) : null].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="pros-tags">
            {item.score >= 80 ? <span className="chip chip-green pros-tag">Priorité</span> : null}
            {age ? <span className="text-small">{age}</span> : null}
          </span>
          {error ? (
            <span className="field-error" role="alert">
              <Icon name="alert" />
              {error}
            </span>
          ) : null}
        </div>
        <div className="list-end">
          {item.state === 'libre' ? (
            <button
              type="button"
              className={`btn btn-primary btn-sm${claiming ? ' is-loading' : ''}`}
              disabled={!canClaim || claiming}
              aria-label={`Réserver ${name}`}
              title={canClaim ? undefined : 'Accepte d’abord les règles de prospection'}
              onClick={onClaim}
            >
              Réserver
            </button>
          ) : item.state === 'a_moi' && item.claim_id ? (
            <Link className="btn btn-secondary btn-sm" to={prospectPath(item.claim_id)} aria-label={`Ouvrir la fiche de ${name}`}>
              À toi
              <Icon name="arrow-right" />
            </Link>
          ) : item.state === 'deja_suivie' ? (
            <span className="chip">Déjà suivie</span>
          ) : (
            <span className="chip chip-orange">En pause</span>
          )}
        </div>
      </div>
    </li>
  );
}

function ResultsSkeleton(): ReactElement {
  return (
    <div className="list pros-list" aria-busy="true" aria-label="Recherche en cours">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="list-row">
          <div className="list-main">
            <span className="skeleton skeleton-text w-2/3" />
            <span className="skeleton skeleton-text mt-2 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mes prospects
// ---------------------------------------------------------------------------

type Filter = 'tous' | 'relancer' | ProspectStatus;
const FILTERS: [Filter, string][] = [
  ['tous', 'Tous'],
  ['relancer', 'À relancer'],
  ['a_contacter', STATUS_LABELS.a_contacter],
  ['contacte', STATUS_LABELS.contacte],
  ['a_repondu', STATUS_LABELS.a_repondu],
  ['rdv', STATUS_LABELS.rdv],
  ['signe', STATUS_LABELS.signe],
];

function MineTab({ rows, loading, error, onFind }: { rows: ProspectRow[] | undefined; loading: boolean; error: boolean; onFind: () => void }): ReactElement {
  const [filter, setFilter] = useState<Filter>('tous');
  const now = new Date();
  if (loading) return <ResultsSkeleton />;
  if (error || !rows) return <FormAlert>Impossible de charger tes prospects. Vérifie ta connexion puis réessaie.</FormAlert>;
  if (rows.length === 0) {
    return (
      <section className="card card-hero empty pros-empty" aria-labelledby="empty-title">
        <div className="empty-art">
          <div className="tile">
            <Icon name="users" />
          </div>
          <span className="sticker sticker-violet">0</span>
        </div>
        <h2 id="empty-title" className="h3">
          Aucun prospect pour l’instant
        </h2>
        <p>Réserve des entreprises de ta zone : elles restent à toi pendant que tu les contactes.</p>
        <button type="button" className="btn btn-primary" onClick={onFind}>
          <Icon name="search" />
          Trouver des entreprises
        </button>
      </section>
    );
  }
  const count = (f: Filter) => rows.filter((r) => matches(r, f, now)).length;
  const visible = rows.filter((r) => matches(r, filter, now));
  return (
    <>
      <div className="pros-chips pros-filters" role="group" aria-label="Filtrer par statut">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" className="chip chip-filter" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label} <span className="chip-count">{count(key)}</span>
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="text-2 pros-none">Aucun prospect dans ce filtre.</p>
      ) : (
        <ul className="list pros-list">
          {visible.map((r) => {
            const left = daysLeft(r.expires_at, now);
            const due = isDueToday(r.next_action_at, now);
            return (
              <li key={r.id}>
                <Link className="list-row pros-row" to={prospectPath(r.id)}>
                  <div className="list-main">
                    <span className="list-title">{displayName(r.name)}</span>
                    <span className="list-sub">
                      <span>{[r.naf_label, r.city ? displayName(r.city) : null].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="pros-tags">
                      <span className={STATUS_CHIP[r.status]}>{STATUS_LABELS[r.status]}</span>
                      {due ? <span className="chip chip-orange">À relancer</span> : r.next_action_at ? <span className="text-small">Prochaine action : {formatLongDate(r.next_action_at)}</span> : null}
                      {left !== null && left <= 2 ? <span className="chip chip-red">Expire {left === 0 ? 'aujourd’hui' : `dans ${String(left)} j`}</span> : null}
                    </span>
                  </div>
                  <span className="list-chevron" aria-hidden="true">
                    <Icon name="chevron-right" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function matches(r: ProspectRow, f: Filter, now: Date): boolean {
  if (f === 'tous') return true;
  if (f === 'relancer') return isDueToday(r.next_action_at, now);
  return r.status === f;
}
