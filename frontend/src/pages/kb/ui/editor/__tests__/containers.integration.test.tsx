import { describe, it, expect, afterEach } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/react';
import { createEditorExtensions } from '../editorExtensions';
import { getEditorCommands } from '../editorCommands';
import { availableSlashItems, buildSlashItems } from '../slashItems';

/*
 * 容器（注意書き・折りたたみ・段組み）の命令と描画の契約。
 * 保存の形（容器かどうか）は契約ファイルのテストが、見た目は Storybook が見る。
 */

let editor: Editor | null = null;

function makeEditor(content: JSONContent): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions({ slashItems: buildSlashItems() }),
    content,
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

/** 文字 text を持つ段落の中にカーソルを置く。 */
function placeCursorIn(e: Editor, text: string) {
  let pos = -1;
  e.state.doc.descendants((node, nodePos) => {
    if (pos === -1 && node.isText && node.text === text) pos = nodePos + 1;
    return pos === -1;
  });
  if (pos === -1) throw new Error(`「${text}」が無い`);
  e.commands.setTextSelection(pos);
}

function findNodes(node: JSONContent, type: string): JSONContent[] {
  const found: JSONContent[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === type) found.push(n);
    n.content?.forEach(walk);
  };
  walk(node);
  return found;
}

describe('注意書き（callout）', () => {
  it('setCallout はいまのブロックを注意書きで包む。種類は既定で info', () => {
    const e = makeEditor(doc(paragraph('本文')));
    placeCursorIn(e, '本文');
    expect(e.commands.setCallout()).toBe(true);
    const [callout] = findNodes(e.getJSON(), 'callout');
    expect(callout.attrs?.kind).toBe('info');
    expect(callout.content?.[0]).toMatchObject({ type: 'paragraph' });
    expect(e.getHTML()).toContain('class="rte-callout"');
    expect(e.getHTML()).toContain('data-kind="info"');
  });

  it('setCalloutKind はカーソルを含む注意書きの種類を変え、注意書きの外では何もしない', () => {
    const e = makeEditor(doc({ type: 'callout', attrs: { kind: 'info' }, content: [paragraph('中')] }, paragraph('外')));
    placeCursorIn(e, '外');
    expect(e.can().setCalloutKind('warning')).toBe(false);
    placeCursorIn(e, '中');
    expect(e.commands.setCalloutKind('warning')).toBe(true);
    expect(findNodes(e.getJSON(), 'callout')[0].attrs?.kind).toBe('warning');
    // 知らない種類は info に落とす（保存側と同じ規則）。
    e.commands.setCalloutKind('neon' as never);
    expect(findNodes(e.getJSON(), 'callout')[0].attrs?.kind).toBe('info');
  });

  it('種類の切り替えの命令は注意書きの中でだけ使え、いまの種類が isActive になる', () => {
    const e = makeEditor(doc({ type: 'callout', attrs: { kind: 'danger' }, content: [paragraph('中')] }, paragraph('外')));
    const kinds = getEditorCommands('callout');
    expect(kinds.map((c) => c.id)).toEqual(['calloutKindInfo', 'calloutKindWarning', 'calloutKindDanger', 'calloutKindSuccess']);
    placeCursorIn(e, '外');
    expect(availableSlashItems(e, kinds)).toEqual([]);
    placeCursorIn(e, '中');
    expect(availableSlashItems(e, kinds).map((c) => c.id)).toEqual(kinds.map((c) => c.id));
    expect(kinds.find((c) => c.id === 'calloutKindDanger')?.isActive?.(e)).toBe(true);
    expect(kinds.find((c) => c.id === 'calloutKindInfo')?.isActive?.(e)).toBe(false);
  });

  it("'/' の挿入には 4 種の注意書きがあり、選んだ種類で包む", () => {
    const e = makeEditor(doc(paragraph('本文')));
    placeCursorIn(e, '本文');
    const items = buildSlashItems();
    const danger = items.find((c) => c.id === 'calloutDanger');
    expect(items.filter((c) => c.id.startsWith('callout') && c.group === 'insert').map((c) => c.id)).toEqual([
      'callout',
      'calloutWarning',
      'calloutDanger',
      'calloutSuccess',
    ]);
    danger!.run(e);
    expect(findNodes(e.getJSON(), 'callout')[0].attrs?.kind).toBe('danger');
  });
});

