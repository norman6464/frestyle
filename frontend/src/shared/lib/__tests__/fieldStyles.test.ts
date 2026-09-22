import { describe, it, expect } from 'vitest';
import { getFieldBorderClass } from '../fieldStyles';

describe('getFieldBorderClass', () => {
  it('エラーありの場合はrose系のクラスを返す', () => {
    const result = getFieldBorderClass(true);
    expect(result).toContain('border-danger');
    expect(result).toContain('focus:border-danger');
  });

  it('エラーなしの場合はbrand系のクラスを返す', () => {
    const result = getFieldBorderClass(false);
    expect(result).toContain('border-surface-3');
    expect(result).toContain('focus:border-brand-400');
  });
});
