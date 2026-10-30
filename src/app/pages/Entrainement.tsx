import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../../components/Icon';
import { Ransom } from '../../components/Ransom';
import { useSignedIn } from '../auth/AuthProvider';
import { FormAlert } from '../components/Form';
import { AppBar, LoadError, usePageTitle } from '../components/Layouts';
import {
  CRITERIA_LABEL,
  DIFFICULTY_LABEL,
  finishRoleplay,
  OUTCOME_LABEL,
  ROLEPLAY_SCENARIOS,
  roleplayErrorMessage,
  sayRoleplay,
  scenarioById,
  startRoleplay,
  type Feedback,
  type RoleplayScenario,
} from '../lib/roleplay';
import { ROLEPLAY_KEY, useRoleplay, useRoleplayDetail } from '../lib/roleplayQueries';
import { buzz, createCallSounds, type CallSounds } from '../lib/sounds';
import { canListen, listen, speak, stopSpeaking, unlockSpeech, type Listener } from '../lib/speech';
import { PATHS } from '../paths';

interface Line {
  role: 'stacker' | 'prospect';
  text: string;
}

interface Result {
  score: number;
  passed: boolean;
  passScore: number;
  stackerTurns: number;
  minTurns: number;
  feedback: Feedback;
}

type Phase = { kind: 'choose' } | { kind: 'call'; scenario: RoleplayScenario; sessionId: string; maxChars: number; opening: string } | { kind: 'result'; scenario: RoleplayScenario; result: Result };

const TONE: Record<string, 'green' | 'violet' | 'orange'> = { facile: 'green', moyen: 'violet', difficile: 'orange' };
const FLAMES: Record<string, number> = { facile: 1, moyen: 2, difficile: 3 };
const CRITERIA = ['presentation', 'accroche', 'decouverte', 'offre', 'conclusion'] as const;
/** Durée de la sonnerie avant que le commerçant décroche. */
const RING_MS = 2400;

const reducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Entraînement à l'appel : un commerçant joué par une IA, à la voix, puis un bilan noté. */
export function EntrainementPage(): ReactElement {
  usePageTitle('Entraînement');
  const [params, setParams] = useSearchParams();
  const review = params.get('appel');
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' });
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const sounds = useRef<CallSounds | null>(null);
  const { backend } = useSignedIn();
  const qc = useQueryClient();

  useEffect(() => () => sounds.current?.close(), []);

  const start = async (scenario: RoleplayScenario) => {
    // Pendant le geste de l'utilisateur : déblocage de la voix et du son (iOS).
    unlockSpeech();
    sounds.current ??= createCallSounds();
    setError(null);
    setStarting(scenario.id);
    try {
      const s = await startRoleplay(backend, scenario.id);
      setPhase({ kind: 'call', scenario, sessionId: s.session_id, maxChars: s.max_chars, opening: s.opening });
      void qc.invalidateQueries({ queryKey: ROLEPLAY_KEY });
    } catch (e) {
      setError(roleplayErrorMessage(e));
    } finally {
      setStarting(null);
    }
  };

  if (review) return <Review id={review} onBack={() => setParams({}, { replace: true })} />;
  if (phase.kind === 'call') {
    return (
      <Call
        key={phase.sessionId}
        scenario={phase.scenario}
        sessionId={phase.sessionId}
        maxChars={phase.maxChars}
        opening={phase.opening}
        sounds={sounds}
        onResult={(result) => {
          setPhase({ kind: 'result', scenario: phase.scenario, result });
          void qc.invalidateQueries({ queryKey: ROLEPLAY_KEY });
        }}
        onQuit={() => setPhase({ kind: 'choose' })}
      />
    );
  }
  if (phase.kind === 'result') {
    return <ResultView scenario={phase.scenario} result={phase.result} onRetry={() => void start(phase.scenario)} onChoose={() => setPhase({ kind: 'choose' })} />;
  }
  return <Choose error={error} starting={starting} onStart={(s) => void start(s)} />;
}

// -----------------------------------------------------------------------------
// Choix du commerçant
// -----------------------------------------------------------------------------

