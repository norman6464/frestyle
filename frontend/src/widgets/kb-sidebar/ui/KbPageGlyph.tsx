import { KbPageGroupIcon, KbPageGroupOpenIcon, KbPageIcon } from '@/shared/ui/icons/kb';
import type { KbPage } from '@/entities/kb';

export interface KbPageGlyphProps {
  /** 見るのは絵文字（icon）だけ。ページの形を丸ごと持たない一覧（お気に入り）からも使えるようにする。 */
  page: Pick<KbPage, 'icon'>;
  className: string;
  /** 子を持つページか（フォルダ／紙の切り替えに使う。絵文字が有れば見ない）。 */
  hasChildren?: boolean;
  /** 開いているか（フォルダの開閉の絵に使う。絵文字が有れば見ない）。 */
  expanded?: boolean;
}

/**
 * KbPageGlyph はページ 1 件の印（サイドバー行・検索結果で共用）。
 *
 * 絵文字を設定したページは、開閉の見た目（フォルダ / 紙）より絵文字を優先する。
 * 開いているかどうかは行の三角（chevron）が別に伝えているので、絵文字に
 * 差し替えても「この段が開いているか」の情報は消えない。
 */
export default function KbPageGlyph({ page, className, hasChildren = false, expanded = false }: KbPageGlyphProps) {
  if (page.icon?.type === 'emoji') {
    // className は SVG アイコンの寸法（h-4 w-4 等）を渡す前提。絵文字はグリフの
    // 基準線が SVG と揃わないので、中央寄せだけこちらで足す（文字色は当てない
    // ―― 絵文字は地の色を持つので、渡された text-* は元々効かない）。
    return (
      <span
        data-icon="emoji"
        aria-hidden="true"
        className={`inline-flex items-center justify-center leading-none ${className}`}
      >
        {page.icon.value}
      </span>
    );
  }
  const Icon = hasChildren ? (expanded ? KbPageGroupOpenIcon : KbPageGroupIcon) : KbPageIcon;
  return <Icon className={className} />;
}
