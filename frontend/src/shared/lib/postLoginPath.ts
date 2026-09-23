import { isAppPath } from './appPath';

/**
 * 「ログインしたらここへ戻る」の置き場。
 *
 * 招待リンク（/invite）のように、ログイン前に開いた画面から続きへ戻したいときに使う。
 * ログイン画面はクエリ（?next=）で戻り先を受け取らない — 発行者（GCIP / Dex）へ丸ごと遷移して
 * 戻ってくる経路では URL を持ち回れないので、タブに閉じた sessionStorage に置く。
 *
 * 保存するのはアプリ内のパスだけ（isAppPath）。外部 URL を置ける口にすると、ログイン直後に
 * 別サイトへ飛ばすリンクを作れてしまう。
 */
const KEY = 'fs.postLoginPath';

export function rememberPostLoginPath(path: string): void {
  if (!isAppPath(path)) return;
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    // 私的ブラウジング等で使えないときは諦める（ログイン後はホームへ）。
  }
}

/** 置いてあった戻り先を取り出して消す。無ければ null。使い切りなので、同じ値で 2 回戻らない。 */
export function consumePostLoginPath(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return path && isAppPath(path) ? path : null;
  } catch {
    return null;
  }
}
