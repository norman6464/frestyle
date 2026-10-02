import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { Editor, JSONContent } from '@tiptap/react';
import RichTextEditor from '../RichTextEditor';
import { emptyRichDoc } from '@/shared/lib/richDoc';
import type { PageRefCandidate } from '../pageRefSuggestion';

// jsdom は Range/Element の getClientRects を実装せず、ProseMirror の scrollToSelection が
// 非同期に落ちる。位置は検証しない（メニューの出現と操作だけ見る）ため、ゼロ矩形で埋める。
const zeroRect = {
  x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
  toJSON() { return this; },
} as DOMRect;
const origRangeGetClientRects = Range.prototype.getClientRects;
const origRangeGetBoundingClientRect = Range.prototype.getBoundingClientRect;
const origElemGetClientRects = Element.prototype.getClientRects;

beforeAll(() => {
  Range.prototype.getClientRects = () => [zeroRect] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => zeroRect;
  Element.prototype.getClientRects = () => [zeroRect] as unknown as DOMRectList;
});

afterAll(() => {
  Range.prototype.getClientRects = origRangeGetClientRects;
  Range.prototype.getBoundingClientRect = origRangeGetBoundingClientRect;
  Element.prototype.getClientRects = origElemGetClientRects;
});

const PAGES: PageRefCandidate[] = [
  { id: 'a1b2c3d4-0000-4000-8000-000000000001', title: '設計ノート' },
  { id: 'a1b2c3d4-0000-4000-8000-000000000002', title: '設計の決めごと' },
  { id: 'a1b2c3d4-0000-4000-8000-000000000003', title: '議事録' },
];

async function setup(searchPages?: (query: string) => Promise<PageRefCandidate[]>) {
  let editor: Editor | null = null;
  const onChange = vi.fn();
  render(
    <RichTextEditor
      value={emptyRichDoc()}
      onChange={onChange}
      searchPages={searchPages}
      onCreate={(created) => {
        editor = created;
      }}
    />,
  );
  await waitFor(() => expect(editor).not.toBeNull());
  return { editor: editor! as Editor, onChange };
}

const search = vi.fn(async (query: string) => PAGES.filter((page) => page.title.includes(query)));

function type(editor: Editor, text: string) {
  act(() => {
    editor.chain().focus().insertContent(text).run();
  });
}

function pressKey(editor: Editor, key: string) {
  act(() => {
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function findNodes(node: JSONContent, type: string): JSONContent[] {
  const found: JSONContent[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === type) found.push(n);
    n.content?.forEach(walk);
  };
  walk(node);
  return found;
}

describe('ページ参照の候補（[[）', () => {
  it('[[ に続けて題名を打つと、検索の口から候補が出る', async () => {
    const { editor } = await setup(search);
    type(editor, '[[設計');
    const listbox = await screen.findByRole('listbox', { name: 'ページの候補' });
    await waitFor(() => expect(search).toHaveBeenCalledWith('設計'));
    expect(listbox).toHaveTextContent('設計ノート');
    expect(listbox).toHaveTextContent('設計の決めごと');
    expect(listbox).not.toHaveTextContent('議事録');
    // 本文（textbox）は候補一覧とつながり、選択中の候補を aria-activedescendant で伝える
    // （aria-expanded は textbox には付けられないので使わない）。
    expect(editor.view.dom.getAttribute('aria-controls')).toBe(listbox.id);
    await waitFor(() => expect(editor.view.dom.getAttribute('aria-activedescendant')).toMatch(/-option-/));
  });

  it('Enter で選ぶと、打ちかけの [[題名 が消えてページ参照が入り、改行は入らない', async () => {
    const { editor } = await setup(search);
    type(editor, '前 [[設計ノ');
    await screen.findByRole('listbox', { name: 'ページの候補' });
    await waitFor(() => expect(screen.getByRole('option', { name: '設計ノート' })).toHaveAttribute('aria-selected', 'true'));
    pressKey(editor, 'Enter');

    await waitFor(() => expect(findNodes(editor.getJSON(), 'pageRef')).toHaveLength(1));
    const ref = findNodes(editor.getJSON(), 'pageRef')[0];
    expect(ref.attrs).toEqual({ pageId: PAGES[0].id, title: '設計ノート' });
    // 打ちかけは消え、段落は 1 つのまま（Enter が改行にならない）。
    expect(editor.getText()).not.toContain('[[');
    expect(editor.getJSON().content).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'ページの候補' })).toBeNull());
  });

  it('↓ で 2 つ目の候補に移ってから Enter で選べる', async () => {
    const { editor } = await setup(search);
    type(editor, '[[設計');
    await screen.findByRole('option', { name: '設計の決めごと' });
    pressKey(editor, 'ArrowDown');
    await waitFor(() => expect(screen.getByRole('option', { name: '設計の決めごと' })).toHaveAttribute('aria-selected', 'true'));
    pressKey(editor, 'Enter');
    await waitFor(() => expect(findNodes(editor.getJSON(), 'pageRef')[0]?.attrs?.title).toBe('設計の決めごと'));
  });

  it('該当が無ければその旨を出す。Escape で閉じ、打った文字はそのまま残る', async () => {
    const { editor } = await setup(search);
    type(editor, '[[存在しない');
    await waitFor(() => expect(screen.getByText('該当するページがありません')).toBeInTheDocument());
    pressKey(editor, 'Escape');
    await waitFor(() => expect(screen.queryByText('該当するページがありません')).toBeNull());
    expect(editor.getText()).toBe('[[存在しない');
  });

  it('検索の口が無ければ [[ を打っても候補は出ず、素の文字のまま', async () => {
    const { editor } = await setup(undefined);
    type(editor, '[[設計');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(screen.queryByRole('listbox', { name: 'ページの候補' })).toBeNull();
    expect(editor.getText()).toBe('[[設計');
  });

  it('検索が失敗しても本文は打ち続けられる（候補が出ないだけ）', async () => {
    const failing = vi.fn(async () => {
      throw new Error('boom');
    });
    const { editor } = await setup(failing);
    type(editor, '[[設計');
    await waitFor(() => expect(failing).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('該当するページがありません')).toBeInTheDocument());
    type(editor, 'の続き');
    expect(editor.getText()).toBe('[[設計の続き');
  });
});
