import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TicketSavedFilter } from '@/entities/ticket';
import BacklogQuickFilters from '../BacklogQuickFilters';

const counts = { total: 10, assignedToMe: 3, overdue: 1, unassigned: 2 };

const savedFilter = (over: Partial<TicketSavedFilter> & { id: string; name: string }): TicketSavedFilter => ({
  statusId: null,
  typeId: null,
  labelId: null,
  assigneePrincipalId: null,
  unassigned: false,
  assignedToMe: false,
  overdue: false,
  q: null,
  count: 0,
  createdAt: '2026-09-24T00:00:00Z',
  updatedAt: '2026-09-24T00:00:00Z',
  ...over,
});

describe('BacklogQuickFilters', () => {
  it('「すべて」と 3 つのタブを出し、件数を添える', () => {
    render(<BacklogQuickFilters counts={counts} value={null} filtered={false} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /自分の担当/ })).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: /期限切れ/ })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /未割り当て/ })).toHaveTextContent('2');
  });

  it('選ばれているタブだけが押された状態になる', () => {
    render(<BacklogQuickFilters counts={counts} value="overdue" filtered onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /期限切れ/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /自分の担当/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('状態などの細かい条件だけが付いているときは「すべて」も押された表示にしない', () => {
    render(<BacklogQuickFilters counts={counts} value={null} filtered onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('押すとその種類を通知し、押されているものをもう一度押すと解除になる', () => {
    const onChange = vi.fn();
    const { rerender } = render(<BacklogQuickFilters counts={counts} value={null} filtered={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /未割り当て/ }));
    expect(onChange).toHaveBeenLastCalledWith('unassigned');

    rerender(<BacklogQuickFilters counts={counts} value="unassigned" filtered onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /未割り当て/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByRole('button', { name: 'すべて' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('期限切れが 1 件以上のときだけ赤で出す', () => {
    const { unmount } = render(
      <BacklogQuickFilters counts={{ ...counts, overdue: 2 }} value={null} filtered={false} onChange={vi.fn()} />,
    );
    // 同じ数字が他のタブにも出ることがあるので、期限切れのボタンの中で探す。
    expect(within(screen.getByRole('button', { name: /期限切れ/ })).getByText('2')).toHaveClass('text-danger-ink');
    expect(within(screen.getByRole('button', { name: /未割り当て/ })).getByText('2')).not.toHaveClass('text-danger-ink');
    unmount();

    render(<BacklogQuickFilters counts={{ ...counts, overdue: 0 }} value={null} filtered={false} onChange={vi.fn()} />);
    expect(within(screen.getByRole('button', { name: /期限切れ/ })).getByText('0')).not.toHaveClass('text-danger-ink');
  });

  it('件数がまだ取れていなければ数字を出さず、タブだけ出す', () => {
    render(<BacklogQuickFilters counts={null} value={null} filtered={false} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '自分の担当' })).toBeInTheDocument();
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it('件数の取得に失敗したら数字の代わりに — を出す（0 件と取り違えない）', () => {
    render(<BacklogQuickFilters counts={counts} countsFailed value={null} filtered={false} onChange={vi.fn()} />);
    const tab = screen.getByRole('button', { name: /自分の担当/ });
    expect(within(tab).getByLabelText('件数を取得できませんでした')).toHaveTextContent('—');
    expect(within(tab).queryByText('3')).toBeNull();
  });

  describe('利用者が保存した絞り込み', () => {
    const saved = [
      savedFilter({ id: 'f-1', name: '自分の不具合', labelId: 'l-1', assignedToMe: true, count: 4 }),
      savedFilter({ id: 'f-2', name: '期限切れの検索', overdue: true, q: '検索', count: 0 }),
    ];

    it('固定のタブの後ろに作った順で並び、件数を添える', () => {
      render(
        <BacklogQuickFilters counts={counts} value={null} filtered={false} onChange={vi.fn()} savedFilters={saved} />,
      );
      const buttons = screen.getAllByRole('button', { pressed: false }).map((b) => b.textContent);
      expect(buttons.indexOf('未割り当て2')).toBeLessThan(buttons.indexOf('自分の不具合4'));
      expect(buttons.indexOf('自分の不具合4')).toBeLessThan(buttons.indexOf('期限切れの検索0'));
    });

    it('選んでいる保存した絞り込みだけが押され、同じ条件を含む固定のタブは押されない', () => {
      render(
        <BacklogQuickFilters
          counts={counts}
          value="assignedToMe"
          filtered
          onChange={vi.fn()}
          savedFilters={saved}
          savedFilterId="f-1"
        />,
      );
      expect(screen.getByRole('button', { name: /^自分の不具合(?! の操作)/ })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: /^自分の担当/ })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('押すとその絞り込みを通知し、押されているものをもう一度押すと解除（null）', () => {
      const onSelectSaved = vi.fn();
      const { rerender } = render(
        <BacklogQuickFilters
          counts={counts}
          value={null}
          filtered={false}
          onChange={vi.fn()}
          savedFilters={saved}
          onSelectSaved={onSelectSaved}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /^期限切れの検索(?! の操作)/ }));
      expect(onSelectSaved).toHaveBeenLastCalledWith(saved[1]);

      rerender(
        <BacklogQuickFilters
          counts={counts}
          value="overdue"
          filtered
          onChange={vi.fn()}
          savedFilters={saved}
          savedFilterId="f-2"
          onSelectSaved={onSelectSaved}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /^期限切れの検索(?! の操作)/ }));
      expect(onSelectSaved).toHaveBeenLastCalledWith(null);
    });

    it('「…」から名前の変更と削除へ進める', async () => {
      const onRenameSaved = vi.fn().mockResolvedValue(undefined);
      const onDeleteSaved = vi.fn();
      render(
        <BacklogQuickFilters
          counts={counts}
          value={null}
          filtered={false}
          onChange={vi.fn()}
          savedFilters={saved}
          onRenameSaved={onRenameSaved}
          onDeleteSaved={onDeleteSaved}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: '自分の不具合 の操作' }));
      fireEvent.click(screen.getByRole('button', { name: '削除' }));
      expect(onDeleteSaved).toHaveBeenCalledWith(saved[0]);

      fireEvent.click(screen.getByRole('button', { name: '自分の不具合 の操作' }));
      fireEvent.click(screen.getByRole('button', { name: '名前を変える' }));
      const input = screen.getByRole('textbox', { name: '絞り込みの名前' });
      expect(input).toHaveValue('自分の不具合');
      fireEvent.change(input, { target: { value: '自分の不具合（急ぎ）' } });
      fireEvent.click(screen.getByRole('button', { name: '名前を変える' }));
      await vi.waitFor(() => expect(onRenameSaved).toHaveBeenCalledWith(saved[0], '自分の不具合（急ぎ）'));
      // 終わったら入力欄は閉じ、タブへ戻る。
      await vi.waitFor(() => expect(screen.queryByRole('textbox', { name: '絞り込みの名前' })).toBeNull());
      expect(screen.getByRole('button', { name: /^自分の不具合(?! の操作)/ })).toHaveFocus();
    });

    it('保存した絞り込みの件数の取り直しに失敗したら — を出す', () => {
      render(
        <BacklogQuickFilters
          counts={counts}
          value={null}
          filtered={false}
          onChange={vi.fn()}
          savedFilters={saved}
          savedCountsFailed
        />,
      );
      expect(within(screen.getByRole('button', { name: /^自分の不具合(?! の操作)/ })).getByLabelText('件数を取得できませんでした')).toBeInTheDocument();
    });
  });
});
