import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import FormMessage from '../FormMessage';

describe('FormMessage', () => {
  it('エラーメッセージを表示する', () => {
    render(<FormMessage message={{ type: 'error', text: 'エラーが発生しました' }} />);

    expect(screen.getByText('エラーが発生しました')).toBeInTheDocument();
  });

  it('成功メッセージを表示する', () => {
    render(<FormMessage message={{ type: 'success', text: '保存しました' }} />);

    expect(screen.getByText('保存しました')).toBeInTheDocument();
  });

  it('messageがnullの場合何も表示しない', () => {
    const { container } = render(<FormMessage message={null} />);

    expect(container.firstChild).toBeNull();
  });

  it('エラーメッセージにExclamationCircleIconが表示される', () => {
    render(<FormMessage message={{ type: 'error', text: 'エラー' }} />);

    expect(screen.getByText('エラー').closest('div')?.querySelector('svg')).toBeInTheDocument();
  });

  it('成功メッセージにCheckCircleIconが表示される', () => {
    render(<FormMessage message={{ type: 'success', text: '成功' }} />);

    expect(screen.getByText('成功').closest('div')?.querySelector('svg')).toBeInTheDocument();
  });

  it('失敗は alert、成功は status として読ませる', () => {
    const { unmount } = render(<FormMessage message={{ type: 'error', text: 'だめ' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('だめ');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    unmount();

    render(<FormMessage message={{ type: 'success', text: 'できた' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('できた');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('長いメッセージテキストが正しく表示される', () => {
    const longText = 'エラー'.repeat(50);
    render(<FormMessage message={{ type: 'error', text: longText }} />);

    expect(screen.getByText(longText)).toBeInTheDocument();
  });

  it('HTMLタグを含むテキストがエスケープされる', () => {
    render(<FormMessage message={{ type: 'error', text: '<script>alert("xss")</script>' }} />);

    expect(screen.getByText('<script>alert("xss")</script>')).toBeInTheDocument();
  });

  it('エラーは danger、成功は success のトークンで塗り分ける', () => {
    const { unmount } = render(<FormMessage message={{ type: 'error', text: 'だめ' }} />);
    const error = screen.getByText('だめ').closest('div');
    expect(error?.className).toContain('bg-danger-soft');
    expect(error?.className).toContain('text-danger-ink');
    expect(error?.className).toContain('border-danger-border');
    expect(error?.className).not.toContain('success');
    unmount();

    render(<FormMessage message={{ type: 'success', text: 'できた' }} />);
    const success = screen.getByText('できた').closest('div');
    expect(success?.className).toContain('bg-success-soft');
    expect(success?.className).toContain('text-success');
    expect(success?.className).not.toContain('danger');
  });

  describe('自動消去', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('成功は5秒後にonDismissが呼ばれる', () => {
      const onDismiss = vi.fn();
      render(<FormMessage message={{ type: 'success', text: '保存しました' }} onDismiss={onDismiss} />);

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('失敗は onDismiss があっても自動では消さない（閉じるボタンを押すまで残す）', () => {
      const onDismiss = vi.fn();
      render(<FormMessage message={{ type: 'error', text: 'エラー' }} onDismiss={onDismiss} />);

      act(() => {
        vi.advanceTimersByTime(60_000);
      });

      expect(onDismiss).not.toHaveBeenCalled();
      expect(screen.getByText('エラー')).toBeInTheDocument();
    });

    it('onDismissが未指定の場合はタイマーが動作しない', () => {
      render(<FormMessage message={{ type: 'error', text: 'エラー' }} />);

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(screen.getByText('エラー')).toBeInTheDocument();
    });

    it('messageがnullの場合タイマーが設定されない', () => {
      const onDismiss = vi.fn();
      render(<FormMessage message={null} onDismiss={onDismiss} />);

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(onDismiss).not.toHaveBeenCalled();
    });
  });

  describe('閉じるボタン', () => {
    it('onDismiss指定時に閉じるボタンが表示される', () => {
      const onDismiss = vi.fn();
      render(<FormMessage message={{ type: 'error', text: 'エラー' }} onDismiss={onDismiss} />);

      expect(screen.getByRole('button', { name: '閉じる' })).toBeInTheDocument();
    });

    it('閉じるボタンクリックでonDismissが呼ばれる', () => {
      const onDismiss = vi.fn();
      render(<FormMessage message={{ type: 'error', text: 'エラー' }} onDismiss={onDismiss} />);

      fireEvent.click(screen.getByRole('button', { name: '閉じる' }));

      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('onDismiss未指定時に閉じるボタンが表示されない', () => {
      render(<FormMessage message={{ type: 'error', text: 'エラー' }} />);

      expect(screen.queryByRole('button', { name: '閉じる' })).not.toBeInTheDocument();
    });
  });
});
