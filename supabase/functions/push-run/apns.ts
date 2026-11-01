/**
 * Envoi d'une notification à un iPhone par le service d'Apple (APNs, HTTP/2),
 * authentifié par un jeton JWT ES256 signé avec la clé .p8 (valable 1 h ;
 * régénéré toutes les 50 minutes).
 */
import type { FetchLike } from '../_shared/rest.ts';

const b64url = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const utf8 = (s: string) => new TextEncoder().encode(s);

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function importApnsKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', pemToDer(pem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** JWT du fournisseur : signature ECDSA P-256 brute (r‖s), comme l'exige ES256. */
export async function providerToken(key: CryptoKey, keyId: string, teamId: string, nowSec: number): Promise<string> {
  const head = b64url(utf8(JSON.stringify({ alg: 'ES256', kid: keyId })));
  const claims = b64url(utf8(JSON.stringify({ iss: teamId, iat: nowSec })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${head}.${claims}`)));
  return `${head}.${claims}.${b64url(sig)}`;
}

export interface PushMessage {
  title: string;
  body: string;
  path: string;
}

export type SendOutcome = 'sent' | 'bad_token' | 'retry';

/** Raisons pour lesquelles Apple refuse définitivement un jeton. */
const BAD_TOKEN = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic', 'ExpiredToken']);

export async function sendToDevice(fetchFn: FetchLike, host: string, jwt: string, bundleId: string, token: string, m: PushMessage): Promise<SendOutcome> {
  let res: Response;
  try {
    res = await fetchFn(`${host}/3/device/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${jwt}`,
        'apns-topic': bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ aps: { alert: { title: m.title, body: m.body }, sound: 'default' }, path: m.path }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return 'retry';
  }
  if (res.ok) return 'sent';
  if (res.status === 410) return 'bad_token';
  const reason = await res
    .json()
    .then((b: unknown) => (b && typeof b === 'object' && 'reason' in b && typeof b.reason === 'string' ? b.reason : ''))
    .catch(() => '');
  return BAD_TOKEN.has(reason) ? 'bad_token' : 'retry';
}
