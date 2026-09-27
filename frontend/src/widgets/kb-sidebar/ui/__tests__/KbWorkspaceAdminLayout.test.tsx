import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import KbWorkspaceAdminLayout from '../KbWorkspaceAdminLayout';
import { useKbWorkspaceAdminOutlet } from '../../model/kbWorkspaceAdminOutlet';

const hoisted = vi.hoisted(() => ({
  useWorkspaceList: vi.fn(),
  navigate: vi.fn(),
  retry: vi.fn(),
  deleteWorkspace: vi.fn(),
}));

vi.mock('@/entities/kb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/kb')>();
  return { ...actual, useWorkspaceList: hoisted.useWorkspaceList };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => hoisted.navigate };
});

const acme = { slug: 'acme', name: 'Acme 社', createdAt: '', canManage: true };

function list(over: Record<string, unknown>) {
  return {
    workspaces: [],
    loading: false,
    error: null,
    retry: hoisted.retry,
    createWorkspace: vi.fn(),
    deleteWorkspace: hoisted.deleteWorkspace,
    ...over,
  };
}

function Child() {
  const { workspaceSlug, workspace } = useKbWorkspaceAdminOutlet();
  return <p>{`中身: ${workspaceSlug} / ${workspace.name}`}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<KbWorkspaceAdminLayout />}>
          <Route path="/kb/:workspaceSlug/members" element={<Child />} />
          <Route path="/kb/:workspaceSlug/invitations" element={<Child />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('KbWorkspaceAdminLayout', () => {
  it('admin には見出しとタブを出し、ワークスペースを子へ渡す', () => {
    hoisted.useWorkspaceList.mockReturnValue(list({ workspaces: [acme] }));
    renderAt('/kb/acme/invitations');

    expect(screen.getByRole('heading', { level: 1, name: 'メンバーと招待' })).toBeInTheDocument();
    expect(screen.getByText('中身: acme / Acme 社')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '招待' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'メンバー' })).not.toHaveAttribute('aria-current');
  });

  it('admin でなければ、どちらの画面も同じ案内を出し、中身を描かない', () => {
    hoisted.useWorkspaceList.mockReturnValue(list({ workspaces: [{ ...acme, canManage: false }] }));
    renderAt('/kb/acme/members');

    expect(screen.getByRole('heading', { level: 1, name: 'この画面は admin だけが開けます' })).toBeInTheDocument();
    expect(screen.queryByText(/中身/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ナレッジへ戻る' }));
    expect(hoisted.navigate).toHaveBeenCalledWith('/kb');
  });

  it('所属していないワークスペースも、あるかどうかを明かさず同じ案内を出す', () => {
    hoisted.useWorkspaceList.mockReturnValue(list({ workspaces: [acme] }));
    renderAt('/kb/other/invitations');

    expect(screen.getByRole('heading', { level: 1, name: 'この画面は admin だけが開けます' })).toBeInTheDocument();
  });

  it('一覧を読み込んでいる間は、admin でないと決めつけない', () => {
    hoisted.useWorkspaceList.mockReturnValue(list({ loading: true }));
    renderAt('/kb/acme/members');

    expect(screen.getByRole('status', { name: '読み込み中' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'この画面は admin だけが開けます' })).toBeNull();
  });

  it('一覧を読み込めなければ、admin でないとは言わず取り直せる', () => {
    hoisted.useWorkspaceList.mockReturnValue(list({ error: 'ワークスペースを読み込めませんでした' }));
    renderAt('/kb/acme/members');

    expect(screen.getByRole('alert')).toHaveTextContent('ワークスペースを読み込めませんでした');
    expect(screen.queryByRole('heading', { name: 'この画面は admin だけが開けます' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(hoisted.retry).toHaveBeenCalledOnce();
  });
});
