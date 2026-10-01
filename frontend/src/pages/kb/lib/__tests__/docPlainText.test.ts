import { describe, it, expect } from 'vitest';
import { extractPlainText } from '../docPlainText';
import { emptyRichDoc } from '@/shared/lib/richDoc';
import type { RichDocContent } from '@/shared/lib/richDoc';

describe('extractPlainText', () => {
  it('段落・見出しをまたいでテキストノードを連結する', () => {
    const doc: RichDocContent = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: '見出し' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '本文の' }, { type: 'text', text: '続き' }] },
      ],
    };
    expect(extractPlainText(doc)).toBe('見出し本文の続き');
  });

  it('本文が空（段落 1 つだけ）なら空文字', () => {
    expect(extractPlainText(emptyRichDoc())).toBe('');
  });

  it('リスト等の入れ子でも text を持つ子まで辿る', () => {
    const doc: RichDocContent = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '項目1' }] }] },
          ],
        },
      ],
    };
    expect(extractPlainText(doc)).toBe('項目1');
  });
});
