import { createContext, useContext } from 'react';

/**
 * 本文の左の列へ「画面ごとの区画」を差し込むための連絡係。
 *
 * 列の置き場所は AppShell が持つが、そこへ入れる中身（ナレッジのスペースと木）は画面側にしか
 * 作れない —— 木を描くには「いま開いているページがどのスペースの物か」が要り、それを知って
 * いるのは画面だから。
 *
 * そこで DOM の置き場所だけを殻が用意し、中身は画面が portal で差し込む（shared/ui/SidebarSlot）。
 * portal なので React の木としては画面の中に居続け、状態も Router も Toast もそのまま使える。
 * JSX を state に持ち上げて受け渡すやり方は、描画のたびに同一性が変わるため
 * 「差し込む → 再描画 → また差し込む」の輪に入りやすく、採らない。
 */
export interface SidebarSlotValue {
  /** 差し込み先の DOM。列が描かれるまでは null。 */
  host: HTMLElement | null;
  setHost: (el: HTMLElement | null) => void;
  /** いま誰かが区画を差し込んでいるか（差し込みが無ければ列そのものを出さない）。 */
  filled: boolean;
  register: () => () => void;
}

export const SidebarSlotContext = createContext<SidebarSlotValue | null>(null);

/** 左の列の連絡係。Provider の外（単体テスト・story）では null。 */
export function useSidebarSlot(): SidebarSlotValue | null {
  return useContext(SidebarSlotContext);
}

/** 左の列に区画が差し込まれているか。列と、それを開く三本線の出し分けに使う。 */
export function useSidebarSlotFilled(): boolean {
  return useContext(SidebarSlotContext)?.filled ?? false;
}
