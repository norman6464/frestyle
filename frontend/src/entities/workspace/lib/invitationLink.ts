/**
 * 招待リンクは `/invite#t=<token>` の形にする。
 *
 * トークンをクエリ（?t=）ではなくフラグメント（#t=）に載せるのは、フラグメントがサーバーへ
 * 送られないため — アクセスログ・プロキシのログ・Referer にトークンが残らない。
 * 開いた側（/invite）はフラグメントを読んだら URL から消し、本文で POST /kb/invitations/preview に送る。
 */
const INVITE_PATH = '/invite';
const TOKEN_KEY = 't';

/** 招待 URL を組み立てる。origin は `window.location.origin`（本番なら https://frestyle.dev）。 */
export function buildInviteUrl(origin: string, token: string): string {
  return `${origin}${INVITE_PATH}#${TOKEN_KEY}=${encodeURIComponent(token)}`;
}

/** `location.hash` から招待のトークンを取り出す。無ければ null。 */
export function readInviteToken(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const token = params.get(TOKEN_KEY);
  return token ? token : null;
}
