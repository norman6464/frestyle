import type { KbResolvedCover } from '@/entities/kb';

export interface KbPageCoverProps {
  /** カバー画像。未設定は null。 */
  cover: KbResolvedCover | null;
}

/**
 * KbPageCover はページ頭部のカバー画像の表示だけを担う。
 *
 * `cover.url` は resolvePage 応答が既に解決した後の一時 URL — 本文中の画像
 * （ImageView）と違い、ここでは resolveImageSrc を挟まずそのまま `<img src>` に使う。
 * 未設定なら何も出さない（無いものを匂わせる空欄を置かない）。
 */
export default function KbPageCover({ cover }: KbPageCoverProps) {
  if (!cover) return null;

  return (
    // 記事面の画像と同じく角を丸めない（本文の中の画像も rte-article で角を落としている）。
    <div className="mb-6 aspect-[4/1] w-full overflow-hidden bg-surface-2">
      <img src={cover.url} alt="" className="h-full w-full object-cover" />
    </div>
  );
}
