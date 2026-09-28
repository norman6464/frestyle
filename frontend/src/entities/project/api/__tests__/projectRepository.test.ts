import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/shared/api/axios', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

import apiClient from '@/shared/api/axios';
import { ProjectRepository } from '../projectRepository';

const mockGet = vi.mocked(apiClient.get);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProjectRepository', () => {
  it('resolveProject は GET /projects/:id でプロジェクトの所在を返す', async () => {
    const location = {
      workspaceSlug: 'acme',
      workspaceName: '開発チーム',
      project: { id: 'p-1', workspaceId: 'w-1', key: 'eng', name: '開発', createdAt: '', updatedAt: '' },
    };
    mockGet.mockResolvedValue({ data: location });

    const got = await ProjectRepository.resolveProject('p-1');

    expect(mockGet).toHaveBeenCalledWith('/api/v2/projects/p-1');
    expect(got).toEqual(location);
  });
});
