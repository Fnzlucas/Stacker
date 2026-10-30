import { describe, expect, it } from 'vitest';
import { buzz, createCallSounds, type AudioLike } from './sounds';

function fakeAudio() {
  const tones: { freq: number; start: number; stop: number; type: string }[] = [];
  let closed = false;
  class Ctx implements Partial<AudioLike> {
    currentTime = 10;
    destination = {} as AudioNode;
    resume = async () => undefined;
    close = async () => {
      closed = true;
    };
    createGain = () =>
      ({
        gain: { setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined },
        connect: () => undefined,
      }) as unknown as GainNode;
    createOscillator = () => {
      const o = {
        type: 'sine',
        frequency: { value: 0 },
        connect: () => undefined,
        start: (t: number) => tones.push({ freq: o.frequency.value, start: t, stop: 0, type: o.type }),
        stop: (t: number) => {
          const last = tones.at(-1);
          if (last) last.stop = t;
        },
      };
      return o as unknown as OscillatorNode;
    };
  }
  return { Ctx: Ctx as unknown as new () => AudioLike, tones, closed: () => closed };
}

describe('sons de l’appel', () => {
  it('tonalité française : 440 Hz, 1,5 s toutes les 5 s', () => {
    const a = fakeAudio();
    const s = createCallSounds({ AudioContext: a.Ctx });
    s.ring(7);
    expect(a.tones.map((t) => [t.freq, t.start])).toEqual([
      [440, 10],
      [440, 15],
    ]);
    expect(a.tones[0]!.stop).toBeCloseTo(11.55);
    expect(a.tones[1]!.stop).toBeCloseTo(16.55);
  });

  it('décroché et raccroché ; fermeture', () => {
    const a = fakeAudio();
    const s = createCallSounds({ webkitAudioContext: a.Ctx });
    s.pickup();
    s.hangup();
    expect(a.tones.map((t) => t.freq)).toEqual([1200, 800, 440, 440, 440]);
    expect(a.tones[0]!.type).toBe('square');
    s.close();
    expect(a.closed()).toBe(true);
  });

  it('sans audio ou en erreur : silencieux, sans exception', () => {
    const silent = createCallSounds({});
    expect(() => {
      silent.ring(3);
      silent.pickup();
      silent.hangup();
      silent.close();
    }).not.toThrow();
    const Broken = function () {
      throw new Error('refusé');
    } as unknown as new () => AudioLike;
    expect(() => createCallSounds({ AudioContext: Broken }).ring(1)).not.toThrow();
  });

  it('vibration : appelée si disponible, ignorée sinon', () => {
    const calls: unknown[] = [];
    buzz([30, 40, 30], { vibrate: (p) => calls.push(p) > 0 });
    buzz(20, {});
    buzz(20, {
      vibrate: () => {
        throw new Error('x');
      },
    });
    expect(calls).toEqual([[30, 40, 30]]);
  });
});
