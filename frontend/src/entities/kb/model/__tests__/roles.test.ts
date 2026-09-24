import { describe, expect, it } from 'vitest';
import { KB_ROLE_LABEL, KB_ROLES_STRONGEST_FIRST, kbRoleDescription, kbRoleLabel } from '../roles';

describe('役割の呼び名', () => {
  it('画面には英語の値ではなく日本語の呼び名を出す', () => {
    expect(kbRoleLabel('admin')).toBe('管理者');
    expect(kbRoleLabel('editor')).toBe('編集者');
    expect(kbRoleLabel('commenter')).toBe('コメント可');
    expect(kbRoleLabel('viewer')).toBe('閲覧者');
  });

  it('知らない値は空欄にせずそのまま出す（読めない値だと気づけるように）', () => {
    expect(kbRoleLabel('owner')).toBe('owner');
    expect(kbRoleDescription('owner')).toBe('');
  });

  it('値が無いときは空文字', () => {
    expect(kbRoleLabel(undefined)).toBe('');
    expect(kbRoleLabel(null)).toBe('');
    expect(kbRoleLabel('')).toBe('');
  });

  it('できることの説明を持つ', () => {
    expect(kbRoleDescription('editor')).toBe('ページを作り、編集できる');
  });

  it('選択肢は強い順で、4 つの役割すべてに呼び名がある', () => {
    expect(KB_ROLES_STRONGEST_FIRST).toEqual(['admin', 'editor', 'commenter', 'viewer']);
    for (const role of KB_ROLES_STRONGEST_FIRST) {
      expect(KB_ROLE_LABEL[role]).not.toBe('');
    }
  });
});
