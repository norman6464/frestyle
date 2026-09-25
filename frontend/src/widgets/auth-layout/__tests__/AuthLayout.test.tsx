import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthLayout from '../ui/AuthLayout';

describe('AuthLayout', () => {
  it('タイトルが表示される', () => {
    render(<AuthLayout title="テストタイトル"><div>テスト</div></AuthLayout>);

    expect(screen.getByText('テストタイトル')).toBeInTheDocument();
  });

  it('子要素が表示される', () => {
    render(<AuthLayout><p>子コンテンツ</p></AuthLayout>);

    expect(screen.getByText('子コンテンツ')).toBeInTheDocument();
  });

  it('複数の子要素が表示される', () => {
    render(
      <AuthLayout>
        <p>要素1</p>
        <p>要素2</p>
      </AuthLayout>
    );

    expect(screen.getByText('要素1')).toBeInTheDocument();
    expect(screen.getByText('要素2')).toBeInTheDocument();
  });

  it('中央寄せレイアウトが適用される', () => {
    const { container } = render(<AuthLayout><div>テスト</div></AuthLayout>);
    // 外枠は自身がスクロールコンテナ(body overflow hidden 対策)、
    // 直下の内側要素は min-h-full の縦並びで、短いコンテンツは中央寄せされる。
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('h-full', 'overflow-y-auto');
    expect(root.firstElementChild).toHaveClass('min-h-full', 'flex', 'flex-col');
    const centered = container.querySelector('.items-center.justify-center') as HTMLElement;
    expect(centered).not.toBeNull();
  });

  it('カードに角丸が適用される', () => {
    const { container } = render(<AuthLayout><div>テスト</div></AuthLayout>);
    const card = container.querySelector('.rounded-2xl');
    expect(card).toBeTruthy();
  });

  it('フッターが表示される', () => {
    render(
      <MemoryRouter>
        <AuthLayout footer={<p>フッター内容</p>}><div>テスト</div></AuthLayout>
      </MemoryRouter>
    );

    expect(screen.getByText('フッター内容')).toBeInTheDocument();
  });

  // ロゴは上部のヘッダーに 1 つだけ置く。カードの中に重ねて出さない（ロゴが縦に 2 つ並ばないように）。
  it('カードの中にはロゴを出さない', () => {
    const { container } = render(<AuthLayout><div>テスト</div></AuthLayout>);
    expect(container.querySelector('img[src="/favicon.svg"]')).toBeNull();
  });
});
