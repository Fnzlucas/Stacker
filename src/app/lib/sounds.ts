/**
 * Sons de l'appel d'entraînement, synthétisés (aucun fichier audio) :
 *   - tonalité de retour d'appel française : 440 Hz, 1,5 s de son ;
 *   - décroché : petit clic ;
 *   - raccroché : trois bips courts.
 * Le contexte audio doit être créé pendant un geste de l'utilisateur
 * (iOS), d'où createCallSounds() appelé au clic sur « Appeler ».
 */

export interface AudioLike {
  currentTime: number;
  destination: AudioNode;
  state?: string;
  resume?: () => Promise<void>;
  close?: () => Promise<void>;
  createOscillator: () => OscillatorNode;
  createGain: () => GainNode;
}

export interface CallSounds {
  /** Fait sonner pendant `seconds` (tonalité française). */
  ring: (seconds: number) => void;
  pickup: () => void;
  hangup: () => void;
  close: () => void;
}

const SILENT: CallSounds = { ring: () => undefined, pickup: () => undefined, hangup: () => undefined, close: () => undefined };

type Ctor = new () => AudioLike;

export function createCallSounds(w: { AudioContext?: Ctor; webkitAudioContext?: Ctor } = typeof window === 'undefined' ? {} : window): CallSounds {
  const Audio = w.AudioContext ?? w.webkitAudioContext;
  if (!Audio) return SILENT;
  let ctx: AudioLike;
  try {
    ctx = new Audio();
  } catch {
    return SILENT;
  }
  void ctx.resume?.().catch(() => undefined);

  const tone = (freq: number, start: number, duration: number, volume: number, type: OscillatorType = 'sine') => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = ctx.currentTime + start;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.02);
    gain.gain.setValueAtTime(volume, t0 + Math.max(0.02, duration - 0.03));
    gain.gain.linearRampToValueAtTime(0, t0 + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  };

  return {
    ring: (seconds) => {
      // Cadence française : 1,5 s de tonalité, 3,5 s de silence.
      for (let t = 0; t < seconds; t += 5) tone(440, t, Math.min(1.5, seconds - t), 0.12);
    },
    pickup: () => {
      tone(1200, 0, 0.04, 0.08, 'square');
      tone(800, 0.05, 0.05, 0.06, 'square');
    },
    hangup: () => {
      for (let i = 0; i < 3; i++) tone(440, i * 0.32, 0.2, 0.1);
    },
    close: () => {
      void ctx.close?.().catch(() => undefined);
    },
  };
}

/** Vibration courte au décroché (Android ; ignoré ailleurs). */
export function buzz(pattern: number | number[], nav: { vibrate?: (p: number | number[]) => boolean } = typeof navigator === 'undefined' ? {} : navigator): void {
  try {
    nav.vibrate?.(pattern);
  } catch {
    /* non disponible */
  }
}
