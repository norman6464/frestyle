import { describe, it, expect, afterEach } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/react';
import { createEditorExtensions } from '../editorExtensions';
import { resolveCommentAnchor } from '../commentAnchor';

let editor: Editor | null = null;

/**
 * makeEditor は jsdom へマウントせず（レンダリングせず）、tiptap の Editor 実体だけを作る。
 * id は StableBlockId の自動採番（appendTransaction 経由）に頼らず、doc の attrs へ
 * 直接書く — 生成時の content 差し込みは transaction を経由しないため
 * （stableBlockId.ts のコメント参照）、ここで明示しないと id が付かない。
 */
function makeEditor(content: JSONContent): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(),
    content,
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('resolveCommentAnchor', () => {
  it('1つの段落内の選択なら、正しい blockId・anchorFrom・anchorTo・quote が返る', () => {
    const e = makeEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'block-1' },
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    });
    // doc: 0=paragraph開始 / 1=本文開始('H'の直前)。'Hello ' は6文字なので
    // 'world' の開始位置は 1+6=7、終了は 7+5=12。
    e.commands.setTextSelection({ from: 7, to: 12 });

    expect(resolveCommentAnchor(e.state)).toEqual({
      blockId: 'block-1',
      anchorFrom: 6,
      anchorTo: 11,
      quote: 'world',
    });
  });

  it('選択なし（カーソルのみ）なら null', () => {
    const e = makeEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'block-1' },
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    });
    e.commands.setTextSelection({ from: 3, to: 3 });

    expect(resolveCommentAnchor(e.state)).toBeNull();
  });

  it('2つの段落にまたがる選択なら null', () => {
    const e = makeEditor({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { id: 'block-1' }, content: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', attrs: { id: 'block-2' }, content: [{ type: 'text', text: 'Second' }] },
      ],
    });
    // 1つめの段落の途中(pos 3)から、2つめの段落の途中(pos 10)まで。
    e.commands.setTextSelection({ from: 3, to: 10 });

    expect(resolveCommentAnchor(e.state)).toBeNull();
  });

  it('ネストしたノード（listItem内のparagraph）を選択したら、最も内側のid付きノード（paragraph）が対象になる', () => {
    const e = makeEditor({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          attrs: { id: 'ul-1' },
          content: [
            {
              type: 'listItem',
              attrs: { id: 'li-1' },
              content: [
                {
                  type: 'paragraph',
                  attrs: { id: 'p-inner' },
                  content: [{ type: 'text', text: 'Nested text' }],
                },
              ],
            },
          ],
        },
      ],
    });
    // doc: 0=bulletList開始 / 1=listItem開始 / 2=paragraph開始 / 3=本文開始。
    // 'Nested' の 6 文字ぶん(pos 3〜9)を選ぶ。
    e.commands.setTextSelection({ from: 3, to: 9 });

    expect(resolveCommentAnchor(e.state)).toEqual({
      blockId: 'p-inner',
      anchorFrom: 0,
      anchorTo: 6,
      quote: 'Nested',
    });
  });

  it('id を持たないブロックの中の選択は null（保存前で StableBlockId 未採番のケース）', () => {
    const e = makeEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
    });
    e.commands.setTextSelection({ from: 1, to: 6 });

    expect(resolveCommentAnchor(e.state)).toBeNull();
  });

  it('選択が空白だけで trim すると空文字になる場合は null', () => {
    const e = makeEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: 'block-1' },
          content: [{ type: 'text', text: 'a   b' }],
        },
      ],
    });
    // 'a' の直後(pos 2)から 'b' の直前(pos 5)まで＝空白3文字だけの選択。
    e.commands.setTextSelection({ from: 2, to: 5 });

    expect(resolveCommentAnchor(e.state)).toBeNull();
  });
});
