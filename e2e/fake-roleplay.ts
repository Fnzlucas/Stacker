/**
 * Faux entraînement (lot 10) : mêmes règles que la base et l'Edge Function
 * « roleplay », avec un commerçant scripté (aucune IA) pour des tests
 * déterministes. Réussite = au moins 5 répliques et une note de 70.
 */
import type { StackerInfo } from './fake-prospects';

type Reply = [number, unknown];

interface Session {
  id: string;
  stacker: string;
  scenario: string;
  status: 'en_cours' | 'terminee' | 'abandonnee';
  turns: { role: 'stacker' | 'prospect'; text: string }[];
  score: number | null;
  passed: boolean;
  feedback: Record<string, unknown> | null;
  started_at: string;
}

const OPENINGS: Record<string, string> = {
  boulangerie: 'Boulangerie Martin, bonjour !',
  garage: 'Garage du Pont, j’écoute.',
  menuiserie: 'Allô, Thierry Roux, menuiserie.',
  coiffure: 'Salon Inès, oui ?',
  hotel: 'Hôtel du Rhône, Claire à l’accueil, bonjour.',
  restaurant: 'Le Petit Comptoir, bonjour.',
};

const REPLIES = ['Oui, c’est pour quoi ?', 'Ah bon, la fiche Google ?', 'Ça coûte combien ?', 'C’est avec engagement ?', 'D’accord, passez jeudi à 10 h.', 'À jeudi alors.'];

export const PASS_SCORE = 70;
export const MIN_TURNS = 5;

function feedback(good: boolean) {
  const n = good ? 16 : 9;
  const c = (commentaire: string) => ({ note: n, commentaire });
  return {
    criteres: {
      presentation: c('Tu t’es présentée clairement.'),
      accroche: c('Ton accroche sur les horaires était précise.'),
      decouverte: c('Pose une question de plus avant l’offre.'),
      offre: c('Prix annoncé tôt et calmement.'),
      conclusion: c('Rendez-vous fixé à une date précise.'),
    },
    points_forts: ['Accroche sur les horaires du dimanche'],
    a_ameliorer: ['Reformule ce que dit le commerçant avant de présenter l’offre'],
    phrase_cle: 'Si je comprends bien, des clients viennent pour rien le dimanche ?',
    resume: good ? 'Bon appel, rendez-vous obtenu.' : 'Appel trop court.',
    faute_grave: null,
    issue: good ? 'rendez_vous' : 'raccroche',
  };
}

export class FakeRoleplay {
  sessions: Session[] = [];
  dailyLimit = 8;

  constructor(
    private readonly id: () => string,
    /** Interrupteur roleplay_required (piloté par l'admin). */
    private readonly isRequired: () => boolean,
  ) {}

  get required(): boolean {
    return this.isRequired();
  }

  /** Stackers ayant donné leur accord pour l'IA. */
  consents = new Set<string>();

  passed(stacker: string): boolean {
    return this.sessions.some((s) => s.stacker === stacker && s.passed);
  }

  /** Règle de la base : signature refusée tant que l'entraînement exigé n'est pas réussi. */
  blocksSigning(stacker: string): boolean {
    return this.required && !this.passed(stacker);
  }

  rpc(fn: string, b: Record<string, unknown>, st: StackerInfo | null): Reply | null {
    if (fn !== 'my_roleplay' && fn !== 'roleplay_detail' && fn !== 'roleplay_consent') return null;
    if (!st) return [401, { code: '42501', message: 'unauthorized' }];
    if (fn === 'roleplay_consent') {
      if (b['p_accept'] === true) this.consents.add(st.id);
      else this.consents.delete(st.id);
      return [200, null];
    }
    if (fn === 'my_roleplay') {
      const mine = this.sessions.filter((s) => s.stacker === st.id);
      return [
        200,
        {
          required: this.required,
          passed: this.passed(st.id),
          consented: this.consents.has(st.id),
          pass_score: PASS_SCORE,
          min_stacker_turns: MIN_TURNS,
          today: { used: mine.length, limit: this.dailyLimit },
          history: [...mine]
            .reverse()
            .slice(0, 20)
            .map((s) => ({ id: s.id, scenario: s.scenario, status: s.status, score: s.score, passed: s.passed, started_at: s.started_at })),
        },
      ];
    }
    const s = this.sessions.find((x) => x.id === b['p_session'] && x.stacker === st.id);
    if (!s) return [404, { code: 'P0002', message: 'not_found' }];
    return [200, { id: s.id, scenario: s.scenario, status: s.status, score: s.score, passed: s.passed, feedback: s.feedback, started_at: s.started_at, ended_at: s.started_at, turns: s.turns }];
  }

  /** Edge Function « roleplay ». */
  call(b: Record<string, unknown>, st: StackerInfo | null): Reply {
    if (!st) return [401, { ok: false, error: 'unauthorized' }];
    if (!st.onboarded) return [403, { ok: false, error: 'onboarding_required' }];
    const action = b['action'];
    if (action === 'start') {
      const scenario = typeof b['scenario'] === 'string' ? b['scenario'] : '';
      const opening = OPENINGS[scenario];
      if (!opening) return [404, { ok: false, error: 'not_found' }];
      if (!this.consents.has(st.id)) return [403, { ok: false, error: 'consent_required' }];
      if (this.sessions.filter((s) => s.stacker === st.id).length >= this.dailyLimit) return [429, { ok: false, error: 'daily_quota' }];
      for (const s of this.sessions) if (s.stacker === st.id && s.status === 'en_cours') s.status = 'abandonnee';
      const s: Session = { id: this.id(), stacker: st.id, scenario, status: 'en_cours', turns: [{ role: 'prospect', text: opening }], score: null, passed: false, feedback: null, started_at: new Date().toISOString() };
      this.sessions.push(s);
      return [200, { ok: true, session_id: s.id, opening, max_chars: 600 }];
    }
    const s = this.sessions.find((x) => x.id === b['session_id'] && x.stacker === st.id);
    if (!s) return [404, { ok: false, error: 'not_found' }];
    if (s.status !== 'en_cours') return [409, { ok: false, error: 'session_closed' }];
    if (action === 'say') {
      const text = typeof b['text'] === 'string' ? b['text'].replace(/\s+/g, ' ').trim() : '';
      if (!text || text.length > 600) return [400, { ok: false, error: 'invalid_request' }];
      const n = s.turns.filter((t) => t.role === 'stacker').length;
      const reply = REPLIES[Math.min(n, REPLIES.length - 1)] ?? 'Oui ?';
      s.turns.push({ role: 'stacker', text }, { role: 'prospect', text: reply });
      return [200, { ok: true, reply, hung_up: false, turns_left: Math.max(0, Math.floor((24 - s.turns.length) / 2)) }];
    }
    if (action === 'finish') {
      const turns = s.turns.filter((t) => t.role === 'stacker').length;
      const good = turns >= MIN_TURNS;
      const fb = feedback(good);
      const score = good ? 80 : 45;
      s.status = 'terminee';
      s.score = score;
      s.passed = score >= PASS_SCORE && turns >= MIN_TURNS;
      s.feedback = fb;
      return [200, { ok: true, score, passed: s.passed, pass_score: PASS_SCORE, stacker_turns: turns, min_stacker_turns: MIN_TURNS, criteria: [], feedback: fb }];
    }
    return [400, { ok: false, error: 'invalid_request' }];
  }
}
