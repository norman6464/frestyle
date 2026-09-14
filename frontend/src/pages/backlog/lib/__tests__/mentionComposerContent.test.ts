import { describe, it, expect } from 'vitest';
import { editorContentToBlocks, isEditorContentEmpty, blocksToEditorContent } from '../mentionComposerContent';
import type { TicketCommentBlock } from '@/entities/ticket';

describe('editorContentToBlocks', () => {
  it('text ノードをそのまま段落の区間へ写す', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'こんにちは' }] }] };
    expect(editorContentToBlocks(doc)).toEqual([
      { kind: 'paragraph', segments: [{ kind: 'text', text: 'こんにちは' }] },
    ]);
  });

  it('隣り合う text 区間を 1 つへ結合する', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'あ' }, { type: 'text', text: 'い' }] }],
    };
    expect(editorContentToBlocks(doc)).toEqual([{ kind: 'paragraph', segments: [{ kind: 'text', text: 'あい' }] }]);
  });

  it('書式が違う隣の text は別の区間のままにする', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'ふつう' },
            { type: 'text', text: '太い', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    };
    expect(editorContentToBlocks(doc)).toEqual([
      {
        kind: 'paragraph',
        segments: [
          { kind: 'text', text: 'ふつう' },
          { kind: 'text', text: '太い', marks: { bold: true } },
        ],
      },
    ]);
  });

  it('mention ノードは userId を持つ区間になる（表示名は送らない）', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { userId: '42', name: '田中 太郎' } }] }],
    };
    expect(editorContentToBlocks(doc)).toEqual([{ kind: 'paragraph', segments: [{ kind: 'mention', userId: '42' }] }]);
  });

  it('hardBreak は文字の \\n として前後の text と結合する（wire に hardBreak ノードを残さない）', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '1行目' }, { type: 'hardBreak' }, { type: 'text', text: '2行目' }],
        },
      ],
    };
    expect(editorContentToBlocks(doc)).toEqual([
      { kind: 'paragraph', segments: [{ kind: 'text', text: '1行目\n2行目' }] },
    ]);
  });

  it('text と mention が混ざっても順番どおり区間になる', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'よろしく ' },
            { type: 'mention', attrs: { userId: '7', name: '佐藤' } },
            { type: 'text', text: ' お願いします' },
          ],
        },
      ],
    };
    expect(editorContentToBlocks(doc)).toEqual([
      {
        kind: 'paragraph',
        segments: [
          { kind: 'text', text: 'よろしく ' },
          { kind: 'mention', userId: '7' },
          { kind: 'text', text: ' お願いします' },
        ],
      },
    ]);
  });

  it('複数段落はそれぞれ別の塊になる（\\n へ畳まない）', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '段落1' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '段落2' }] },
      ],
    };
    expect(editorContentToBlocks(doc)).toEqual([
      { kind: 'paragraph', segments: [{ kind: 'text', text: '段落1' }] },
      { kind: 'paragraph', segments: [{ kind: 'text', text: '段落2' }] },
    ]);
  });

  it('bulletList は項目ごとの区間を持つ塊になる（項目の中の段落は潜って剥がす）', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '一つ目' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '二つ目' }] }] },
          ],
        },
      ],
    };
    expect(editorContentToBlocks(doc)).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [[{ kind: 'text', text: '一つ目' }], [{ kind: 'text', text: '二つ目' }]],
      },
    ]);
  });

  it('orderedList は ordered: true になる', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '手順' }] }] }],
        },
      ],
    };
    expect(editorContentToBlocks(doc)).toEqual([
      { kind: 'list', ordered: true, items: [[{ kind: 'text', text: '手順' }]] },
    ]);
  });

  it('空の項目しかない箇条書きは塊ごと落とす', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }] }],
    };
    expect(editorContentToBlocks(doc)).toEqual([]);
  });

  it('中身が無ければ空配列', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [] }] };
    expect(editorContentToBlocks(doc)).toEqual([]);
  });

  it('userId が空文字の mention は落とす', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { userId: '' } }] }] };
    expect(editorContentToBlocks(doc)).toEqual([]);
  });
});

describe('blocksToEditorContent / editorContentToBlocks の往復', () => {
  it('text だけの段落は往復して同じ内容に戻る', () => {
    const blocks: TicketCommentBlock[] = [{ kind: 'paragraph', segments: [{ kind: 'text', text: '1行目\n2行目' }] }];
    expect(editorContentToBlocks(blocksToEditorContent(blocks, () => null))).toEqual(blocks);
  });

  it('mention を含む段落も往復する（表示名は解決関数を通す）', () => {
    const blocks: TicketCommentBlock[] = [
      {
        kind: 'paragraph',
        segments: [
          { kind: 'text', text: 'よろしく ' },
          { kind: 'mention', userId: '7' },
        ],
      },
    ];
    const content = blocksToEditorContent(blocks, (userId) => (userId === '7' ? '佐藤 花子' : null));
    expect(editorContentToBlocks(content)).toEqual(blocks);
  });

  it('書式つきの区間も往復する', () => {
    const blocks: TicketCommentBlock[] = [
      {
        kind: 'paragraph',
        segments: [{ kind: 'text', text: '大事', marks: { bold: true, href: 'https://example.com/' } }],
      },
    ];
    expect(editorContentToBlocks(blocksToEditorContent(blocks, () => null))).toEqual(blocks);
  });

  it('箇条書きも往復する', () => {
    const blocks: TicketCommentBlock[] = [
      { kind: 'paragraph', segments: [{ kind: 'text', text: '以下のとおり' }] },
      { kind: 'list', ordered: true, items: [[{ kind: 'text', text: '一つ目' }], [{ kind: 'text', text: '二つ目' }]] },
    ];
    expect(editorContentToBlocks(blocksToEditorContent(blocks, () => null))).toEqual(blocks);
  });

  it('名前を引けない mention は「不明なユーザー」で埋める', () => {
    const content = blocksToEditorContent([{ kind: 'paragraph', segments: [{ kind: 'mention', userId: '99' }] }], () => null);
    expect(content).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { userId: '99', name: '不明なユーザー' } }] }],
    });
  });
});

describe('isEditorContentEmpty', () => {
  it('空の段落は空扱い', () => {
    expect(isEditorContentEmpty({ type: 'doc', content: [{ type: 'paragraph', content: [] }] })).toBe(true);
  });

  it('空白だけの text は空扱い', () => {
    expect(
      isEditorContentEmpty({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }] }),
    ).toBe(true);
  });

  it('中身の無い箇条書きだけなら空扱い', () => {
    expect(
      isEditorContentEmpty({
        type: 'doc',
        content: [
          { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }] },
        ],
      }),
    ).toBe(true);
  });

  it('箇条書きに文字があれば空ではない', () => {
    expect(
      isEditorContentEmpty({
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }],
          },
        ],
      }),
    ).toBe(false);
  });

  it('mention だけでも空ではない', () => {
    expect(
      isEditorContentEmpty({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { userId: '1', name: 'x' } }] }],
      }),
    ).toBe(false);
  });

  it('文字があれば空ではない', () => {
    expect(
      isEditorContentEmpty({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }),
    ).toBe(false);
  });
});
