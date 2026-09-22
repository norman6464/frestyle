export function getFieldBorderClass(hasError: boolean): string {
  return hasError
    ? 'border-danger focus:border-danger focus:ring-danger'
    : 'border-surface-3 focus:border-brand-400 focus:ring-brand-400';
}
