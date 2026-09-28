import { describe, it, expect } from 'vitest';
import { splitExcerptMatch } from '../highlightExcerpt';

describe('splitExcerptMatch', () => {
  it('一致箇所が中ほどにあれば、一致前・一致・一致後の3つに分ける', () => {
    const got = splitExcerptMatch('…この段落には docker の使い方が書かれている…', 8, 6);

    expect(got).toEqual({
      before: '…この段落には ',
      match: 'docker',
      after: ' の使い方が書かれている…',
    });
  });

  it('matchStart=0（先頭からの一致）', () => {
    const got = splitExcerptMatch('docker の使い方', 0, 6);

    expect(got).toEqual({ before: '', match: 'docker', after: ' の使い方' });
  });

  it('matchLen が excerpt 全体（抜粋のすべてが一致）', () => {
    const excerpt = 'docker';
    const got = splitExcerptMatch(excerpt, 0, excerpt.length);

    expect(got).toEqual({ before: '', match: 'docker', after: '' });
  });

  it('matchLen=0（一致箇所の長さが無い）なら match は空文字', () => {
    const got = splitExcerptMatch('docker の使い方', 6, 0);

    expect(got).toEqual({ before: 'docker', match: '', after: ' の使い方' });
  });

  it('< / & 等の HTML として解釈され得る文字を含んでいても、そのまま3分割する（変換・除去しない）', () => {
    const excerpt = '条件は a < b && c > d のとき成立する';
    const start = excerpt.indexOf('a < b');
    const got = splitExcerptMatch(excerpt, start, 'a < b'.length);

    expect(got.match).toBe('a < b');
    expect(got.before + got.match + got.after).toBe(excerpt);
    // 文字そのものは変換されない（呼び出し側が React ノードとして描画することで
    // 安全になる — ここでは実体参照（&lt; 等）へは変換しない）。
    expect(got.after).toContain('&& c > d');
  });

  it('matchStart が excerpt の長さを超えていても落ちない（丸めて範囲内に収める）', () => {
    const excerpt = 'docker';
    const got = splitExcerptMatch(excerpt, 999, 3);

    expect(got).toEqual({ before: 'docker', match: '', after: '' });
  });

  it('matchStart が負数でも落ちない（0 に丸める）', () => {
    const got = splitExcerptMatch('docker の使い方', -5, 6);

    expect(got).toEqual({ before: '', match: 'docker', after: ' の使い方' });
  });

  it('matchLen が負数でも落ちない（0 扱いにする）', () => {
    const got = splitExcerptMatch('docker の使い方', 2, -3);

    expect(got).toEqual({ before: 'do', match: '', after: 'cker の使い方' });
  });

  it('matchStart + matchLen が excerpt の長さを超えても落ちない（末尾で切る）', () => {
    const excerpt = 'docker';
    const got = splitExcerptMatch(excerpt, 3, 100);

    expect(got).toEqual({ before: 'doc', match: 'ker', after: '' });
  });

  it('空の excerpt でも落ちない', () => {
    expect(splitExcerptMatch('', 0, 0)).toEqual({ before: '', match: '', after: '' });
  });

  // backendのmatchStart/matchLenはGoのrune単位（Unicodeコードポイント）。絵文字（😀等）は
  // サロゲートペアでJSの文字列indexだと2として数えられてしまうため、単純なslice(start,end)
  // だと絵文字を含む抜粋でズレる・サロゲートペアを分断して壊れた文字になる — その回帰確認。
  it('サロゲートペア文字（絵文字）を含む抜粋でも、rune単位のmatchStart/matchLenどおりに分割する', () => {
    // "🎉docker" — 先頭の絵文字はコードポイントで1文字（Goのruneでも1）だが
    // JSのstring.lengthでは2（サロゲートペア）としてカウントされる。
    const excerpt = '🎉docker の使い方';
    // backend視点: [0]=🎉, [1..6]=docker, [7]=' ', ... というrune単位のオフセット。
    const got = splitExcerptMatch(excerpt, 1, 6);

    expect(got).toEqual({ before: '🎉', match: 'docker', after: ' の使い方' });
    // サロゲートペアが分断され壊れた文字（U+FFFD等）になっていないことも確認する。
    expect(got.before).toBe('🎉');
    expect([...got.before]).toHaveLength(1);
  });

  it('絵文字が一致箇所の直後にある場合も、コードポイント境界で正しく分割する', () => {
    const excerpt = 'docker🎉の使い方';
    const got = splitExcerptMatch(excerpt, 0, 6);

    expect(got).toEqual({ before: '', match: 'docker', after: '🎉の使い方' });
  });
});
