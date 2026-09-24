import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BacklogList, { type BacklogListProps } from '../BacklogList';

const props: BacklogListProps = {
  groups: [], statuses: [], types: [], projectKey: 'TEST', loading: false, error: null,
  archived: false, canEdit: true, selectedId: null, busyId: null,
  nameOf: () => '', initialsOf: () => '', onSelect: vi.fn(), onCreate: vi.fn().mockResolvedValue(undefined),
  onChangeStatus: vi.fn(), onMove: vi.fn(), onRetry: vi.fn(),
};

describe('BacklogList の状態別の導線', () => {
  it('アーカイブが空の場合は作成を案内しない', () => {
    render(<BacklogList {...props} archived />);
    expect(screen.getByRole('heading', { name: 'アーカイブされたチケットはありません' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('絞り込みが空の場合は条件を見直せる', () => {
    render(<BacklogList {...props} filtered />);
    expect(screen.getByRole('heading', { name: '条件に合うチケットはありません' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('初めてのチケットは入力してボタンで作成できる', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<BacklogList {...props} onCreate={onCreate} />);
    fireEvent.change(screen.getByRole('textbox', { name: '新しいチケットの題名' }), { target: { value: 'はじめの作業' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('はじめの作業'));
  });
});

const ticket = {
  id: 't-1', workspaceId: 'w-1', projectId: 'p-1', number: 1, typeId: 'ty-1', statusId: 'st-1', parentId: null,
  title: '最初の作業', doc: null, priority: 2 as const, storyPoints: null, startDate: null, dueDate: null, teamId: null,
  position: 'a0', closedAt: null, resolution: null, createdByUserId: 1, archivedAt: null, createdAt: '', updatedAt: '',
  assigneePrincipalId: null, labels: [],
};
const oneGroup = [{ id: '__backlog__', kind: 'backlog' as const, name: 'バックログ', tickets: [ticket] }];

describe('BacklogList の件数の行', () => {
  it('件数は status で読み上げに通知し、取り直し中は一覧を消さず「更新中」を添える', () => {
    const { rerender } = render(<BacklogList {...props} groups={oneGroup} filtered totalCount={6} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('1 件の課題を表示・全 6 件');
    expect(status).not.toHaveTextContent('更新中');

    rerender(<BacklogList {...props} groups={oneGroup} filtered totalCount={6} loading />);
    expect(screen.getByRole('status')).toHaveTextContent('更新中');
    expect(screen.getByRole('table', { name: 'チケット' })).toHaveAttribute('aria-busy', 'true');
    // 行はそのまま見えている（読み込み表示に差し替えない）。
    expect(screen.getByText('最初の作業')).toBeInTheDocument();
  });

  it('件数の行の右端に渡された操作を置く', () => {
    render(<BacklogList {...props} groups={oneGroup} footerAction={<button type="button">この絞り込みを保存</button>} />);
    expect(screen.getByRole('button', { name: 'この絞り込みを保存' })).toBeInTheDocument();
  });
});
