import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { Editor, JSONContent } from '@tiptap/react';
import RichTextEditor from '../RichTextEditor';
import { emptyRichDoc } from '@/shared/lib/richDoc';
import type { TicketRefCandidate } from '../ticketRefSuggestion';

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

const TICKETS: TicketRefCandidate[] = [
  { id: 'a1b2c3d4-0000-4000-8000-000000000001', key: 'ENG-12', title: 'ログインが落ちる', statusName: '進行中', statusCategory: 'in_progress' },
  { id: 'a1b2c3d4-0000-4000-8000-000000000002', key: 'ENG-13', title: 'ログインの表示を直す', statusName: 'To Do', statusCategory: 'todo' },
  { id: 'a1b2c3d4-0000-4000-8000-000000000003', key: 'OPS-1', title: '監視を足す', statusName: '完了', statusCategory: 'done' },
];

async function setup(searchTickets?: (query: string) => Promise<TicketRefCandidate[]>) {
  let editor: Editor | null = null;
  const onChange = vi.fn();
  render(
    <RichTextEditor
      value={emptyRichDoc()}
      onChange={onChange}
      searchTickets={searchTickets}
      onCreate={(created) => {
        editor = created;
      }}
    />,
  );
  await waitFor(() => expect(editor).not.toBeNull());
  return { editor: editor! as Editor, onChange };
}

const search = vi.fn(async (query: string) =>
  TICKETS.filter((t) => t.title.includes(query) || t.key.toUpperCase().startsWith(query.toUpperCase())),
);

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

describe('チケット参照の候補（#）', () => {
  it('# に続けて題名を打つと、検索の口から候補が鍵・題名・状態つきで出る', async () => {
    const { editor } = await setup(search);
    type(editor, '#ログイン');
    const listbox = await screen.findByRole('listbox', { name: 'チケットの候補' });
    await waitFor(() => expect(search).toHaveBeenCalledWith('ログイン'));
    expect(listbox).toHaveTextContent('ENG-12');
    expect(listbox).toHaveTextContent('ログインが落ちる');
    expect(listbox).toHaveTextContent('進行中');
    expect(listbox).toHaveTextContent('ENG-13');
    expect(listbox).not.toHaveTextContent('監視を足す');
    expect(editor.view.dom.getAttribute('aria-controls')).toBe(listbox.id);
    await waitFor(() => expect(editor.view.dom.getAttribute('aria-activedescendant')).toMatch(/-option-/));
  });

  it('鍵でも探せる（大文字小文字を問わない）', async () => {
    const { editor } = await setup(search);
    type(editor, '#ops');
    const listbox = await screen.findByRole('listbox', { name: 'チケットの候補' });
    expect(listbox).toHaveTextContent('OPS-1');
    expect(listbox).not.toHaveTextContent('ENG-12');
  });

  it('Enter で選ぶと、打ちかけの #語 が消えてチケット参照（写しつき）が入り、改行は入らない', async () => {
    const { editor } = await setup(search);
    type(editor, '前 #ログインが');
    await screen.findByRole('listbox', { name: 'チケットの候補' });
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /ログインが落ちる/ })).toHaveAttribute('aria-selected', 'true'),
    );
    pressKey(editor, 'Enter');

    await waitFor(() => expect(findNodes(editor.getJSON(), 'ticketRef')).toHaveLength(1));
    const ref = findNodes(editor.getJSON(), 'ticketRef')[0];
    expect(ref.attrs).toEqual({
      ticketId: TICKETS[0].id,
      key: 'ENG-12',
      title: 'ログインが落ちる',
      statusName: '進行中',
      statusCategory: 'in_progress',
    });
    expect(editor.getText()).not.toContain('#');
    expect(editor.getJSON().content).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'チケットの候補' })).toBeNull());
  });

  it('↓ で 2 つ目の候補に移ってから Enter で選べる', async () => {
    const { editor } = await setup(search);
    type(editor, '#ログイン');
    await screen.findByRole('option', { name: /ログインの表示を直す/ });
    pressKey(editor, 'ArrowDown');
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /ログインの表示を直す/ })).toHaveAttribute('aria-selected', 'true'),
    );
    pressKey(editor, 'Enter');
    await waitFor(() => expect(findNodes(editor.getJSON(), 'ticketRef')[0]?.attrs?.key).toBe('ENG-13'));
  });

  it('該当が無ければその旨を出す。Escape で閉じ、打った文字はそのまま残る', async () => {
    const { editor } = await setup(search);
    type(editor, '#存在しない');
    await waitFor(() => expect(screen.getByText('該当するチケットがありません')).toBeInTheDocument());
    pressKey(editor, 'Escape');
    await waitFor(() => expect(screen.queryByText('該当するチケットがありません')).toBeNull());
    expect(editor.getText()).toBe('#存在しない');
  });

  it('検索の口が無ければ # を打っても候補は出ず、素の文字のまま', async () => {
    const { editor } = await setup(undefined);
    type(editor, '#ログイン');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(screen.queryByRole('listbox', { name: 'チケットの候補' })).toBeNull();
    expect(editor.getText()).toBe('#ログイン');
  });

  it('コードの中では # を打っても候補を出さない', async () => {
    // 共有の search はほかの例で既に呼ばれているので、この例だけの口で数える
    // （vi.fn(既存のモック) は同じモックを返して回数を引き継ぐため、包まずに別の関数にする）。
    const inCode = vi.fn(async () => TICKETS);
    const { editor } = await setup(inCode);
    act(() => {
      editor.chain().focus().setCodeBlock().insertContent('#ログイン').run();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(screen.queryByRole('listbox', { name: 'チケットの候補' })).toBeNull();
    expect(inCode).not.toHaveBeenCalled();
  });

  it('検索が失敗しても本文は打ち続けられる（候補が出ないだけ）', async () => {
    const failing = vi.fn(async () => {
      throw new Error('boom');
    });
    const { editor } = await setup(failing);
    type(editor, '#ログイン');
    await waitFor(() => expect(failing).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('該当するチケットがありません')).toBeInTheDocument());
    type(editor, 'の続き');
    expect(editor.getText()).toBe('#ログインの続き');
  });
});
