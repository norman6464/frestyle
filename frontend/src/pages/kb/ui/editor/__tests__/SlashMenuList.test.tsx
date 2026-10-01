import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SlashMenuList, { type SlashMenuListHandle } from '../SlashMenuList';
import { buildSlashItems } from '../slashItems';

const items = buildSlashItems();

function renderList(onSelect = vi.fn()) {
  const ref = createRef<SlashMenuListHandle>();
  render(<SlashMenuList ref={ref} items={items} onSelect={onSelect} />);
  return { ref, onSelect };
}

describe('SlashMenuList', () => {
  it('候補を listbox として描画し、日本語ラベルと英語トリガを併記する', () => {
    renderList();
    expect(screen.getByRole('listbox', { name: 'ブロックの挿入' })).toBeInTheDocument();
    expect(screen.getByText('見出し1')).toBeInTheDocument();
    expect(screen.getByText('/heading1')).toBeInTheDocument();
  });

  it('先頭が選択状態（aria-selected）で始まる', () => {
    renderList();
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('ArrowDown / ArrowUp で選択が移動し末尾で折り返す', () => {
    const { ref } = renderList();
    act(() => {
      ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    act(() => {
      ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    });
    // 先頭からさらに上で末尾へ折り返す。
    const options = screen.getAllByRole('option');
    expect(options[options.length - 1]).toHaveAttribute('aria-selected', 'true');
  });

  it('Enter で選択中の項目を onSelect へ渡す', () => {
    const { ref, onSelect } = renderList();
    act(() => {
      ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    });
    let handled = false;
    act(() => {
      handled = ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    });
    expect(handled).toBe(true);
    expect(onSelect).toHaveBeenCalledWith(items[1]);
  });

  it('クリックでも onSelect が呼ばれる', () => {
    const { onSelect } = renderList();
    fireEvent.click(screen.getByText('引用'));
    expect(onSelect).toHaveBeenCalledWith(items.find((item) => item.id === 'blockquote'));
  });

  it('未処理のキー（英字入力）は false を返して編集を妨げない', () => {
    const { ref } = renderList();
    let handled = true;
    act(() => {
      handled = ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'a' }));
    });
    expect(handled).toBe(false);
  });

  it('候補ゼロのときは空表示を出す', () => {
    render(<SlashMenuList items={[]} onSelect={vi.fn()} />);
    expect(screen.getByText('該当するコマンドがありません')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
