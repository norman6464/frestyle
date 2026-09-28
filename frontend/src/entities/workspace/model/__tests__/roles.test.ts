import { describe, expect, it } from 'vitest';
import { GRANT_ROLE_LABEL, GRANT_ROLES_STRONGEST_FIRST, grantRoleDescription, grantRoleLabel } from '../roles';

describe('役割の呼び名', () => {
  it('画面には英語の値ではなく日本語の呼び名を出す', () => {
    expect(grantRoleLabel('admin')).toBe('管理者');
    expect(grantRoleLabel('editor')).toBe('編集者');
    expect(grantRoleLabel('commenter')).toBe('コメント可');
    expect(grantRoleLabel('viewer')).toBe('閲覧者');
  });

  it('知らない値は空欄にせずそのまま出す（読めない値だと気づけるように）', () => {
    expect(grantRoleLabel('owner')).toBe('owner');
    expect(grantRoleDescription('owner')).toBe('');
  });

  it('値が無いときは空文字', () => {
    expect(grantRoleLabel(undefined)).toBe('');
    expect(grantRoleLabel(null)).toBe('');
    expect(grantRoleLabel('')).toBe('');
  });

  it('できることの説明を持つ', () => {
    expect(grantRoleDescription('editor')).toBe('ページを作り、編集できる');
  });

  it('選択肢は強い順で、4 つの役割すべてに呼び名がある', () => {
    expect(GRANT_ROLES_STRONGEST_FIRST).toEqual(['admin', 'editor', 'commenter', 'viewer']);
    for (const role of GRANT_ROLES_STRONGEST_FIRST) {
      expect(GRANT_ROLE_LABEL[role]).not.toBe('');
    }
  });
});
