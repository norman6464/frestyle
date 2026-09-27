import type { KbPage } from './types';

/**
 * 開いているページの画面（本文）へ、ほかの場所で起きた変化を知らせる合図。
 *
 * ページの一覧・木・スペースなど、サーバーから取ったものの写しは共有の問い合わせ
 * （TanStack Query）に置き、書き込んだ側がその控えを直す（kbPageTreeCache など）。
 * ここに残すのは、控えではなく画面が持っているもの — 本文を書いている最中のページ
 * （useKbPageDoc）— へ届ける合図だけ。本文は書きかけの下書きで、裏で取り直した
 * 結果で上書きしてはいけないので、共有の問い合わせには入れていない。
 *
 * 合図はサーバーが返した確定後の値を運ぶ（楽観更新の合図ではない — 失敗した操作が
 * 合図になることはない）。
 */
export type KbTreeEvent =
  /** 左の列での改名など。開いているページなら題名を、祖先ならパンくずの題名を差し替える。 */
  | { type: 'page-updated'; page: KbPage }
  /** 物理削除（子孫ごと消えた）。開いている画面が「消えた場所」かはページ側が判定する。 */
  | { type: 'page-deleted'; pageId: string }
  /** 配下は FK CASCADE で全消去。開いている画面がその配下かはページ側が判定する。 */
  | { type: 'workspace-deleted'; workspaceSlug: string };

type KbTreeEventListener = (event: KbTreeEvent) => void;

const listeners = new Set<KbTreeEventListener>();

/** subscribeKbTreeEvents は購読を開始し、解除関数を返す。 */
export function subscribeKbTreeEvents(listener: KbTreeEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** emitKbTreeEvent は購読者全員へ知らせる。購読者がいなければ何もしない。 */
export function emitKbTreeEvent(event: KbTreeEvent): void {
  // 途中で購読が外れても走査が壊れないよう写しを回す。
  for (const listener of [...listeners]) {
    listener(event);
  }
}
