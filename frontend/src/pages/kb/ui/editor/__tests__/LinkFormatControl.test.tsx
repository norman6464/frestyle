import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useEditor, type Editor, type JSONContent } from '@tiptap/react';
import LinkFormatControl from '../LinkFormatControl';
import { createEditorExtensions } from '../editorExtensions';

const textDoc: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'こちらの資料' }] }],
};

// 生成した editor をテストから覗くための受け皿（doc の中身を検査する）。
let editor: Editor | null = null;

/** Harness は実 editor を用意し、リンク操作だけを描画する薄い入れ物。 */
function Harness() {
  const created = useEditor({
    extensions: createEditorExtensions(),
    content: textDoc,
    onCreate: ({ editor: instance }) => {
      editor = instance;
    },
  });
  if (!created) return null;
  return <LinkFormatControl editor={created} />;
}

/**
 * renderWithSelection は本文の一部（「こちら」）を選択した状態にしてから操作を始める。
 * useEditor は初回描画のあとに editor を作るので、出来上がるのを待ってから選択を張る。
 */
async function renderWithSelection() {
  render(<Harness />);
  await waitFor(() => expect(editor).not.toBeNull());
  act(() => {
    editor!.commands.setTextSelection({ from: 1, to: 4 });
  });
}

/** linkHrefs は doc JSON を歩いて link マークの href を集める。 */
function linkHrefs(doc: JSONContent): unknown[] {
  const found: unknown[] = [];
  const walk = (node: JSONContent) => {
    for (const mark of node.marks ?? []) {
      if (mark.type === 'link') found.push(mark.attrs?.href);
    }
    (node.content ?? []).forEach(walk);
  };
  walk(doc);
  return found;
}

const linkButton = () => screen.getByRole('button', { name: 'リンク' });
const urlInput = () => screen.getByRole('textbox', { name: 'リンク先 URL' });

beforeEach(() => {
  editor = null;
});

describe('LinkFormatControl', () => {
  it('初期状態はボタンだけで、入力欄は開いていない', async () => {
    await renderWithSelection();
    expect(linkButton()).toHaveAttribute('aria-expanded', 'false');
    expect(linkButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('textbox', { name: 'リンク先 URL' })).not.toBeInTheDocument();
  });

  it('ボタンを押すと入力欄が開き、もう一度押すと閉じる', async () => {
    await renderWithSelection();
    fireEvent.click(linkButton());
    expect(urlInput()).toBeInTheDocument();
    expect(linkButton()).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(linkButton());
    expect(screen.queryByRole('textbox', { name: 'リンク先 URL' })).not.toBeInTheDocument();
  });

  it('URL を入れて「適用」すると選択範囲にリンクが掛かり、入力欄が閉じる', async () => {
    await renderWithSelection();
    fireEvent.click(linkButton());
    fireEvent.change(urlInput(), { target: { value: 'example.com/a' } });
    fireEvent.click(screen.getByRole('button', { name: '適用' }));

    await waitFor(() => expect(linkButton()).toHaveAttribute('aria-pressed', 'true'));
    // スキームを省いた入力には https:// が補われる。
    expect(linkHrefs(editor!.getJSON())).toEqual(['https://example.com/a']);
    expect(screen.queryByRole('textbox', { name: 'リンク先 URL' })).not.toBeInTheDocument();
  });

  it('許可できない URL は掛からず、理由を出したまま打ち直せる', async () => {
    await renderWithSelection();
    fireEvent.click(linkButton());
    fireEvent.change(urlInput(), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: '適用' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('http://');
    expect(linkHrefs(editor!.getJSON())).toEqual([]);
    // 閉じないので、そのまま安全な URL に打ち直せる。
    expect(urlInput()).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(urlInput(), { target: { value: 'https://ok.example' } });
    fireEvent.click(screen.getByRole('button', { name: '適用' }));
    await waitFor(() => expect(linkHrefs(editor!.getJSON())).toEqual(['https://ok.example']));
  });

  it('リンクが掛かっているときだけ「解除」が出て、押すとリンクが外れる（文字は残る）', async () => {
    await renderWithSelection();
    fireEvent.click(linkButton());
    // 掛かっていない状態では解除ボタンを出さない。
    expect(screen.queryByRole('button', { name: '解除' })).not.toBeInTheDocument();

    fireEvent.change(urlInput(), { target: { value: 'https://ok.example' } });
    fireEvent.click(screen.getByRole('button', { name: '適用' }));
    await waitFor(() => expect(linkButton()).toHaveAttribute('aria-pressed', 'true'));

    // 開き直すと現在の URL が初期値に入り、解除ボタンが出る。
    fireEvent.click(linkButton());
    expect(urlInput()).toHaveValue('https://ok.example');
    fireEvent.click(screen.getByRole('button', { name: '解除' }));

    await waitFor(() => expect(linkHrefs(editor!.getJSON())).toEqual([]));
    expect(editor!.getText()).toBe('こちらの資料');
  });

  it('Esc で入力欄を閉じる', async () => {
    await renderWithSelection();
    fireEvent.click(linkButton());
    fireEvent.keyDown(urlInput(), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'リンク先 URL' })).not.toBeInTheDocument();
  });
});
