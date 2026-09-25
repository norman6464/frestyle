import { describe, it, expect, vi, beforeEach } from 'vitest';
import TicketRepository from '../ticketRepository';
import apiClient from '@/shared/api/axios';
import axios from 'axios';

vi.mock('@/shared/api/axios');
// putTicketAttachmentFile が素の axios を直接使うため個別に mock する。
// shared/api/axios.ts の automock は実モジュールを一度読み込んで形を写すので、
// ここでの axios.create もその読み込み時に呼ばれる（動く形を返しておかないと自動 mock 自体が落ちる）。
vi.mock('axios', () => ({
  default: {
    put: vi.fn(),
    create: vi.fn(() => ({
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    })),
  },
}));

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPut = vi.mocked(apiClient.put);
const mockDelete = vi.mocked(apiClient.delete);
const mockAxiosPut = vi.mocked(axios.put);

beforeEach(() => {
  vi.clearAllMocks();
});

const wireTicket = (over: Record<string, unknown> = {}) => ({
  id: 't-1',
  workspaceId: 'w-1',
  projectId: 'p-1',
  number: 457,
  typeId: 'ty-1',
  statusId: 'st-1',
  title: '段1: チケットの骨格',
  doc: { type: 'doc', content: [] },
  priority: 2,
  position: 'a0',
  createdByUserId: 1,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-09T00:00:00Z',
  ...over,
});

describe('TicketRepository.fetchTickets', () => {
  it('GET /workspaces/:slug/projects/:projectId/tickets を叩き、omitempty のキーを null に正規化する', async () => {
    mockGet.mockResolvedValue({ data: { tickets: [wireTicket()] } });
    const list = await TicketRepository.fetchTickets('acme', 'p-1');
    expect(mockGet).toHaveBeenCalledWith('/api/v2/workspaces/acme/projects/p-1/tickets', { params: { limit: '200' } });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 't-1',
      parentId: null,
      startDate: null,
      dueDate: null,
      closedAt: null,
      resolution: null,
      archivedAt: null,
      assigneePrincipalId: null,
    });
  });

  it('tickets が null で返っても空配列にする', async () => {
    mockGet.mockResolvedValue({ data: { tickets: null } });
    await expect(TicketRepository.fetchTickets('acme', 'p-1')).resolves.toEqual([]);
  });

  it('絞り込みをクエリパラメータへ渡す', async () => {
    mockGet.mockResolvedValue({ data: { tickets: [] } });
    await TicketRepository.fetchTickets('acme', 'p-1', {
      statusId: 'st-1',
      typeId: 'ty-1',
      assigneePrincipalId: 'p-1',
      archived: true,
    });
    expect(mockGet).toHaveBeenCalledWith('/api/v2/workspaces/acme/projects/p-1/tickets', {
      params: { limit: '200', statusId: 'st-1', typeId: 'ty-1', assigneePrincipalId: 'p-1', archived: 'true' },
    });
  });

  it('保存した絞り込み(unassigned/assignedToMe/overdue/q/labelId)もクエリパラメータへ渡す', async () => {
    mockGet.mockResolvedValue({ data: { tickets: [] } });
    await TicketRepository.fetchTickets('acme', 'p-1', {
      labelId: 'l-1',
      unassigned: true,
      assignedToMe: true,
      overdue: true,
      q: '認証',
    });
    expect(mockGet).toHaveBeenCalledWith('/api/v2/workspaces/acme/projects/p-1/tickets', {
      params: { limit: '200', label: 'l-1', unassigned: 'true', assignedToMe: 'true', overdue: 'true', q: '認証' },
    });
  });

  it('値がある omitempty フィールドはそのまま通す', async () => {
    mockGet.mockResolvedValue({
      data: { tickets: [wireTicket({ parentId: 't-0', assigneePrincipalId: 'p-1' })] },
    });
    const [ticket] = await TicketRepository.fetchTickets('acme', 'p-1');
    expect(ticket.parentId).toBe('t-0');
    expect(ticket.assigneePrincipalId).toBe('p-1');
  });
});

describe('TicketRepository.fetchTicketCounts', () => {
  it('GET .../tickets/counts を叩き、応答をそのまま返す', async () => {
    mockGet.mockResolvedValue({ data: { total: 10, assignedToMe: 3, overdue: 1, unassigned: 2 } });
    const counts = await TicketRepository.fetchTicketCounts('acme', 'p-1');
    expect(mockGet).toHaveBeenCalledWith('/api/v2/workspaces/acme/projects/p-1/tickets/counts');
    expect(counts).toEqual({ total: 10, assignedToMe: 3, overdue: 1, unassigned: 2 });
  });
});

