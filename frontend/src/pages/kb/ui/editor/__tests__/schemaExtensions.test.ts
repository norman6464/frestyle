import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { blockRowNodeTypeNames, createSchemaExtensions, isBlockRowNodeType } from '../schemaExtensions';
import { createEditorExtensions } from '../editorExtensions';

/**
 * schemaSummary はスキーマの「意味のある部分」（ノード/マーク名・content 式・group・attrs 既定値・
 * excludes）だけを比較可能な形に落とす。toDOM 等の関数は同値比較できないため対象にしない。
 */
function schemaSummary(schema: ReturnType<typeof getSchema>) {
  return {
    nodes: Object.fromEntries(
      Object.entries(schema.nodes).map(([name, type]) => [
        name,
        {
          content: type.spec.content ?? null,
          group: type.spec.group ?? null,
          inline: type.spec.inline ?? false,
          attrs: Object.fromEntries(
            Object.entries(type.spec.attrs ?? {}).map(([attr, spec]) => [attr, spec.default]),
          ),
        },
      ]),
    ),
    marks: Object.fromEntries(
      Object.entries(schema.marks).map(([name, type]) => [name, { excludes: type.spec.excludes ?? null }]),
    ),
  };
}

describe('createSchemaExtensions', () => {
  it('エディタ拡張と同一スキーマになる（NodeView / input rule の上掛けはスキーマを変えない）', () => {
    const editorSchema = getSchema(createEditorExtensions());
    const schemaOnly = getSchema(createSchemaExtensions());
    expect(schemaSummary(editorSchema)).toEqual(schemaSummary(schemaOnly));
  });

  it('ノード名 heading / codeBlock・マーク code（excludes 解除）を既存 doc と互換のまま持つ', () => {
    const schema = getSchema(createSchemaExtensions());
    for (const name of ['heading', 'codeBlock', 'table', 'taskList', 'taskItem', 'image']) {
      expect(schema.nodes[name], name).toBeDefined();
    }
    // CombinableCode: 排他を解いて太字等と併用できる。
    expect(schema.marks.code.spec.excludes).toBe('');
  });

  it('heading は levels 1〜3 のまま', () => {
    const heading = createSchemaExtensions().find((extension) => extension.name === 'heading');
    expect(heading?.options.levels).toEqual([1, 2, 3]);
  });

  it('image: false でスキーマから画像ノードを外せる', () => {
    const schema = getSchema(createSchemaExtensions({ image: false }));
    expect(schema.nodes.image).toBeUndefined();
  });
});

describe('isBlockRowNodeType', () => {
  it('withBlockId を付けた種類だけが blocks の行になる（pageRef・ticketRef・text・hardBreak・doc は行にならない）', () => {
    const schema = getSchema(createSchemaExtensions());
    for (const name of ['paragraph', 'heading', 'listItem', 'tableCell', 'image', 'horizontalRule']) {
      expect(isBlockRowNodeType(schema.nodes[name]), name).toBe(true);
    }
    for (const name of ['doc', 'text', 'hardBreak', 'pageRef', 'ticketRef']) {
      expect(isBlockRowNodeType(schema.nodes[name]), name).toBe(false);
    }
  });

  it('名前の集合（doc JSON を歩くとき用）も同じ判定から導かれる', () => {
    const schema = getSchema(createSchemaExtensions());
    const names = blockRowNodeTypeNames();
    for (const type of Object.values(schema.nodes)) {
      expect(names.has(type.name), type.name).toBe(isBlockRowNodeType(type));
    }
  });
});
