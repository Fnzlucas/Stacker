import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENTRY_MS, EXIT_MS, holdBoot, resetBootForTests, scheduleBootCheck } from './boot';

/** Faux #boot minimal (environnement node, sans DOM). */
class FakeBoot {
  attrs = new Map<string, string>([['role', 'status']]);
  classes = new Set<string>();
  removed = false;
  listeners: ((e: { target: unknown }) => void)[] = [];
  entry: { animationName?: string; playState: string; finished: Promise<unknown> }[] = [];
  /** Dernière bande de sortie (.boot-band-3). */
  lastBand = { band: 3 };
  classList = { add: (c: string) => this.classes.add(c) };
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  remove() {
    this.removed = true;
  }
  addEventListener(_type: string, fn: (e: { target: unknown }) => void) {
    this.listeners.push(fn);
  }
  getAnimations = (opts?: { subtree?: boolean }) => (opts?.subtree ? this.entry : []);
  querySelector = (sel: string) => (sel === '.boot-band-3' ? this.lastBand : null);
}

let boot: FakeBoot | null;
/** Classes de <html> (html.is-booted : les écrans jouent leur entrée). */
let htmlClasses = new Set<string>();
let reduced = false;
let paintAt: number | undefined;

function install(opts: { withAnimations?: boolean } = {}) {
  boot = new FakeBoot();
  if (opts.withAnimations === false) (boot as unknown as { getAnimations?: unknown }).getAnimations = undefined;
  htmlClasses = new Set<string>();
  vi.stubGlobal('document', {
    getElementById: (id: string) => (id === 'boot' ? boot : null),
    documentElement: { classList: { add: (c: string) => htmlClasses.add(c), remove: (c: string) => htmlClasses.delete(c) } },
  });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: reduced }) });
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 16));
  vi.stubGlobal('performance', {
    now: () => Date.now(),
    getEntriesByType: () => (paintAt === undefined ? [] : [{ name: 'first-contentful-paint', startTime: paintAt }]),
  });
}

describe('écran de démarrage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
    resetBootForTests();
    reduced = false;
    paintAt = undefined;
    install();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reste affiché tant qu’un écran d’attente le retient, puis sort avec une transition', async () => {
    const release = holdBoot();
    scheduleBootCheck();
    await vi.advanceTimersByTimeAsync(100);
    expect(boot!.classes.has('is-leaving')).toBe(false);
    expect(htmlClasses.has('is-booted')).toBe(false);

    release();
    release(); // libérer deux fois n'a aucun effet
    await vi.advanceTimersByTimeAsync(20);
    expect(boot!.classes.has('is-leaving')).toBe(true);
    expect(boot!.attrs.get('aria-hidden')).toBe('true');
    expect(boot!.attrs.has('role')).toBe(false);
    // Les écrans jouent leur entrée pendant que les bandes sortent.
    expect(htmlClasses.has('is-booted')).toBe(true);
    // animationend d'un autre élément : ignoré ; de la dernière bande : retiré.
    boot!.listeners.forEach((fn) => fn({ target: boot }));
    expect(boot!.removed).toBe(false);
    boot!.listeners.forEach((fn) => fn({ target: boot!.lastBand }));
    expect(boot!.removed).toBe(true);
    await vi.advanceTimersByTimeAsync(EXIT_MS + 300);
  });

  it('attend la fin de l’animation d’entrée, jamais davantage', async () => {
    let finish!: () => void;
    boot!.entry = [
      { animationName: 'boot-in-tile', playState: 'running', finished: new Promise<void>((r) => (finish = r)) },
      { animationName: 'boot-in-letter', playState: 'finished', finished: Promise.resolve() },
      // Respiration (infinie), barre de progression, message de lenteur : jamais attendus.
      { animationName: 'boot-breathe', playState: 'running', finished: new Promise(() => undefined) },
      { animationName: 'boot-appear', playState: 'running', finished: new Promise(() => undefined) },
      { playState: 'running', finished: new Promise(() => undefined) },
    ];
    scheduleBootCheck();
    scheduleBootCheck(); // une seule vérification planifiée
    await vi.advanceTimersByTimeAsync(500);
    expect(boot!.classes.has('is-leaving')).toBe(false);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(boot!.classes.has('is-leaving')).toBe(true);
    // Filet de sécurité sans animationend.
    await vi.advanceTimersByTimeAsync(EXIT_MS + 200);
    expect(boot!.removed).toBe(true);
  });

  it('un écran d’attente apparu pendant l’animation d’entrée retarde la sortie', async () => {
    let finish!: () => void;
    boot!.entry = [{ animationName: 'boot-in-x-left', playState: 'running', finished: new Promise<void>((r) => (finish = r)) }];
    scheduleBootCheck();
    await vi.advanceTimersByTimeAsync(20);
    const release = holdBoot();
    finish();
    await vi.advanceTimersByTimeAsync(20);
    expect(boot!.classes.has('is-leaving')).toBe(false);
    release();
    await vi.advanceTimersByTimeAsync(20);
    expect(boot!.classes.has('is-leaving')).toBe(true);
  });

  it('mouvement réduit : sortie immédiate, sans transition', async () => {
    reduced = true;
    boot!.entry = [{ animationName: 'boot-in-y', playState: 'running', finished: new Promise(() => undefined) }];
    scheduleBootCheck();
    await vi.advanceTimersByTimeAsync(20);
    expect(boot!.removed).toBe(true);
    expect(boot!.classes.has('is-leaving')).toBe(false);
  });

  it('sans Web Animations : se cale sur le premier rendu + durée d’entrée', async () => {
    install({ withAnimations: false });
    paintAt = 100;
    scheduleBootCheck();
    await vi.advanceTimersByTimeAsync(ENTRY_MS - 50);
    expect(boot!.classes.has('is-leaving')).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(boot!.classes.has('is-leaving')).toBe(true);
  });

  it('sans Web Animations ni mesure du premier rendu : sortie dès que possible', async () => {
    install({ withAnimations: false });
    vi.setSystemTime(5000);
    scheduleBootCheck();
    await vi.advanceTimersByTimeAsync(20);
    expect(boot!.classes.has('is-leaving')).toBe(true);
  });

  it('écran absent (déjà retiré) : rien à faire, plus aucune vérification', async () => {
    boot = null;
    scheduleBootCheck();
    await vi.advanceTimersByTimeAsync(20);
    scheduleBootCheck();
    await vi.advanceTimersByTimeAsync(20);
    expect(boot).toBeNull();
    expect(htmlClasses.has('is-booted')).toBe(true);
  });

  it('une rejection d’animation (annulée) ne bloque pas la sortie', async () => {
    const aborted = Promise.reject(new Error('AbortError'));
    aborted.catch(() => undefined); // évite l'alerte « rejet non géré » avant que boot.ts ne s'y abonne
    boot!.entry = [{ animationName: 'boot-in-squash', playState: 'running', finished: aborted }];
    scheduleBootCheck();
    await vi.advanceTimersByTimeAsync(20);
    expect(boot!.classes.has('is-leaving')).toBe(true);
  });
});
