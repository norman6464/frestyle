import { describe, expect, it } from 'vitest';
import { extractHeadings } from '../docOutline';

const heading = (level: number, text: string, id?: string) => ({
  type: 'heading',
  attrs: { level, ...(id ? { id } : {}) },
  content: text === '' ? [] : [{ type: 'text', text }],
});

describe('extractHeadings', () => {
  it('見出しだけを本文の順に取り出し、id と段を持たせる', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '前置き' }] },
        heading(2, '命名', 'h-1'),
        heading(3, 'ファイル名', 'h-2'),
        heading(2, 'レビュー', 'h-3'),
      ],
    };
    expect(extractHeadings(doc)).toEqual([
      { id: 'h-1', level: 2, text: '命名', index: 0 },
      { id: 'h-2', level: 3, text: 'ファイル名', index: 1 },
      { id: 'h-3', level: 2, text: 'レビュー', index: 2 },
    ]);
  });

  it('太字やリンクで分かれた見出しの文字は 1 行につなぐ', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [
            { type: 'text', text: 'PR の' },
            { type: 'text', text: '粒度', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    };
    expect(extractHeadings(doc).map((h) => h.text)).toEqual(['PR の粒度']);
  });

  it('空の見出しと 4 段以降は目次に出さない', () => {
    const doc = { type: 'doc', content: [heading(2, ''), heading(4, '細かい区切り'), heading(1, '題')] };
    expect(extractHeadings(doc)).toEqual([{ id: undefined, level: 1, text: '題', index: 0 }]);
  });

  it('本文が無い・形が違うときは空', () => {
    expect(extractHeadings(null)).toEqual([]);
    expect(extractHeadings({ type: 'doc' })).toEqual([]);
    expect(extractHeadings('壊れた値')).toEqual([]);
  });
});
