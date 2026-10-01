import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getSchema } from '@tiptap/core';
import type { NodeType } from '@tiptap/pm/model';
import { createSchemaExtensions, isBlockRowNodeType } from '../schemaExtensions';

/**
 * 契約ファイルはリポジトリ直下。backend（internal/domain/block_contract_test.go）も同じファイルを読み、
 * 保存を許す種類と容器かどうかの表と突き合わせる。
 */
const CONTRACT_URL = new URL('../../../../../../../contracts/kb-block-types.json', import.meta.url);

interface Contract {
  blockTypes: { type: string; container: boolean }[];
}

/**
 * isContainer は、その種類が「中にブロックを持つ容器」かをスキーマの content 式から導く。
 * 葉は content が無い（image・horizontalRule）か、inline / text だけを持つ（paragraph・heading・
 * codeBlock）。それ以外（block+・listItem+・tableRow+ …）は中にブロックを持つ容器。
 *
 * backend の表の「容器かどうか」は手で書いた値なので、スキーマから導いた事実と突き合わせる
 * ことで、容器を葉として登録する間違い（保存は通るのに検索・コメント・被リンクが黙って壊れる）を
 * ここで止める。
 */
function isContainer(type: NodeType): boolean {
  const content = type.spec.content ?? '';
  return content !== '' && !/\b(?:inline|text)\b/.test(content);
}

describe('ブロックの種類の契約（contracts/kb-block-types.json）', () => {
  it('blocks の行になる種類と、容器かどうかが契約ファイルと一致する', () => {
    const contract = JSON.parse(readFileSync(fileURLToPath(CONTRACT_URL), 'utf8')) as Contract;
    expect(contract.blockTypes.length).toBeGreaterThan(0);
    expect(new Set(contract.blockTypes.map((entry) => entry.type)).size, '契約ファイルに重複が無い').toBe(
      contract.blockTypes.length,
    );

    const schema = getSchema(createSchemaExtensions());
    const fromSchema = Object.fromEntries(
      Object.values(schema.nodes)
        .filter(isBlockRowNodeType)
        .map((type) => [type.name, isContainer(type)]),
    );
    const fromContract = Object.fromEntries(contract.blockTypes.map((entry) => [entry.type, entry.container]));

    expect(fromSchema).toEqual(fromContract);
  });
});
