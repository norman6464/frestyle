import { describe, it, expect } from 'vitest';
import { ticketKeys, type Ticket } from '@/entities/ticket';
import { sprintKeys } from '@/entities/sprint';
import { createTestQueryClient } from '@/test/queryClient';
import { reflectTicket, refreshTicketDerived } from '../ticketCache';

const ticket = (id: string, title = id) => ({ id, projectId: 'p-1', title }) as unknown as Ticket;

describe('reflectTicket', () => {
  it('そのチケットを載せている一覧すべてとチケットの画面へ新しい値を映し、載せていない一覧には触らない', async () => {
    const client = createTestQueryClient();
    const withIt = [ticket('t-1'), ticket('t-2')];
    const without = [ticket('t-2')];
    client.setQueryData(ticketKeys.list('acme', 'p-1', {}), withIt);
    client.setQueryData(ticketKeys.list('acme', 'p-1', { statusId: 's-1' }), withIt);
    client.setQueryData(ticketKeys.list('acme', 'p-1', { statusId: 's-2' }), without);
    client.setQueryData(ticketKeys.resolved('t-1'), { workspaceSlug: 'acme', ticket: ticket('t-1') });

    await reflectTicket(client, 'acme', 'p-1', 't-1', (t) => ({ ...t, title: '新しい題名' }));

    expect(client.getQueryData<Ticket[]>(ticketKeys.list('acme', 'p-1', {}))?.[0].title).toBe('新しい題名');
    expect(client.getQueryData<Ticket[]>(ticketKeys.list('acme', 'p-1', { statusId: 's-1' }))?.[0].title).toBe('新しい題名');
    expect(client.getQueryData(ticketKeys.list('acme', 'p-1', { statusId: 's-2' }))).toBe(without);
    expect(client.getQueryData<{ ticket: Ticket }>(ticketKeys.resolved('t-1'))?.ticket.title).toBe('新しい題名');
  });
});

describe('refreshTicketDerived', () => {
  it('件数・保存した絞り込み・状態と種別・担当・スプリントの件数を古くし、一覧には古い印だけ付ける', async () => {
    const client = createTestQueryClient();
    const keys = [
      ticketKeys.counts('acme', 'p-1'),
      ticketKeys.savedFilters('acme', 'p-1'),
      ticketKeys.statuses('acme', 'p-1'),
      ticketKeys.types('acme', 'p-1'),
      ticketKeys.assigned('acme'),
      ticketKeys.myAssigned(3),
      sprintKeys.list('acme', 'p-1'),
      ticketKeys.list('acme', 'p-1', {}),
    ];
    for (const key of keys) client.setQueryData(key, []);
    client.setQueryData(ticketKeys.counts('acme', 'p-2'), []);

    refreshTicketDerived(client, 'acme', 'p-1');

    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(ticketKeys.counts('acme', 'p-2'))?.isInvalidated).toBe(false);
  });
});
