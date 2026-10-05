import type { ReactElement } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { PageShell } from '../components/Layout';
import { Ransom } from '../components/Ransom';
import { AVAILABILITY_STEPS, Faq, LaunchOfferCard, PricingCard, SectionHeading, TierList } from '../components/Sections';
import { LAUNCH_OFFER, PRODUCT } from '../config/site';
import { Island } from '../islands/Island';
import { FAQ_GENERAL } from '../site/faq';

export function LandingPage(): ReactElement {
  return (
    <PageShell current="home" ctaHref="#rejoindre">
      <Hero />
      <HowItWorks />
      <Services />
      <Commissions />
      <Subscription />
      <Join />
      <section className="site-section bg-bg-2" aria-labelledby="faq-title" id="faq">
        <div className="site-container grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <SectionHeading
            id="faq-title"
            eyebrow="Questions fréquentes"
            title={
              <>
                Les réponses, <span className="serif-accent">sans détour</span>.
              </>
            }
            lead={
              <>
                Une autre question ?{' '}
                <a className="font-semibold text-ink underline" href="/contact">
                  Écris-nous
                </a>
                .
              </>
            }
          />
          <Faq items={FAQ_GENERAL} />
        </div>
      </section>
    </PageShell>
  );
}

function Hero(): ReactElement {
  return (
    <section className="site-section hero-section" aria-labelledby="hero-title">
      <div className="site-container grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div>
          <span className="chip chip-outline h-9 px-3 text-sm">
            <Icon name="calendar" />
            Ouverture le {PRODUCT.launchDateLabel}
          </span>
          <h1 id="hero-title" className="display hero-title mt-5">
            Apporte des clients. Touche une commission <span className="serif-accent">récurrente</span>.
          </h1>
          <p className="lead mt-5 max-w-xl">
            Stacker propose aux entreprises des services qu’il réalise lui-même : site web, avis Google, posts Instagram, visibilité Google. L’app
            trouve les entreprises, tu les appelles et tu obtiens leur accord. Elles signent ensuite directement avec Stacker, et tu touches une
            commission chaque mois tant que ton client reste abonné.
          </p>
          <div className="mt-8 flex flex-col gap-3 md:flex-row">
            <a className="btn btn-primary btn-lg" href="#rejoindre">
              Rejoindre la liste d’attente
              <Icon name="arrow-right" />
            </a>
            <a className="btn btn-secondary btn-lg" href="#comment">
              Comment ça marche
            </a>
          </div>
          <div className="mt-6 min-h-9">
            <Island name="waitlist-count" props={{ variant: 'pill' }} as="span" />
          </div>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

/** Aperçu de l'app. Aucun montant : seulement des statuts, marqués « Exemple illustratif ». */
function HeroVisual(): ReactElement {
  const rows: { name: string; service: string; status: string; chip: string }[] = [
    { name: 'Boulangerie', service: 'Visibilité Google', status: 'Disponible', chip: 'chip-green' },
    { name: 'Garage', service: 'Site web', status: 'En validation', chip: 'chip-orange' },
    { name: 'Plombier', service: 'Avis Google', status: 'Signée', chip: 'chip-violet' },
  ];
  return (
    <figure className="hero-visual relative mx-auto w-full max-w-md" aria-labelledby="hero-visual-caption">
      <figcaption id="hero-visual-caption" className="sr-only">
        Exemple illustratif de l’app : niveau Pro à 18 %, et statut de trois commissions.
      </figcaption>
      <span className="sticker deco-sticker hero-sticker-top">
        <Icon name="trending-up" />
        Commission récurrente
      </span>
      <div className="card" aria-hidden="true">
        <div className="flex items-center justify-between gap-2">
          <span className="level level-pro">
            <span className="level-mark">
              <Icon name="star" />
            </span>
            Pro <span className="level-rate">· 18 %</span>
          </span>
          <span className="text-xs font-semibold text-ink-2">Exemple illustratif</span>
        </div>
        <p className="mt-4 text-sm text-ink-2">Prochain niveau</p>
        <p className="mt-1 font-display text-xl font-heavy tracking-title">Legend · 22 %</p>
        <div className="progress progress-violet progress-64 mt-4">
          <span className="progress-bar" />
        </div>
      </div>
      <div className="card card-dark mt-4" aria-hidden="true">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-on-dark-2">Tes commissions</p>
          <span className="chip chip-on-dark">En temps réel</span>
        </div>
        <ul className="mt-3 grid gap-1">
          {rows.map((row) => (
            <li key={row.name} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{row.name}</span>
                <span className="block truncate text-sm text-on-dark-2">{row.service}</span>
              </span>
              <span className={`chip ${row.chip}`}>{row.status}</span>
            </li>
          ))}
        </ul>
      </div>
      <span className="sticker sticker-paper sticker-serif deco-sticker hero-sticker-bottom">sans engagement</span>
    </figure>
  );
}

const STEPS: { icon: IconName; title: string; text: string; tone: string; sticker: string }[] = [
  {
    icon: 'search',
    title: 'L’app trouve les entreprises',
    text: 'Choisis ta zone : l’app te sort les entreprises à contacter et t’aide à préparer chaque prise de contact.',
    tone: 'bg-green-50 text-green-ink',
    sticker: 'sticker',
  },
  {
    icon: 'phone',
    title: 'Tu appelles et tu convaincs',
    text: 'Tu appelles avec les scripts et l’aide intégrés à l’app. Quand l’entreprise est d’accord, elle reçoit un lien sécurisé et signe elle-même avec Stacker.',
    tone: 'bg-violet-50 text-violet-ink',
    sticker: 'sticker sticker-violet',
  },
  {
    icon: 'euro',
    title: 'Stacker réalise, tu touches ta commission',
    text: 'Stacker réalise le service pour l’entreprise. Toi, tu touches ta commission, chaque mois tant que le client reste abonné.',
    tone: 'bg-orange-50 text-orange-ink',
    sticker: 'sticker sticker-orange',
  },
];

function HowItWorks(): ReactElement {
  return (
    <section className="site-section" id="comment" aria-labelledby="comment-title">
      <div className="site-container">
        <SectionHeading
          id="comment-title"
          eyebrow="Comment ça marche"
          title={
            <>
              Trois étapes. <span className="serif-accent">Pas une de plus.</span>
            </>
          }
          lead="Tu n’as rien à produire ni à livrer : ton travail, c’est de trouver les entreprises intéressées et de les convaincre."
        />
        <ol className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="card relative">
              <span className={`${step.sticker} step-num`} aria-hidden="true">
                0{i + 1}
              </span>
              <span className={`step-icon ${step.tone}`}>
                <Icon name={step.icon} />
              </span>
              <h3 className="h3 mt-5">
                <span className="sr-only">Étape {i + 1} : </span>
                {step.title}
              </h3>
              <p className="text-2 mt-2">{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const SERVICES: { icon: IconName; title: string; text: string; tone: string }[] = [
  { icon: 'building', title: 'Site web', text: 'Un site professionnel pour l’entreprise, réalisé par Stacker.', tone: 'avatar-violet' },
  { icon: 'star', title: 'Avis Google', text: 'Une démarche pour demander un avis à tous les clients de l’entreprise.', tone: 'avatar-orange' },
  { icon: 'message', title: 'Posts Instagram', text: 'Des publications pour faire vivre le compte de l’entreprise.', tone: 'avatar-pink' },
  { icon: 'map-pin', title: 'Visibilité Google', text: 'Un travail sur la présence de l’entreprise dans les recherches locales.', tone: 'avatar-green' },
];

function Services(): ReactElement {
  return (
    <section className="site-section bg-bg-2" aria-labelledby="services-title">
      <div className="site-container">
        <SectionHeading
          id="services-title"
          eyebrow="Ce que tu proposes"
          title="Des services simples à présenter à un commerce."
          lead="C’est Stacker qui vend, réalise et suit le service. Tu n’as aucune compétence technique à avoir."
        />
        <ul className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
          {SERVICES.map((s) => (
            <li key={s.title} className="card flex gap-4">
              <span className={`avatar ${s.tone}`}>
                <Icon name={s.icon} />
              </span>
              <div className="min-w-0">
                <h3 className="h3">{s.title}</h3>
                <p className="text-2 mt-1">{s.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Commissions(): ReactElement {
  return (
    <section className="site-section" id="paliers" aria-labelledby="paliers-title">
      <div className="site-container">
        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
          <div>
            <span className="eyebrow">Commissions</span>
            <h2 id="paliers-title" className="mt-5">
              <Ransom text="De 15 à 25 %" className="ransom-fluid justify-start" />
            </h2>
            <p className="lead mt-6 max-w-xl">
              Ton taux de commission dépend de ton niveau : 15 %, puis 18 %, 22 % et 25 %. Elle est récurrente : tu la touches chaque mois, tant
              que ton client reste abonné.
            </p>
            <p className="text-small mt-4 max-w-xl">
              Aucun montant de gain n’est promis : tes commissions dépendent uniquement des clients que tu apportes.
            </p>
          </div>
          <TierList />
        </div>

        <div className="card mt-10">
          <h3 className="h3">Quand ta commission est disponible</h3>
          <ol className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
            {AVAILABILITY_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span className="timeline-dot" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <h4 className="font-semibold text-ink">{step.title}</h4>
                  <p className="text-2 mt-1 text-sm">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Subscription(): ReactElement {
  return (
    <section className="site-section bg-bg-2" id="abonnement" aria-labelledby="abonnement-title">
      <div className="site-container">
        <SectionHeading
          id="abonnement-title"
          eyebrow="Abonnement"
          title={
            <>
              Tous les outils, <span className="serif-accent">un seul prix</span>.
            </>
          }
          lead="Le logiciel de prospection, les scripts et la formation sont inclus dans l’abonnement stacker."
        />
        <div className="mt-12 grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
          <PricingCard />
          <LaunchOfferCard />
        </div>
      </div>
    </section>
  );
}

function Join(): ReactElement {
  return (
    <section className="site-section" id="rejoindre" aria-labelledby="rejoindre-title">
      <div className="site-container grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="lg:sticky lg:top-24">
          <SectionHeading
            id="rejoindre-title"
            eyebrow="Liste d’attente"
            title={
              <>
                Prends ta place <span className="serif-accent">avant l’ouverture</span>.
              </>
            }
            lead={`Stacker ouvre le ${PRODUCT.launchDateLabel}. Les inscrits sont prévenus par email, dans l’ordre d’inscription.`}
          />
          <ul className="tick-list mt-6 max-w-xl">
            <li>
              <span className="tick">
                <Icon name="trophy" />
              </span>
              <span>
                <b className="font-semibold">Priorité sur les {LAUNCH_OFFER.seats} places</b> de l’offre de lancement.
              </span>
            </li>
            <li>
              <span className="tick">
                <Icon name="target" />
              </span>
              <span>
                <b className="font-semibold">Ta position tout de suite</b>, confirmée par email.
              </span>
            </li>
            <li>
              <span className="tick">
                <Icon name="shield" />
              </span>
              <span>
                <b className="font-semibold">Gratuit et sans engagement</b> : aucun moyen de paiement demandé.
              </span>
            </li>
          </ul>
        </div>
        <Island name="waitlist-form" props={{ context: 'landing' }} />
      </div>
    </section>
  );
}
