import { describe, expect, it } from 'vitest';
import { NOTHING_SAID_MS, SILENCE_MS, nativeRecognitionClass, type SpeechPluginLike } from './nativeSpeech';
import { listen } from './speech';

function fakePlugin(permission = 'granted', failStart = false) {
  const listeners: Record<string, ((d: never) => void)[]> = {};
  let stops = 0;
  const plugin: SpeechPluginLike = {
    requestPermissions: async () => ({ speechRecognition: permission }),
    start: async () => {
      if (failStart) throw new Error('micro occupé');
      return {};
    },
    stop: async () => {
      stops++;
    },
    addListener: (async (event: string, fn: (d: never) => void) => {
      (listeners[event] ??= []).push(fn);
      return { remove: async () => undefined };
    }),
  };
  const fire = (event: string, data: unknown) => {
    for (const fn of listeners[event] ?? []) fn(data as never);
  };
  return { plugin, fire, stops: () => stops };
}

function fakeTimers() {
  let pending: { fn: () => void; ms: number } | null = null;
  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        pending = { fn, ms };
        return pending;
      },
      clear: (id: unknown) => {
        if (pending === id) pending = null;
      },
    },
    pendingMs: () => pending?.ms ?? null,
    flush: () => {
      const p = pending;
      pending = null;
      p?.fn();
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('dictée native (iPhone)', () => {
  it('phrase dictée : texte au fil de l’eau, puis phrase complète après un silence', async () => {
    const p = fakePlugin();
    const t = fakeTimers();
    const Ctor = nativeRecognitionClass(p.plugin, t.timers);
    const partials: string[] = [];
    const done: string[] = [];
    listen({ onPartial: (x) => partials.push(x), onDone: (x) => done.push(x), onError: () => undefined }, { SpeechRecognition: Ctor });
    await tick();
    expect(t.pendingMs()).toBe(NOTHING_SAID_MS);
    p.fire('partialResults', { matches: ['Bonjour'] });
    p.fire('partialResults', { matches: ['Bonjour madame Martin'] });
    expect(partials.at(-1)).toBe('Bonjour madame Martin');
    expect(t.pendingMs()).toBe(SILENCE_MS);
    t.flush();
    await tick();
    expect(done).toEqual(['Bonjour madame Martin']);
    expect(p.stops()).toBe(1);
  });

  it('rien de dit : l’écoute s’arrête seule, phrase vide', async () => {
    const p = fakePlugin();
    const t = fakeTimers();
    const done: string[] = [];
    listen({ onPartial: () => undefined, onDone: (x) => done.push(x), onError: () => undefined }, { SpeechRecognition: nativeRecognitionClass(p.plugin, t.timers) });
    await tick();
    t.flush();
    await tick();
    expect(done).toEqual(['']);
  });

  it('arrêt par le moteur, arrêt demandé, abandon', async () => {
    const p = fakePlugin();
    const t = fakeTimers();
    const done: string[] = [];
    const l = listen({ onPartial: () => undefined, onDone: (x) => done.push(x), onError: () => undefined }, { SpeechRecognition: nativeRecognitionClass(p.plugin, t.timers) });
    await tick();
    p.fire('partialResults', { matches: ['Oui'] });
    p.fire('listeningState', { status: 'stopped' });
    await tick();
    l?.stop();
    await tick();
    expect(done).toEqual(['Oui']);

    const aborted: string[] = [];
    const a = listen({ onPartial: () => undefined, onDone: (x) => aborted.push(x), onError: () => undefined }, { SpeechRecognition: nativeRecognitionClass(p.plugin, t.timers) });
    await tick();
    p.fire('partialResults', { matches: ['Allô'] });
    a?.abort();
    await tick();
    expect(aborted).toEqual([]);
  });

  it('micro refusé ou moteur en panne : erreur, sans plantage', async () => {
    const errors: string[] = [];
    listen({ onPartial: () => undefined, onDone: () => undefined, onError: (c) => errors.push(c) }, { SpeechRecognition: nativeRecognitionClass(fakePlugin('denied').plugin, fakeTimers().timers) });
    await tick();
    listen({ onPartial: () => undefined, onDone: () => undefined, onError: (c) => errors.push(c) }, { SpeechRecognition: nativeRecognitionClass(fakePlugin('granted', true).plugin, fakeTimers().timers) });
    await tick();
    await tick();
    expect(errors).toEqual(['not-allowed', 'start_failed']);
  });
});
