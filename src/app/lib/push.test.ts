import { describe, expect, it } from 'vitest';
import { pushTarget, setupPush, type PushPluginLike } from './push';
import type { Backend } from './supabase';

function fake(permission: string, afterRequest = permission) {
  const listeners: Record<string, (d: never) => void> = {};
  let registered = false;
  let asked = false;
  const plugin: PushPluginLike = {
    checkPermissions: async () => ({ receive: permission }),
    requestPermissions: async () => {
      asked = true;
      return { receive: afterRequest };
    },
    register: async () => {
      registered = true;
    },
    addListener: (async (event: string, fn: (d: never) => void) => {
      listeners[event] = fn;
      return {};
    }),
  };
  return { plugin, fire: (e: string, d: unknown) => listeners[e]?.(d as never), registered: () => registered, asked: () => asked };
}

describe('notifications push', () => {
  it('autorisation demandée, appareil enregistré, jeton envoyé au serveur', async () => {
    const f = fake('prompt', 'granted');
    const calls: unknown[] = [];
    const backend = { db: { rpc: async (fn: string, args: unknown) => calls.push([fn, args]) } } as unknown as Backend;
    expect(await setupPush(f.plugin, () => backend, () => undefined)).toBe('granted');
    expect(f.asked()).toBe(true);
    expect(f.registered()).toBe(true);
    f.fire('registration', { value: 'a'.repeat(64) });
    expect(calls).toEqual([['push_register', { p_token: 'a'.repeat(64), p_platform: 'ios' }]]);
  });

  it('refusé : pas d’enregistrement ; déjà accordé : pas de nouvelle question', async () => {
    const no = fake('denied');
    expect(await setupPush(no.plugin, () => null, () => undefined)).toBe('denied');
    expect(no.registered()).toBe(false);
    const yes = fake('granted');
    expect(await setupPush(yes.plugin, () => null, () => undefined)).toBe('granted');
    expect(yes.asked()).toBe(false);
    yes.fire('registration', { value: 'x' });
  });

  it('notification touchée : ouvre l’écran indiqué, jamais une adresse externe', async () => {
    const f = fake('granted');
    const opened: string[] = [];
    await setupPush(f.plugin, () => null, (p) => opened.push(p));
    f.fire('pushNotificationActionPerformed', { notification: { data: { path: '/app/gains' } } });
    f.fire('pushNotificationActionPerformed', { notification: { data: { path: 'https://pirate.example' } } });
    f.fire('pushNotificationActionPerformed', { notification: {} });
    expect(opened).toEqual(['/app/gains']);
    expect(pushTarget({ path: '/app/prospects?onglet=campagne' })).toBe('/app/prospects?onglet=campagne');
    expect(pushTarget({ path: '//pirate.example/app' })).toBeNull();
    expect(pushTarget(null)).toBeNull();
  });
});
