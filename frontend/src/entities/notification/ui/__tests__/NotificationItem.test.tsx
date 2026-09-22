import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotificationItem from '../NotificationItem';
import type { Notification } from '../../model/types';

/**
 * backend の形に合わせる（本文は message ではなく body）。
 *
 * 種別に実在の値を書かないのは、いま backend に通知を作る usecase が 1 つも無く、
 * 「実際に届く種別」がまだ存在しないため。Type は自由文字列なので、ここでは
 * 素性の分かる仮の値を使い、**種別文字列がそのまま出る**ことだけを確かめる。
 */
function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 1,
    type: 'sample_type',
    title: 'コメントに返信がありました',
    body: '「設計メモ」のコメントに返信が付きました。',
    isRead: false,
    linkPath: '',
    createdAt: '2026-08-02T10:00:00Z',
    ...overrides,
  };
}

function renderItem(overrides: Partial<Notification> = {}) {
  const onMarkAsRead = vi.fn();
  render(
    <MemoryRouter>
      <NotificationItem notification={makeNotification(overrides)} onMarkAsRead={onMarkAsRead} />
    </MemoryRouter>,
  );
  return { onMarkAsRead };
}

describe('NotificationItem', () => {
  it('本文を表示する', () => {
    renderItem();

    expect(
      screen.getByText('「設計メモ」のコメントに返信が付きました。'),
    ).toBeInTheDocument();
  });

  it('タイトルを表示する', () => {
    renderItem();

    expect(screen.getByText('コメントに返信がありました')).toBeInTheDocument();
    expect(screen.getByText('未読')).toBeInTheDocument();
  });

  /*
   * 日本語ラベルを当てる対応表はいま空（backend に通知を作る usecase が無く、実在する
   * 種別がまだ無いため）。したがって、どの種別で来ても種別文字列がそのまま出るのが正。
   * 対応表に実在の種別を足したときは、その種別のラベルを確かめるテストをここに足す。
   */
  it('ラベルの無い種別は種別文字列をそのまま表示する', () => {
    renderItem({ type: 'unknown_type' });

    expect(screen.getByText('unknown_type')).toBeInTheDocument();
  });

  it('本文が空でもタイトルは表示する', () => {
    renderItem({ body: '' });

    expect(screen.getByText('コメントに返信がありました')).toBeInTheDocument();
  });

  describe('既読の操作', () => {
    it('未読なら既読ボタンを出し、押すと id を渡す', () => {
      const { onMarkAsRead } = renderItem({ id: 42, isRead: false });

      fireEvent.click(screen.getByRole('button', { name: '既読にする' }));

      expect(onMarkAsRead).toHaveBeenCalledWith(42);
    });

    it('既読なら既読ボタンを出さない', () => {
      renderItem({ isRead: true });

      expect(screen.queryByRole('button', { name: '既読にする' })).not.toBeInTheDocument();
      expect(screen.getByText('既読')).toBeInTheDocument();
    });

    it('更新中は既読ボタンを無効にする', () => {
      const onMarkAsRead = vi.fn();
      render(
        <MemoryRouter>
          <NotificationItem notification={makeNotification()} onMarkAsRead={onMarkAsRead} disabled />
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByRole('button', { name: '既読にする' }));
      expect(onMarkAsRead).not.toHaveBeenCalled();
    });
  });

  describe('飛び先', () => {
    it('linkPath があれば題名が目的地へのリンクになる', () => {
      renderItem({ linkPath: '/tickets/t-1' });
      expect(screen.getByRole('link', { name: 'コメントに返信がありました' })).toHaveAttribute('href', '/tickets/t-1');
    });

    it('リンクを押すと既読にしてから遷移する（未読のとき）', () => {
      const { onMarkAsRead } = renderItem({ id: 9, isRead: false, linkPath: '/tickets/t-1' });
      fireEvent.click(screen.getByRole('link', { name: 'コメントに返信がありました' }));
      expect(onMarkAsRead).toHaveBeenCalledWith(9);
    });

    it('既読ならリンクを押しても既読化を呼ばない（無駄な往復をしない）', () => {
      const { onMarkAsRead } = renderItem({ isRead: true, linkPath: '/tickets/t-1' });
      fireEvent.click(screen.getByRole('link', { name: 'コメントに返信がありました' }));
      expect(onMarkAsRead).not.toHaveBeenCalled();
    });

    it('linkPath が空なら題名は文字のまま（飛び先の無い種別）', () => {
      renderItem({ linkPath: '' });
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.getByText('コメントに返信がありました')).toBeInTheDocument();
    });

    it('linkPath が無い旧応答でも壊れず、題名は文字のまま（backend より先に出しても安全）', () => {
      renderItem({ linkPath: undefined });
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.getByText('コメントに返信がありました')).toBeInTheDocument();
    });

    it('外部 URL への誘導はリンクにしない（backend の CHECK と同じ規則を画面でも守る）', () => {
      renderItem({ linkPath: '//evil.example' });
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
  });
});
