import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ToastContainer from '@/app/providers/ToastContainer';

const mockToasts: { id: string; type: 'success' | 'error' | 'info'; message: string }[] = [];
const mockRemoveToast = vi.fn();

vi.mock('@/shared/lib/hooks/useToast', () => ({
  useToast: () => ({
    toasts: mockToasts,
    removeToast: mockRemoveToast,
  }),
}));

vi.mock('@/shared/ui/Toast', () => ({
  default: ({ message, onClose }: { message: string; onClose: () => void }) => (
    <div data-testid="toast" onClick={onClose}>{message}</div>
  ),
}));

describe('ToastContainer', () => {
  it('トーストが無くても成功・お知らせ用の読み上げ領域は置いておく（後から差し込むと変化を拾われない）', () => {
    mockToasts.length = 0;
    const { container } = render(<ToastContainer />);
    const polite = container.querySelector('[aria-live="polite"]');
    expect(polite).toBeInTheDocument();
    expect(polite).toBeEmptyDOMElement();
  });

  it('トーストがある場合はメッセージが表示される', () => {
    mockToasts.length = 0;
    mockToasts.push({ id: '1', type: 'success', message: '保存しました' });
    render(<ToastContainer />);
    expect(screen.getByText('保存しました')).toBeInTheDocument();
  });

  it('複数のトーストが表示される', () => {
    mockToasts.length = 0;
    mockToasts.push(
      { id: '1', type: 'success', message: '成功' },
      { id: '2', type: 'error', message: 'エラー' },
    );
    render(<ToastContainer />);
    expect(screen.getByText('成功')).toBeInTheDocument();
    expect(screen.getByText('エラー')).toBeInTheDocument();
  });

  it('成功・お知らせは polite の領域に入り、失敗は live region で包まない（Toast 自身の alert と二重に読ませない）', () => {
    mockToasts.length = 0;
    mockToasts.push(
      { id: '1', type: 'info', message: 'お知らせ' },
      { id: '2', type: 'success', message: '保存しました' },
      { id: '3', type: 'error', message: '保存できませんでした' },
    );
    render(<ToastContainer />);
    expect(screen.getByText('お知らせ').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('保存しました').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('保存できませんでした').closest('[aria-live]')).toBeNull();
    // aria-live 以外の live region の役割（log / status / alert）でも包まない。
    expect(screen.getByText('保存できませんでした').closest('[role="log"], [role="status"], [role="alert"]')).toBeNull();
  });
});
