import { afterEach, describe, expect, it, vi } from 'vitest';
import { canListen, canSpeak, listen, pickVoice, speak, stopSpeaking, unlockSpeech, type Recognition, type SpeechEnv } from './speech';

afterEach(() => vi.useRealTimers());

const voice = (name: string, lang = 'fr-FR') => ({ name, lang, localService: true }) as SpeechSynthesisVoice;

class FakeUtterance {
  voice: SpeechSynthesisVoice | null = null;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly text: string) {}
}

function synthEnv(voices: SpeechSynthesisVoice[], autoEnd = true) {
  const spoken: FakeUtterance[] = [];
  let cancels = 0;
  const env = {
    SpeechSynthesisUtterance: FakeUtterance,
    speechSynthesis: {
      speak: (u: FakeUtterance) => {
        spoken.push(u);
        if (autoEnd) setTimeout(() => u.onend?.(), 0);
      },
      cancel: () => {
        cancels++;
      },
      getVoices: () => voices,
    },
  } as unknown as SpeechEnv;
  return { env, spoken, cancels: () => cancels };
}

class FakeRecognition implements Recognition {
  static last: FakeRecognition | null = null;
  lang = '';
  interimResults = false;
  continuous = true;
  maxAlternatives = 0;
  onresult: Recognition['onresult'] = null;
  onerror: Recognition['onerror'] = null;
  onend: Recognition['onend'] = null;
  started = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
  emit(parts: { t: string; final: boolean }[]) {
    const results = parts.map((p) => Object.assign([{ transcript: p.t }], { isFinal: p.final }));
    this.onresult?.({ resultIndex: 0, results });
  }
}

describe('disponibilité', () => {
  it('reconnaissance (standard ou préfixée) et synthèse', () => {
    expect(canListen({})).toBe(false);
    expect(canListen({ webkitSpeechRecognition: FakeRecognition })).toBe(true);
    expect(canSpeak({})).toBe(false);
    expect(canSpeak(synthEnv([]).env)).toBe(true);
  });
});

describe('choix de la voix', () => {
  it('français de France, voix naturelle, genre du commerçant', () => {
    const voices = [voice('Samantha', 'en-US'), voice('Thomas'), voice('Amélie', 'fr-CA'), voice('Google français'), voice('Audrey')];
    expect(pickVoice(voices, 'm')).toBe(3);
    expect(pickVoice([voice('Thomas'), voice('Audrey')], 'f')).toBe(1);
    expect(pickVoice([voice('Thomas'), voice('Audrey')], 'm')).toBe(0);
    expect(pickVoice([voice('Samantha', 'en-US')], 'f')).toBe(-1);
    expect(pickVoice([voice('Amélie', 'fr_CA')], 'f')).toBe(0);
  });
});

describe('synthèse', () => {
  it('lit avec la voix choisie et se résout à la fin', async () => {
    const s = synthEnv([voice('Thomas'), voice('Audrey')]);
    await speak('Garage du Pont.', 'm', s.env);
    expect(s.spoken[0]?.text).toBe('Garage du Pont.');
    expect(s.spoken[0]?.voice?.name).toBe('Thomas');
    expect(s.spoken[0]?.lang).toBe('fr-FR');
    expect(s.cancels()).toBe(1);
  });

  it('sans voix française : langue forcée ; sans « end » : filet de sécurité', async () => {
    vi.useFakeTimers();
    const s = synthEnv([], false);
    const p = speak('Bonjour', 'f', s.env);
    expect(s.spoken[0]?.lang).toBe('fr-FR');
    vi.advanceTimersByTime(5000);
    await expect(p).resolves.toBeUndefined();
  });

  it('sans synthèse : se résout tout de suite ; déblocage et arrêt sans erreur', async () => {
    await expect(speak('x', 'f', {})).resolves.toBeUndefined();
    unlockSpeech({});
    stopSpeaking({});
    const s = synthEnv([]);
    unlockSpeech(s.env);
    expect(s.spoken[0]?.volume).toBe(0);
  });
});

describe('reconnaissance', () => {
  it('français, texte partiel puis phrase complète à la fin', () => {
    const partial: string[] = [];
    const done: string[] = [];
    const l = listen({ onPartial: (t) => partial.push(t), onDone: (t) => done.push(t), onError: () => undefined }, { SpeechRecognition: FakeRecognition });
    const rec = FakeRecognition.last!;
    expect(rec.lang).toBe('fr-FR');
    expect(rec.started).toBe(true);
    rec.emit([{ t: 'Bonjour je ', final: false }]);
    rec.emit([
      { t: 'Bonjour, je suis Inès ', final: true },
      { t: 'pour', final: false },
    ]);
    l?.stop();
    expect(partial).toEqual(['Bonjour je', 'Bonjour, je suis Inès pour']);
    expect(done).toEqual(['Bonjour, je suis Inès']);
  });

  it('sans résultat final : garde le dernier texte ; abandon : pas de phrase envoyée', () => {
    const done: string[] = [];
    const h = { onPartial: () => undefined, onDone: (t: string) => done.push(t), onError: () => undefined };
    listen(h, { SpeechRecognition: FakeRecognition });
    FakeRecognition.last!.emit([{ t: 'Allô', final: false }]);
    FakeRecognition.last!.stop();
    const l = listen(h, { SpeechRecognition: FakeRecognition });
    l?.abort();
    expect(done).toEqual(['Allô']);
  });

  it('erreurs : micro refusé signalé, silence ignoré, démarrage impossible, indisponible', () => {
    const errors: string[] = [];
    const h = { onPartial: () => undefined, onDone: () => undefined, onError: (c: string) => errors.push(c) };
    listen(h, { SpeechRecognition: FakeRecognition });
    FakeRecognition.last!.onerror?.({ error: 'no-speech' });
    FakeRecognition.last!.onerror?.({ error: 'not-allowed' });
    class Broken extends FakeRecognition {
      override start() {
        throw new Error('déjà démarré');
      }
    }
    expect(listen(h, { SpeechRecognition: Broken })).toBeNull();
    expect(listen(h, {})).toBeNull();
    expect(errors).toEqual(['not-allowed', 'start_failed']);
  });
});
