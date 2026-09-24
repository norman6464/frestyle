/** 見出しの横や節の下に置く文字の入口（「一覧へ ›」「履歴をひらく ›」など）。押せる高さは 44px。 */
export const homeTextLink =
  'inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-medium text-brand-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600';

/** 右の列の行き先（「プロジェクトの作業へ →」）。見出しに近い太さの黒い文字。 */
export const homeStrongLink =
  'inline-flex min-h-11 items-center gap-1 rounded-md text-base font-bold text-[var(--color-text-primary)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600';

/** 行全体を押せる一覧の 1 行。 */
export const homeRowLink =
  'group flex min-h-16 items-center gap-4 rounded-lg py-4 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600';

/** 主ボタンの見た目の入口（リンク）。共通の Button の primary と同じ色と大きさ。 */
export const homePrimaryLink =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand-600 px-6 text-base font-semibold text-white hover:bg-brand-700 active:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

/** 白地に枠の入口（リンク）。共通の Button の secondary と同じ色。 */
export const homeSecondaryLink =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[var(--color-border-hover)] bg-surface-1 px-5 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';
