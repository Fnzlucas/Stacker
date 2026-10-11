import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { formatPhone } from '@shared/account';
import { Icon } from '../../components/Icon';
import { Ransom } from '../../components/Ransom';
import { CheckField, FormAlert, TextField } from '../components/Form';
import { usePageTitle } from '../components/Layouts';
import { SignaturePad } from '../components/SignaturePad';
import { useCatalog, usePreviewDeal, useSignDeal } from '../lib/dealQueries';
import {
  DealError,
  commissionCents,
  dealErrorMessage,
  emptyDealInput,
  engagementLabel,
  formatEuros,
  formatIban,
  groupByBrand,
  stepErrors,
  type DealInput,
  type DealPreview,
  type Offer,
  type SignedDeal,
} from '../lib/deals';
import { useProspect } from '../lib/prospectQueries';
import { displayName } from '../lib/prospects';
import { formatRate } from '../lib/tiers';
import { PATHS, dealPath } from '../paths';

const STEPS = ['offre', 'client', 'paiement', 'signature'] as const;
type WizardStep = (typeof STEPS)[number];
const STEP_TITLES: Record<WizardStep, string> = { offre: 'L’offre', client: 'Le client', paiement: 'Le paiement', signature: 'Contrat et signature' };

/** Faire signer un client : offre → client → IBAN → contrat lu et signé au doigt. */
export function DealNewPage(): ReactElement {
  usePageTitle('Faire signer un client');
  const [params] = useSearchParams();
  const claimId = params.get('prospect');
  return claimId ? <FromProspect claimId={claimId} /> : <Wizard initial={emptyDealInput()} />;
}

