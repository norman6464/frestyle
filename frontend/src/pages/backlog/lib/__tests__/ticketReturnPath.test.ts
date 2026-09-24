import { describe, expect, it } from 'vitest';
import { ticketReturnPath } from '../ticketReturnPath';

describe('ticketReturnPath', () => {
  it('自分の担当から来たら、そこへ「自分の担当に戻る」', () => {
    expect(ticketReturnPath('/assigned', 'p-1', 't-1')).toEqual({ to: '/assigned', label: '自分の担当に戻る' });
  });

  it('バックログから来たら、条件つきの URL のまま戻る', () => {
    const from = '/backlog/p-1?labelId=l-1&filter=f-1&ticket=t-1';
    expect(ticketReturnPath(from, 'p-1', 't-1')).toEqual({ to: from, label: 'バックログに戻る' });
  });

  it('ホームから来たら「ホームに戻る」', () => {
    expect(ticketReturnPath('/', 'p-1', 't-1')).toEqual({ to: '/', label: 'ホームに戻る' });
  });

  it('出どころが無ければ、そのプロジェクトのバックログへチケットを選んだ状態で戻る', () => {
    expect(ticketReturnPath(undefined, 'p-1', 't-1')).toEqual({ to: '/backlog/p-1?ticket=t-1', label: 'バックログ' });
  });

  it('別のサイトや知らない場所は使わない', () => {
    for (const from of ['//evil.example/x', 'https://evil.example/', '/settings', 42]) {
      expect(ticketReturnPath(from, 'p-1', 't-1').to).toBe('/backlog/p-1?ticket=t-1');
    }
  });
});
