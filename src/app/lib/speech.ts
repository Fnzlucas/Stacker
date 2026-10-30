/**
 * Voix de l'entraînement, avec les API du navigateur (aucun service tiers) :
 *   - reconnaissance vocale (Web Speech API, en français) pour ce que dit
 *     le stacker ;
 *   - synthèse vocale pour la réponse du commerçant.
 * Sans reconnaissance vocale (certains navigateurs), l'écran propose
 * d'écrire ses phrases : l'exercice reste le même.
 */

/** Sous-ensemble de SpeechRecognition utilisé ici (types absents de lib.dom). */
export interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export interface SpeechEnv {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
  speechSynthesis?: Pick<SpeechSynthesis, 'speak' | 'cancel' | 'getVoices'>;
  SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtterance;
}

const env = (): SpeechEnv => (typeof window === 'undefined' ? {} : window);

export function canListen(w: SpeechEnv = env()): boolean {
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

export function canSpeak(w: SpeechEnv = env()): boolean {
  return Boolean(w.speechSynthesis && w.SpeechSynthesisUtterance);
}

const FEMALE = /am[ée]lie|audrey|aur[ée]lie|marie|denise|julie|virginie|c[ée]line|chantal|h[ée]l[èe]ne|sylvie|eloise|vivienne|brigitte|female|femme/i;
const MALE = /thomas|henri|paul|daniel|nicolas|claude|jacques|antoine|r[ée]mi|alain|guillaume|male|homme/i;

/** Voix française la plus naturelle disponible, du genre demandé si possible. */
export function pickVoice(voices: readonly Pick<SpeechSynthesisVoice, 'lang' | 'name' | 'localService'>[], gender: 'f' | 'm'): number {
  const scored = voices
    .map((v, i) => {
      const lang = v.lang.toLowerCase().replace('_', '-');
      if (!lang.startsWith('fr')) return { i, score: -1 };
      let score = lang === 'fr-fr' ? 4 : 2;
      if (/natural|neural|premium|enhanced|google/i.test(v.name)) score += 3;
      if ((gender === 'f' ? FEMALE : MALE).test(v.name)) score += 2;
      if ((gender === 'f' ? MALE : FEMALE).test(v.name)) score -= 2;
      return { i, score };
    })
    .filter((s) => s.score >= 0)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  return scored[0]?.i ?? -1;
}

/** Débloque la synthèse sur iOS : doit être appelé pendant un geste de l'utilisateur. */
export function unlockSpeech(w: SpeechEnv = env()): void {
  if (!canSpeak(w) || !w.SpeechSynthesisUtterance) return;
  const u = new w.SpeechSynthesisUtterance(' ');
  u.volume = 0;
  w.speechSynthesis?.speak(u);
}

/** Lit un texte avec la voix du commerçant. Se résout à la fin de la lecture (ou tout de suite sans synthèse). */
export function speak(text: string, gender: 'f' | 'm', w: SpeechEnv = env()): Promise<void> {
  return new Promise((resolve) => {
    if (!canSpeak(w) || !w.SpeechSynthesisUtterance || !w.speechSynthesis) {
      resolve();
      return;
    }
    const synth = w.speechSynthesis;
    synth.cancel();
    const u = new w.SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    const idx = pickVoice(voices, gender);
    const voice = idx >= 0 ? voices[idx] : undefined;
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? 'fr-FR';
    u.rate = 1.04;
    u.pitch = gender === 'f' ? 1.05 : 0.95;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      resolve();
    };
    // Filet de sécurité : certains navigateurs n'émettent jamais « end ».
    const guard = setTimeout(finish, 1500 + text.length * 90);
    u.onend = finish;
    u.onerror = finish;
    synth.speak(u);
  });
}

export function stopSpeaking(w: SpeechEnv = env()): void {
  w.speechSynthesis?.cancel();
}

export interface Listener {
  stop: () => void;
  abort: () => void;
}

/**
 * Écoute une phrase. `onPartial` reçoit le texte au fil de l'eau ; `onDone`
 * reçoit la phrase complète quand le stacker se tait (ou une chaîne vide).
 */
export function listen(
  handlers: { onPartial: (text: string) => void; onDone: (text: string) => void; onError: (code: string) => void },
  w: SpeechEnv = env(),
): Listener | null {
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = 'fr-FR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '';
  let lastText = '';
  let aborted = false;
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (!r) continue;
      const t = r[0]?.transcript ?? '';
      if (r.isFinal) finalText += t;
      else interim += t;
    }
    lastText = `${finalText}${interim}`.replace(/\s+/g, ' ').trim();
    handlers.onPartial(lastText);
  };
  rec.onerror = (e) => {
    if (e.error !== 'no-speech' && e.error !== 'aborted') handlers.onError(e.error);
  };
  rec.onend = () => {
    if (!aborted) handlers.onDone((finalText.trim() || lastText).replace(/\s+/g, ' ').trim());
  };
  try {
    rec.start();
  } catch {
    handlers.onError('start_failed');
    return null;
  }
  return {
    stop: () => rec.stop(),
    abort: () => {
      aborted = true;
      rec.abort();
    },
  };
}
