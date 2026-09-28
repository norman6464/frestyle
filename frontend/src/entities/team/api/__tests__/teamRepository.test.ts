import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiClient from '@/shared/api/axios';
import { TeamRepository } from '../teamRepository';

vi.mock('@/shared/api/axios');

const mockPut = vi.mocked(apiClient.put);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TeamRepository.setTicketTeam', () => {
  it('応答のチケットから、どのチケットの担当チームが何になったかだけを返す', async () => {
    mockPut.mockResolvedValueOnce({ data: { id: 't-1', title: '題名', teamId: 'team-1', labels: null } });

    await expect(TeamRepository.setTicketTeam('acme', 't-1', 'team-1')).resolves.toEqual({
      ticketId: 't-1',
      teamId: 'team-1',
    });
    expect(mockPut).toHaveBeenCalledWith('/api/v2/workspaces/acme/tickets/t-1/team', { teamId: 'team-1' });
  });

  it('外したときは応答に teamId が入らないので、null に揃える', async () => {
    mockPut.mockResolvedValueOnce({ data: { id: 't-1', title: '題名' } });

    await expect(TeamRepository.setTicketTeam('acme', 't-1', '')).resolves.toEqual({ ticketId: 't-1', teamId: null });
  });
});
