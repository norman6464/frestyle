import { describe, it, expect } from 'vitest';
import { embedPlayerSrc, parseEmbedUrl } from '../embedUrl';

const ID = 'dQw4w9WgXcQ';

describe('parseEmbedUrl', () => {
  it.each([
    ['watch', `https://www.youtube.com/watch?v=${ID}`],
    ['watch（ほかの問い合わせ文字列つき）', `https://www.youtube.com/watch?list=PL1&v=${ID}&t=42s`],
    ['watch（www なし・http）', `http://youtube.com/watch?v=${ID}`],
    ['watch（携帯版）', `https://m.youtube.com/watch?v=${ID}`],
    ['youtu.be', `https://youtu.be/${ID}`],
    ['youtu.be（共有の印つき）', `https://youtu.be/${ID}?si=abcdef`],
    ['shorts', `https://www.youtube.com/shorts/${ID}`],
    ['embed', `https://www.youtube.com/embed/${ID}`],
    ['nocookie の embed', `https://www.youtube-nocookie.com/embed/${ID}`],
    ['live', `https://www.youtube.com/live/${ID}`],
    ['前後の空白', `  https://youtu.be/${ID}\n`],
  ])('%s を読み取る', (_name, url) => {
    expect(parseEmbedUrl(url)).toEqual({ provider: 'youtube', videoId: ID });
  });

  it.each([
    ['YouTube でない', `https://example.com/watch?v=${ID}`],
    ['YouTube に似せた別のホスト', `https://youtube.com.evil.example/watch?v=${ID}`],
    ['ID が短い', 'https://youtu.be/dQw4w9WgXc'],
    ['ID が無い', 'https://www.youtube.com/watch'],
    ['チャンネルのページ', 'https://www.youtube.com/@frestyle'],
    ['shorts の後ろに続き', `https://www.youtube.com/shorts/${ID}/extra`],
    ['http(s) でない', `javascript:alert(1)//youtu.be/${ID}`],
    ['URL でない', 'YouTube の動画'],
  ])('%s は読み取らない', (_name, url) => {
    expect(parseEmbedUrl(url)).toBeNull();
  });
});

describe('embedPlayerSrc', () => {
  it('Cookie を使わない youtube-nocookie.com で、押したあとすぐ再生する', () => {
    expect(embedPlayerSrc({ provider: 'youtube', videoId: ID })).toBe(`https://www.youtube-nocookie.com/embed/${ID}?autoplay=1`);
  });
});
