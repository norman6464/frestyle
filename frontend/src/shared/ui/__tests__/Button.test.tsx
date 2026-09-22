import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Button from '../Button';

describe('Button', () => {
  it('子要素が表示される', () => {
    render(<Button>送信</Button>);
    expect(screen.getByText('送信')).toBeInTheDocument();
  });

  it('クリックでonClickが呼ばれる', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>送信</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('デフォルトのtype属性がbuttonである', () => {
    render(<Button>テスト</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('disabled時にボタンが無効化される', () => {
    render(<Button disabled>送信</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('loading時にスピナーが表示される', () => {
    const { container } = render(<Button loading>送信</Button>);
    expect(container.querySelector('[data-testid="loading-spinner"]')).toBeInTheDocument();
  });

  it('loading時にボタンが無効化される', () => {
    render(<Button loading>送信</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('loading時にaria-busyがtrueになる', () => {
    render(<Button loading>送信</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });

  it('loading=false時にaria-busyが付かない', () => {
    render(<Button>送信</Button>);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy');
  });

  it('loading=false時にスピナーが非表示', () => {
    const { container } = render(<Button>送信</Button>);
    expect(container.querySelector('[data-testid="loading-spinner"]')).not.toBeInTheDocument();
  });

  it('loading時にonClickが呼ばれない', () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>送信</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  describe('variant', () => {
    it('primary: brand-500クラスが付く', () => {
      render(<Button variant="primary">テスト</Button>);
      expect(screen.getByRole('button').className).toContain('bg-brand-600');
    });

    it('secondary: 境界線で輪郭を示し、常時の影は付けない', () => {
      render(<Button variant="secondary">テスト</Button>);
      const cls = screen.getByRole('button').className;
      expect(cls).toContain('border-[var(--color-border-hover)]');
      expect(cls).not.toContain('shadow-sm');
    });

    it('danger: bg-dangerクラスが付く', () => {
      render(<Button variant="danger">テスト</Button>);
      // 白文字を載せる面は 600 から（red-500 は 3.76:1 で小さな文字の基準に届かない）。
      expect(screen.getByRole('button').className).toContain('bg-danger');
    });

    it('ghost: bg-brand-600クラスが付かない', () => {
      render(<Button variant="ghost">テスト</Button>);
      expect(screen.getByRole('button').className).not.toContain('bg-brand-600');
    });
  });

  describe('size', () => {
    it('sm: px-3クラスが付く', () => {
      render(<Button size="sm">テスト</Button>);
      expect(screen.getByRole('button').className).toContain('px-3');
    });

    it('md: px-4クラスが付く（デフォルト）', () => {
      render(<Button>テスト</Button>);
      expect(screen.getByRole('button').className).toContain('px-4');
    });

    it('lg: px-6クラスが付く', () => {
      render(<Button size="lg">テスト</Button>);
      expect(screen.getByRole('button').className).toContain('px-6');
    });
  });

  it('fullWidth時にw-fullクラスが付く', () => {
    render(<Button fullWidth>テスト</Button>);
    expect(screen.getByRole('button').className).toContain('w-full');
  });

  it('fullWidth未指定時にw-fullクラスが付かない', () => {
    render(<Button>テスト</Button>);
    expect(screen.getByRole('button').className).not.toContain('w-full');
  });

  it('追加のclassNameがマージされる', () => {
    render(<Button className="mt-4">テスト</Button>);
    expect(screen.getByRole('button').className).toContain('mt-4');
  });

  it('focus-visibleリングクラスが含まれる', () => {
    render(<Button>テスト</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('focus-visible:ring-2');
    expect(cls).toContain('focus-visible:ring-brand-600');
  });
});