function FromProspect({ claimId }: { claimId: string }): ReactElement {
  const prospect = useProspect(claimId);
  const initial = useMemo<DealInput | null>(() => {
    if (!prospect.data) return null;
    const c = prospect.data.company;
    const officer = c.officers.find((o) => Boolean(o.prenoms ?? o.nom));
    const address = [c.address, c.address && c.postcode && c.address.includes(c.postcode) ? null : [c.postcode, c.city].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ');
    return {
      ...emptyDealInput(),
      claim_id: prospect.data.claim.id,
      siret: c.siret,
      company_name: displayName(c.name),
      company_address: address ? displayName(address) : '',
      first_name: officer?.prenoms ? displayName(officer.prenoms.split(' ')[0] ?? '') : '',
      last_name: officer?.nom ? displayName(officer.nom) : '',
      email: prospect.data.claim.contact_email ?? '',
      phone: prospect.data.claim.contact_phone ? formatPhone(prospect.data.claim.contact_phone) : '',
      iban_holder: displayName(c.name),
    };
  }, [prospect.data]);
  if (prospect.isPending) return <Loading />;
  if (!initial) return <Wizard initial={emptyDealInput()} />;
  return <Wizard initial={initial} />;
}

function Loading(): ReactElement {
  return (
    <div className="app-container">
      <div className="card card-hero mt-6" aria-busy="true">
        <span className="skeleton skeleton-title w-2/3" />
        <span className="skeleton skeleton-text mt-4 w-full" />
      </div>
    </div>
  );
}

function Wizard({ initial }: { initial: DealInput }): ReactElement {
  const catalog = useCatalog();
  const [step, setStep] = useState<WizardStep>('offre');
  const [v, setV] = useState<DealInput>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [signed, setSigned] = useState<SignedDeal | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const offer = catalog.data?.offers.find((o) => o.id === v.offer_id);
  const index = STEPS.indexOf(step);

  useEffect(() => {
    top.current?.scrollIntoView({ block: 'start' });
  }, [step]);

  const set = <K extends keyof DealInput>(k: K, value: DealInput[K]) => {
    setV((prev) => ({ ...prev, [k]: value }));
    setErrors((prev) => (k in prev ? Object.fromEntries(Object.entries(prev).filter(([key]) => key !== k)) : prev));
  };

  function next() {
    if (step === 'signature') return;
    const e = stepErrors(step, v, offer);
    setErrors(e);
    if (Object.keys(e).length) return;
    setStep(STEPS[index + 1] ?? step);
  }

  if (signed) return <Celebration deal={signed} company={v.company_name} />;

  return (
    <div className="app-container deal-new" ref={top}>
      <header className="appbar app-appbar deal-new-bar">
        {index === 0 ? (
          <Link className="btn btn-ghost btn-sm" to={PATHS.deals}>
            <Icon name="x" />
            Annuler
          </Link>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep(STEPS[index - 1] ?? 'offre')}>
            <Icon name="chevron-left" />
            Retour
          </button>
        )}
        <span className="deal-new-count">
          Étape {index + 1} / {STEPS.length}
        </span>
      </header>
      <ol className="deal-steps" aria-label="Étapes">
        {STEPS.map((s, i) => (
          <li key={s} className={i < index ? 'is-done' : i === index ? 'is-current' : undefined} aria-current={i === index ? 'step' : undefined}>
            <span className="sr-only">{STEP_TITLES[s]}</span>
          </li>
        ))}
      </ol>
      <h1 className="h2 deal-new-title">{STEP_TITLES[step]}</h1>

      {catalog.isPending ? (
        <Loading />
      ) : catalog.isError ? (
        <FormAlert>{dealErrorMessage(catalog.error)}</FormAlert>
      ) : step === 'offre' ? (
        <OfferStep offers={catalog.data.offers} rateBps={catalog.data.rate_bps} v={v} set={set} errors={errors} />
      ) : step === 'client' ? (
        <ClientStep v={v} set={set} errors={errors} />
      ) : step === 'paiement' ? (
        <PaymentStep v={v} set={set} errors={errors} />
      ) : offer ? (
        <SignatureStep v={v} set={set} offer={offer} onSigned={setSigned} onEdit={setStep} />
      ) : null}

      {step !== 'signature' && catalog.data ? (
        <div className="deal-new-actions">
          {Object.keys(errors).length ? <FormAlert>Corrige les champs signalés pour continuer.</FormAlert> : null}
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={next}>
            Continuer
            <Icon name="arrow-right" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

type Setter = <K extends keyof DealInput>(k: K, value: DealInput[K]) => void;

// ---------------------------------------------------------------------------
// 1. Offre
// ---------------------------------------------------------------------------

function OfferStep({ offers, rateBps, v, set, errors }: { offers: Offer[]; rateBps: number; v: DealInput; set: Setter; errors: Record<string, string> }): ReactElement {
  const groups = groupByBrand(offers);
  const selected = offers.find((o) => o.id === v.offer_id);
  return (
    <div className="deal-offers">
      <p className="text-2">
        Choisis ce que ton client prend. Ta commission : <b className="text-ink">{formatRate(rateBps)}</b> du prix, chaque mois où il paie.
      </p>
      {errors['offer_id'] ? <FormAlert>{errors['offer_id']}</FormAlert> : null}
      {groups.map((g) => (
        <section key={g.brand} className="card deal-brand" aria-labelledby={`brand-${g.offers[0]?.id ?? g.brand}`}>
          <h2 id={`brand-${g.offers[0]?.id ?? g.brand}`} className="h3">
            {g.brand}
          </h2>
          <p className="text-small text-2">{g.category}</p>
          <div className="deal-formulas" role="radiogroup" aria-label={`Formules ${g.brand}`}>
            {g.offers.map((o) => {
              const on = o.id === v.offer_id;
              const price = o.price_cents * (on ? v.quantity : o.qty_min);
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`deal-formula${on ? ' is-on' : ''}`}
                  onClick={() => {
                    set('offer_id', o.id);
                    set('quantity', o.qty_min);
                  }}
                >
                  <span className="deal-formula-head">
                    <span className="deal-formula-name">{o.name}</span>
                    {o.recommended ? <span className="chip chip-green">Le plus pris</span> : null}
                  </span>
                  <span className="deal-formula-price">
                    {o.unit_label ? `${formatEuros(o.price_cents)} / ${o.unit_label}` : formatEuros(o.price_cents)}
                    <small> par mois</small>
                  </span>
                  <span className="text-small text-2">{engagementLabel(o.engagement_months)}</span>
                  <ul className="deal-formula-features">
                    {o.features.slice(0, 4).map((f) => (
                      <li key={f}>
                        <Icon name="check" size={16} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <span className="deal-formula-com">
                    Ta commission : <b>{formatEuros(commissionCents(price, rateBps))}</b> / mois{o.unit_label && !on ? ' (minimum)' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {selected?.unit_label ? (
        <div className="card deal-qty">
          <TextField
            label={`Nombre de ${selected.unit_label}s`}
            type="number"
            inputMode="numeric"
            min={selected.qty_min}
            max={selected.qty_max}
            value={String(v.quantity)}
            onChange={(e) => set('quantity', Math.trunc(Number(e.target.value)) || 0)}
            error={errors['quantity']}
            hint={`Entre ${String(selected.qty_min)} et ${String(selected.qty_max)}.`}
          />
          <p className="deal-qty-total">
            Total client : <b>{formatEuros(selected.price_cents * Math.max(0, v.quantity))}</b> / mois
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Client
// ---------------------------------------------------------------------------

function ClientStep({ v, set, errors }: { v: DealInput; set: Setter; errors: Record<string, string> }): ReactElement {
  return (
    <div className="card card-hero deal-form">
      <p className="text-2 text-sm">Les informations figurent sur le contrat : vérifie-les avec ton client.</p>
      <h2 className="h3">L’entreprise</h2>
      <TextField label="SIRET" inputMode="numeric" autoComplete="off" value={v.siret} onChange={(e) => set('siret', e.target.value)} error={errors['siret']} hint="14 chiffres, sur le Kbis ou une facture." />
      <TextField label="Raison sociale" value={v.company_name} onChange={(e) => set('company_name', e.target.value)} error={errors['company_name']} />
      <TextField label="Adresse" autoComplete="street-address" value={v.company_address} onChange={(e) => set('company_address', e.target.value)} error={errors['company_address']} />
      <h2 className="h3 mt-2">Le signataire</h2>
      <div className="deal-row2">
        <TextField label="Prénom" autoComplete="off" value={v.first_name} onChange={(e) => set('first_name', e.target.value)} error={errors['first_name']} />
        <TextField label="Nom" autoComplete="off" value={v.last_name} onChange={(e) => set('last_name', e.target.value)} error={errors['last_name']} />
      </div>
      <TextField label="Fonction" value={v.role} onChange={(e) => set('role', e.target.value)} error={errors['role']} hint="Gérant, président, associé…" />
      <TextField label="Email" type="email" inputMode="email" autoComplete="off" value={v.email} onChange={(e) => set('email', e.target.value)} error={errors['email']} hint="Il recevra son contrat à cette adresse." />
      <TextField label="Téléphone" type="tel" inputMode="tel" autoComplete="off" value={v.phone} onChange={(e) => set('phone', e.target.value)} error={errors['phone']} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Paiement
// ---------------------------------------------------------------------------

function PaymentStep({ v, set, errors }: { v: DealInput; set: Setter; errors: Record<string, string> }): ReactElement {
  return (
    <div className="card card-hero deal-form">
      <p className="text-2 text-sm">
        Le client paie chaque mois par prélèvement : il suffit de son IBAN. Le premier prélèvement a lieu après les 14 jours de rétractation.
      </p>
      <TextField label="Titulaire du compte" autoComplete="off" value={v.iban_holder} onChange={(e) => set('iban_holder', e.target.value)} error={errors['iban_holder']} />
      <TextField
        label="IBAN"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={v.iban}
        onChange={(e) => set('iban', e.target.value)}
        onBlur={() => set('iban', formatIban(v.iban))}
        error={errors['iban']}
        hint="Sur le RIB du compte professionnel. Il est chiffré dès l’envoi."
        icon="bank"
      />
      <CheckField checked={v.accept_mandate} onChange={(e) => set('accept_mandate', e.target.checked)} error={errors['accept_mandate']}>
        Le client autorise Stacker (via son prestataire de paiement Mollie) à prélever ce compte chaque mois, selon le mandat SEPA présenté avec le contrat.
      </CheckField>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Contrat et signature
// ---------------------------------------------------------------------------

function SignatureStep({ v, set, offer, onSigned, onEdit }: { v: DealInput; set: Setter; offer: Offer; onSigned: (d: SignedDeal) => void; onEdit: (s: WizardStep) => void }): ReactElement {
  const preview = usePreviewDeal();
  const sign = useSignDeal();
  const [signature, setSignature] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const { mutate } = preview;

  useEffect(() => {
    mutate(v);
    // Aperçu demandé une fois à l'arrivée sur l'étape (la saisie n'y change plus).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutate]);

  async function submit(p: DealPreview) {
    setTouched(true);
    if (!v.accept_terms || !signature) return;
    try {
      const d = await sign.mutateAsync({ input: v, signature, sha: p.contract_sha256 });
      onSigned(d);
    } catch (e) {
      if (e instanceof DealError && e.code === 'contract_changed') mutate(v);
    }
  }

  if (preview.isPending || preview.isIdle) return <Loading />;
  if (preview.isError) {
    const code = preview.error instanceof DealError ? preview.error.code : '';
    const back: WizardStep = ['invalid_iban', 'invalid_holder'].includes(code) ? 'paiement' : code === 'offer_unavailable' || code === 'invalid_quantity' ? 'offre' : 'client';
    return (
      <div className="deal-form">
        <FormAlert>{dealErrorMessage(preview.error)}</FormAlert>
        <button type="button" className="btn btn-secondary" onClick={() => onEdit(back)}>
          Corriger
        </button>
      </div>
    );
  }
  const p = preview.data;
  return (
    <div className="deal-sign">
      <section className="card card-hero deal-summary" aria-label="Récapitulatif">
        <p className="deal-summary-offer">
          {offer.brand} · {offer.name}
          {offer.unit_label ? ` · ${String(v.quantity)} ${offer.unit_label}${v.quantity > 1 ? 's' : ''}` : ''}
        </p>
        <p className="deal-summary-price">
          {formatEuros(p.monthly_price_cents)}
          <small> / mois</small>
        </p>
        <p className="text-small text-2">
          {engagementLabel(offer.engagement_months)} · Réf. {p.reference}
        </p>
        <p className="deal-summary-com">
          <Icon name="euro" />
          <span>
            Ta commission : <b>{formatEuros(p.commission_cents)} / mois</b> ({formatRate(p.rate_bps)}), dès que le client paie.
          </span>
        </p>
      </section>

      <section className="card deal-contract" aria-labelledby="contract-title">
        <h2 id="contract-title" className="h3">
          Le contrat
        </h2>
        <p className="text-small text-2">Tends ton téléphone au client : il lit, coche et signe lui-même.</p>
        <textarea className="deal-contract-text" readOnly aria-label="Texte du contrat" value={p.contract_text} rows={12} />
      </section>

      <section className="card card-hero deal-form" aria-labelledby="sign-title">
        <h2 id="sign-title" className="h3">
          Signature du client
        </h2>
        <CheckField checked={v.accept_terms} onChange={(e) => set('accept_terms', e.target.checked)} error={touched && !v.accept_terms ? 'Le client doit accepter le contrat.' : undefined}>
          J’ai lu le contrat et le mandat de prélèvement, et je les accepte au nom de {v.company_name || 'mon entreprise'}.
        </CheckField>
        <SignaturePad onChange={setSignature} label="Zone de signature du client" />
        {touched && !signature ? <FormAlert>La signature est vide ou trop courte.</FormAlert> : null}
        {sign.isError ? <FormAlert>{dealErrorMessage(sign.error)}</FormAlert> : null}
        <button type="button" className={`btn btn-primary btn-lg btn-block${sign.isPending ? ' is-loading' : ''}`} disabled={sign.isPending} onClick={() => void submit(p)}>
          <Icon name="signature" />
          Signer le contrat
        </button>
        <p className="form-note">
          <Icon name="lock" />
          <span>Signature électronique horodatée, avec l’empreinte du contrat. Le client a 14 jours pour se rétracter.</span>
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Célébration
// ---------------------------------------------------------------------------

const CONFETTI = Array.from({ length: 36 }, (_, i) => i);

function useCountUp(target: number, ms = 1400): number {
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [value, setValue] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) return undefined;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      setValue(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return value;
}

function Celebration({ deal, company }: { deal: SignedDeal; company: string }): ReactElement {
  const navigate = useNavigate();
  const shown = useCountUp(deal.commission_cents);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="deal-win" role="status">
      <div className="deal-win-confetti" aria-hidden="true">
        {CONFETTI.map((i) => (
          <span key={i} className={`cf cf-${String(i % 12)}`} />
        ))}
      </div>
      <div className="deal-win-body">
        <h1 className="deal-win-title" ref={heading} tabIndex={-1}>
          <Ransom text="SIGNÉ !" animated />
        </h1>
        <p className="deal-win-company">{company}</p>
        <p className="deal-win-amount num" aria-label={`${formatEuros(deal.commission_cents)} par mois`}>
          + {formatEuros(shown, { always: true })}
          <small> / mois</small>
        </p>
        <p className="deal-win-text">
          Ta commission ({formatRate(deal.rate_bps)}) tombe chaque mois où le client paie, à partir du premier prélèvement, après les 14 jours de rétractation.
        </p>
        <div className="deal-win-actions">
          <button type="button" className="btn btn-accent btn-lg btn-block" onClick={() => void navigate(dealPath(deal.id), { replace: true })}>
            Voir le deal
          </button>
          <button type="button" className="btn btn-glass btn-block" onClick={() => void navigate(PATHS.deals, { replace: true })}>
            Retour à mes deals
          </button>
        </div>
      </div>
    </div>
  );
}
