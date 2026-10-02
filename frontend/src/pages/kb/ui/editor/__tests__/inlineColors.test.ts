import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { contractPath } from '@/test/contracts';
import {
  COLORED_MARK_TYPES,
  INLINE_MARK_COLORS,
  INLINE_MARK_COLOR_LABELS,
  isInlineMarkColor,
  sanitizeDocColors,
} from '../inlineColors';

const CONTRACT_PATH = contractPath('kb-inline-attrs.json');

interface Contract {
  marks: Record<string, { color: string[] }>;
}

describe('色の名前の契約（contracts/kb-inline-attrs.json）', () => {
  it('検査するマークの種類と、許す色の名前が契約ファイルと一致する', () => {
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as Contract;
    expect(Object.keys(contract.marks).sort()).toEqual([...COLORED_MARK_TYPES].sort());
    for (const [markType, spec] of Object.entries(contract.marks)) {
      expect([...spec.color].sort(), markType).toEqual([...INLINE_MARK_COLORS].sort());
    }
  });

  it('すべての色に日本語の読み上げ名がある', () => {
    for (const color of INLINE_MARK_COLORS) {
      expect(INLINE_MARK_COLOR_LABELS[color]).toMatch(/^.+$/);
    }
  });
});

describe('isInlineMarkColor', () => {
  it('許した名前だけ通す（生の色コード・大文字違い・文字列以外は通さない）', () => {
    expect(isInlineMarkColor('red')).toBe(true);
    expect(isInlineMarkColor('gray')).toBe(true);
    expect(isInlineMarkColor('#ff0000')).toBe(false);
    expect(isInlineMarkColor('Red')).toBe(false);
    expect(isInlineMarkColor('')).toBe(false);
    expect(isInlineMarkColor(123)).toBe(false);
    expect(isInlineMarkColor(null)).toBe(false);
  });
});

describe('sanitizeDocColors', () => {
  const text = (marks?: unknown[]) => ({ type: 'text', text: '色', ...(marks ? { marks } : {}) });
  const doc = (marks?: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content: [text(marks)] }] });

  it('許した名前のマークは残し、通らない色のマークだけ剥がす（文字とほかのマークは残る）', () => {
    const input = doc([
      { type: 'bold' },
      { type: 'textStyle', attrs: { color: '#ff0000' } },
      { type: 'highlight', attrs: { color: 'yellow' } },
      { type: 'link', attrs: { href: 'https://example.com' } },
    ]);
    const out = sanitizeDocColors(input);
    const marks = out.content?.[0]?.content?.[0]?.marks?.map((m) => m.type);
    expect(marks).toEqual(['bold', 'highlight', 'link']);
    expect(out.content?.[0]?.content?.[0]?.text).toBe('色');
  });

  it('色の無い textStyle・文字列でない色・attrs の無い highlight も剥がす', () => {
    const input = doc([{ type: 'textStyle', attrs: {} }, { type: 'highlight', attrs: { color: 7 } }, { type: 'highlight' }]);
    const out = sanitizeDocColors(input);
    expect(out.content?.[0]?.content?.[0]?.marks).toBeUndefined();
  });

  it('剥がすものが無ければ同じ参照を返す（無用な複製をしない）', () => {
    const input = doc([{ type: 'textStyle', attrs: { color: 'blue' } }]);
    expect(sanitizeDocColors(input)).toBe(input);
  });

  it('入れ子（リストの中の段落）の中も見る', () => {
    const input = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text([{ type: 'textStyle', attrs: { color: 'nope' } }])] }] }],
        },
      ],
    };
    const out = sanitizeDocColors(input);
    expect(JSON.stringify(out)).not.toContain('textStyle');
    expect(JSON.stringify(out)).toContain('色');
  });
});
