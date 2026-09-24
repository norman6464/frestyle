import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/entities/project';
import BacklogSidebar from '../BacklogSidebar';

const hoisted = vi.hoisted(() => ({ fetchProjects: vi.fn() }));

vi.mock('@/entities/project', () => ({
  ProjectRepository: { fetchProjects: hoisted.fetchProjects },
}));

const project = (id: string, name: string): Project => ({
  id,
  workspaceId: 'w-1',
  key: id.toUpperCase(),
  name,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
});

const current = project('p1', 'FreStyle');

function renderSidebar() {
  return render(
    <MemoryRouter>
      <BacklogSidebar workspaceSlug="acme" project={current} />
    </MemoryRouter>,
  );
}

function openSwitcher() {
  fireEvent.click(screen.getByRole('button', { name: 'プロジェクトを切り替える' }));
}

describe('BacklogSidebar のプロジェクト切替', () => {
  beforeEach(() => {
    hoisted.fetchProjects.mockReset();
  });

  it('取得中は「読み込み中」と出し、「無い」とは言わない', () => {
    hoisted.fetchProjects.mockReturnValue(new Promise(() => {}));
    renderSidebar();
    openSwitcher();
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中');
    expect(screen.queryByText(/プロジェクトはありません/)).not.toBeInTheDocument();
  });

  it('取得に失敗したら「無い」と言わず、失敗と示して再試行できる', async () => {
    hoisted.fetchProjects.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce([current, project('p2', 'Design')]);
    renderSidebar();
    openSwitcher();
    expect(await screen.findByRole('alert')).toHaveTextContent('プロジェクトを読み込めませんでした');
    expect(screen.queryByText(/プロジェクトはありません/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(await screen.findByRole('link', { name: 'Design' })).toBeInTheDocument();
    expect(hoisted.fetchProjects).toHaveBeenCalledTimes(2);
  });

  it('今いるプロジェクトは選択中として名乗る', async () => {
    hoisted.fetchProjects.mockResolvedValue([current, project('p2', 'Design')]);
    renderSidebar();
    openSwitcher();
    expect(await screen.findByRole('link', { name: 'FreStyle' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Design' })).not.toHaveAttribute('aria-current');
  });

  it('0 件なら「切り替えられるプロジェクトはありません」', async () => {
    hoisted.fetchProjects.mockResolvedValue([]);
    renderSidebar();
    openSwitcher();
    expect(await screen.findByText('切り替えられるプロジェクトはありません')).toBeInTheDocument();
  });

  it('外を押すと閉じる', async () => {
    hoisted.fetchProjects.mockResolvedValue([current, project('p2', 'Design')]);
    renderSidebar();
    openSwitcher();
    await screen.findByRole('link', { name: 'Design' });
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('link', { name: 'Design' })).not.toBeInTheDocument();
  });

  it('中にフォーカスがあるまま Escape で閉じたら、切替のボタンへフォーカスを戻す', async () => {
    hoisted.fetchProjects.mockResolvedValue([current, project('p2', 'Design')]);
    renderSidebar();
    openSwitcher();
    const link = await screen.findByRole('link', { name: 'Design' });
    link.focus();
    fireEvent.keyDown(link, { key: 'Escape' });
    expect(screen.queryByRole('link', { name: 'Design' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'プロジェクトを切り替える' })).toHaveFocus();
  });
});
