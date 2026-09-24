import { describe, expect, it } from 'vitest';
import { ticketLinkState } from '../ticketLinkState';

describe('ticketLinkState', () => {
  it('一覧からは、その場所（条件つき）を出発点にする', () => {
    expect(ticketLinkState({ pathname: '/backlog/p-1', search: '?labelId=l-1', state: null })).toEqual({
      from: '/backlog/p-1?labelId=l-1',
    });
    expect(ticketLinkState({ pathname: '/assigned', search: '', state: null })).toEqual({ from: '/assigned' });
  });

  it('票から票へ移るときは、最初の出発点を引き継ぐ', () => {
    expect(ticketLinkState({ pathname: '/tickets/t-1', search: '', state: { from: '/assigned' } })).toEqual({
      from: '/assigned',
    });
  });

  it('出発点を持たない票からは何も載せない（戻り先はそのチケットのバックログ）', () => {
    expect(ticketLinkState({ pathname: '/tickets/t-1', search: '', state: null })).toEqual({});
  });
});
