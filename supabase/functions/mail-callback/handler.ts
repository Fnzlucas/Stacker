/**
 * Retour de Google / Microsoft après l'autorisation. Vérifie l'état signé,
 * échange le code, chiffre le jeton de rafraîchissement, l'enregistre, puis
 * renvoie le navigateur vers le profil avec le résultat (jamais de détail).
 */
import { callRpc, RpcError, type FetchLike } from '../_shared/rest.ts';
import { OAuthError, encryptToken, exchangeCode, verifyState } from '../_shared/mail.ts';
import type { MailConfigResult } from '../_shared/mailConfig.ts';

export interface HandlerDeps {
  config: MailConfigResult;
  fetch: FetchLike;
  log: (event: string, data?: Record<string, string | number | boolean | string[]>) => void;
  now?: () => number;
}

const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  if (!deps.config.ok) deps.log('config_invalid', { variables: deps.config.missing });
  return async function handle(req: Request): Promise<Response> {
    if (!deps.config.ok) return new Response('Service indisponible', { status: 503 });
    const config = deps.config.config;
    const back = (result: 'connectee' | 'refusee' | 'erreur') => redirect(`${config.siteUrl}/app/profil?boite=${result}`);
    if (req.method !== 'GET') return new Response(null, { status: 405 });
    const q = new URL(req.url).searchParams;
    const state = await verifyState(config.stateKey, q.get('state') ?? '', now());
    if (!state) {
      deps.log('bad_state');
      return back('erreur');
    }
    if (q.get('error')) {
      deps.log('consent_refused', { provider: state.provider });
      return back('refusee');
    }
    const code = q.get('code');
    const client = config.clients[state.provider];
    if (!code || code.length > 2048 || !client) return back('erreur');
    try {
      const { email, refreshToken } = await exchangeCode(deps.fetch, state.provider, client, config.redirectUri, code);
      const tokenEnc = await encryptToken(config.tokenKey, refreshToken);
      await callRpc(deps.fetch, config.supabaseUrl, config.serviceRoleKey, 'mail_account_save', { p_user: state.userId, p_provider: state.provider, p_email: email, p_token_enc: tokenEnc });
      deps.log('connected', { provider: state.provider });
      return back('connectee');
    } catch (error) {
      deps.log('connect_failed', { provider: state.provider, reason: error instanceof OAuthError ? error.code : error instanceof RpcError ? `rpc_${String(error.status)}` : 'exception' });
      return back(error instanceof OAuthError && error.code === 'scope_refused' ? 'refusee' : 'erreur');
    }
  };
}
