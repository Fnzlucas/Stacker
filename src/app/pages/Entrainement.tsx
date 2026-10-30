import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactElement, type SyntheticEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../../components/Icon';
import { useSignedIn } from '../auth/AuthProvider';
import { FormAlert } from '../components/Form';
import { AppBar, LoadError, usePageTitle } from '../components/Layouts';
import { ProgressBar } from '../components/Ui';
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

/** Entraînement à l'appel : un commerçant joué par une IA, à la voix, puis un bilan noté. */
export function EntrainementPage(): ReactElement {
  usePageTitle('Entraînement');
  const [params, setParams] = useSearchParams();
  const review = params.get('appel');
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' });
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const { backend } = useSignedIn();
  const qc = useQueryClient();

  const start = async (scenario: RoleplayScenario) => {
    unlockSpeech();
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
        <span className="training-hero-icon" aria-hidden="true">
          <Icon name="mic" />
        </span>
        <h2 id="training-intro" className="h3">
          Appelle un commerçant, pour de faux
        </h2>
        <p>
          Un commerçant joué par une IA décroche et réagit comme un vrai : il objecte, il hésite, il peut raccrocher. Parle à voix haute, comme au téléphone. À la fin, tu
          reçois une note sur 100 et des conseils précis.
        </p>
        {s ? (
          <p className="training-status">
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
          </p>
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
          {ROLEPLAY_SCENARIOS.map((sc) => (
            <li key={sc.id} className="card training-card">
              <div className="training-card-head">
                <span className={`avatar avatar-${TONE[sc.difficulty] ?? 'violet'}`} aria-hidden="true">
                  {initials(sc.contact)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="list-title">{sc.business}</span>
                  <span className="list-sub">
                    {sc.contact}, {sc.role} · {sc.city}
                  </span>
                </span>
                <span className={`chip chip-${TONE[sc.difficulty] ?? 'violet'}`}>{DIFFICULTY_LABEL[sc.difficulty]}</span>
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
              <button type="button" className="btn btn-accent" onClick={() => onStart(sc)} disabled={starting !== null || left === 0} aria-busy={starting === sc.id}>
                <Icon name="phone" />
                {starting === sc.id ? 'Appel en cours…' : `Appeler ${sc.contact.split(' ')[0] ?? ''}`}
              </button>
            </li>
          ))}
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

type Status = 'prospect-speaking' | 'your-turn' | 'listening' | 'thinking' | 'ending';

const STATUS_LABEL: Record<Status, string> = {
  'prospect-speaking': 'Le commerçant parle…',
  'your-turn': 'À toi de parler',
  listening: 'Je t’écoute…',
  thinking: 'Le commerçant réfléchit…',
  ending: 'Fin de l’appel, préparation de ton bilan…',
};

function Call({
  scenario,
  sessionId,
  maxChars,
  opening,
  onResult,
  onQuit,
}: {
  scenario: RoleplayScenario;
  sessionId: string;
  maxChars: number;
  opening: string;
  onResult: (r: Result) => void;
  onQuit: () => void;
}): ReactElement {
  const { backend } = useSignedIn();
  const voiceOk = canListen();
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState<Status>('prospect-speaking');
  const [partial, setPartial] = useState('');
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

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
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
  }, [backend, sessionId, onResult]);

  const startListening = useCallback(() => {
    if (ended.current || !voiceOk) return;
    setPartial('');
    setStatus('listening');
    listener.current = listen({
      onPartial: setPartial,
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

  // Le commerçant décroche.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    void prospectSays(opening, false);
  }, [prospectSays, opening]);

  const onSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const t = typed;
    setTyped('');
    void send(t);
  };

  const micBusy = status === 'thinking' || status === 'prospect-speaking' || status === 'ending';
  const stackerTurns = lines.filter((l) => l.role === 'stacker').length;

  return (
    <div className="app-container training-call">
      <section className="card card-dark call-card" aria-label={`Appel avec ${scenario.contact}`}>
        <header className="call-head">
          <span className={`call-avatar${status === 'prospect-speaking' ? ' is-speaking' : ''}`} aria-hidden="true">
            {initials(scenario.contact)}
          </span>
          <div className="min-w-0">
            <p className="call-name">{scenario.contact}</p>
            <p className="call-sub">
              {scenario.business} · <span className="num">{clock(seconds)}</span>
            </p>
          </div>
        </header>

        <div className="call-lines" role="log" aria-live="polite" aria-label="Conversation">
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
              <Icon name="mic" />
            </button>
          ) : null}
          <button type="button" className="call-hangup" onClick={() => void finish()} disabled={status === 'ending'} aria-label="Raccrocher et voir mon bilan">
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
      <button type="button" className="btn btn-ghost btn-sm call-quit" onClick={onQuit} disabled={status === 'ending'}>
        Quitter sans bilan
      </button>
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
        note={
          result.passed
            ? 'Entraînement réussi. Tu peux continuer à t’entraîner sur les autres commerçants.'
            : tooShort
              ? `Bonne note, mais l’appel était trop court : il faut au moins ${String(result.minTurns)} répliques pour valider.`
              : `Il faut ${String(result.passScore)}/100 pour valider. Relis les conseils et rappelle-le.`
        }
      />
      <div className="training-actions">
        <button type="button" className="btn btn-accent" onClick={onRetry}>
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
      {d && sc && d.feedback ? <Feedback scenario={sc} score={d.score ?? 0} passed={d.passed} feedback={d.feedback} note={null} /> : null}
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

function Feedback({ scenario, score, passed, feedback, note }: { scenario: RoleplayScenario; score: number; passed: boolean; feedback: Feedback; note: string | null }): ReactElement {
  const criteria = (['presentation', 'accroche', 'decouverte', 'offre', 'conclusion'] as const).map((k) => ({ k, ...feedback.criteres[k] }));
  return (
    <>
      <section className={`card card-hero result-hero${passed ? ' is-passed' : ''}`} aria-labelledby="result-score">
        <p className="training-label">
          {scenario.business} · {OUTCOME_LABEL[feedback.issue] ?? feedback.issue}
        </p>
        <h2 id="result-score" className="result-score num">
          {score}
          <span>/100</span>
        </h2>
        <p className={`chip ${passed ? 'chip-green' : 'chip-orange'}`}>{passed ? 'Réussi' : 'Pas encore'}</p>
        {feedback.resume ? <p>{feedback.resume}</p> : null}
        {note ? <p className="text-2 text-sm">{note}</p> : null}
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
          {criteria.map((c) => (
            <li key={c.k}>
              <div className="result-criterion-head">
                <span>{CRITERIA_LABEL[c.k]}</span>
                <span className="num">{Math.round(c.note)}/20</span>
              </div>
              <ProgressBar percent={(c.note / 20) * 100} label={`${CRITERIA_LABEL[c.k] ?? c.k} : ${String(Math.round(c.note))} sur 20`} tone={c.note >= 14 ? 'green' : c.note >= 10 ? 'violet' : 'orange'} />
              <p className="text-2 text-sm">{c.commentaire}</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="result-columns">
        {feedback.points_forts.length > 0 ? (
          <section className="card" aria-labelledby="result-good">
            <h2 id="result-good" className="h3">
              Ce qui a marché
            </h2>
            <ul className="result-bullets is-good">
              {feedback.points_forts.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {feedback.a_ameliorer.length > 0 ? (
          <section className="card" aria-labelledby="result-better">
            <h2 id="result-better" className="h3">
              À améliorer
            </h2>
            <ul className="result-bullets is-better">
              {feedback.a_ameliorer.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {feedback.phrase_cle ? (
        <section className="card result-key" aria-labelledby="result-key">
          <h2 id="result-key" className="training-label">
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