describe('TicketRepository.fetchTicketChildren', () => {
  it('GET /tickets/:ticketId/children を叩く', async () => {
    mockGet.mockResolvedValue({ data: { tickets: [wireTicket({ id: 'c-1', parentId: 't-1' })] } });
    const list = await TicketRepository.fetchTicketChildren('acme', 't-1');
    expect(mockGet).toHaveBeenCalledWith('/api/v2/workspaces/acme/tickets/t-1/children');
    expect(list).toHaveLength(1);
    expect(list[0].parentId).toBe('t-1');
  });

  it('tickets が null で返っても空配列にする', async () => {
    mockGet.mockResolvedValue({ data: { tickets: null } });
    await expect(TicketRepository.fetchTicketChildren('acme', 't-1')).resolves.toEqual([]);
  });
});

describe('TicketRepository.createTicket', () => {
  it('POST で作成し、省略項目は空文字/0 で送る', async () => {
    mockPost.mockResolvedValue({ data: wireTicket() });
    await TicketRepository.createTicket('acme', 'p-1', { title: '新しいチケット' });
    expect(mockPost).toHaveBeenCalledWith('/api/v2/workspaces/acme/projects/p-1/tickets', {
      parentId: '',
      typeId: '',
      statusId: '',
      title: '新しいチケット',
      doc: undefined,
      priority: 0,
      startDate: undefined,
      dueDate: undefined,
    });
  });
});

describe('TicketRepository.moveTicket', () => {
  it('POST /move へ anchor を送る（204・戻り値なし）', async () => {
    mockPost.mockResolvedValue({ data: undefined });
    await TicketRepository.moveTicket('acme', 't-1', { anchorTicketId: 't-2', anchorAfter: true });
    expect(mockPost).toHaveBeenCalledWith('/api/v2/workspaces/acme/tickets/t-1/move', {
      anchorTicketId: 't-2',
      anchorAfter: true,
    });
  });

  it('anchor 省略時は末尾へ（空文字を送る）', async () => {
    mockPost.mockResolvedValue({ data: undefined });
    await TicketRepository.moveTicket('acme', 't-1', {});
    expect(mockPost).toHaveBeenCalledWith('/api/v2/workspaces/acme/tickets/t-1/move', {
      anchorTicketId: '',
      anchorAfter: false,
    });
  });
});

describe('TicketRepository.unassignTicket / archiveTicketStatus', () => {
  it('DELETE /assignee を叩く', async () => {
    mockDelete.mockResolvedValue({ data: undefined });
    await TicketRepository.unassignTicket('acme', 't-1');
    expect(mockDelete).toHaveBeenCalledWith('/api/v2/workspaces/acme/tickets/t-1/assignee');
  });

  it('POST /ticket-statuses/:id/archive を叩く', async () => {
    mockPost.mockResolvedValue({ data: undefined });
    await TicketRepository.archiveTicketStatus('acme', 'p-1', 'st-1');
    expect(mockPost).toHaveBeenCalledWith('/api/v2/workspaces/acme/projects/p-1/ticket-statuses/st-1/archive');
  });
});

describe('TicketRepository.fetchTicketStatuses', () => {
  it('activeTicketCount を含めて正規化する', async () => {
    mockGet.mockResolvedValue({
      data: {
        statuses: [
          {
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
            activeTicketCount: 3,
          },
        ],
      },
    });
    const [status] = await TicketRepository.fetchTicketStatuses('acme', 'p-1');
    expect(status.activeTicketCount).toBe(3);
    expect(status.archivedAt).toBeNull();
  });
});

describe('TicketRepository.updateTicketStatus', () => {
  it('応答に activeTicketCount が無くても 0 に正規化する（backend は domain 構造体を素で返す）', async () => {
    mockPut.mockResolvedValue({
      data: {
        id: 'st-1',
        workspaceId: 'w-1',
        projectId: 'p-1',
        name: 'To Do',
        category: 'todo',
        color: '#5b6b7a',
        position: 'a0',
        isInitial: true,
        createdAt: '2026-09-08T00:00:00Z',
        updatedAt: '2026-09-09T00:00:00Z',
      },
    });
    const status = await TicketRepository.updateTicketStatus('acme', 'p-1', 'st-1', {
      name: 'To Do',
      category: 'todo',
      color: '#5b6b7a',
    });
    expect(status.activeTicketCount).toBe(0);
  });
});

