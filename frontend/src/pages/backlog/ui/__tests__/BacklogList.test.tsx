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
