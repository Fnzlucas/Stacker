/**
 * Présentation de Stacker, au premier lancement (avant l'inscription) et, si
 * elle n'a pas été vue, avant les questions de l'inscription : ce que c'est,
 * ce qu'on propose aux commerçants, comment ça marche en 3 temps (apprendre,
 * appeler, encaisser), les règles, puis les formules (gratuit pour vendre,
 * Academy et Pro en option). Écrans plein format, à faire défiler (boutons, glisser
 * du doigt, flèches du clavier). Aucun gain promis : l'exemple est signalé.
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { LogoLockup } from '../../components/Logo';
import { Ransom } from '../../components/Ransom';
import { PLANS } from '../../config/site';
import { isNativeApp } from '../lib/platform';

interface Slide {
  id: string;
  kicker: string;
  title: string;
  text: string;
  visual: ReactNode;
}

function Bubble({ who, children }: { who: 'them' | 'me'; children: ReactNode }): ReactElement {
  return <p className={`intro-bubble is-${who}`}>{children}</p>;
}

function Step({ icon, tone, title, text }: { icon: IconName; tone: string; title: string; text: string }): ReactElement {
  return (
    <li className="intro-flow-step">
      <span className={`intro-flow-icon is-${tone}`} aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span>
        <b>{title}</b>
        <span>{text}</span>
      </span>
    </li>
  );
}

/** Services les plus simples à proposer (prix pour le commerçant, catalogue de l'app). */
const OFFERS: { name: string; what: string; price: string; per: string; icon: IconName; tone: string; big?: boolean }[] = [
  { name: 'QR Avis Google', what: 'Plus d’avis, sans effort', price: '9\u00a0€', per: '/ mois', icon: 'star', tone: 'green' },
  { name: 'Fiche Google', what: 'Bien visible sur Google Maps', price: '39\u00a0€', per: '/ mois', icon: 'map-pin', tone: 'violet' },
  { name: 'Réseaux sociaux', what: 'Des posts chaque semaine', price: '49\u00a0€', per: '/ mois', icon: 'send', tone: 'green' },
  { name: 'Site sur mesure', what: 'Gros ticket, payé en une fois', price: '1\u00a0490\u00a0€', per: 'une fois', icon: 'building', tone: 'orange', big: true },
];