describe('TicketRepository.fetchTicketComments', () => {
  it('GET /comments を叩き、本文のノード配列を塊の列へ畳む', async () => {
    mockGet.mockResolvedValue({
      data: {
        comments: [
          {
            id: 'c-1',
            author: { userId: 1, name: '田中 太郎' },
            body: [{ type: 'text', text: 'こんにちは' }],
            edited: false,
            reactions: [{ userId: 2, emoji: '👍' }],
            createdAt: '2026-09-10T00:00:00Z',
            updatedAt: '2026-09-10T00:00:00Z',
          },
        ],
      },
    });

    const comments = await TicketRepository.fetchTicketComments('acme', 't-1');

    expect(mockGet).toHaveBeenCalledWith('/api/v2/workspaces/acme/tickets/t-1/comments');
    expect(comments).toEqual([
      {
        id: 'c-1',
        parentCommentId: null,
        author: { userId: 1, name: '田中 太郎' },
        body: [{ kind: 'paragraph', segments: [{ kind: 'text', text: 'こんにちは' }] }],
        edited: false,
        reactions: [{ userId: 2, emoji: '👍' }],
        createdAt: '2026-09-10T00:00:00Z',
        updatedAt: '2026-09-10T00:00:00Z',
      },
    ]);
  });

  it('reactions が無ければ空配列にする', async () => {
    mockGet.mockResolvedValue({
      data: {
        comments: [
          {
            id: 'c-1',
            author: { userId: 1, name: '田中 太郎' },
            body: [],
            edited: false,
            createdAt: '',
            updatedAt: '',
          },
        ],
      },
    });
    const [comment] = await TicketRepository.fetchTicketComments('acme', 't-1');
    expect(comment.reactions).toEqual([]);
  });

  it('comments が null でも空配列にする', async () => {
    mockGet.mockResolvedValue({ data: { comments: null } });
    await expect(TicketRepository.fetchTicketComments('acme', 't-1')).resolves.toEqual([]);
  });
});

describe('TicketRepository.createTicketComment', () => {
  it('POST で塊の列を送信できる本文へ組み立てて送る', async () => {
    mockPost.mockResolvedValue({
      data: {
        id: 'c-1',
        author: { userId: 1, name: '田中 太郎' },
        body: [{ type: 'text', text: 'お願いします' }],
        edited: false,
        reactions: [],
        createdAt: '',
        updatedAt: '',
      },
    });

    await TicketRepository.createTicketComment(
      'acme',
      't-1',
      [{ kind: 'paragraph', segments: [{ kind: 'text', text: 'お願いします' }] }],
      'c-parent',
    );

    expect(mockPost).toHaveBeenCalledWith('/api/v2/workspaces/acme/tickets/t-1/comments', {
      parentCommentId: 'c-parent',
      body: [{ type: 'paragraph', content: [{ type: 'text', text: 'お願いします' }] }],
    });
  });
});

describe('TicketRepository.updateTicketComment', () => {
  it('PUT で本文を置き換える（応答の reactions は常に空配列で返る）', async () => {
    mockPut.mockResolvedValue({
      data: {
        id: 'c-1',
        author: { userId: 1, name: '田中 太郎' },
        body: [{ type: 'text', text: '直しました' }],
        edited: true,
        reactions: [],
        createdAt: '',
        updatedAt: '',
      },
    });

    const updated = await TicketRepository.updateTicketComment('acme', 't-1', 'c-1', [
      { kind: 'paragraph', segments: [{ kind: 'text', text: '直しました' }] },
    ]);

    expect(mockPut).toHaveBeenCalledWith('/api/v2/workspaces/acme/tickets/t-1/comments/c-1', {
      body: [{ type: 'paragraph', content: [{ type: 'text', text: '直しました' }] }],
    });
    expect(updated.reactions).toEqual([]);
  });
});

