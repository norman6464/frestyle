import { describe, it, expect } from 'vitest';
import { formatFileSize } from '../formatFileSize';

describe('formatFileSize', () => {
  it('1024 未満は B のまま', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('KB / MB / GB へ単位を上げる', () => {
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatFileSize(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
  });

  it('不正な値は空文字を返す', () => {
    expect(formatFileSize(-1)).toBe('');
    expect(formatFileSize(NaN)).toBe('');
  });
});
