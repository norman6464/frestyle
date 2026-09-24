import { act, renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useBacklogUrlState } from '../useBacklogUrlState';

function wrapperAt(initial: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>;
  };
}

function renderAt(initial: string) {
  return renderHook(
    () => ({ state: useBacklogUrlState(), search: useLocation().search }),
    { wrapper: wrapperAt(initial) },
  );
}

describe('useBacklogUrlState', () => {
  it('絞り込みの解除は選択中のチケットと無関係なクエリを残す', () => {
    const { result } = renderAt('/backlog/s-1?ticket=t-9&statusId=st-1&typeId=ty-1&labelId=l-1&unassigned=1&overdue=1&q=x&from=home');
    act(() => result.current.state.clearFilters());
    expect(result.current.search).toBe('?ticket=t-9&from=home');
  });
  it('何も付いていない URL は既定（未選択・絞り込み無し）', () => {
    const { result } = renderAt('/backlog/s-1');
    expect(result.current.state).toMatchObject({ selectedId: null, statusId: null, assignedToMe: false });
  });

  it('URL から選択を読む', () => {
    const { result } = renderAt('/backlog/s-1?ticket=t-9');
    expect(result.current.state.selectedId).toBe('t-9');
  });

  // 面は経路（/backlog/:projectId/settings 等）が持つ。問い合わせに tab が残っていても
  // この hook は解釈しないし、消しもしない（知らない鍵には触らないため）。
  it('面は問い合わせに持たない', () => {
    const { result } = renderAt('/backlog/s-1?tab=statuses');
    expect(result.current.state).not.toHaveProperty('tab');
    expect(result.current.state).not.toHaveProperty('setTab');
  });

  it('選んだチケットを URL に載せ、他の項目は残す', () => {
    const { result } = renderAt('/backlog/s-1?statusId=st-1');
    act(() => result.current.state.selectTicket('t-9'));
    expect(result.current.search).toContain('ticket=t-9');
    expect(result.current.search).toContain('statusId=st-1');
  });

  it('既定の値は URL に書かない', () => {
    const { result } = renderAt('/backlog/s-1?ticket=t-9&statusId=st-1');
    act(() => result.current.state.selectTicket(null));
    act(() => result.current.state.setStatusId(null));
    expect(result.current.search).toBe('');
  });

  it('プロジェクトを移ったときは文脈ごと捨てる', () => {
    const { result } = renderAt('/backlog/s-1?statusId=st-1&assignedToMe=1&ticket=t-9');
    act(() => result.current.state.reset());
    expect(result.current.search).toBe('');
  });

  it('チケット以外のクエリには触らない', () => {
    const { result } = renderAt('/backlog/s-1?from=notification');
    act(() => result.current.state.selectTicket('t-9'));
    expect(result.current.search).toContain('from=notification');
  });

  it('URL から絞り込み(状態・種別・担当・期限切れ・題名検索)を読む', () => {
    const { result } = renderAt(
      '/backlog/s-1?statusId=st-1&typeId=ty-1&assignedToMe=1&overdue=1&q=%E8%AA%8D%E8%A8%BC',
    );
    expect(result.current.state).toMatchObject({
      statusId: 'st-1',
      typeId: 'ty-1',
      assignedToMe: true,
      overdue: true,
      unassigned: false,
      q: '認証',
    });
  });

  it('担当の絞り込みは assigneePrincipalId・unassigned・assignedToMe が互いに排他', () => {
    const { result } = renderAt('/backlog/s-1?assigneePrincipalId=p-1');
    act(() => result.current.state.setAssignedToMe(true));
    expect(result.current.state.assignedToMe).toBe(true);
    expect(result.current.state.assigneePrincipalId).toBeNull();

    act(() => result.current.state.setUnassigned(true));
    expect(result.current.state.unassigned).toBe(true);
    expect(result.current.state.assignedToMe).toBe(false);

    act(() => result.current.state.setAssigneePrincipalId('p-2'));
    expect(result.current.state.assigneePrincipalId).toBe('p-2');
    expect(result.current.state.unassigned).toBe(false);
  });

  it('reset は絞り込みも含めてすべて捨てる', () => {
    const { result } = renderAt('/backlog/s-1?statusId=st-1&assignedToMe=1&q=x');
    act(() => result.current.state.reset());
    expect(result.current.search).toBe('');
  });

  it('保存した絞り込みのタブは 1 回の更新で切り替わり、互いに排他', () => {
    const { result } = renderAt('/backlog/s-1?assignedToMe=1&statusId=st-1');
    expect(result.current.state.quickFilter).toBe('assignedToMe');

    act(() => result.current.state.setQuickFilter('overdue'));
    expect(result.current.state.quickFilter).toBe('overdue');
    expect(result.current.search).toContain('overdue=1');
    expect(result.current.search).not.toContain('assignedToMe');
    // 詳細条件（状態）はタブとは別の軸なので残る。
    expect(result.current.search).toContain('statusId=st-1');

    act(() => result.current.state.setQuickFilter('unassigned'));
    expect(result.current.search).toContain('unassigned=1');
    expect(result.current.search).not.toContain('overdue');

    act(() => result.current.state.setQuickFilter(null));
    expect(result.current.state.quickFilter).toBeNull();
    expect(result.current.search).toBe('?statusId=st-1');
  });

  it('URL に複数立っていても読みは 1 つに決める（assignedToMe → overdue → unassigned の順）', () => {
    const { result } = renderAt('/backlog/s-1?overdue=1&unassigned=1');
    expect(result.current.state.quickFilter).toBe('overdue');
  });

  it('条件が 1 つでも付いていれば filtered', () => {
    expect(renderAt('/backlog/s-1').result.current.state.filtered).toBe(false);
    expect(renderAt('/backlog/s-1?ticket=t-9').result.current.state.filtered).toBe(false);
    expect(renderAt('/backlog/s-1?labelId=l-1').result.current.state.filtered).toBe(true);
    expect(renderAt('/backlog/s-1?q=x').result.current.state.filtered).toBe(true);
  });

  it('担当の絞り込みは 4 通りを 1 つの値で読み書きする', () => {
    const { result } = renderAt('/backlog/s-1');
    expect(result.current.state.assignee).toEqual({ kind: 'any' });

    act(() => result.current.state.setAssignee({ kind: 'me' }));
    expect(result.current.state.assignee).toEqual({ kind: 'me' });
    expect(result.current.search).toBe('?assignedToMe=1');

    act(() => result.current.state.setAssignee({ kind: 'principal', id: 'p-1' }));
    expect(result.current.state.assignee).toEqual({ kind: 'principal', id: 'p-1' });
    expect(result.current.search).toBe('?assigneePrincipalId=p-1');

    act(() => result.current.state.setAssignee({ kind: 'none' }));
    expect(result.current.search).toBe('?unassigned=1');

    act(() => result.current.state.setAssignee({ kind: 'any' }));
    expect(result.current.search).toBe('');
  });

  describe('保存した絞り込み', () => {
    const saved = {
      id: 'f-1',
      name: '自分の不具合',
      statusId: 'st-1',
      typeId: null,
      labelId: 'l-1',
      assigneePrincipalId: null,
      unassigned: false,
      assignedToMe: true,
      overdue: false,
      q: '検索',
      count: 2,
      createdAt: '',
      updatedAt: '',
    };

    it('選ぶと条件をすべて書き出し、filter に id を載せる。書いていない条件は外す', () => {
      const { result } = renderAt('/backlog/s-1?typeId=ty-9&overdue=1&unassigned=1&ticket=t-9');
      act(() => result.current.state.applySavedFilter(saved));
      expect(result.current.state).toMatchObject({
        savedFilterId: 'f-1',
        statusId: 'st-1',
        typeId: null,
        labelId: 'l-1',
        assignedToMe: true,
        unassigned: false,
        overdue: false,
        q: '検索',
        selectedId: 't-9',
      });
    });

    it('条件のどれかを手で変えると選択が外れる（保存したものと違う条件を同じ名前で見せない）', () => {
      const { result } = renderAt('/backlog/s-1?filter=f-1&statusId=st-1&assignedToMe=1');
      expect(result.current.state.savedFilterId).toBe('f-1');
      act(() => result.current.state.setStatusId(null));
      expect(result.current.state.savedFilterId).toBeNull();
      expect(result.current.state.assignedToMe).toBe(true);
    });

    it('固定のタブを押しても選択が外れる', () => {
      const { result } = renderAt('/backlog/s-1?filter=f-1&assignedToMe=1');
      act(() => result.current.state.setQuickFilter('overdue'));
      expect(result.current.state.savedFilterId).toBeNull();
      expect(result.current.state.quickFilter).toBe('overdue');
    });

    it('チケットの選択は条件ではないので選択が外れない', () => {
      const { result } = renderAt('/backlog/s-1?filter=f-1&assignedToMe=1');
      act(() => result.current.state.selectTicket('t-9'));
      expect(result.current.state.savedFilterId).toBe('f-1');
    });

    it('すべて解除・プロジェクトの切替で filter も消える', () => {
      const a = renderAt('/backlog/s-1?filter=f-1&assignedToMe=1&ticket=t-9');
      act(() => a.result.current.state.clearFilters());
      expect(a.result.current.search).toBe('?ticket=t-9');

      const b = renderAt('/backlog/s-1?filter=f-1&assignedToMe=1&ticket=t-9');
      act(() => b.result.current.state.reset());
      expect(b.result.current.search).toBe('');
    });
  });
});