describe('TicketRepository.deleteTicketComment', () => {
  it('DELETE を叩く（204）', async () => {
    mockDelete.mockResolvedValue({ data: undefined });
    await TicketRepository.deleteTicketComment('acme', 't-1', 'c-1');
    expect(mockDelete).toHaveBeenCalledWith('/api/v2/workspaces/acme/tickets/t-1/comments/c-1');
  });
});

describe('TicketRepository.fetchTicketCommentEdits', () => {
  it('GET /edits を叩き、編集前の本文も塊の列へ畳む', async () => {
    mockGet.mockResolvedValue({
      data: {
        edits: [
          {
            id: 'e-1',
            editor: { userId: 1, name: '田中 太郎' },
            previousBody: [{ type: 'text', text: '直す前' }],
            editedAt: '2026-09-10T00:00:00Z',
          },
        ],
      },
    });

    const edits = await TicketRepository.fetchTicketCommentEdits('acme', 't-1', 'c-1');

    expect(mockGet).toHaveBeenCalledWith('/api/v2/workspaces/acme/tickets/t-1/comments/c-1/edits');
    expect(edits).toEqual([
      {
        id: 'e-1',
        editor: { userId: 1, name: '田中 太郎' },
        previousBody: [{ kind: 'paragraph', segments: [{ kind: 'text', text: '直す前' }] }],
        editedAt: '2026-09-10T00:00:00Z',
      },
    ]);
  });
});

describe('TicketRepository.addTicketCommentReaction / removeTicketCommentReaction', () => {
  it('絵文字を URL エンコードして PUT/DELETE する（204・冪等）', async () => {
    mockPut.mockResolvedValue({ data: undefined });
    mockDelete.mockResolvedValue({ data: undefined });

    await TicketRepository.addTicketCommentReaction('acme', 't-1', 'c-1', '👍');
    await TicketRepository.removeTicketCommentReaction('acme', 't-1', 'c-1', '👍');

    const expectedUrl = `/api/v2/workspaces/acme/tickets/t-1/comments/c-1/reactions/${encodeURIComponent('👍')}`;
    expect(mockPut).toHaveBeenCalledWith(expectedUrl);
    expect(mockDelete).toHaveBeenCalledWith(expectedUrl);
  });
});

describe('TicketRepository.fetchLabels', () => {
  it('GET /labels を叩く', async () => {
    mockGet.mockResolvedValue({
      data: { labels: [{ id: 'l-1', projectId: 'p-1', name: '不具合', color: '#1d4ed8', createdAt: '', updatedAt: '' }] },
    });
    const labels = await TicketRepository.fetchLabels('acme');
    expect(mockGet).toHaveBeenCalledWith('/api/v2/workspaces/acme/labels');
    expect(labels).toHaveLength(1);
  });

  it('labels が null でも空配列にする', async () => {
    mockGet.mockResolvedValue({ data: { labels: null } });
    await expect(TicketRepository.fetchLabels('acme')).resolves.toEqual([]);
  });
});

describe('TicketRepository.createLabel / updateLabel', () => {
  it('POST で作成する', async () => {
    mockPost.mockResolvedValue({ data: { id: 'l-1', projectId: 'p-1', name: '検索', color: '#dbeafe', createdAt: '', updatedAt: '' } });
    await TicketRepository.createLabel('acme', { name: '検索', color: '#dbeafe' });
    expect(mockPost).toHaveBeenCalledWith('/api/v2/workspaces/acme/labels', { name: '検索', color: '#dbeafe' });
  });

  it('PUT で更新する', async () => {
    mockPut.mockResolvedValue({ data: { id: 'l-1', projectId: 'p-1', name: '検索2', color: '#dbeafe', createdAt: '', updatedAt: '' } });
    await TicketRepository.updateLabel('acme', 'l-1', { name: '検索2', color: '#dbeafe' });
    expect(mockPut).toHaveBeenCalledWith('/api/v2/workspaces/acme/labels/l-1', { name: '検索2', color: '#dbeafe' });
  });
});

describe('TicketRepository.deleteLabel', () => {
  it('DELETE を叩く（204）', async () => {
    mockDelete.mockResolvedValue({ data: undefined });
    await TicketRepository.deleteLabel('acme', 'l-1');
    expect(mockDelete).toHaveBeenCalledWith('/api/v2/workspaces/acme/labels/l-1');
  });
});

