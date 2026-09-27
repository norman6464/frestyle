import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToastProvider } from '@/app/providers/ToastProvider';
import { useToast, useToastList } from '../useToast';
import { ReactNode } from 'react';

const wrapper = ({ children }: { children: ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
);

/** 出す関数と一覧を 1 つにまとめて読む（一覧の中身を確かめるテスト用）。 */
function useToastState() {
  return { ...useToast(), toasts: useToastList() };
}

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('初期状態でトーストが空である', () => {
    const { result } = renderHook(() => useToastState(), { wrapper });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('showToastでトーストが追加される', () => {
    const { result } = renderHook(() => useToastState(), { wrapper });
    act(() => {
      result.current.showToast('success', 'テストメッセージ');
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].type).toBe('success');
    expect(result.current.toasts[0].message).toBe('テストメッセージ');
  });

  it('removeToastでトーストが削除される', () => {
    const { result } = renderHook(() => useToastState(), { wrapper });
    act(() => {
      result.current.showToast('success', 'テスト');
    });
    const id = result.current.toasts[0].id;
    act(() => {
      result.current.removeToast(id);
    });
    expect(result.current.toasts).toHaveLength(0);
  });

  it('複数のトーストを追加できる', () => {
    const { result } = renderHook(() => useToastState(), { wrapper });
    act(() => {
      result.current.showToast('success', 'メッセージ1');
      result.current.showToast('error', 'メッセージ2');
    });
    expect(result.current.toasts).toHaveLength(2);
  });

  it('同一メッセージを連続で出すと 1 枚にまとまり count が増える', () => {
    const { result } = renderHook(() => useToastState(), { wrapper });
    act(() => {
      result.current.showToast('success', 'ナレッジを作成しました');
      result.current.showToast('success', 'ナレッジを作成しました');
      result.current.showToast('success', 'ナレッジを作成しました');
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].count).toBe(3);
  });

  it('type が違えば同じ文言でも別枠になる', () => {
    const { result } = renderHook(() => useToastState(), { wrapper });
    act(() => {
      result.current.showToast('success', '完了');
      result.current.showToast('error', '完了');
    });
    expect(result.current.toasts).toHaveLength(2);
  });

  it('総数は上限(3)でクランプされ古いものから落ちる', () => {
    const { result } = renderHook(() => useToastState(), { wrapper });
    act(() => {
      result.current.showToast('info', 'A');
      result.current.showToast('info', 'B');
      result.current.showToast('info', 'C');
      result.current.showToast('info', 'D');
    });
    expect(result.current.toasts).toHaveLength(3);
    expect(result.current.toasts.map((t) => t.message)).toEqual(['B', 'C', 'D']);
  });

  it('通知が出ても消えても、出す関数だけを使う部品は描き直さない', () => {
    // 画面のほとんどは showToast しか使わない。一覧と同じ箱で配ると、一覧が変わるたびに
    // それらが全部描き直される（ナレッジならサイドバーの木の全行まで）。
    let callerRenders = 0;
    function Caller() {
      callerRenders += 1;
      const { showToast } = useToast();
      return (
        <button type="button" onClick={() => showToast('success', '保存しました')}>
          出す
        </button>
      );
    }
    function List() {
      const toasts = useToastList();
      const { removeToast } = useToast();
      return (
        <ul>
          {toasts.map((toast) => (
            <li key={toast.id}>
              {toast.message}
              <button type="button" onClick={() => removeToast(toast.id)}>
                消す
              </button>
            </li>
          ))}
        </ul>
      );
    }
    render(
      <ToastProvider>
        <Caller />
        <List />
      </ToastProvider>,
    );
    const before = callerRenders;

    fireEvent.click(screen.getByRole('button', { name: '出す' }));
    expect(screen.getByText('保存しました')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '消す' }));
    expect(screen.queryByText('保存しました')).not.toBeInTheDocument();

    expect(callerRenders).toBe(before);
  });
});
