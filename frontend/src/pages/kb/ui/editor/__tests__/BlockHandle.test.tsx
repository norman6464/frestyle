import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { JSONContent } from '@tiptap/react';
import RichTextEditor from '../RichTextEditor';

const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = { type: 'doc' as const, content: [paragraph('一つ目'), paragraph('二つ目'), paragraph('三つ目')] };

afterEach(cleanup);

/** 本文の中の、text を持つ最上段のブロック要素。 */
function blockElementOf(container: HTMLElement, text: string): HTMLElement {
  const pm = container.querySelector('.ProseMirror');
  if (!pm) throw new Error('.ProseMirror が無い');
  const found = Array.from(pm.children).find((el) => el.textContent === text);
  if (!found) throw new Error(`「${text}」のブロックが無い`);
  return found as HTMLElement;
}

describe('BlockHandle（ブロックの取っ手）', () => {
  it('ブロックに乗せると取っ手が出る。乗せる前は無い', async () => {
    const { container } = render(<RichTextEditor value={doc} editable onChange={() => {}} />);
    await screen.findByText('二つ目');
    expect(screen.queryByRole('button', { name: 'ブロックの操作' })).toBeNull();

    fireEvent.mouseOver(blockElementOf(container, '二つ目'));
    expect(await screen.findByRole('button', { name: 'ブロックの操作' })).toBeInTheDocument();
  });

  it('読み取り専用では取っ手を出さない', async () => {
    const { container } = render(<RichTextEditor value={doc} editable={false} />);
    await screen.findByText('二つ目');
    fireEvent.mouseOver(blockElementOf(container, '二つ目'));
    expect(screen.queryByRole('button', { name: 'ブロックの操作' })).toBeNull();
  });

  it('取っ手を押すとメニュー（上へ・下へ・複製・削除）が開き、「削除」でそのブロックが消える', async () => {
    const changes: JSONContent[] = [];
    const { container } = render(<RichTextEditor value={doc} editable onChange={(next) => changes.push(next)} />);
    await screen.findByText('二つ目');
    fireEvent.mouseOver(blockElementOf(container, '二つ目'));
    fireEvent.click(await screen.findByRole('button', { name: 'ブロックの操作' }));

    const menu = await screen.findByRole('menu', { name: 'ブロックの操作' });
    for (const name of ['上へ移動', '下へ移動', '複製', 'ブロックを削除']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('menuitem', { name: 'ブロックを削除' }));

    await waitFor(() => expect(screen.queryByText('二つ目')).toBeNull());
    expect(menu).not.toBeInTheDocument();
    const last = changes.at(-1);
    expect(last?.content?.map((node) => node.content?.[0]?.text)).toEqual(['一つ目', '三つ目']);
  });

  it('メニューの「複製」は、乗せていたブロック（カーソルの場所ではなく）を複製する', async () => {
    const changes: JSONContent[] = [];
    const { container } = render(<RichTextEditor value={doc} editable onChange={(next) => changes.push(next)} />);
    await screen.findByText('三つ目');
    fireEvent.mouseOver(blockElementOf(container, '三つ目'));
    fireEvent.click(await screen.findByRole('button', { name: 'ブロックの操作' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '複製' }));

    await waitFor(() => expect(screen.getAllByText('三つ目')).toHaveLength(2));
    const last = changes.at(-1);
    expect(last?.content?.map((node) => node.content?.[0]?.text)).toEqual(['一つ目', '二つ目', '三つ目', '三つ目']);
  });

  it('Escape でメニューが閉じ、焦点がメニューに取り残されない', async () => {
    const { container } = render(<RichTextEditor value={doc} editable onChange={() => {}} />);
    await screen.findByText('二つ目');
    fireEvent.mouseOver(blockElementOf(container, '二つ目'));
    fireEvent.click(await screen.findByRole('button', { name: 'ブロックの操作' }));
    const menu = await screen.findByRole('menu', { name: 'ブロックの操作' });
    const firstItem = screen.getByRole('menuitem', { name: '上へ移動' });
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'ブロックの操作' })).toBeNull());
    // 本文（contenteditable）へ焦点が戻ることは jsdom では確かめられない（焦点を受け付けない）ので、
    // 消えたメニューの項目に焦点が残っていないことまでを見る。戻ること自体は見本（Storybook）で確かめる。
    expect(document.activeElement).not.toBe(firstItem);
  });
});
