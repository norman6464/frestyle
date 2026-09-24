import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Loading from '../Loading';

describe('Loading', () => {
  it('スピナーが表示される', () => {
    render(<Loading />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('メッセージが表示される', () => {
    render(<Loading message="読み込み中..." />);

    expect(screen.getByText('読み込み中...')).toBeInTheDocument();
  });

  it('フルスクリーンモードで表示される', () => {
    render(<Loading fullscreen message="処理中..." />);

    expect(screen.getByText('処理中...')).toBeInTheDocument();
  });

  it('メッセージなしの場合テキストが表示されない', () => {
    const { container } = render(<Loading />);

    expect(container.querySelector('p')).toBeNull();
  });

  it('スピナーにaria-labelが設定される', () => {
    render(<Loading />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', '読み込み中');
  });

  it('アニメーションクラスが適用される', () => {
    render(<Loading />);
    expect(screen.getByRole('status').className).toContain('animate-spin');
  });

  it.each([
    ['small', 'border-2'],
    ['medium', 'border-[3px]'],
    ['large', 'border-4'],
  ] as const)('%s の輪は Tailwind が生成する太さのクラスで描く（存在しない border-3 だと枠 0px で何も見えない）', (size, border) => {
    render(<Loading size={size} />);
    const spinner = screen.getByRole('status');
    expect(spinner.className.split(/\s+/)).toContain(border);
    expect(spinner.className.split(/\s+/)).not.toContain('border-3');
  });
});
