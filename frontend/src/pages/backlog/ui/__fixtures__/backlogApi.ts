import type { ApiStubs } from '../../../../../.storybook/decorators';

/*
 * バックログの面の見本（一覧・設定）が共有する API の見本。宛先は「先に登録した鍵の部分一致」で
 * 決まるので、長い宛先を先に書く。
 */

export const workspaces = [{ slug: 'acme', name: '開発チーム', createdAt: '2026-01-01T00:00:00Z', canManage: true }];
export const projects = [
  { id: 'p-1', workspaceId: 'w-1', key: 'frestyle', name: 'frestyle', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
];

export const status = (over: Record<string, unknown>) => ({
  id: 'st-1',
  workspaceId: 'w-1',
  projectId: 'p-1',
  name: 'To Do',
  category: 'todo',
  color: '#5b6b7a',
  position: 'a0',
  isInitial: true,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-08T00:00:00Z',
  activeTicketCount: 1,
  ...over,
});

export const type = (over: Record<string, unknown>) => ({
  id: 'ty-1',
  workspaceId: 'w-1',
  projectId: 'p-1',
  name: '開発タスク',
  hierarchyLevel: 0,
  color: '#2563eb',
  position: 'a0',
  isDefault: true,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-08T00:00:00Z',
  activeTicketCount: 1,
  ...over,
});

export const ticket = (over: Record<string, unknown>) => ({
  id: 't-1',
  workspaceId: 'w-1',
  projectId: 'p-1',
  number: 457,
  typeId: 'ty-1',
  statusId: 'st-1',
  title: '段1: チケットの骨格（9表）',
  doc: { type: 'doc', content: [] },
  priority: 1,
  position: 'a0',
  createdByUserId: 1,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-09T00:00:00Z',
  ...over,
});

export function baseApi(over: ApiStubs = {}): ApiStubs {
  return {
    '/workspaces/acme/projects/p-1/ticket-statuses': { statuses: [status({})] },
    '/workspaces/acme/projects/p-1/ticket-types': { types: [type({})] },
    '/workspaces/acme/labels': { labels: [] },
    // 宛先は「先に登録した鍵の部分一致」で決まる。`…/tickets` は `…/tickets/counts` にも一致するので、
    // 長い方を先に置く。
    '/workspaces/acme/projects/p-1/tickets/counts': { total: 1, assignedToMe: 0, overdue: 1, unassigned: 1 },
    '/workspaces/acme/projects/p-1/tickets': { tickets: [ticket({})] },
    '/workspaces/acme/projects/p-1/saved-filters': { savedFilters: [] },
    '/workspaces/acme/projects': { projects },
    // プロジェクトの所在（親ルートが URL のプロジェクトのワークスペースを引く口）。`/projects/p-1` のままだと
    // `/workspaces/acme/projects/p-1/…` にも部分一致するので、前を付けて所在の口だけに当てる。
    '/api/v2/projects/p-1': { workspaceSlug: 'acme', workspaceName: '開発チーム', project: projects[0] },
    // 担当の名前と選択肢の元（ワークスペースに属する人）。`/kb/workspaces` より先に置く
    // （後ろだと、人の一覧の宛先にワークスペースの一覧が当たる）。
    '/kb/workspaces/acme/members': [{ principalId: 'pr-1', userId: 1, name: '川野 拓馬' }],
    '/kb/workspaces': workspaces,
    ...over,
  };
}

/** スプリント 1 本を持つスタブ。鍵は `/workspaces/acme/projects` より先に置く（前から順の部分一致）。 */
export function sprintApi(): ApiStubs {
  return {
    '/workspaces/acme/projects/p-1/sprints': {
      sprints: [
        {
          id: 's-1',
          workspaceId: 'w-1',
          projectId: 'p-1',
          name: 'スプリント 1',
          state: 'planned',
          startDate: '2026-09-01',
          endDate: '2026-09-14',
          position: 'a0',
          ticketCount: 0,
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        },
      ],
    },
    '/workspaces/acme/sprints/s-1/tickets': { ticketIds: [] },
    ...baseApi(),
  };
}