function Choose({ error, starting, onStart }: { error: string | null; starting: string | null; onStart: (s: RoleplayScenario) => void }): ReactElement {
  const state = useRoleplay();
  const [, setParams] = useSearchParams();
  const s = state.data;
  const left = s ? Math.max(0, s.today.limit - s.today.used) : null;
  return (
    <div className="app-container training">
      <AppBar title="Entraînement" />
      <section className="card card-dark training-hero" aria-labelledby="training-intro">
        <div className="training-hero-deco" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <h2 id="training-intro" className="training-hero-title">
          <Ransom text="DÉCROCHE TON OUI" animated className="ransom-sm" />
        </h2>
        <p className="training-hero-lead">
          Un commerçant joué par une IA décroche et réagit comme un vrai : il objecte, il hésite, il peut raccrocher. Parle à voix haute, comme au téléphone. À la fin,
          ta note sur 100 et des conseils précis.
        </p>
        {s ? (
          <div className="training-status">
            {s.passed ? (
              <span className="chip chip-green">
                <Icon name="check" /> Entraînement réussi
              </span>
            ) : s.required ? (
              <span className="chip chip-orange">
                <Icon name="lock" /> Obligatoire avant ta première signature
              </span>
            ) : null}
            <span className="training-quota">
              Réussite à partir de {s.pass_score}/100, avec au moins {s.min_stacker_turns} répliques · {left} simulation{left === 1 ? '' : 's'} restante{left === 1 ? '' : 's'} aujourd’hui
            </span>
          </div>
        ) : null}
        {!canListen() ? (
          <p className="training-note">
            <Icon name="info" /> Ton navigateur ne permet pas la dictée vocale : tu pourras écrire tes phrases. Pour parler, ouvre l’app dans Chrome ou Safari.
          </p>
        ) : null}
      </section>

      {error ? <FormAlert>{error}</FormAlert> : null}
      {state.isError ? <LoadError onRetry={() => void state.refetch()} /> : null}

      <section aria-labelledby="training-list">
        <h2 id="training-list" className="h2 section-title">
          Choisis ton commerçant
        </h2>
        <ul className="training-list">
          {ROLEPLAY_SCENARIOS.map((sc) => {
            const tone = TONE[sc.difficulty] ?? 'violet';
            return (
              <li key={sc.id} className={`card training-card is-${tone}`}>
                <div className="training-card-band" aria-hidden="true" />
                <div className="training-card-head">
                  <span className="training-sticker" aria-hidden="true">
                    {initials(sc.contact)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="training-business">{sc.business}</span>
                    <span className="list-sub">
                      {sc.contact}, {sc.role} · {sc.city}
                    </span>
                    <span className={`chip chip-${tone} training-level`}>
                      <span className="training-flames" aria-hidden="true">
                        {Array.from({ length: 3 }, (_, i) => (
                          <Icon key={i} name="flame" className={i < (FLAMES[sc.difficulty] ?? 1) ? 'is-on' : ''} />
                        ))}
                      </span>
                      {DIFFICULTY_LABEL[sc.difficulty]}
                    </span>
                  </span>
                </div>
                <div className="training-noticed">
                  <p className="training-label">Ce que tu as remarqué</p>
                  <ul>
                    {sc.noticed.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                  <p className="training-offers">
                    <Icon name="briefcase" /> {sc.offers}
                  </p>
                </div>
                <button type="button" className="btn btn-accent training-call-btn" onClick={() => onStart(sc)} disabled={starting !== null || left === 0} aria-busy={starting === sc.id}>
                  <Icon name="phone" />
                  {starting === sc.id ? 'Connexion…' : `Appeler ${sc.contact.split(' ')[0] ?? ''}`}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {s && s.history.length > 0 ? (
        <section aria-labelledby="training-history">
          <h2 id="training-history" className="h2 section-title">
            Tes derniers appels
          </h2>
          <ul className="card list">
            {s.history.map((h) => {
              const sc = scenarioById(h.scenario);
              return (
                <li key={h.id}>
                  <button type="button" className="list-row training-history-row" onClick={() => setParams({ appel: h.id })} disabled={h.status !== 'terminee'}>
                    <span className="list-main">
                      <span className="list-title">{sc?.business ?? h.scenario}</span>
                      <span className="list-sub">{new Date(h.started_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </span>
                    {h.status === 'terminee' ? (
                      <span className={`chip ${h.passed ? 'chip-green' : 'chip-orange'}`}>{h.score ?? 0}/100</span>
                    ) : (
                      <span className="chip">Interrompu</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// L'appel
// -----------------------------------------------------------------------------

type Status = 'ringing' | 'prospect-speaking' | 'your-turn' | 'listening' | 'thinking' | 'ending';

const STATUS_LABEL: Record<Status, string> = {
  ringing: 'Appel en cours…',
  'prospect-speaking': 'Le commerçant parle…',
  'your-turn': 'À toi de parler',
  listening: 'Je t’écoute…',
  thinking: 'Le commerçant réfléchit…',
  ending: 'Analyse de ton appel…',
};

function Call({
  scenario,
  sessionId,
  maxChars,
  opening,
  sounds,
  onResult,
  onQuit,
}: {
  scenario: RoleplayScenario;
  sessionId: string;
  maxChars: number;
  opening: string;
  sounds: { readonly current: CallSounds | null };
  onResult: (r: Result) => void;
  onQuit: () => void;
}): ReactElement {
  const { backend } = useSignedIn();
  const voiceOk = canListen();
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState<Status>('ringing');
  const [partial, setPartial] = useState('');
  const [voiceTick, setVoiceTick] = useState(0);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [handsFree, setHandsFree] = useState(voiceOk);
  const [seconds, setSeconds] = useState(0);
  const listener = useRef<Listener | null>(null);
  const ended = useRef(false);
  const handsFreeRef = useRef(handsFree);
  useEffect(() => {
    handsFreeRef.current = handsFree;
  }, [handsFree]);
  const sendRef = useRef<(text: string) => void>(() => undefined);
  const bottom = useRef<HTMLDivElement>(null);
  const connected = status !== 'ringing';

  useEffect(() => {
    if (!connected) return undefined;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [connected]);
  useEffect(() => {
    // Accolades : scrollIntoView renvoie une promesse dans les Chrome récents, React la prendrait pour une fonction de nettoyage.
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [lines, partial]);
  useEffect(
    () => () => {
      listener.current?.abort();
      stopSpeaking();
    },
    [],
  );

  const finish = useCallback(async () => {
    if (ended.current) return;
    ended.current = true;
    listener.current?.abort();
    stopSpeaking();
    sounds.current?.hangup();
    setStatus('ending');
    setError(null);
    try {
      const r = await finishRoleplay(backend, sessionId);
      onResult({ score: r.score, passed: r.passed, passScore: r.pass_score, stackerTurns: r.stacker_turns, minTurns: r.min_stacker_turns, feedback: r.feedback });
    } catch (e) {
      ended.current = false;
      setStatus('your-turn');
      setError(roleplayErrorMessage(e));
    }
  }, [backend, sessionId, onResult, sounds]);

  const startListening = useCallback(() => {
    if (ended.current || !voiceOk) return;
    setPartial('');
    setStatus('listening');
    listener.current = listen({
      onPartial: (t) => {
        setPartial(t);
        setVoiceTick((n) => n + 1);
      },
      onDone: (text) => {
        listener.current = null;
        setPartial('');
        if (text) sendRef.current(text);
        else setStatus('your-turn');
      },
      onError: (code) => {
        setStatus('your-turn');
        const denied = code === 'not-allowed' || code === 'service-not-allowed';
        // Micro refusé : on arrête de le relancer à chaque réponse (le stacker peut le rallumer).
        if (denied) setHandsFree(false);
        setError(denied ? 'Autorise l’accès au micro pour parler, ou écris tes phrases.' : 'Le micro n’a pas fonctionné. Réessaie ou écris ta phrase.');
      },
    });
    if (!listener.current) setStatus('your-turn');
  }, [voiceOk]);

  const prospectSays = useCallback(
    async (text: string, hungUp: boolean) => {
      setLines((l) => [...l, { role: 'prospect', text }]);
      setStatus('prospect-speaking');
      await speak(text, scenario.voice);
      if (ended.current) return;
      if (hungUp) {
        void finish();
        return;
      }
      setStatus('your-turn');
      if (handsFreeRef.current) startListening();
    },
    [scenario.voice, finish, startListening],
  );

  async function send(raw: string) {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, maxChars);
    if (!text || ended.current) return;
    setError(null);
    setLines((l) => [...l, { role: 'stacker', text }]);
    setStatus('thinking');
    try {
      const r = await sayRoleplay(backend, sessionId, text);
      await prospectSays(r.reply, r.hung_up);
    } catch (e) {
      setStatus('your-turn');
      setError(roleplayErrorMessage(e));
    }
  }
  useEffect(() => {
    sendRef.current = (t: string) => void send(t);
  });

  // Ça sonne… puis le commerçant décroche.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return undefined;
    opened.current = true;
    const ring = reducedMotion() ? 600 : RING_MS;
    sounds.current?.ring(ring / 1000);
    const t = setTimeout(() => {
      sounds.current?.pickup();
      buzz(30);
      void prospectSays(opening, false);
    }, ring);
    return () => clearTimeout(t);
  }, [prospectSays, opening, sounds]);

  const onSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const t = typed;
    setTyped('');
    void send(t);
  };

  const micBusy = status === 'thinking' || status === 'prospect-speaking' || status === 'ending' || status === 'ringing';
  const stackerTurns = lines.filter((l) => l.role === 'stacker').length;

  if (status === 'ending') return <Analysis scenario={scenario} />;

  return (
    <div className={`training-call is-${status}`}>
      <section className="call-card" aria-label={`Appel avec ${scenario.contact}`}>
        <div className="call-glow" aria-hidden="true" />
        <header className={`call-head${connected ? ' is-connected' : ''}`}>
          <span className={`call-avatar is-${TONE[scenario.difficulty] ?? 'violet'}`} aria-hidden="true">
            <span className="call-avatar-rings">
              <i />
              <i />
              <i />
            </span>
            {initials(scenario.contact)}
          </span>
          <div className="call-id">
            <p className="call-name">{scenario.contact}</p>
            <p className="call-sub">
              {scenario.business} · {connected ? <span className="num">{clock(seconds)}</span> : 'Appel en cours…'}
            </p>
          </div>
          <span className={`call-eq${status === 'prospect-speaking' ? ' is-on' : ''}`} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </header>

        <div className="call-lines" role="log" aria-live="polite" aria-label="Conversation">
          {!connected ? <p className="call-ringing">Ça sonne…</p> : null}
          {lines.map((l, i) => (
            <p key={i} className={`call-line is-${l.role}`}>
              <span className="sr-only">{l.role === 'stacker' ? 'Toi : ' : `${scenario.contact} : `}</span>
              {l.text}
            </p>
          ))}
          {partial ? <p className="call-line is-stacker is-partial">{partial}</p> : null}
          <div ref={bottom} />
        </div>

        <p className="call-status" role="status">
          {STATUS_LABEL[status]}
        </p>

        {error ? <FormAlert>{error}</FormAlert> : null}

        <div className="call-controls">
          {voiceOk ? (
            <button
              type="button"
              className={`call-mic${status === 'listening' ? ' is-listening' : ''}`}
              onClick={() => (status === 'listening' ? listener.current?.stop() : startListening())}
              disabled={micBusy}
              aria-label={status === 'listening' ? 'J’ai fini de parler' : 'Parler'}
            >
              <span key={voiceTick} className="call-mic-wave" aria-hidden="true" />
              <Icon name="mic" />
            </button>
          ) : null}
          <button type="button" className="call-hangup" onClick={() => void finish()} disabled={!connected} aria-label="Raccrocher et voir mon bilan">
            <Icon name="phone" />
          </button>
        </div>
        {voiceOk ? (
          <label className="call-toggle">
            <input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.target.checked)} />
            Micro automatique après chaque réponse
          </label>
        ) : null}

        <form className="call-type" onSubmit={onSubmit}>
          <label htmlFor="call-text" className="sr-only">
            Écrire ta phrase
          </label>
          <input
            id="call-text"
            className="input"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            maxLength={maxChars}
            placeholder={voiceOk ? 'Ou écris ta phrase…' : 'Écris ce que tu dis au commerçant…'}
            disabled={micBusy}
            autoComplete="off"
          />
          <button type="submit" className="btn btn-accent btn-sm" disabled={micBusy || !typed.trim()}>
            <Icon name="send" />
            <span className="sr-only">Envoyer</span>
          </button>
        </form>
        <p className="call-hint">
          {stackerTurns === 0 ? 'Présente-toi : ton nom, ton statut, et pourquoi tu appelles.' : 'Raccroche quand l’appel est terminé pour voir ton bilan.'}
        </p>
      </section>
      <button type="button" className="btn btn-ghost btn-sm call-quit" onClick={onQuit}>
        Quitter sans bilan
      </button>
    </div>
  );
}

/** Pendant que l'IA rédige le bilan : les critères défilent, un par un. */
function Analysis({ scenario }: { scenario: RoleplayScenario }): ReactElement {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, CRITERIA.length)), 650);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="training-call training-analysis" role="status" aria-live="polite">
      <div className="analysis-card">
        <span className="analysis-spinner" aria-hidden="true">
          <Icon name="star" />
        </span>
        <h1 className="analysis-title">Analyse de ton appel</h1>
        <p className="analysis-sub">avec {scenario.contact}</p>
        <ul className="analysis-steps">
          {CRITERIA.map((c, i) => (
            <li key={c} className={i < step ? 'is-done' : i === step ? 'is-current' : ''}>
              <span className="analysis-dot" aria-hidden="true">
                {i < step ? <Icon name="check" /> : null}
              </span>
              {CRITERIA_LABEL[c]}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Bilan
// -----------------------------------------------------------------------------

function ResultView({ scenario, result, onRetry, onChoose }: { scenario: RoleplayScenario; result: Result; onRetry: () => void; onChoose: () => void }): ReactElement {
  const tooShort = result.score >= result.passScore && result.stackerTurns < result.minTurns;
  return (
    <div className="app-container training">
      <AppBar title="Ton bilan" />
      <Feedback
        scenario={scenario}
        score={result.score}
        passed={result.passed}
        feedback={result.feedback}
        celebrate
        note={
          result.passed
            ? 'Entraînement réussi. Tu peux continuer à t’entraîner sur les autres commerçants.'
            : tooShort
              ? `Bonne note, mais l’appel était trop court : il faut au moins ${String(result.minTurns)} répliques pour valider.`
              : `Il faut ${String(result.passScore)}/100 pour valider. Relis les conseils et rappelle-le.`
        }
      />
      <div className="training-actions">
        <button type="button" className="btn btn-accent btn-lg" onClick={onRetry}>
          <Icon name="phone" /> Rappeler {scenario.contact.split(' ')[0]}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onChoose}>
          Choisir un autre commerçant
        </button>
        {result.passed ? (
          <Link className="btn btn-ghost" to={PATHS.prospects}>
            Passer à mes vrais prospects
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Review({ id, onBack }: { id: string; onBack: () => void }): ReactElement {
  const detail = useRoleplayDetail(id);
  const d = detail.data;
  const sc = d ? scenarioById(d.scenario) : undefined;
  return (
    <div className="app-container training">
      <AppBar
        title="Appel d’entraînement"
        actions={
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
            <Icon name="chevron-left" /> Retour
          </button>
        }
      />
      {detail.isError ? <LoadError onRetry={() => void detail.refetch()} /> : null}
      {d && sc && d.feedback ? <Feedback scenario={sc} score={d.score ?? 0} passed={d.passed} feedback={d.feedback} note={null} celebrate={false} /> : null}
      {d ? (
        <section className="card" aria-labelledby="review-turns">
          <h2 id="review-turns" className="h3">
            La conversation
          </h2>
          <div className="review-lines">
            {d.turns.map((t, i) => (
              <p key={i} className={`call-line is-${t.role}`}>
                <span className="review-who">{t.role === 'stacker' ? 'Toi' : (sc?.contact ?? 'Commerçant')}</span>
                {t.text}
              </p>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Nombre qui monte de 0 à `to` (instantané si les animations sont réduites). */
function useCountUp(to: number, ms = 1300): number {
  const [value, setValue] = useState(() => (reducedMotion() ? to : 0));
  useEffect(() => {
    if (reducedMotion()) return undefined;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      setValue(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return value;
}

function Feedback({ scenario, score, passed, feedback, note, celebrate }: { scenario: RoleplayScenario; score: number; passed: boolean; feedback: Feedback; note: string | null; celebrate: boolean }): ReactElement {
  const shown = useCountUp(score);
  const criteria = CRITERIA.map((k) => ({ k, ...feedback.criteres[k] }));
  const R = 70;
  const C = 2 * Math.PI * R;
  return (
    <>
      <section className={`card card-dark result-hero${passed ? ' is-passed' : ''}`} aria-labelledby="result-score">
        {celebrate && passed ? (
          <div className="deal-win-confetti result-confetti" aria-hidden="true">
            {Array.from({ length: 24 }, (_, i) => (
              <span key={i} className={`cf cf-${String(i % 12)}`} />
            ))}
          </div>
        ) : null}
        <p className="result-kicker">
          {scenario.business} · {OUTCOME_LABEL[feedback.issue] ?? feedback.issue}
        </p>
        <div className="result-gauge">
          <svg viewBox="0 0 160 160" aria-hidden="true">
            <circle className="result-gauge-track" cx="80" cy="80" r={R} />
            <circle className="result-gauge-value" cx="80" cy="80" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - shown / 100)} />
          </svg>
          <h2 id="result-score" className="result-score">
            <span className="sr-only">{score}/100</span>
            <span className="num" aria-hidden="true">
              {shown}
              <small>/100</small>
            </span>
          </h2>
        </div>
        <div className="result-verdict">
          <Ransom text={passed ? 'BIEN JOUÉ' : 'ENCORE UN EFFORT'} animated className="ransom-sm" />
        </div>
        <p className={`chip ${passed ? 'chip-green' : 'chip-orange'}`}>{passed ? 'Réussi' : 'Pas encore'}</p>
        {feedback.resume ? <p className="result-resume">{feedback.resume}</p> : null}
        {note ? <p className="result-note">{note}</p> : null}
      </section>

      {feedback.faute_grave ? (
        <FormAlert>
          <strong>Faute grave :</strong> {feedback.faute_grave} Ta note est plafonnée.
        </FormAlert>
      ) : null}

      <section className="card result-criteria" aria-labelledby="result-criteria">
        <h2 id="result-criteria" className="h3">
          Le détail
        </h2>
        <ul>
          {criteria.map((c, i) => {
            const note20 = Math.round(c.note);
            const tone = c.note >= 14 ? 'green' : c.note >= 10 ? 'violet' : 'orange';
            return (
              <li key={c.k} className={`result-criterion d-${String(i)}`}>
                <div className="result-criterion-head">
                  <span>{CRITERIA_LABEL[c.k]}</span>
                  <span className={`result-criterion-note is-${tone} num`}>{note20}/20</span>
                </div>
                <div
                  className={`result-bar is-${tone}`}
                  role="progressbar"
                  aria-label={`${CRITERIA_LABEL[c.k] ?? c.k} : ${String(note20)} sur 20`}
                  aria-valuemin={0}
                  aria-valuemax={20}
                  aria-valuenow={note20}
                >
                  <span style={{ width: `${String((c.note / 20) * 100)}%` }} />
                </div>
                <p className="text-2 text-sm">{c.commentaire}</p>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="result-columns">
        {feedback.points_forts.length > 0 ? (
          <section className="result-stickers is-good" aria-labelledby="result-good">
            <h2 id="result-good" className="result-stickers-title">
              <Icon name="trophy" /> Ce qui a marché
            </h2>
            <ul>
              {feedback.points_forts.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {feedback.a_ameliorer.length > 0 ? (
          <section className="result-stickers is-better" aria-labelledby="result-better">
            <h2 id="result-better" className="result-stickers-title">
              <Icon name="target" /> À améliorer
            </h2>
            <ul>
              {feedback.a_ameliorer.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {feedback.phrase_cle ? (
        <section className="result-key" aria-labelledby="result-key">
          <h2 id="result-key" className="result-key-title">
            La phrase à retenir
          </h2>
          <p>« {feedback.phrase_cle.replace(/^«\s*|\s*»$/g, '')} »</p>
        </section>
      ) : null}
    </>
  );
}

// -----------------------------------------------------------------------------

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function clock(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
