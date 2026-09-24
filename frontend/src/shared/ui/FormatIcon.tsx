/**
 * 書式バーのアイコン。
 *
 * 文字書式（太字・斜体・打ち消し）と塊（見出し・箇条書き・引用…）の記号は、この製品が
 * 使っている heroicons に無い。そのためここで持つ。素の SVG にしてあるのは、
 * **色と大きさを呼び出し側の文字に合わせたい**ため —— `currentColor` と `em` で効くので、
 * 押下状態の色替えや濃淡がボタン側の className だけで完結する。png に焼くとこれができない。
 *
 * 形は lucide の作法（24×24・端は丸）に合わせてある。線幅だけは lucide の 2 ではなく FsIcon の
 * 1.75 にそろえる（書式バーで隣に並ぶ）。名前も lucide に揃えて、将来ライブラリを入れたときに
 * そのまま差し替えられるようにしてある。
 */
export type FormatIconName =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'heading'
  | 'list'
  | 'list-ordered'
  | 'code'
  | 'code-block'
  | 'quote'
  | 'link'
  | 'undo'
  | 'redo';

/** 名前 → 中身。d だけの配列にして、共通の線の設定は下の <svg> が一括で持つ。 */
const PATHS: Record<FormatIconName, string[]> = {
  bold: ['M14 12a4 4 0 0 0 0-8H6v8', 'M15 20a4 4 0 0 0 0-8H6v8Z'],
  italic: ['M19 4h-9', 'M14 20H5', 'M15 4 9 20'],
  strikethrough: ['M16 4H9a3 3 0 0 0-2.83 4', 'M14 12a4 4 0 0 1 0 8H6', 'M4 12h16'],
  heading: ['M4 12h8', 'M4 18V6', 'M12 18V6', 'M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  'list-ordered': ['M10 6h11', 'M10 12h11', 'M10 18h11', 'M4 6h1v4', 'M4 10h2', 'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1'],
  code: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
  'code-block': ['M10 9.5 8 12l2 2.5', 'm14 9.5 2 2.5-2 2.5', 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z'],
  // 引用は「左の罫＋文」。引用符の形は小さくすると潰れて読めないため、罫で表す。
  quote: ['M4 5v14', 'M9 7h11', 'M9 12h11', 'M9 17h6'],
  link: [
    'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
    'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  ],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  redo: ['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
};

export interface FormatIconProps {
  name: FormatIconName;
  /** 既定は 1em（隣の文字と同じ高さ）。数値を渡せば px。 */
  size?: number | string;
  className?: string;
}

export default function FormatIcon({ name, size = '1em', className = '' }: FormatIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
