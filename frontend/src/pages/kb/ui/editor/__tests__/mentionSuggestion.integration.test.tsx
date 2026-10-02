import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import type { Editor, JSONContent } from '@tiptap/react';
import RichTextEditor from '../RichTextEditor';
import { emptyRichDoc } from '@/shared/lib/richDoc';
import type { MentionCandidate } from '../mentionSuggestion';

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

const MEMBERS: MentionCandidate[] = [
  { userId: 1, name: '田中 太郎' },
  { userId: 2, name: '田村 花子' },
  { userId: 3, name: '鈴木 一郎' },
];

async function setup(searchMembers?: (query: string) => Promise<MentionCandidate[]>) {
  let editor: Editor | null = null;
  const onChange = vi.fn();
  render(
    <RichTextEditor
      value={emptyRichDoc()}
      onChange={onChange}
      searchMembers={searchMembers}
      onCreate={(created) => {
        editor = created;
      }}
    />,
  );
  await waitFor(() => expect(editor).not.toBeNull());
  return { editor: editor! as Editor, onChange };
}

const search = vi.fn(async (query: string) => MEMBERS.filter((m) => m.name.includes(query)));

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

describe('名指しの候補（@）', () => {
  it('@ に続けて名前を打つと、口から候補が出る', async () => {
    const { editor } = await setup(search);
    type(editor, '@田');
    const listbox = await screen.findByRole('listbox', { name: '名指しする相手' });
    await waitFor(() => expect(search).toHaveBeenCalledWith('田'));
    expect(listbox).toHaveTextContent('田中 太郎');
    expect(listbox).toHaveTextContent('田村 花子');
    expect(listbox).not.toHaveTextContent('鈴木');
    expect(editor.view.dom.getAttribute('aria-controls')).toBe(listbox.id);
    await waitFor(() => expect(editor.view.dom.getAttribute('aria-activedescendant')).toMatch(/-option-/));
  });

  it('@ だけでも候補（全員）が出る', async () => {
    const { editor } = await setup(search);
    type(editor, '@');
    const listbox = await screen.findByRole('listbox', { name: '名指しする相手' });
    await waitFor(() => expect(search).toHaveBeenCalledWith(''));
    expect(listbox).toHaveTextContent('鈴木 一郎');
  });

  it('Enter で選ぶと、打ちかけの @名前 が消えて名指し（userId は文字列）が入り、改行は入らない', async () => {
    const { editor } = await setup(search);
    type(editor, '前 @田中');
    await screen.findByRole('listbox', { name: '名指しする相手' });
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /田中 太郎/ })).toHaveAttribute('aria-selected', 'true'),
    );
    pressKey(editor, 'Enter');

    await waitFor(() => expect(findNodes(editor.getJSON(), 'mention')).toHaveLength(1));
    expect(findNodes(editor.getJSON(), 'mention')[0].attrs).toEqual({ userId: '1', name: '田中 太郎' });
    // 打ちかけの「@田中」は消え、残るのは札（@田中 太郎）と続けて打つための空白だけ。
    expect(editor.getText()).toBe('前 @田中 太郎 ');
    expect(editor.getJSON().content).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('listbox', { name: '名指しする相手' })).toBeNull());
  });

  it('↓ で 2 つ目の候補に移ってから Enter で選べる', async () => {
    const { editor } = await setup(search);
    type(editor, '@田');
    await screen.findByRole('option', { name: /田村 花子/ });
    pressKey(editor, 'ArrowDown');
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /田村 花子/ })).toHaveAttribute('aria-selected', 'true'),
    );
    pressKey(editor, 'Enter');
    await waitFor(() => expect(findNodes(editor.getJSON(), 'mention')[0]?.attrs?.userId).toBe('2'));
  });

  it('該当が無ければその旨を出す。Escape で閉じ、打った文字はそのまま残る', async () => {
    const { editor } = await setup(search);
    type(editor, '@存在しない');
    await waitFor(() => expect(screen.getByText('該当する人がいません')).toBeInTheDocument());
    pressKey(editor, 'Escape');
    await waitFor(() => expect(screen.queryByText('該当する人がいません')).toBeNull());
    expect(editor.getText()).toBe('@存在しない');
  });

  it('口が無ければ @ を打っても候補は出ず、素の文字のまま', async () => {
    const { editor } = await setup(undefined);
    type(editor, '@田');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(screen.queryByRole('listbox', { name: '名指しする相手' })).toBeNull();
    expect(editor.getText()).toBe('@田');
  });

  it('コードの中では @ を打っても候補を出さない', async () => {
    const inCode = vi.fn(async () => MEMBERS);
    const { editor } = await setup(inCode);
    act(() => {
      editor.chain().focus().setCodeBlock().insertContent('@田').run();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(screen.queryByRole('listbox', { name: '名指しする相手' })).toBeNull();
    expect(inCode).not.toHaveBeenCalled();
  });

  it('探すのに失敗しても本文は打ち続けられる（候補が出ないだけ）', async () => {
    const failing = vi.fn(async () => {
      throw new Error('boom');
    });
    const { editor } = await setup(failing);
    type(editor, '@田');
    await waitFor(() => expect(failing).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('該当する人がいません')).toBeInTheDocument());
    type(editor, 'の続き');
    expect(editor.getText()).toBe('@田の続き');
  });
});
