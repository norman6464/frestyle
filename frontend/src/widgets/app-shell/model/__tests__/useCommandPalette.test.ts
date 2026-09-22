import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCommandPalette } from '../useCommandPalette';
import { COMMAND_ITEMS } from '../../config/commandPaletteItems';

describe('useCommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('初期状態ではパレットが閉じている', () => {
    const { result } = renderHook(() => useCommandPalette());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.query).toBe('');
    expect(result.current.selectedIndex).toBe(0);
  });

  it('openでパレットが開く', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
    });
    expect(result.current.isOpen).toBe(true);
  });

  it('closeでパレットが閉じてクエリがリセットされる', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
      result.current.setQuery('テスト');
    });
    act(() => {
      result.current.close();
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.query).toBe('');
    expect(result.current.selectedIndex).toBe(0);
  });

  it('クエリが空のとき全コマンドを返す', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
    });
    expect(result.current.filteredItems).toEqual(COMMAND_ITEMS);
  });

  it('クエリでラベルをフィルタリングできる', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
      result.current.setQuery('ナレッジ');
    });
    const labels = result.current.filteredItems.map(i => i.label);
    expect(labels).toContain('ナレッジ');
    expect(labels).not.toContain('ホーム');
  });

  it('キーワードでもフィルタリングできる', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
      result.current.setQuery('knowledge');
    });
    const labels = result.current.filteredItems.map(i => i.label);
    expect(labels).toContain('ナレッジ');
  });

  it('descriptionでもフィルタリングできる', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
      result.current.setQuery('バックログに移動');
    });
    const labels = result.current.filteredItems.map(i => i.label);
    expect(labels).toContain('バックログ');
  });

  it('フィルタリングは大文字小文字を区別しない', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
      result.current.setQuery('KB');
    });
    const labels = result.current.filteredItems.map(i => i.label);
    expect(labels).toContain('ナレッジ');
  });

  it('常設の行き先がすべて載っている（柱の 4 つ ＋ ヘッダーからしか行けない通知・設定）', () => {
    // 窓は「どこからでも 1 手で行ける」ための物。柱に無い通知・設定を落とすと、
    // その 2 つだけキーボードで辿れなくなる。
    const paths = COMMAND_ITEMS.map((i) => i.action.path);
    expect(paths).toEqual(['/', '/assigned', '/kb', '/backlog', '/notifications', '/settings']);
    // 古い /profile/me は設定へ統合した（画面としてはもう入口が無い）。
    expect(paths).not.toContain('/profile/me');
  });

  it('「プロフィール」と打っても設定が引ける（旧名の記憶で探す人のため）', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
      result.current.setQuery('プロフィール');
    });
    expect(result.current.filteredItems.map((i) => i.label)).toEqual(['設定']);
  });

  it('キーワード（英語の別名）でも引ける', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
      result.current.setQuery('wiki');
    });
    const labels = result.current.filteredItems.map(i => i.label);
    expect(labels).toContain('ナレッジ');
  });

  it('クエリ変更時にselectedIndexが0にリセットされる', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
      result.current.selectNext();
      result.current.selectNext();
    });
    expect(result.current.selectedIndex).toBe(2);
    act(() => {
      result.current.setQuery('ナレッジ');
    });
    expect(result.current.selectedIndex).toBe(0);
  });

  it('selectNextでインデックスが進む', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
      result.current.selectNext();
    });
    expect(result.current.selectedIndex).toBe(1);
  });

  it('selectNextは最後のアイテムでループする', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
    });
    const count = result.current.filteredItems.length;
    for (let i = 0; i < count; i++) {
      act(() => {
        result.current.selectNext();
      });
    }
    expect(result.current.selectedIndex).toBe(0);
  });

  it('selectPrevでインデックスが戻る', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
      result.current.selectNext();
      result.current.selectNext();
      result.current.selectPrev();
    });
    expect(result.current.selectedIndex).toBe(1);
  });

  it('selectPrevは最初のアイテムで最後にループする', () => {
    const { result } = renderHook(() => useCommandPalette());
    act(() => {
      result.current.open();
      result.current.selectPrev();
    });
    expect(result.current.selectedIndex).toBe(result.current.filteredItems.length - 1);
  });
});
