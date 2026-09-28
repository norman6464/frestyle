import { useToast } from '@/shared/lib/hooks/useToast';
import { useKbPageFavorite } from '../model/useKbPageFavorite';
import KbFavoriteButton from './KbFavoriteButton';

export interface KbFavoriteControlProps {
  workspaceSlug: string;
  pageId: string;
  /** ページの応答の isFavorite。 */
  initial: boolean;
}

/**
 * ページのお気に入りの星。入れた・外したの状態はここだけで持ち、押してもページ全体
 * （本文・題名・右の欄）を描き直さない。失敗したら元へ戻して知らせる。
 */
export default function KbFavoriteControl({ workspaceSlug, pageId, initial }: KbFavoriteControlProps) {
  const { showToast } = useToast();
  const favorite = useKbPageFavorite(workspaceSlug, pageId, initial);
  const toggle = async () => {
    // 知らせの文言は try の外で決める（try/catch の中の条件式は React Compiler が扱えない）。
    const failure = favorite.favorite ? 'お気に入りから外せませんでした' : 'お気に入りに追加できませんでした';
    try {
      await favorite.toggle();
    } catch {
      showToast('error', failure);
    }
  };
  return <KbFavoriteButton favorite={favorite.favorite} pending={favorite.pending} onToggle={() => void toggle()} />;
}