function slides(native: boolean): Slide[] {
  const list: Slide[] = [
    {
      id: 'quoi',
      kicker: 'Bienvenue',
      title: 'C’EST QUOI STACKER ?',
      text: 'Stacker propose aux commerçants des services qui les font gagner des clients : fiche Google, avis, sites sur mesure, réseaux sociaux. Toi, tu trouves les commerçants intéressés. Stacker fait tout le travail. Et c’est gratuit pour démarrer.',
      visual: (
        <ol className="intro-flow">
          <Step icon="search" tone="green" title="Tu trouves un commerçant" text="L’app te donne les entreprises à contacter." />
          <Step icon="phone" tone="violet" title="Tu le convaincs" text="Au téléphone, avec les scripts de l’app." />
          <Step icon="signature" tone="orange" title="Il signe sur ton téléphone" text="Stacker réalise le service pour lui." />
          <Step icon="euro" tone="green" title="Tu touches ta commission" text="Chaque mois, ou d’un coup sur les gros tickets." />
        </ol>
      ),
    },
    {
      id: 'offres',
      kicker: 'Ce que tu proposes',
      title: 'DES SERVICES QUI MARCHENT',
      text: 'Des abonnements simples, que les commerçants comprennent tout de suite, et des gros tickets sur mesure payés en une fois. C’est Stacker qui les réalise : toi, tu n’as rien à produire ni à livrer.',
      visual: (
        <ul className="intro-offers" aria-hidden="true">
          {OFFERS.map((o) => (
            <li key={o.name} className={o.big ? 'is-big' : undefined}>
              <span className={`intro-flow-icon is-${o.tone}`}>
                <Icon name={o.icon} />
              </span>
              <span className="intro-offer-name">
                <b>{o.name}</b>
                <span>{o.what}</span>
              </span>
              <span className="intro-offer-price">
                {o.big ? null : 'dès '}
                <b className="num">{o.price}</b>
                <span>{o.per}</span>
              </span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: 'apprends',
      kicker: 'En option · Academy',
      title: 'APPRENDS À CONVAINCRE',
      text: 'Jamais vendu de ta vie ? Entraîne-toi : un commerçant joué par une IA décroche, hésite, objecte… et peut raccrocher. Tu parles comme au téléphone, et tu reçois une note sur 100 avec des conseils précis.',
      visual: (
        <div className="intro-phone" aria-hidden="true">
          <p className="intro-phone-head">
            <span className="intro-avatar">SM</span>
            <span>
              <b>Sophie · Boulangerie Martin</b>
              <span>Appel d’entraînement</span>
            </span>
          </p>
          <Bubble who="them">Boulangerie Martin, bonjour !</Bubble>
          <Bubble who="me">Bonjour, j’ai vu que votre fiche Google indique 19 h le dimanche…</Bubble>
          <Bubble who="them">Ah bon ? Et ça coûte combien votre truc ?</Bubble>
          <p className="intro-score">
            <span className="num">80</span>/100 · Réussi
          </p>
        </div>
      ),
    },
    {
      id: 'appelle',
      kicker: 'En option · Pro',
      title: 'TROUVE TES CLIENTS',
      text: 'Avec Pro, l’app trouve les entreprises de ta zone et leur envoie un premier email depuis ta boîte, au bon rythme : tu rappelles celles qui répondent. Sans Pro, tu prospectes à ta façon. Dans tous les cas, le client signe sur ton téléphone.',
      visual: (
        <div className="intro-stack" aria-hidden="true">
          <p className="intro-card">
            <Icon name="send" />
            <span>
              <b>Campagne en cours</b>
              <span>9 emails envoyés aujourd’hui · 2 réponses</span>
            </span>
          </p>
          <p className="intro-card">
            <Icon name="building" />
            <span>
              <b>Garage du Pont</b>
              <span>A répondu · à rappeler ce matin</span>
            </span>
            <span className="intro-chip">Appeler</span>
          </p>
          <p className="intro-card is-signed">
            <Icon name="signature" />
            <span>
              <b>Contrat signé</b>
              <span>Fiche Google · le client signe sur ton écran</span>
            </span>
          </p>
        </div>
      ),
    },
    {
      id: 'encaisse',
      kicker: 'Tes commissions',
      title: 'ENCAISSE',
      text: '15 à 25 % de ce que paie ton client : chaque mois s’il est abonné, ou d’un coup sur le prix total d’un gros ticket. Débloqué le jour où le client est prélevé, viré quand tu veux.',
      visual: (
        <div className="intro-stack" aria-hidden="true">
          <p className="intro-money">
            <span className="intro-money-label">Exemple illustratif</span>
            <span className="intro-money-amount num">+ 10,49 €</span>
            <span>par mois · client à 69,99 € · taux 15 %</span>
          </p>
          <p className="intro-money is-big">
            <span className="intro-money-label">Exemple illustratif</span>
            <span className="intro-money-amount num">+ 223,50 €</span>
            <span>en une fois · site sur mesure à 1 490 € · taux 15 %</span>
          </p>
          <ol className="intro-levels">
            <li>
              Rookie <b>15 %</b>
            </li>
            <li>
              Pro <b>18 %</b>
            </li>
            <li>
              Legend <b>22 %</b>
            </li>
            <li>
              Elite <b>25 %</b>
            </li>
          </ol>
          <p className="intro-fine">Aucun gain n’est garanti : tes commissions dépendent des clients que tu apportes et qui paient.</p>
        </div>
      ),
    },
  ];
  list.push({
    id: 'regles',
    kicker: 'Les règles du jeu',
    title: 'À TON RYTHME',
    text: 'Tu es indépendant : tu choisis tes horaires et ta zone, partout en France. Il faut juste être majeur. Pas besoin de statut pour démarrer.',
    visual: (
      <ul className="intro-rules" aria-hidden="true">
        <li>
          <Icon name="clock" />
          <span>
            <b>Quand tu veux</b>
            <span>Quelques appels par jour ou un vrai complément : c’est toi qui décides.</span>
          </span>
        </li>
        <li>
          <Icon name="briefcase" />
          <span>
            <b>Sans statut au départ</b>
            <span>Au-delà de 1 000 € de commissions par an, il te faudra une micro-entreprise (gratuite, en ligne).</span>
          </span>
        </li>
        <li>
          <Icon name="shield" />
          <span>
            <b>Rien de caché</b>
            <span>Sans engagement, aucun gain promis : tu gagnes seulement sur les clients qui paient.</span>
          </span>
        </li>
      </ul>
    ),
  });
  // Dans l'application iPhone : ni prix ni formules (règles de l'App Store).
  if (!native) {
    list.push({
      id: 'formules',
      kicker: 'Tes formules',
      title: 'GRATUIT POUR VENDRE',
      text: 'Tu fais signer tes clients et tu touches tes commissions gratuitement, aux mêmes taux. En option : Academy pour t’entraîner, Pro pour le logiciel de prospection. Sans engagement.',
      visual: (
        <ul className="intro-plans" aria-hidden="true">
          <li className="is-free">
            <span className="intro-plan-name">
              <b>Gratuit</b>
              <span className="intro-chip">Pour démarrer</span>
            </span>
            <span className="intro-plan-price">
              <b className="num">0 €</b>
            </span>
          </li>
          {[...PLANS].reverse().map((p) => (
            <li key={p.id} className={p.id === 'duo' ? 'is-best' : undefined}>
              <span className="intro-plan-name">
                <b>{p.name}</b>
                {p.id === 'duo' ? <span className="intro-chip">Le plus complet</span> : null}
              </span>
              <span className="intro-plan-price">
                <b className="num">{p.price}</b> / mois
              </span>
            </li>
          ))}
        </ul>
      ),
    });
  }
  return list;
}

/**
 * `onDone` : fin ou « Passer ». `end` : boutons du dernier écran à la place de
 * « C’est parti » (avant l'inscription : créer un compte / se connecter).
 */
export function OnboardingIntro({ onDone, end }: { onDone: () => void; end?: ReactNode }): ReactElement {
  const list = slides(isNativeApp());
  const count = list.length;
  const [i, setI] = useState(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const start = useRef<number | null>(null);
  const first = useRef(true);
  const last = i === list.length - 1;
  const slide = list[i] ?? list[0];

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    titleRef.current?.focus();
  }, [i]);

  const go = (n: number) => {
    if (n >= list.length) onDone();
    else setI(Math.max(0, n));
  };
  // Flèches du clavier et glisser du doigt, sur tout l'écran.
  useEffect(() => {
    const go = (n: number) => {
      if (n >= count) onDone();
      else setI(Math.max(0, n));
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(i + 1);
      if (e.key === 'ArrowLeft') go(i - 1);
    };
    const down = (e: PointerEvent) => {
      start.current = e.clientX;
    };
    const up = (e: PointerEvent) => {
      if (start.current === null) return;
      const dx = e.clientX - start.current;
      start.current = null;
      if (dx < -60) go(i + 1);
      if (dx > 60) go(i - 1);
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
    };
  }, [i, count, onDone]);

  if (!slide) return <></>;
  return (
    <div
      className="intro"
      role="region"
      aria-roledescription="présentation"
      aria-label="Comment fonctionne Stacker"
    >
      <header className="intro-top">
        <LogoLockup size={26} inverse />
        {!last ? (
          <button type="button" className="intro-skip" onClick={onDone}>
            Passer
          </button>
        ) : null}
      </header>

      <main id="contenu" className="intro-main" key={slide.id}>
        <p className="intro-kicker">{slide.kicker}</p>
        <h1 ref={titleRef} tabIndex={-1} className="intro-title">
          <Ransom text={slide.title} animated className="ransom-sm justify-start" />
        </h1>
        <div className="intro-visual">{slide.visual}</div>
        <p className="intro-text">{slide.text}</p>
      </main>

      <footer className="intro-bottom">
        <ol className="intro-dots" aria-label="Progression">
          {list.map((s, n) => (
            <li key={s.id} className={n === i ? 'is-on' : undefined} aria-current={n === i ? 'step' : undefined}>
              <span className="sr-only">
                Écran {n + 1} sur {list.length}
              </span>
            </li>
          ))}
        </ol>
        <div className="intro-actions">
          {i > 0 ? (
            <button type="button" className="btn btn-glass intro-back" onClick={() => go(i - 1)} aria-label="Écran précédent">
              <Icon name="arrow-left" />
            </button>
          ) : null}
          {last && end ? (
            <div className="intro-end">{end}</div>
          ) : (
            <button type="button" className="btn btn-accent btn-lg intro-next" onClick={() => go(i + 1)}>
              {last ? 'C’est parti' : 'Suivant'}
              <Icon name="arrow-right" />
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

const SEEN_KEY = 'stk-intro-seen';

/** Présentation déjà vue sur cet appareil (sinon : affichée au premier lancement). */
export function introSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* stockage indisponible : la présentation pourra réapparaître */
  }
}
