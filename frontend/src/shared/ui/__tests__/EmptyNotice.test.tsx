import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import EmptyNotice from '../EmptyNotice';

describe('EmptyNotice', () => {
  it('0 件であることを一言で出す', () => {
    render(<EmptyNotice title="まだコメントはありません。" />);

    expect(screen.getByText('まだコメントはありません。')).toBeInTheDocument();
  });

  it('次の操作や補足を添えられる', () => {
    render(
      <EmptyNotice title="お気に入りはまだありません">
        <a href="/kb">ナレッジを開く</a>
      </EmptyNotice>,
    );

    expect(screen.getByRole('link', { name: 'ナレッジを開く' })).toBeInTheDocument();
  });

  it('失敗や読み込み中と違い、知らせ（alert / status）にしない', () => {
    render(<EmptyNotice title="添付はありません" variant="panel" />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
