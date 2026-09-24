import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import CommandPalette from '../ui/CommandPalette';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('CommandPalette', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderPalette(props = {}) {
    return render(
      <BrowserRouter>
        <CommandPalette {...defaultProps} {...props} />
      </BrowserRouter>
    );
  }

  it('isOpen=falseのとき何も表示しない', () => {
    renderPalette({ isOpen: false });
    expect(screen.queryByPlaceholderText('移動先を探す...')).not.toBeInTheDocument();
  });

  it('isOpen=trueのとき検索入力が表示される', () => {
    renderPalette();
    expect(screen.getByPlaceholderText('移動先を探す...')).toBeInTheDocument();
  });

  it('全コマンドがデフォルトで表示される', () => {
    renderPalette();
    expect(screen.getByText('ホーム')).toBeInTheDocument();
    expect(screen.getByText('ナレッジ')).toBeInTheDocument();
  });

  it('カテゴリヘッダーが表示される', () => {
    renderPalette();
    expect(screen.getByText('ページ移動')).toBeInTheDocument();
  });

  it('検索入力で絞り込みができる', () => {
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText('移動先を探す...'), {
      target: { value: 'ナレッジ' },
    });
    expect(screen.getByText('ナレッジ')).toBeInTheDocument();
    expect(screen.queryByText('ホーム')).not.toBeInTheDocument();
  });

  it('ナビゲーションコマンドをクリックするとページ移動する', () => {
    renderPalette();
    fireEvent.click(screen.getByText('ナレッジ'));
    expect(mockNavigate).toHaveBeenCalledWith('/kb');
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('キーワード（英語の別名）でもナレッジに絞り込める', () => {
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText('移動先を探す...'), {
      target: { value: 'wiki' },
    });
    expect(screen.getByText('ナレッジ')).toBeInTheDocument();
    expect(screen.queryByText('ホーム')).not.toBeInTheDocument();
  });

  it('背景オーバーレイをクリックするとパレットが閉じる', () => {
    renderPalette();
    fireEvent.click(screen.getByTestId('command-palette-overlay'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('Escapeキーでパレットが閉じる', () => {
    renderPalette();
    fireEvent.keyDown(screen.getByPlaceholderText('移動先を探す...'), {
      key: 'Escape',
    });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('ArrowDownで選択が移動する', () => {
    renderPalette();
    const input = screen.getByPlaceholderText('移動先を探す...');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    // 2番目のアイテムが選択状態になっているか確認
    const items = screen.getAllByRole('option');
    expect(items[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('ArrowUpで選択が戻る', () => {
    renderPalette();
    const input = screen.getByPlaceholderText('移動先を探す...');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    const items = screen.getAllByRole('option');
    expect(items[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('Enterで選択中のコマンドが実行される', () => {
    renderPalette();
    const input = screen.getByPlaceholderText('移動先を探す...');
    // 最初のアイテム（ホーム）が選択されている状態でEnter
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith('/');
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('検索結果が空のとき「該当するコマンドがありません」と表示', () => {
    renderPalette();
    fireEvent.change(screen.getByPlaceholderText('移動先を探す...'), {
      target: { value: 'xxxxxxxxx' },
    });
    expect(screen.getByText('該当するコマンドがありません')).toBeInTheDocument();
  });

  it('窓として名乗り、入力欄は候補一覧を操る combobox として名乗る', () => {
    renderPalette();
    expect(screen.getByRole('dialog', { name: '移動先を探す' })).toBeInTheDocument();
    const input = screen.getByRole('combobox', { name: '移動先を探す' });
    const listbox = screen.getByRole('listbox', { name: '移動先' });
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('上下キーで選んだ候補を aria-activedescendant で伝える（フォーカスは入力欄のまま）', () => {
    renderPalette();
    const input = screen.getByRole('combobox', { name: '移動先を探す' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const selected = screen.getAllByRole('option')[1];
    expect(input).toHaveAttribute('aria-activedescendant', selected.id);
  });

  it('一致が無いと combobox は閉じた状態を名乗り、activedescendant を持たない', () => {
    renderPalette();
    const input = screen.getByRole('combobox', { name: '移動先を探す' });
    fireEvent.change(input, { target: { value: 'xxxxxxxxx' } });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });

  it('日本語入力の変換キャンセルの Escape では閉じない（打ちかけの検索語を守る）', () => {
    renderPalette();
    const input = screen.getByRole('combobox', { name: '移動先を探す' });
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 });
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it('マウスを乗せた候補に選択が合う', () => {
    renderPalette();
    const options = screen.getAllByRole('option');
    fireEvent.mouseMove(options[2]);
    expect(options[2]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('閉じるボタンで閉じる（狭い画面には Esc キーが無い）', () => {
    renderPalette();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
