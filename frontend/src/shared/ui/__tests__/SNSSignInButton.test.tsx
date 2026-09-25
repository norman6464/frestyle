import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SNSSignInButton from '../SNSSignInButton';

describe('SNSSignInButton', () => {
  it('渡した文言がボタンの名前になる（ログインと登録で文言を分ける）', () => {
    const { rerender } = render(<SNSSignInButton provider="google" label="Google でログイン" onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Google でログイン' })).toBeInTheDocument();

    rerender(<SNSSignInButton provider="google" label="Google で登録" onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Google で登録' })).toBeInTheDocument();
  });

  it('押すと onClick が呼ばれる', () => {
    const onClick = vi.fn();
    render(<SNSSignInButton provider="google" label="Google でログイン" onClick={onClick} />);

    fireEvent.click(screen.getByRole('button', { name: 'Google でログイン' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('印は同梱の絵で、外部の画像を読まず、読み上げから外す', () => {
    const { container } = render(<SNSSignInButton provider="google" label="Google でログイン" onClick={vi.fn()} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('無効のときは押せない', () => {
    const onClick = vi.fn();
    render(<SNSSignInButton provider="google" label="Google でログイン" onClick={onClick} disabled />);

    expect(screen.getByRole('button', { name: 'Google でログイン' })).toBeDisabled();
  });
});
