/**
 * ホームの見た目の部品。報道系サイトの一覧面から借りたのは骨組み（中央 1125px の器・全幅の灰色の帯に
 * 等幅の白いカード・密な一覧の行・角を丸めない面・脇柱の箱）だけで、中身は FreStyle の性質に合わせる
 * （順位や配信元のような要素は持たない）。色は既存のトークンだけを使う。
 */

/** 本文の器。中央寄せの 1125px（左右の余白ぶんを足した幅で切る）。狭い幅では左右の余白だけ持つ。 */
export const homeContainer = 'mx-auto w-full min-w-0 max-w-[calc(1125px+4rem)] px-4 sm:px-6 lg:px-8';

/** 帯や本文の上に置く白い面。角を丸めず、1px の枠だけで地から分ける（影は使わない）。 */
export const homeCard = 'border border-surface-3 bg-surface-1';

/** 欄の見出し（24px 太字）。 */
export const homeHeading = 'text-2xl font-bold leading-9 text-[var(--color-text-primary)]';

/** 一覧の行の題名。16px / 24px の通常の太さ（太さではなく、行の並びと区切りで読ませる）。 */
export const homeRowTitle =
  'block text-base font-normal leading-6 text-[var(--color-text-primary)] [overflow-wrap:anywhere] underline-offset-4 group-hover:underline';

/** 行の補足（12px の薄い灰色）。 */
export const homeMeta = 'text-xs leading-5 text-[var(--color-text-muted)]';

/** 見出しの横や節の下に置く文字の入口（「一覧へ ›」など）。押せる高さは 44px。 */
export const homeTextLink =
  'inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-medium text-brand-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600';

/** 行全体を押せる一覧の 1 行。密に並べ、行の間は 1px の線で区切る（区切りは li 側が持つ）。 */
export const homeRowLink =
  'group flex items-start gap-3 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600';

/** 小さな塗りのボタン。14px 太字・高さ 36px・角 3px。指では ui-hit で 44px。 */
export const homeFilledButton =
  'ui-hit inline-flex min-h-9 items-center justify-center gap-1 rounded-md bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700 active:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

/** 脇柱の薄い青の箱の中に重ねる白い段（未読・行き先）。 */
export const homeBoxRow =
  'flex min-h-12 items-center gap-3 border border-surface-3 bg-surface-1 px-3 py-2 text-sm font-bold text-[var(--color-text-primary)]';

/** 白い段そのものが押せる行き先。 */
export const homeBoxRowLink = `${homeBoxRow} group hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600`;

/** 主ボタンの見た目の入口（リンク）。共通の Button の primary と同じ色と大きさ。 */
export const homePrimaryLink =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand-600 px-6 text-base font-semibold text-white hover:bg-brand-700 active:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

/** 白地に枠の入口（リンク）。共通の Button の secondary と同じ色。 */
export const homeSecondaryLink =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[var(--color-border-hover)] bg-surface-1 px-5 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';
