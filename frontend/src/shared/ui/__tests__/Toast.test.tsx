import { render, screen, act } from '@testing-library/react';
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

  it('role="alert"が設定されている', () => {
    render(<Toast type="success" message="テスト" onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
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
    expect(screen.getByRole('alert')).toHaveClass('bg-success', 'text-white');
  });

  it('エラーは塗り（濃い赤・白文字）スタイル', () => {
    render(<Toast type="error" message="NG" onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveClass('bg-danger', 'text-white');
  });
});
