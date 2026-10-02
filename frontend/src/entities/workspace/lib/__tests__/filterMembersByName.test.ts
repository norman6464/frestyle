import { describe, it, expect } from 'vitest';
import { filterMembersByName } from '../filterMembersByName';
import type { WorkspaceMember } from '../../model/types';

function member(over: Partial<WorkspaceMember> & { userId: number }): WorkspaceMember {
  return { principalId: `p-${over.userId}`, name: '', ...over };
}

describe('filterMembersByName', () => {
  it('query が空なら名前を引けた全員を返す', () => {
    const members = [member({ userId: 1, name: '田中 太郎' }), member({ userId: 2, name: '' })];
    expect(filterMembersByName(members, '')).toEqual([member({ userId: 1, name: '田中 太郎' })]);
  });

  it('前方一致を部分一致より先に並べる', () => {
    const members = [
      member({ userId: 1, name: '中村 一郎' }), // 部分一致（「村」を含む）
      member({ userId: 2, name: '村田 次郎' }), // 前方一致
    ];
    const result = filterMembersByName(members, '村');
    expect(result.map((m) => m.userId)).toEqual([2, 1]);
  });

  it('大文字小文字を区別しない', () => {
    const members = [member({ userId: 1, name: 'norman6464' })];
    expect(filterMembersByName(members, 'NORMAN')).toHaveLength(1);
  });

  it('名前を引けなかった行は候補に出さない', () => {
    const members = [member({ userId: 1, name: '' })];
    expect(filterMembersByName(members, '')).toEqual([]);
  });

  it('一致しなければ空', () => {
    const members = [member({ userId: 1, name: '田中 太郎' })];
    expect(filterMembersByName(members, '見つからない')).toEqual([]);
  });
});
