import { describe, expect, it } from 'vitest';
import { ADMIN, KB_API, TICKET_API, INVITATIONS, NOTIFICATIONS } from '../apiRoutes';

/**
 * apiRoutes.ts のパスパラメータはすべて encodeURIComponent を通す。通さないと、
 * パラメータの値（ワークスペースの slug・ページ ID 等、API から返った文字列がそのまま
 * URL に埋め込まれる）に `/`・`?`・`#` のような URL の構造を作る文字が混じったとき、
 * 意図しないパスへ経路が変わる・クエリ文字列が混入するといった壊れ方をする。
 *
 * 個々の関数を全部は列挙せず、パラメータの位置（末尾 / 途中 / 複数）が異なる代表例で
 * 「その関数が確かに encodeURIComponent を通しているか」を固定する。
 */
describe('apiRoutes のパスパラメータは encodeURIComponent を通す', () => {
  it('末尾のパラメータ（KB_API.workspace）', () => {
    expect(KB_API.workspace('a/b?c#d')).toBe('/api/v2/kb/workspaces/a%2Fb%3Fc%23d');
  });

  it('途中のパラメータ（KB_API.page の workspaceSlug）', () => {
    expect(KB_API.page('a/b', 'page-1')).toBe('/api/v2/kb/workspaces/a%2Fb/pages/page-1');
  });

  it('複数のパラメータ（TICKET_API.ticketComment）', () => {
    expect(TICKET_API.ticketComment('ws/1', 't#1', 'c?1')).toBe(
      '/api/v2/workspaces/ws%2F1/tickets/t%231/comments/c%3F1',
    );
  });

  it('数値パラメータも文字列化してから通す（ADMIN.member）', () => {
    expect(ADMIN.member(42)).toBe('/api/v2/admin/members/42');
  });

  it('通常の UUID・slug では見た目が変わらない（余計な壊し方をしない）', () => {
    const uuid = '0198a000-0000-7000-8000-000000000001';
    expect(KB_API.page('my-workspace', uuid)).toBe(`/api/v2/kb/workspaces/my-workspace/pages/${uuid}`);
  });

  it('スラッシュを含む値でも実際にパスの段数が増えない（構造を壊さない）', () => {
    // '/' を符号化しないと、狙った 1 segment のつもりが複数 segment に化ける。
    const url = KB_API.workspace('a/../b');
    const path = url.replace('/api/v2/kb/workspaces/', '');
    expect(path.split('/')).toHaveLength(1);
  });

  it('クエリ文字列に化ける文字も構造を壊さない（NOTIFICATIONS.read）', () => {
    const url = NOTIFICATIONS.read('1?evil=1');
    expect(url).not.toContain('?evil=1');
    expect(url).toContain('%3Fevil%3D1');
  });

  it('招待トークン（INVITATIONS.validateToken）も同じ扱い', () => {
    expect(INVITATIONS.validateToken('a b')).toBe('/api/v2/invitations/accept/a%20b');
  });
});
