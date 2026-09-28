import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiClient from '@/shared/api/axios';
import WorkspaceRepository from '../workspaceRepository';

vi.mock('@/shared/api/axios');

const mockGet = vi.mocked(apiClient.get);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WorkspaceRepository', () => {
  it('fetchWorkspaces は GET /kb/workspaces で配列を返す', async () => {
    mockGet.mockResolvedValue({ data: [{ slug: 'acme', name: 'Acme 社', createdAt: '2026-08-01T00:00:00Z' }] });

    const list = await WorkspaceRepository.fetchWorkspaces();

    expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/workspaces');
    expect(list).toHaveLength(1);
  });

  it('一覧が null で返っても空配列にする', async () => {
    // 0 件を null で返されると map / for-of が落ちて画面が開けなくなる。
    mockGet.mockResolvedValue({ data: null });

    await expect(WorkspaceRepository.fetchWorkspaces()).resolves.toEqual([]);
  });

  it('fetchMembers は GET /kb/workspaces/:slug/members を叩き、裸の配列をそのまま返す', async () => {
    mockGet.mockResolvedValue({ data: [{ principalId: 'p-1', userId: 42, name: '田中 太郎' }] });

    const members = await WorkspaceRepository.fetchMembers('acme');

    expect(mockGet).toHaveBeenCalledWith('/api/v2/kb/workspaces/acme/members');
    expect(members).toEqual([{ principalId: 'p-1', userId: 42, name: '田中 太郎' }]);
  });

  it('fetchMembers も null 応答は空配列にする', async () => {
    mockGet.mockResolvedValue({ data: null });
    await expect(WorkspaceRepository.fetchMembers('acme')).resolves.toEqual([]);
  });
});
