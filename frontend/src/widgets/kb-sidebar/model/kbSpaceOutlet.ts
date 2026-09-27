import { useOutletContext } from 'react-router-dom';
import type { KbMySpace } from '@/entities/kb';

/** 親ルート KbSpaceLayout が解決して、スペースの画面へ渡すもの。 */
export interface KbSpaceOutlet {
  workspaceSlug: string;
  space: KbMySpace;
}

/**
 * スペースの画面（概要・すべてのページ・お気に入り・メンバー）が、親ルートの解決した
 * スペースを受け取る。親ルートは解決できたときだけ子を描くので、ここで null は返らない。
 */
export function useKbSpaceOutlet(): KbSpaceOutlet {
  return useOutletContext<KbSpaceOutlet>();
}
