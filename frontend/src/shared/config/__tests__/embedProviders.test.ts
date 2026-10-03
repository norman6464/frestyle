import { describe, it, expect } from 'vitest';
import { isValidEmbedVideo } from '../embedProviders';

describe('isValidEmbedVideo', () => {
  it('許可した提供元で、その提供元の形の ID だけを通す', () => {
    expect(isValidEmbedVideo('youtube', 'dQw4w9WgXcQ')).toBe(true);
    expect(isValidEmbedVideo('youtube', 'a-b_c-d_e-f')).toBe(true);
  });

  it.each([
    ['vimeo', 'dQw4w9WgXcQ'],
    ['youtube', 'dQw4w9WgXc'],
    ['youtube', 'dQw4w9WgXcQQ'],
    ['youtube', 'dQw4w9WgX/Q'],
    ['youtube', ''],
    [null, 'dQw4w9WgXcQ'],
    ['youtube', 42],
  ])('%s・%s は通さない', (provider, videoId) => {
    expect(isValidEmbedVideo(provider, videoId)).toBe(false);
  });
});
