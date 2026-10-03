import { describe, it, expect } from 'vitest';
import { generateHTML, generateJSON, getSchema, getText, getTextSerializersFromSchema } from '@tiptap/core';
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
  it('withBlockId を付けた種類だけが blocks の行になる（pageRef・ticketRef・mention・inlineMath・text・hardBreak・doc は行にならない）', () => {
    const schema = getSchema(createSchemaExtensions());
    for (const name of ['paragraph', 'heading', 'listItem', 'tableCell', 'image', 'horizontalRule', 'attachment', 'embed']) {
      expect(isBlockRowNodeType(schema.nodes[name]), name).toBe(true);
    }
    for (const name of ['doc', 'text', 'hardBreak', 'pageRef', 'ticketRef', 'mention', 'inlineMath']) {
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

describe('Attachment（添付）のスキーマ', () => {
  const extensions = createSchemaExtensions();
  const id = '0198a000-0000-7000-8000-0000000000c1';
  const parse = (html: string) => generateJSON(html, extensions).content ?? [];

  it('貼り付けた HTML から添付を読み、表示の写しを attrs に戻す', () => {
    const [node] = parse(
      `<div data-attachment data-attachment-id="${id}" data-page-id="p1" data-filename="議事録.pdf" data-content-type="application/pdf" data-size="2048">議事録.pdf</div>`,
    );
    expect(node).toMatchObject({
      type: 'attachment',
      attrs: { attachmentId: id, pageId: 'p1', filename: '議事録.pdf', contentType: 'application/pdf', size: 2048 },
    });
  });

  it.each([
    ['UUID でない', 'kb/ws/page/att/1.bin'],
    ['大文字の UUID', id.toUpperCase()],
    ['空', ''],
  ])('添付の ID が %s なら添付として取り込まない', (_name, attachmentId) => {
    const nodes = parse(`<div data-attachment data-attachment-id="${attachmentId}">a.pdf</div>`);
    expect(nodes.some((n) => n.type === 'attachment')).toBe(false);
  });

  it('添付の ID が無ければ添付として取り込まない', () => {
    const nodes = parse('<div data-attachment>a.pdf</div>');
    expect(nodes.some((n) => n.type === 'attachment')).toBe(false);
  });

  it.each([
    ['0', 0],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    [String(Number.MAX_SAFE_INTEGER + 2), null],
    ['-1', null],
    ['1.5', null],
    ['abc', null],
  ])('大きさ %s は %s として読む（安全な整数だけ）', (raw, expected) => {
    const [node] = parse(`<div data-attachment data-attachment-id="${id}" data-size="${raw}"></div>`);
    expect(node.attrs?.size).toBe(expected);
  });

  it('ファイル名が無ければ「添付ファイル」と描き、文字にもそう出す', () => {
    const html = generateHTML({ type: 'doc', content: [{ type: 'attachment', attrs: { attachmentId: id } }] }, extensions);
    expect(html).toContain('>添付ファイル<');
    expect(html).toContain(`data-attachment-id="${id}"`);
    expect(html).not.toContain('data-filename');
    const schema = getSchema(extensions);
    const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'attachment', attrs: { attachmentId: id } }] });
    expect(getText(doc, { textSerializers: getTextSerializersFromSchema(schema) })).toBe('添付ファイル');
  });

  it('ファイル名があれば名前を描く', () => {
    const html = generateHTML(
      { type: 'doc', content: [{ type: 'attachment', attrs: { attachmentId: id, filename: '見積.xlsx', size: 10 } }] },
      extensions,
    );
    expect(html).toContain('>見積.xlsx<');
    expect(html).toContain('data-size="10"');
  });
});

describe('Embed（埋め込み）のスキーマ', () => {
  const extensions = createSchemaExtensions();
  const parse = (html: string) => generateJSON(html, extensions).content ?? [];

  it('貼り付けた HTML から埋め込みを読む', () => {
    const [node] = parse('<div data-embed data-provider="youtube" data-video-id="dQw4w9WgXcQ" data-title="説明会">説明会</div>');
    expect(node).toMatchObject({ type: 'embed', attrs: { provider: 'youtube', videoId: 'dQw4w9WgXcQ', title: '説明会' } });
  });

  it.each([
    ['許可していない提供元', 'vimeo', 'dQw4w9WgXcQ'],
    ['動画の ID が短い', 'youtube', 'dQw4w9WgXc'],
    ['動画の ID に URL の続きを混ぜる', 'youtube', 'dQw4w9WgXcQ?autoplay=1'],
  ])('%s なら埋め込みとして取り込まない', (_name, provider, videoId) => {
    const nodes = parse(`<div data-embed data-provider="${provider}" data-video-id="${videoId}">x</div>`);
    expect(nodes.some((n) => n.type === 'embed')).toBe(false);
  });

  it('上限を超える題名は捨てる（埋め込みは残す）', () => {
    const long = 'あ'.repeat(201);
    const [node] = parse(`<div data-embed data-provider="youtube" data-video-id="dQw4w9WgXcQ" data-title="${long}"></div>`);
    expect(node).toMatchObject({ type: 'embed', attrs: { title: null } });
  });

  it('題名が無ければ「YouTube の動画」と描き、文字にもそう出す', () => {
    const json = { type: 'doc', content: [{ type: 'embed', attrs: { provider: 'youtube', videoId: 'dQw4w9WgXcQ' } }] };
    const html = generateHTML(json, extensions);
    expect(html).toContain('>YouTube の動画<');
    expect(html).toContain('data-video-id="dQw4w9WgXcQ"');
    const schema = getSchema(extensions);
    expect(getText(schema.nodeFromJSON(json), { textSerializers: getTextSerializersFromSchema(schema) })).toBe('YouTube の動画');
  });
});
