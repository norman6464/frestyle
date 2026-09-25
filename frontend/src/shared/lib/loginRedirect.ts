/**
 * ログイン画面へ戻すときに、失敗の理由を渡す形。
 *
 * 渡すのはログインの戻り処理の失敗だけなので、ログイン画面はこれを**失敗として**出す
 * （成功の知らせの見た目にしない）。鍵を 1 つにそろえ、送る側と読む側で名前がずれないようにする。
 */
export interface LoginRedirectState {
  loginError: string;
}

/** navigate('/login', loginErrorRedirect('…')) の形で使う。 */
export function loginErrorRedirect(message: string): { state: LoginRedirectState } {
  return { state: { loginError: message } };
}

/** location.state からログインの失敗の理由を読む。無ければ null。 */
export function readLoginError(state: unknown): string | null {
  if (state && typeof state === 'object' && 'loginError' in state) {
    const value = (state as { loginError: unknown }).loginError;
    return typeof value === 'string' && value !== '' ? value : null;
  }
  return null;
}
