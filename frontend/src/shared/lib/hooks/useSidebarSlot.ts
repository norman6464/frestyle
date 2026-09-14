import { createContext, useContext } from 'react';

/**
 * 左の柱は 1 本しか無い。そこへ「画面ごとの区画」を差し込むための連絡係。
 *
 * 柱そのもの（行き先・スペース・通知・設定）は AppShell が常に描くが、そこへ入れる中身
 * （ナレッジの木・バックログのプロジェクト）は画面側にしか作れない —— 木を描くには
 * 「いま開いているページがどのスペースの物か」が要り、それを知っているのは画面だから。
 *
 * そこで DOM の置き場所だけを柱が用意し、中身は画面が portal で差し込む（shared/ui/SidebarSlot）。
 * portal なので React の木としては画面の中に居続け、状態も Router も Toast もそのまま使える。
 * JSX を state に持ち上げて受け渡すやり方は、描画のたびに同一性が変わるため
 * 「差し込む → 再描画 → また差し込む」の輪に入りやすく、採らない。
 */
export interface SidebarSlotValue {
  /** 差し込み先の DOM。柱が描かれるまでは null。 */
  host: HTMLElement | null;
  setHost: (el: HTMLElement | null) => void;
  /** いま誰かが区画を差し込んでいるか（柱は、差し込みが無いときだけ既定の区画を出す）。 */
  filled: boolean;
  register: () => () => void;
}

export const SidebarSlotContext = createContext<SidebarSlotValue | null>(null);

/** 柱の中の連絡係。Provider の外（単体テスト・story）では null。 */
export function useSidebarSlot(): SidebarSlotValue | null {
  return useContext(SidebarSlotContext);
}

/** 柱に区画が差し込まれているか。柱の既定の中身を出し分けるのに使う。 */
export function useSidebarSlotFilled(): boolean {
  return useContext(SidebarSlotContext)?.filled ?? false;
}
