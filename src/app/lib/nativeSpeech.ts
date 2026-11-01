/**
 * Dictée vocale dans l'application iPhone : le moteur natif d'Apple
 * (SFSpeechRecognizer, via @capgo/capacitor-speech-recognition), présenté
 * sous la même forme que la reconnaissance vocale du navigateur (Recognition).
 * L'écran d'appel n'a donc rien à changer.
 *
 * Le moteur natif ne s'arrête pas tout seul quand le stacker se tait : on
 * arrête l'écoute après un court silence (ou si rien n'est dit).
 */
import type { Recognition } from './speech';

export interface SpeechPluginLike {
  requestPermissions: () => Promise<{ speechRecognition: string }>;
  start: (o: { language: string; partialResults: boolean; popup: boolean; maxResults: number }) => Promise<unknown>;
  stop: () => Promise<void>;
  addListener: ((event: 'partialResults', fn: (d: { matches?: string[] }) => void) => Promise<{ remove: () => Promise<void> }>) &
    ((event: 'listeningState', fn: (d: { status?: string; state?: string }) => void) => Promise<{ remove: () => Promise<void> }>);
}

/** Silence après une phrase, puis attente maximale si rien n'est dit. */
export const SILENCE_MS = 1600;
export const NOTHING_SAID_MS = 8000;

interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function nativeRecognitionClass(plugin: SpeechPluginLike, timers: Timers = realTimers): new () => Recognition {
  return class NativeRecognition implements Recognition {
    lang = 'fr-FR';
    interimResults = true;
    continuous = false;
    maxAlternatives = 1;
    onresult: Recognition['onresult'] = null;
    onerror: Recognition['onerror'] = null;
    onend: Recognition['onend'] = null;

    private text = '';
    private done = false;
    private timer: unknown = null;
    private handles: { remove: () => Promise<void> }[] = [];

    start(): void {
      void this.run();
    }

    stop(): void {
      void this.finish(true);
    }

    abort(): void {
      this.text = '';
      void this.finish(false);
    }

    private arm(ms: number) {
      if (this.timer !== null) timers.clear(this.timer);
      this.timer = timers.set(() => this.stop(), ms);
    }

    private emit(isFinal: boolean) {
      const result = Object.assign([{ transcript: this.text }], { isFinal });
      this.onresult?.({ resultIndex: 0, results: [result] });
    }

    private async run() {
      try {
        const perm = await plugin.requestPermissions();
        if (perm.speechRecognition !== 'granted') {
          this.onerror?.({ error: 'not-allowed' });
          this.done = true;
          this.onend?.();
          return;
        }
        this.handles.push(
          await plugin.addListener('partialResults', (d) => {
            const t = (d.matches?.[0] ?? '').trim();
            if (!t || this.done) return;
            this.text = t;
            this.emit(false);
            this.arm(SILENCE_MS);
          }),
        );
        this.handles.push(
          await plugin.addListener('listeningState', (d) => {
            if (d.status === 'stopped' || d.state === 'stopped') void this.finish(true);
          }),
        );
        this.arm(NOTHING_SAID_MS);
        await plugin.start({ language: this.lang, partialResults: true, popup: false, maxResults: 1 });
      } catch {
        this.onerror?.({ error: 'start_failed' });
        await this.finish(false);
      }
    }

    private async finish(withResult: boolean) {
      if (this.done) return;
      this.done = true;
      if (this.timer !== null) timers.clear(this.timer);
      await plugin.stop().catch(() => undefined);
      for (const h of this.handles.splice(0)) await h.remove().catch(() => undefined);
      if (withResult && this.text) this.emit(true);
      this.onend?.();
    }
  };
}
