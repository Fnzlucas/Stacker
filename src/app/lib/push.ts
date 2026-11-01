/**
 * Notifications push de l'application iPhone : demande d'autorisation (la
 * fenêtre système d'iOS), enregistrement du jeton de l'appareil, et ouverture
 * du bon écran quand le stacker touche une notification.
 */
import type { Backend } from './supabase';

export interface PushPluginLike {
  checkPermissions: () => Promise<{ receive: string }>;
  requestPermissions: () => Promise<{ receive: string }>;
  register: () => Promise<void>;
  addListener: ((event: 'registration', fn: (t: { value: string }) => void) => Promise<unknown>) &
    ((event: 'pushNotificationActionPerformed', fn: (a: { notification: { data?: unknown } }) => void) => Promise<unknown>);
}

/** Écran à ouvrir : uniquement un chemin de l'app (jamais une adresse externe). */
export function pushTarget(data: unknown): string | null {
  const path = data && typeof data === 'object' && 'path' in data ? (data).path : null;
  return typeof path === 'string' && /^\/app(\/[a-z0-9/?=&_-]*)?$/.test(path) ? path : null;
}

function go(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export async function setupPush(plugin: PushPluginLike, backend: () => Backend | null, navigate: (path: string) => void = go): Promise<'granted' | 'denied'> {
  await plugin.addListener('registration', ({ value }) => {
    const b = backend();
    if (b) void b.db.rpc('push_register', { p_token: value, p_platform: 'ios' });
  });
  await plugin.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const path = pushTarget(notification.data);
    if (path) navigate(path);
  });
  let perm = await plugin.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await plugin.requestPermissions();
  if (perm.receive !== 'granted') return 'denied';
  await plugin.register();
  return 'granted';
}

/** Branché par native.ts (application iPhone seulement). */
export async function registerPush(backend: () => Backend | null): Promise<void> {
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await setupPush(PushNotifications, backend);
  } catch {
    /* notifications indisponibles : l'app fonctionne sans */
  }
}
