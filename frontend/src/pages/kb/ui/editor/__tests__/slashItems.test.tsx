import { describe, it, expect, vi } from 'vitest';
import { buildSlashItems, filterSlashItems } from '../slashItems';
import type { EditorCommand } from '../editorCommands';

describe('buildSlashItems', () => {
  it('ブロック変換＋挿入のコマンドを含み、マーク（太字等）と履歴は含まない', () => {
    const ids = buildSlashItems().map((item) => item.id);
    for (const id of ['heading1', 'heading2', 'heading3', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'horizontalRule']) {
      expect(ids).toContain(id);
    }
    for (const id of ['bold', 'italic', 'underline', 'strike', 'code', 'undo', 'redo']) {
      expect(ids).not.toContain(id);
    }
  });

  it('extra（画像など利用側のコマンド）を末尾に足せる', () => {
    const image: EditorCommand = { id: 'image', label: '画像', group: 'insert', glyph: '🖼', run: vi.fn() };
    const ids = buildSlashItems([image]).map((item) => item.id);
    expect(ids.at(-1)).toBe('image');
  });
});

describe('filterSlashItems（英単語トリガ）', () => {
  const items = buildSlashItems([
    { id: 'image', label: '画像', group: 'insert', glyph: '🖼', keywords: ['image', 'img', 'photo'], run: vi.fn() },
  ]);

  it('空クエリは全件', () => {
    expect(filterSlashItems(items, '')).toHaveLength(items.length);
  });

  it('h で見出しが前方一致で先頭に来る', () => {
    const ids = filterSlashItems(items, 'h').map((item) => item.id);
    expect(ids.slice(0, 4)).toEqual(['heading1', 'heading2', 'heading3', 'horizontalRule']);
  });

  it('image / img / photo で画像コマンドが出る', () => {
    for (const q of ['image', 'img', 'photo', 'IMA']) {
      expect(filterSlashItems(items, q).map((item) => item.id)).toContain('image');
    }
  });

  it('quote で引用が出る', () => {
    expect(filterSlashItems(items, 'quote').map((item) => item.id)).toContain('blockquote');
  });

  it('日本語ラベルでは照合しない（トリガは英単語のみ）', () => {
    expect(filterSlashItems(items, '画像')).toHaveLength(0);
    expect(filterSlashItems(items, '見出し')).toHaveLength(0);
  });

  it('一致なしは空配列', () => {
    expect(filterSlashItems(items, 'zzz')).toHaveLength(0);
  });
});
