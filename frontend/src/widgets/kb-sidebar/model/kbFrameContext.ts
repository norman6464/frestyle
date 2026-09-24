import { createContext, useContext } from 'react';
import type { KbSpace } from '@/entities/kb';

export interface KbFrameValue {
  /** 枠が今いると判断しているスペース。決まっていなければ null。 */
  space: KbSpace | null;
}

/**
 * KbFrameContext は枠（KbFrame）が本文へ「今いるスペース」を渡す口。
 *
 * ページの応答（KbResolvedPage）はスペースの id しか持たず名前が無い。パンくずにスペースの段を
 * 出すために本文がもう一度スペース一覧を取るのは無駄で、枠は木のために既に持っている。
 * 枠の外（story・単体テスト）では null のまま — スペースの段が無いだけで本文は壊れない。
 */
export const KbFrameContext = createContext<KbFrameValue>({ space: null });

export function useKbFrameSpace(): KbSpace | null {
  return useContext(KbFrameContext).space;
}
