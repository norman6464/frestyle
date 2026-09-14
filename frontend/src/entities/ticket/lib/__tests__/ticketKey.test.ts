import { describe, it, expect } from 'vitest';
import { formatTicketKey, parseTicketKey } from '../ticketKey';

describe('formatTicketKey', () => {
  it('projectKey を大文字化して number をハイフンで繋ぐ', () => {
    expect(formatTicketKey('frestyle', 457)).toBe('FRESTYLE-457');
  });
});

describe('parseTicketKey', () => {
  it('末尾のハイフンで projectKey と number に分解する', () => {
    expect(parseTicketKey('FRESTYLE-457')).toEqual({ projectKey: 'FRESTYLE', number: 457 });
  });

  it('projectKey 自体にハイフンを含む場合も最後のハイフンで割る', () => {
    expect(parseTicketKey('my-app-12')).toEqual({ projectKey: 'my-app', number: 12 });
  });

  it('ハイフンが無ければ null', () => {
    expect(parseTicketKey('FRESTYLE457')).toBeNull();
  });

  it('数字部分が無ければ null', () => {
    expect(parseTicketKey('FRESTYLE-')).toBeNull();
  });

  it('数字以外を含む末尾なら null', () => {
    expect(parseTicketKey('FRESTYLE-12a')).toBeNull();
  });

  it('先頭がハイフンなら null（projectKey が空）', () => {
    expect(parseTicketKey('-12')).toBeNull();
  });
});
