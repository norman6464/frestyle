import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import type { Editor, JSONContent } from '@tiptap/react';
import RichTextEditor from '../RichTextEditor';
import type { RichDocContent } from '@/shared/lib/richDoc';
import { emptyRichDoc } from '@/shared/lib/richDoc';
import { fillMissingBlockIdsInDoc } from '../stableBlockId';

// crypto.randomUUID() が実際に振る形（UUID v4）。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** onCreate 経由で editor 実体を取り出してマウントする（RichTextEditor.test.tsx と同じ手順）。 */
async function mountAndGetEditor(value: RichDocContent): Promise<Editor> {
  render(
    <RichTextEditor
      value={value}
      onCreate={(created) => {
        editor = created;
      }}
    />,
  );
  await waitFor(() => expect(editor).not.toBeNull());
  return editor as Editor;
}

/** doc 内のブロックノード（type=doc 直下から再帰的に）を depth-first で列挙する。 */
function collectBlockNodes(node: JSONContent, out: JSONContent[] = []): JSONContent[] {
  for (const child of node.content ?? []) {
    if (child.type && child.type !== 'text') {
      out.push(child);
      collectBlockNodes(child, out);
    }
  }
  return out;
}

describe('StableBlockId: 初回ロード', () => {
  it('id 無しの doc をマウントすると、各ブロックノードに UUID 形式の id が付与される', async () => {
    const value: RichDocContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }],
    };
    const e = await mountAndGetEditor(value);
    const blocks = collectBlockNodes(e.getJSON());
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.attrs?.id).toMatch(UUID_RE);
  });

  it('既に id を持つノードはその値のまま変わらない', async () => {
    const existingId = '11111111-1111-4111-8111-111111111111';
    const value: RichDocContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { id: existingId },
          content: [{ type: 'text', text: '本文' }],
        },
      ],
    };
    const e = await mountAndGetEditor(value);
    const blocks = collectBlockNodes(e.getJSON());
    expect(blocks[0]?.attrs?.id).toBe(existingId);
  });

  it('2つの異なるブロックが両方 id 無しでロードされた場合、それぞれ異なる id が振られる', async () => {
    const value: RichDocContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '1つめ' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '2つめ' }] },
      ],
    };
    const e = await mountAndGetEditor(value);
    const blocks = collectBlockNodes(e.getJSON());
    expect(blocks).toHaveLength(2);
    const [firstId, secondId] = blocks.map((b) => b.attrs?.id);
    expect(firstId).toMatch(UUID_RE);
    expect(secondId).toMatch(UUID_RE);
    expect(firstId).not.toBe(secondId);
  });

  it('マウント時の id 補充は onChange を発火しない（開いただけで未保存に落とさない）', async () => {
    const onChange = vi.fn();
    const value: RichDocContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }],
    };
    render(
      <RichTextEditor
        value={value}
        onChange={onChange}
        onCreate={(created) => {
          editor = created;
        }}
      />,
    );
    await waitFor(() => expect(editor).not.toBeNull());
    expect(editor!.getJSON().content?.[0]?.attrs?.id).toMatch(UUID_RE);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('StableBlockId: 編集時', () => {
  it('新しい段落を入力操作で追加したときも、その段落に id が付く', async () => {
    const e = await mountAndGetEditor(emptyRichDoc());

    act(() => {
      e.chain()
        .insertContentAt(e.state.doc.content.size, {
          type: 'paragraph',
          content: [{ type: 'text', text: '追加した段落' }],
        })
        .run();
    });

    const blocks = collectBlockNodes(e.getJSON());
    const added = blocks.find((b) => b.content?.[0]?.text === '追加した段落');
    expect(added?.attrs?.id).toMatch(UUID_RE);
  });

  it('同じトランザクションで複数ブロックに id が無くても、それぞれ異なる id を振る', async () => {
    const e = await mountAndGetEditor(emptyRichDoc());

    act(() => {
      e.chain()
        .insertContentAt(e.state.doc.content.size, [
          { type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
        ])
        .run();
    });

    const blocks = collectBlockNodes(e.getJSON()).filter((b) => b.type === 'paragraph');
    const ids = blocks.map((b) => b.attrs?.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(id).toMatch(UUID_RE));
  });
});

describe('StableBlockId: 属性だけを置き換えて id を落とす変更', () => {
  const detailsId = '22222222-2222-4222-8222-222222222222';
  const summaryId = '33333333-3333-4333-8333-333333333333';
  const contentId = '44444444-4444-4444-8444-444444444444';
  const paragraphId = '55555555-5555-4555-8555-555555555555';
  const detailsDoc: RichDocContent = {
    type: 'doc',
    content: [
      {
        type: 'details',
        attrs: { id: detailsId, open: false },
        content: [
          { type: 'detailsSummary', attrs: { id: summaryId }, content: [{ type: 'text', text: '要約' }] },
          {
            type: 'detailsContent',
            attrs: { id: contentId },
            content: [{ type: 'paragraph', attrs: { id: paragraphId }, content: [{ type: 'text', text: '中身' }] }],
          },
        ],
      },
    ],
  };

  it('setNodeMarkup で attrs を丸ごと置き換えても（公式の折りたたみの開閉と同じ）、元の id に戻す', async () => {
    const e = await mountAndGetEditor(detailsDoc);
    act(() => {
      // 公式の Details の開閉は tr.setNodeMarkup(pos, undefined, { open }) — 既存の id を渡さない。
      e.view.dispatch(e.state.tr.setNodeMarkup(0, undefined, { open: true }));
    });
    const details = e.getJSON().content?.[0];
    expect(details?.attrs).toMatchObject({ id: detailsId, open: true });
    // 中のブロックの id もそのまま（末尾に自動で足される空の段落は比べない）。
    expect(collectBlockNodes(details!).map((b) => b.attrs?.id)).toEqual([summaryId, contentId, paragraphId]);
  });

  it('開閉のボタンを押しても、折りたたみの id は変わらない', async () => {
    const e = await mountAndGetEditor(detailsDoc);
    const toggle = e.view.dom.querySelector<HTMLButtonElement>('[data-type="details"] > button');
    expect(toggle).not.toBeNull();
    act(() => {
      toggle!.click();
    });
    await waitFor(() => expect(e.getJSON().content?.[0]?.attrs?.open).toBe(true));
    expect(e.getJSON().content?.[0]?.attrs?.id).toBe(detailsId);
  });

  it('中身ごと別のブロックに置き換えたときは、元の id を引き継がない（コメントの紐付けを移さない）', async () => {
    const original = '66666666-6666-4666-8666-666666666666';
    const e = await mountAndGetEditor({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { id: original }, content: [{ type: 'text', text: '元の段落' }] }],
    });
    act(() => {
      const replacement = e.schema.nodes.paragraph.create(null, e.schema.text('別の段落'));
      e.view.dispatch(e.state.tr.replaceWith(0, e.state.doc.child(0).nodeSize, replacement));
    });
    const [paragraph] = collectBlockNodes(e.getJSON());
    expect(paragraph.content?.[0]?.text).toBe('別の段落');
    expect(paragraph.attrs?.id).toMatch(UUID_RE);
    expect(paragraph.attrs?.id).not.toBe(original);
  });
});

describe('fillMissingBlockIdsInDoc: 入れ子の段数に上限がある', () => {
  /** nestedDoc は blockquote を levels 段だけ入れ子にした doc を返す。 */
  function nestedDoc(levels: number): JSONContent {
    let inner: JSONContent = { type: 'paragraph', content: [{ type: 'text', text: '底' }] };
    for (let i = 0; i < levels; i += 1) {
      inner = { type: 'blockquote', content: [inner] };
    }
    return { type: 'doc', content: [inner] };
  }

  it('数千段の入れ子でも例外を投げずに完走する', () => {
    expect(() => fillMissingBlockIdsInDoc(nestedDoc(5000))).not.toThrow();
  });

  it('上限より浅い入れ子は通常どおり最奥まで id を埋める', () => {
    const doc = nestedDoc(10);
    const filled = fillMissingBlockIdsInDoc(doc);
    let node = filled.content?.[0];
    for (let i = 0; i < 10; i += 1) node = node?.content?.[0];
    expect(node?.attrs?.id).toMatch(UUID_RE);
  });
});