describe('TicketRepository.addTicketLabel / removeTicketLabel', () => {
  it('PUT/DELETE でチケットへの付け外しをする（どちらも204・冪等）', async () => {
    mockPut.mockResolvedValue({ data: undefined });
    mockDelete.mockResolvedValue({ data: undefined });
    await TicketRepository.addTicketLabel('acme', 't-1', 'l-1');
    await TicketRepository.removeTicketLabel('acme', 't-1', 'l-1');
    expect(mockPut).toHaveBeenCalledWith('/api/v2/workspaces/acme/tickets/t-1/labels/l-1');
    expect(mockDelete).toHaveBeenCalledWith('/api/v2/workspaces/acme/tickets/t-1/labels/l-1');
  });
});

describe('TicketRepository.fetchTicketAttachments', () => {
  it('GET /attachments を叩き attachments を取り出す', async () => {
    mockGet.mockResolvedValue({
      data: { attachments: [{ id: 'at-1', ticketId: 't-1', filename: 'a.png', contentType: 'image/png', sizeBytes: 1, uploadedByUserId: 1, createdAt: '' }] },
    });
    const attachments = await TicketRepository.fetchTicketAttachments('acme', 't-1');
    expect(mockGet).toHaveBeenCalledWith('/api/v2/workspaces/acme/tickets/t-1/attachments');
    expect(attachments).toHaveLength(1);
  });

  it('attachments が null でも空配列にする', async () => {
    mockGet.mockResolvedValue({ data: { attachments: null } });
    await expect(TicketRepository.fetchTicketAttachments('acme', 't-1')).resolves.toEqual([]);
  });
});

describe('TicketRepository.issueTicketAttachmentUploadUrl', () => {
  it('POST で contentType と size を渡す', async () => {
    mockPost.mockResolvedValue({ data: { url: 'https://gcs/put?sig', key: 'k-1', expiresIn: 600 } });
    const issued = await TicketRepository.issueTicketAttachmentUploadUrl('acme', 't-1', 'image/png', 1024);
    expect(mockPost).toHaveBeenCalledWith('/api/v2/workspaces/acme/tickets/t-1/attachments/upload-url', {
      contentType: 'image/png',
      size: 1024,
    });
    expect(issued).toEqual({ url: 'https://gcs/put?sig', key: 'k-1', expiresIn: 600 });
  });
});

describe('TicketRepository.putTicketAttachmentFile', () => {
  it('素の axios で署名付き URL へ Content-Type 一致の PUT を送る（apiClient は使わない）', async () => {
    mockAxiosPut.mockResolvedValue({});
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    await TicketRepository.putTicketAttachmentFile('https://gcs/put?sig', file);
    expect(mockAxiosPut).toHaveBeenCalledWith('https://gcs/put?sig', file, {
      headers: { 'Content-Type': 'application/pdf' },
    });
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe('TicketRepository.createTicketAttachment', () => {
  it('POST で確定し、応答をそのまま返す（201）', async () => {
    const created = { id: 'at-1', ticketId: 't-1', filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10, uploadedByUserId: 1, createdAt: '' };
    mockPost.mockResolvedValue({ data: created });
    const result = await TicketRepository.createTicketAttachment('acme', 't-1', {
      key: 'k-1',
      filename: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10,
    });
    expect(mockPost).toHaveBeenCalledWith('/api/v2/workspaces/acme/tickets/t-1/attachments', {
      key: 'k-1',
      filename: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: 10,
    });
    expect(result).toEqual(created);
  });
});

describe('TicketRepository.issueTicketAttachmentDownloadUrl', () => {
  it('GET でダウンロード URL を発行する', async () => {
    mockGet.mockResolvedValue({ data: { url: 'https://gcs/get?sig', expiresIn: 600 } });
    const issued = await TicketRepository.issueTicketAttachmentDownloadUrl('acme', 't-1', 'at-1');
    expect(mockGet).toHaveBeenCalledWith('/api/v2/workspaces/acme/tickets/t-1/attachments/at-1/download-url');
    expect(issued).toEqual({ url: 'https://gcs/get?sig', expiresIn: 600 });
  });
});

describe('TicketRepository.deleteTicketAttachment', () => {
  it('DELETE を叩く（204）', async () => {
    mockDelete.mockResolvedValue({ data: undefined });
    await TicketRepository.deleteTicketAttachment('acme', 't-1', 'at-1');
    expect(mockDelete).toHaveBeenCalledWith('/api/v2/workspaces/acme/tickets/t-1/attachments/at-1');
  });
});
