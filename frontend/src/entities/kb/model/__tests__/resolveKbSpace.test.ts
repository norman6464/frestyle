import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveEntryKbSpaceId, resolveKbSpace } from '../resolveKbSpace';

const hoisted = vi.hoisted(() => ({
  fetchWorkspaces: vi.fn(),
  fetchMySpaces: vi.fn(),
}));

vi.mock('../../api/kbRepository', () => ({
  default: {
    fetchWorkspaces: hoisted.fetchWorkspaces,
    fetchMySpaces: hoisted.fetchMySpaces,
  },
}));

const WS_A = { slug: 'a', name: 'A', createdAt: '', canManage: true };
const WS_B = { slug: 'b', name: 'B', createdAt: '', canManage: false };
const SPACE_A1 = { id: 'sp-a1', name: 'A のスペース', role: 'admin' as const };
const SPACE_B1 = { id: 'sp-b1', name: 'B のスペース', role: 'viewer' as const };

describe('resolveEntryKbSpaceId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preferredWorkspaceSlug 無しでは、所属の先頭から最初のスペースを返す', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([WS_A, WS_B]);
    hoisted.fetchMySpaces.mockImplementation(async (slug: string) =>
      slug === 'a' ? [SPACE_A1] : [SPACE_B1],
    );

    const id = await resolveEntryKbSpaceId();

    expect(id).toBe('sp-a1');
    expect(hoisted.fetchMySpaces).toHaveBeenCalledWith('a');
  });

  it('preferredWorkspaceSlug があれば、そのワークスペースを最初に見る', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([WS_A, WS_B]);
    hoisted.fetchMySpaces.mockImplementation(async (slug: string) =>
      slug === 'a' ? [SPACE_A1] : [SPACE_B1],
    );

    const id = await resolveEntryKbSpaceId('b');

    expect(id).toBe('sp-b1');
    // 先頭（a）へは問い合わせない。
    expect(hoisted.fetchMySpaces).toHaveBeenCalledTimes(1);
    expect(hoisted.fetchMySpaces).toHaveBeenCalledWith('b');
  });

  it('preferred が所属に無い slug なら無視し、通常どおり先頭から見る', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([WS_A, WS_B]);
    hoisted.fetchMySpaces.mockImplementation(async (slug: string) =>
      slug === 'a' ? [SPACE_A1] : [SPACE_B1],
    );

    const id = await resolveEntryKbSpaceId('gone');

    expect(id).toBe('sp-a1');
  });

  it('preferred のワークスペースにスペースが無ければ、次のワークスペースへ進む', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([WS_A, WS_B]);
    hoisted.fetchMySpaces.mockImplementation(async (slug: string) =>
      slug === 'a' ? [] : [SPACE_B1],
    );

    const id = await resolveEntryKbSpaceId('a');

    expect(id).toBe('sp-b1');
  });

  it('どのワークスペースにもスペースが無ければ null', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([WS_A]);
    hoisted.fetchMySpaces.mockResolvedValue([]);

    expect(await resolveEntryKbSpaceId()).toBeNull();
  });
});

describe('resolveKbSpace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('spaceId からワークスペースを引く', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([WS_A, WS_B]);
    hoisted.fetchMySpaces.mockImplementation(async (slug: string) =>
      slug === 'a' ? [SPACE_A1] : [SPACE_B1],
    );

    const resolved = await resolveKbSpace('sp-b1');

    expect(resolved).toEqual({ workspaceSlug: 'b', space: SPACE_B1 });
  });

  it('見つからなければ null', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([WS_A]);
    hoisted.fetchMySpaces.mockResolvedValue([SPACE_A1]);

    expect(await resolveKbSpace('does-not-exist')).toBeNull();
  });
});
