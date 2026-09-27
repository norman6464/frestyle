import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import apiClient from '@/shared/api/axios';
import KbBacklogPage from '../KbBacklogPage';

// 行は本物を描き、チケットごとに描かれた回数だけ数える。本物の行は memo なので、数える包みも
// 同じく memo にする（包みが memo でないと、本物が描き直しを飛ばしても包みの数が増える）。
// 本物が memo であること自体は下の検査で確かめる。ここで確かめるのは「ページが同じものを
// 渡しているか」＝ memo が効く条件がそろっているか。
const hoisted = vi.hoisted(() => ({ rowRenders: {} as Record<string, number> }));
vi.mock('../BacklogRow', async (importOriginal) => {
  const { memo } = await import('react');
  const actual = await importOriginal<typeof import('../BacklogRow')>();
  const Real = actual.default;
  const Counting = memo(function CountingRow(props: Parameters<typeof Real>[0]) {
    hoisted.rowRenders[props.ticket.id] = (hoisted.rowRenders[props.ticket.id] ?? 0) + 1;
    return <Real {...props} />;
  });
  return { ...actual, default: Counting };
});
vi.mock('@/shared/lib/hooks/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
// 要求のたびに ID トークンを付ける処理（apiClient の interceptor）は、テストではサインインが無い。
vi.mock('@/shared/lib/auth/currentIdToken', () => ({ getCurrentIdToken: () => Promise.resolve(null) }));

const status = { id: 'st-1', workspaceId: 'w-1', projectId: 'p-1', name: 'To Do', category: 'todo', color: '#5b6b7a', position: 'a0', isInitial: true, createdAt: '', updatedAt: '', activeTicketCount: 3 };
const type = { id: 'ty-1', workspaceId: 'w-1', projectId: 'p-1', name: '開発タスク', hierarchyLevel: 0, color: '#2563eb', position: 'a0', isDefault: true, createdAt: '', updatedAt: '', activeTicketCount: 3 };
const ticket = (id: string, number: number, title: string) => ({
  id, workspaceId: 'w-1', projectId: 'p-1', number, typeId: 'ty-1', statusId: 'st-1', title,
  doc: { type: 'doc', content: [] }, priority: 1, position: `a${number}`, createdByUserId: 1,
  createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z', parentId: null, labels: [],
});
const tickets = [ticket('t-1', 1, '一つ目'), ticket('t-2', 2, '二つ目'), ticket('t-3', 3, '三つ目')];

/** 宛先の部分一致で応答を返す（見本の withApi と同じ考え方）。細かい宛先を先に書く。 */
function stubs(): [string, (config: InternalAxiosRequestConfig) => unknown][] {
  return [
    ['/workspaces/acme/projects/p-1/ticket-statuses', () => ({ statuses: [status] })],
    ['/workspaces/acme/projects/p-1/ticket-types', () => ({ types: [type] })],
    ['/workspaces/acme/labels', () => ({ labels: [] })],
    ['/workspaces/acme/projects/p-1/tickets/counts', () => ({ total: 3, assignedToMe: 0, overdue: 0, unassigned: 3 })],
    ['/workspaces/acme/projects/p-1/tickets', (config) =>
      config.method === 'post'
        ? ticket('t-4', 4, JSON.parse(String(config.data)).title)
        : { tickets: tickets.map((t) => ({ ...t })) }],
    ['/workspaces/acme/projects/p-1/saved-filters', () => ({ savedFilters: [] })],
    ['/workspaces/acme/projects/p-1/sprints', () => ({ sprints: [] })],
    ['/workspaces/acme/projects', () => ({ projects: [{ id: 'p-1', workspaceId: 'w-1', key: 'frestyle', name: 'frestyle', createdAt: '', updatedAt: '' }] })],
    ['/kb/workspaces', () => [{ slug: 'acme', name: '開発チーム', createdAt: '', canManage: true }]],
  ];
}

const adapter: AxiosAdapter = async (config) => {
  const url = config.url ?? '';
  const hit = stubs().find(([pattern]) => url.includes(pattern));
  if (!hit) {
    const error = Object.assign(new Error(`stub なし: ${url}`), {
      isAxiosError: true,
      config,
      response: { data: null, status: 404, statusText: 'Not Found', headers: {}, config } as AxiosResponse,
    });
    throw error;
  }
  return { data: hit[1](config), status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse;
};

const originalAdapter = apiClient.defaults.adapter;
beforeEach(() => {
  apiClient.defaults.adapter = adapter;
  hoisted.rowRenders = {};
});
afterEach(() => {
  apiClient.defaults.adapter = originalAdapter;
});

async function renderReady() {
  render(
    <MemoryRouter initialEntries={['/backlog/p-1']}>
      <Routes>
        <Route path="/backlog/:projectId" element={<KbBacklogPage view="backlog" />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText('三つ目');
  // 取得が落ち着く（件数・保存した絞り込みが届く）まで待ってから数え始める。
  await waitFor(() => expect(screen.getByText(/3 件の課題を表示/)).toBeInTheDocument());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  hoisted.rowRenders = {};
}

describe('KbBacklogPage の描き直しの範囲', () => {
  it('行の部品は memo（渡すものが変わらない限り描き直さない）', async () => {
    const actual = await vi.importActual<typeof import('../BacklogRow')>('../BacklogRow');
    expect((actual.default as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
  });

  it('行を 1 つ選んでも、ほかの行を描き直さない', async () => {
    await renderReady();

    fireEvent.click(within(screen.getByText('二つ目').closest('[role="row"]') as HTMLElement).getByText('二つ目'));

    await waitFor(() => expect(hoisted.rowRenders['t-2'] ?? 0).toBeGreaterThan(0));
    expect(hoisted.rowRenders['t-1'] ?? 0).toBe(0);
    expect(hoisted.rowRenders['t-3'] ?? 0).toBe(0);
  });

  it('チケットを 1 件作っても、ほかの行を描き直さない', async () => {
    await renderReady();

    const input = screen.getByPlaceholderText('題名を入力して Enter で作成');
    fireEvent.change(input, { target: { value: '四つ目' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByText('四つ目');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect({ t1: hoisted.rowRenders['t-1'] ?? 0, t2: hoisted.rowRenders['t-2'] ?? 0, t3: hoisted.rowRenders['t-3'] ?? 0 }).toEqual({
      t1: 0,
      t2: 0,
      t3: 0,
    });
  });

  it('絞り込みに 1 文字打っても、中身の変わらない行を描き直さない', async () => {
    await renderReady();

    fireEvent.change(screen.getByPlaceholderText('題名で絞り込む'), { target: { value: 'つ' } });
    // 待ってから URL に反映され、一覧を取り直す（応答は同じ 3 件）。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    await waitFor(() => expect(screen.queryByText('更新中…')).not.toBeInTheDocument());

    expect({ t1: hoisted.rowRenders['t-1'] ?? 0, t2: hoisted.rowRenders['t-2'] ?? 0, t3: hoisted.rowRenders['t-3'] ?? 0 }).toEqual({
      t1: 0,
      t2: 0,
      t3: 0,
    });
  });
});
