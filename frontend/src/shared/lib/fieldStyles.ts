/**
 * 入力欄の枠とフォーカスの輪の色。
 *
 * フォーカスの輪は brand-600（白地 5.15:1）。枠線・輪郭には 3:1（WCAG 2.2 SC 1.4.11）が要り、
 * brand-400（白地 2.33:1）では届かない。全体の :focus-visible と揃える。
 */
export function getFieldBorderClass(hasError: boolean): string {
  return hasError
    ? 'border-danger focus:border-danger focus:ring-danger'
    : 'border-surface-3 focus:border-brand-600 focus:ring-brand-600';
}
