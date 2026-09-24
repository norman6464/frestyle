import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Toast from '../Toast';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('成功メッセージが表示される', () => {
    render(<Toast type="success" message="保存しました" onClose={vi.fn()} />);
    expect(screen.getByText('保存しました')).toBeInTheDocument();
  });

  it('エラーメッセージが表示される', () => {
    render(<Toast type="error" message="エラーが発生しました" onClose={vi.fn()} />);
    expect(screen.getByText('エラーが発生しました')).toBeInTheDocument();
  });

  it('情報メッセージが表示される', () => {
    render(<Toast type="info" message="お知らせ" onClose={vi.fn()} />);
    expect(screen.getByText('お知らせ')).toBeInTheDocument();
  });

  it('4秒後にonCloseが呼ばれる', () => {
    const onClose = vi.fn();
    render(<Toast type="success" message="テスト" onClose={onClose} />);
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('失敗は自身が alert として読まれる', () => {
    render(<Toast type="error" message="保存できませんでした" onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした');
  });

  it('成功とお知らせは role を持たない（ToastContainer の常設の polite 領域が読む。二重に読ませない）', () => {
    const { unmount } = render(<Toast type="success" message="保存しました" onClose={vi.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // role="log" などの別の live region や aria-live も自分では持たない。
    const root = screen.getByText('保存しました').closest('[data-toast-type]');
    expect(root).not.toHaveAttribute('role');
    expect(root).not.toHaveAttribute('aria-live');
    unmount();
    render(<Toast type="info" message="お知らせ" onClose={vi.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('失敗は自動では消えない（閉じるまで残す）', () => {
    const onClose = vi.fn();
    render(<Toast type="error" message="保存できませんでした" onClose={onClose} />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('お知らせは成功と同じく 4 秒で消える', () => {
    const onClose = vi.fn();
    render(<Toast type="info" message="お知らせ" onClose={onClose} />);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('マウスを乗せている間は消えず、離すと改めて 4 秒数える', () => {
    const onClose = vi.fn();
    render(<Toast type="success" message="保存しました" onClose={onClose} />);
    const toast = screen.getByText('保存しました').closest('[data-toast-type]') as HTMLElement;
    fireEvent.mouseEnter(toast);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseLeave(toast);
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('閉じるボタンにフォーカスしたままマウスを離しても消えない（マウスとフォーカスは別々に数える）', () => {
    const onClose = vi.fn();
    render(<Toast type="success" message="保存しました" onClose={onClose} />);
    const toast = screen.getByText('保存しました').closest('[data-toast-type]') as HTMLElement;
    fireEvent.mouseEnter(toast);
    act(() => {
      screen.getByRole('button', { name: '閉じる' }).focus();
    });
    fireEvent.mouseLeave(toast);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('マウスを乗せたままフォーカスを外しても消えない', () => {
    const onClose = vi.fn();
    render(<Toast type="success" message="保存しました" onClose={onClose} />);
    const toast = screen.getByText('保存しました').closest('[data-toast-type]') as HTMLElement;
    const close = screen.getByRole('button', { name: '閉じる' });
    act(() => {
      close.focus();
    });
    fireEvent.mouseEnter(toast);
    act(() => {
      close.blur();
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('閉じるボタンにフォーカスがある間は消えない', () => {
    const onClose = vi.fn();
    render(<Toast type="success" message="保存しました" onClose={onClose} />);
    // React の onFocus は focusin で拾うので、fireEvent.focus ではなく実際にフォーカスを移す。
    act(() => {
      screen.getByRole('button', { name: '閉じる' }).focus();
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('描画し直しで onClose が変わってもタイマーは巻き戻らない', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Toast type="success" message="保存しました" onClose={first} />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    rerender(<Toast type="success" message="保存しました" onClose={second} />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('成功時にアイコンが表示される', () => {
    const { container } = render(<Toast type="success" message="テスト" onClose={vi.fn()} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('4秒未満ではonCloseが呼ばれない', () => {
    const onClose = vi.fn();
    render(<Toast type="success" message="テスト" onClose={onClose} />);
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('エラータイプでもアイコンが表示される', () => {
    const { container } = render(<Toast type="error" message="エラー" onClose={vi.fn()} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('情報タイプでもアイコンが表示される', () => {
    const { container } = render(<Toast type="info" message="情報" onClose={vi.fn()} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('まとめ件数の「×N」バッジは表示しない', () => {
    render(<Toast type="success" message="作成しました" onClose={vi.fn()} />);
    expect(screen.queryByText(/^×\d/)).not.toBeInTheDocument();
  });

  it('成功は塗り（黄緑・白文字）スタイル', () => {
    render(<Toast type="success" message="OK" onClose={vi.fn()} />);
    // 白文字に対し lime-600 は 3.08:1 で未達。700 で 4.7:1。
    expect(screen.getByText('OK').closest('[data-toast-type]')).toHaveClass('bg-success', 'text-white');
  });

  it('エラーは塗り（濃い赤・白文字）スタイル', () => {
    render(<Toast type="error" message="NG" onClose={vi.fn()} />);
    expect(screen.getByText('NG').closest('[data-toast-type]')).toHaveClass('bg-danger', 'text-white');
  });
});