describe('段組み（columns）', () => {
  it('insertColumns は指定の列数（各列に空の段落）を入れる。範囲外の列数は 2 に丸める', () => {
    const e = makeEditor(doc(paragraph('本文')));
    placeCursorIn(e, '本文');
    expect(e.commands.insertColumns(3)).toBe(true);
    const [columns] = findNodes(e.getJSON(), 'columns');
    expect(columns.attrs?.count).toBe(3);
    expect(columns.content).toHaveLength(3);
    expect(columns.content?.every((c) => c.type === 'column' && c.content?.[0]?.type === 'paragraph')).toBe(true);
    expect(e.getHTML()).toContain('class="rte-columns"');
    expect(e.getHTML()).toContain('data-count="3"');

    const e2 = makeEditor(doc(paragraph('本文')));
    placeCursorIn(e2, '本文');
    e2.commands.insertColumns(7);
    expect(findNodes(e2.getJSON(), 'columns')[0].content).toHaveLength(2);
  });

  it('列の中には段組みも注意書きも入れ子にできない', () => {
    const e = makeEditor(
      doc({
        type: 'columns',
        attrs: { count: 2 },
        content: [
          { type: 'column', content: [paragraph('左')] },
          { type: 'column', content: [paragraph('右')] },
        ],
      }),
    );
    placeCursorIn(e, '左');
    expect(e.can().insertColumns(2)).toBe(false);
    expect(e.can().setCallout()).toBe(false);
    // 列の中でも、段落や見出しは置ける。
    expect(e.can().toggleHeading({ level: 2 })).toBe(true);
  });

  it("'/' に「2 列」「3 列」があり、段組みの中では出ない", () => {
    const items = buildSlashItems();
    expect(items.filter((c) => c.id.startsWith('columns')).map((c) => c.label)).toEqual(['2 列', '3 列']);
    const e = makeEditor(
      doc({
        type: 'columns',
        attrs: { count: 2 },
        content: [
          { type: 'column', content: [paragraph('左')] },
          { type: 'column', content: [paragraph('右')] },
        ],
      }),
    );
    placeCursorIn(e, '左');
    expect(availableSlashItems(e, items).some((c) => c.id.startsWith('columns'))).toBe(false);
  });
});

describe('折りたたみ（details）', () => {
  it("'/' の「折りたたみ」で要約と中身を持つ折りたたみが入り、開閉のボタンに日本語の名前が付く", () => {
    const e = makeEditor(doc(paragraph('本文')));
    document.body.appendChild(e.view.dom);
    placeCursorIn(e, '本文');
    const item = buildSlashItems().find((c) => c.id === 'details');
    expect(item).toBeDefined();
    item!.run(e);
    const [details] = findNodes(e.getJSON(), 'details');
    expect(details.content?.map((c) => c.type)).toEqual(['detailsSummary', 'detailsContent']);
    const toggle = e.view.dom.querySelector('[data-type="details"] > button');
    expect(toggle?.getAttribute('aria-label')).toBe('折りたたみを開く');
    e.view.dom.remove();
  });

  it('open は本文に保存される（書いた人が既定を決める）', () => {
    const e = makeEditor(
      doc({
        type: 'details',
        attrs: { open: true },
        content: [
          { type: 'detailsSummary', content: [{ type: 'text', text: '要約' }] },
          { type: 'detailsContent', content: [paragraph('中身')] },
        ],
      }),
    );
    expect(findNodes(e.getJSON(), 'details')[0].attrs?.open).toBe(true);
  });
});
