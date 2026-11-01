/**
 * Branchements propres à l'application iPhone (Capacitor). Rien n'est
 * chargé dans le navigateur : les modules natifs sont importés à la demande,
 * uniquement quand l'app tourne dans l'application native.
 *
 *   - retour au premier plan : les données sont relues (ex. retour de la
 *     connexion Gmail, faite dans Safari) ;
 *   - dictée vocale : moteur natif d'Apple ;
 *   - notifications push : enregistrement de l'appareil ;
 *   - liens de connexion (Gmail, Outlook) : ouverts dans Safari, Google
 *     refusant les connexions depuis une vue web intégrée.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { Backend } from './supabase';
import { nativeRecognitionClass } from './nativeSpeech';
import { isNativeApp } from './platform';
import { registerPush } from './push';

let started = false;

export async function initNative(queryClient: QueryClient, backend: () => Backend | null): Promise<void> {
  if (started || !isNativeApp()) return;
  started = true;
  try {
    await startNative(queryClient, backend);
  } catch {
    /* module natif indisponible : l'app fonctionne comme dans le navigateur */
  }
}

async function startNative(queryClient: QueryClient, backend: () => Backend | null): Promise<void> {
  const [{ App }, { SpeechRecognition }] = await Promise.all([import('@capacitor/app'), import('@capgo/capacitor-speech-recognition')]);
  await App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void queryClient.invalidateQueries();
  });
  (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition = nativeRecognitionClass(SpeechRecognition);
  await registerPush(backend);
}

/** Ouvre une page de connexion externe : Safari dans l'app native, la même fenêtre sinon. */
export async function openExternal(url: string): Promise<void> {
  if (!isNativeApp()) {
    window.location.assign(url);
    return;
  }
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url, presentationStyle: 'popover' });
}
