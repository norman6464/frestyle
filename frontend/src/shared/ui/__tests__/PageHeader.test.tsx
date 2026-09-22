import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PageHeader from '../PageHeader';

describe('PageHeader', () => {
  it('画面の見出し・説明・操作を意味のある要素で示す', () => {
    render(<PageHeader title="設定" description="自分の情報を管理します。" action={<button>保存</button>} />);
    expect(screen.getByRole('heading', { name: '設定', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('自分の情報を管理します。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
  });
});
