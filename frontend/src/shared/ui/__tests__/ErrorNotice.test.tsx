import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ErrorNotice from '../ErrorNotice';

describe('ErrorNotice', () => {
  it('何が読めなかったかを alert で知らせる。読み上げにボタンの名前を混ぜない', () => {
    render(<ErrorNotice message="コメントを読み込めませんでした。" onRetry={() => {}} />);

    expect(screen.getByRole('alert')).toHaveTextContent('コメントを読み込めませんでした。');
    expect(screen.getByRole('alert')).not.toHaveTextContent('再試行');
  });

  it('再試行を押すと取り直しを呼ぶ', () => {
    const onRetry = vi.fn();
    render(<ErrorNotice message="読み込めませんでした。" onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('ボタンの文言を変えられる', () => {
    render(<ErrorNotice message="読み込めませんでした。" onRetry={() => {}} retryLabel="再読み込み" />);

    expect(screen.getByRole('button', { name: '再読み込み' })).toBeInTheDocument();
  });

  it('取り直せないときはボタンを出さない', () => {
    render(<ErrorNotice message="読み込めませんでした。" />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('補足は知らせの外に出す（alert は一言で終える）', () => {
    render(<ErrorNotice message="通知を読み込めませんでした。" description="通知が無いのではなく、読み込めていない状態です。" />);

    expect(screen.getByText('通知が無いのではなく、読み込めていない状態です。')).toBeInTheDocument();
    expect(screen.getByRole('alert')).not.toHaveTextContent('読み込めていない状態です');
  });

  it('画面を塞がない知らせは status にできる', () => {
    render(<ErrorNotice message="スプリントを読み込めませんでした。" politeness="polite" />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('スプリントを読み込めませんでした。');
  });
});
