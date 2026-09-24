import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import GlobalBottomNav from '../GlobalBottomNav';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GlobalBottomNav />
    </MemoryRouter>,
  );
}

describe('GlobalBottomNav', () => {
  it('毎日使う 4 つの行き先を、絵と名前で並べる', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: '主な行き先' });
    const links = nav.querySelectorAll('a');
    expect(links).toHaveLength(4);
    for (const label of ['ホーム', '担当', 'ナレッジ', 'バックログ']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    // 絵は飾り。名前は文字が持つ。
    expect(nav.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(4);
  });

  it('いま居る面だけが aria-current を持つ（下の階層でも光る）', () => {
    renderAt('/backlog/p-1/archive');
    expect(screen.getByRole('link', { name: 'バックログ' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'ホーム' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'ナレッジ' })).not.toHaveAttribute('aria-current');
  });

  it('通知と設定は無い（ヘッダー側が唯一の入口）', () => {
    renderAt('/');
    expect(screen.queryByRole('link', { name: '通知' })).toBeNull();
    expect(screen.queryByRole('link', { name: '設定' })).toBeNull();
  });
});
