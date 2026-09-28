import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { kbKeys } from '@/entities/kb/api/kbQueries';
import { ticketKeys } from '@/entities/ticket/api/ticketQueries';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import HomeCreateDialog from '../ui/HomeCreateDialog';

const hoisted = vi.hoisted(() => ({
  fetchMySpaces: vi.fn(),
  listPageTemplates: vi.fn(),
  createPage: vi.fn(),
  fetchProjects: vi.fn(),
  fetchTicketStatuses: vi.fn(),
  createTicket: vi.fn(),
}));

// 取得の本体を偽物にする（公開口だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/kb/api/kbRepository', () => ({
  default: {
    fetchMySpaces: hoisted.fetchMySpaces,
    listPageTemplates: hoisted.listPageTemplates,
    createPage: hoisted.createPage,
  },
}));

vi.mock('@/entities/project/api/projectRepository', () => ({
  ProjectRepository: { fetchProjects: hoisted.fetchProjects },
}));

vi.mock('@/entities/ticket/api/ticketRepository', () => ({
  default: { fetchTicketStatuses: hoisted.fetchTicketStatuses, createTicket: hoisted.createTicket },
}));

const workspaces = [{ slug: 'acme', name: 'Acme', createdAt: '', canManage: true, canCreateTickets: true }];

function renderDialog() {
  const client = createTestQueryClient();
  render(
    <MemoryRouter>
      <HomeCreateDialog workspaces={workspaces} initialWorkspaceSlug="acme" onClose={vi.fn()} />
    </MemoryRouter>,
    { wrapper: queryWrapper(client) },
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.fetchMySpaces.mockResolvedValue([{ id: 's-1', name: 'プロダクト', role: 'editor' }]);
  hoisted.listPageTemplates.mockResolvedValue([]);
  hoisted.fetchProjects.mockResolvedValue([{ id: 'p-1', workspaceId: 'w', key: 'FRE', name: 'Product', createdAt: '', updatedAt: '' }]);
  hoisted.fetchTicketStatuses.mockResolvedValue([
    { id: 'st-1', workspaceId: 'w', projectId: 'p-1', name: 'To Do', category: 'todo', color: '#666', position: 'a0', isInitial: true, archivedAt: null, createdAt: '', updatedAt: '' },
  ]);
});

describe('HomeCreateDialog の作ったあとの控え', () => {
  it('ページを作ったら、そのスペースの木を古くする（開いた先のサイドバーに出るように）', async () => {
    hoisted.createPage.mockResolvedValue({ id: 'page-new', spaceId: 's-1', title: 'x', position: 'a0' });
    const client = renderDialog();
    client.setQueryData(kbKeys.pageTree('acme', 's-1', false), []);

    const dialog = within(await screen.findByRole('dialog', { name: '新しくつくる' }));
    await dialog.findByRole('combobox', { name: '保存先のスペース' });
    fireEvent.change(dialog.getByRole('textbox', { name: 'ページのタイトル' }), { target: { value: '手順' } });
    fireEvent.click(dialog.getByRole('button', { name: /ページを作成してひらく/ }));

    await waitFor(() => expect(hoisted.createPage).toHaveBeenCalled());
    await waitFor(() => expect(client.getQueryState(kbKeys.pageTree('acme', 's-1', false))?.isInvalidated).toBe(true));
  });

  it('チケットを作ったら、そのプロジェクトの一覧と件数を古くする（次に開いたバックログに出るように）', async () => {
    hoisted.createTicket.mockResolvedValue({ id: 't-new', projectId: 'p-1' });
    const client = renderDialog();
    client.setQueryData(ticketKeys.list('acme', 'p-1', {}), []);
    client.setQueryData(ticketKeys.counts('acme', 'p-1'), { total: 0 });

    const dialog = within(await screen.findByRole('dialog', { name: '新しくつくる' }));
    fireEvent.click(dialog.getByRole('tab', { name: 'チケット' }));
    const panel = within(dialog.getByRole('tabpanel', { name: 'チケット' }));
    await panel.findByRole('combobox', { name: '所属するプロジェクト' });
    fireEvent.change(panel.getByRole('textbox', { name: 'チケットのタイトル' }), { target: { value: '確かめる' } });
    const submit = panel.getByRole('button', { name: /チケットを作成してひらく/ });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(hoisted.createTicket).toHaveBeenCalled());
    await waitFor(() => expect(client.getQueryState(ticketKeys.list('acme', 'p-1', {}))?.isInvalidated).toBe(true));
    expect(client.getQueryState(ticketKeys.counts('acme', 'p-1'))?.isInvalidated).toBe(true);
  });
});
