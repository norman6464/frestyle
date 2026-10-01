import type { Editor } from '@tiptap/react';
import { type FormatIconName, type FsIconName } from '@/shared/ui';

import { LINK_MARK_NAME } from '@/shared/lib/linkSafety';
/**
 * EditorCommandGroup はコマンドの分類。UI（バブルメニュー・将来のスラッシュ/ツールバー）が
 * 「どのコマンドを出すか」を出し分けるために使う。
 * - mark: インラインのマーク（太字・斜体…）。選択テキストに掛ける
 * - turn: 現在ブロックの種類変換（見出し・リスト・引用・コードブロック）
 * - insert: カーソル位置への挿入（水平線…）
 * - history: 取り消し/やり直し
 */
export type EditorCommandGroup = 'mark' | 'turn' | 'insert' | 'history' | 'table' | 'block';

/**
 * EditorCommandIcon はコマンドを線のアイコンで出すときの指定。書式の記号（FormatIcon）か、
 * 製品のアイコン（FsIcon）のどちらかから選ぶ。指定があれば glyph（字面）より優先する。
 */
export type EditorCommandIcon = { set: 'format'; name: FormatIconName } | { set: 'fs'; name: FsIconName };

/**
 * EditorCommand はエディタの 1 操作を「データ」として表す記述子。
 * UI 側はこの配列を描画するだけにし、書式ロジックをレジストリへ一元化する
 * （＝バブルメニューにもスラッシュメニューにも、記述子を 1 つ足すだけで同じ操作が現れる）。
 */
export interface EditorCommand {
  /**
   * 一意 id（'bold' / 'heading1' / 'image' 等）。React key・テストのアンカーであり、
   * スラッシュコマンドの正規トリガ（英単語）も兼ねる（例: /bold・/heading1・/image）。
   */
  id: string;
  /** 日本語ラベル。アクセシブルネーム / tooltip / スラッシュメニューの表示名に共用する。 */
  label: string;
  /** 分類。 */
  group: EditorCommandGroup;
  /** ボタンに出す短い字面（B / I / H1 等）。icon が無いときに出す。絵文字は入れない。 */
  glyph: string;
  /** 線のアイコンで出すときの指定。字面にならない操作（チェックリスト・画像・元に戻す等）に使う。 */
  icon?: EditorCommandIcon;
  /** スラッシュ検索用キーワード（後続の '/' メニューで使う）。英単語のみ（日本語は入れない）。 */
  keywords?: string[];
  /** トグル状態（マーク・turn 系）。非トグル（insert/history）は未定義。 */
  isActive?: (editor: Editor) => boolean;
  /** 実行可否（undo/redo 等）。未定義なら常に実行可。 */
  isEnabled?: (editor: Editor) => boolean;
  /** 実行本体。フォーカス付き chain を内部で張って副作用を完結させる。 */
  run: (editor: Editor) => void;
}

// フォーカスを当ててから操作する（ボタン経由でも選択・キャレットを保って実行する）。
const focused = (editor: Editor) => editor.chain().focus();

/**
 * EDITOR_COMMANDS は RichTextEditor が提供する書式コマンドの正典（single source of truth）。
 * 新しい操作を足すときはこの配列に記述子を 1 つ加える（UI 側の分岐は増やさない）。
 */
export const EDITOR_COMMANDS: EditorCommand[] = [
  // --- インラインのマーク ---
  {
    id: 'bold',
    label: '太字',
    group: 'mark',
    glyph: 'B',
    keywords: ['bold', 'strong'],
    isActive: (editor) => editor.isActive('bold'),
    run: (editor) => focused(editor).toggleBold().run(),
  },
  {
    id: 'italic',
    label: '斜体',
    group: 'mark',
    glyph: 'I',
    keywords: ['italic', 'em'],
    isActive: (editor) => editor.isActive('italic'),
    run: (editor) => focused(editor).toggleItalic().run(),
  },
  {
    id: 'underline',
    label: '下線',
    group: 'mark',
    glyph: 'U',
    keywords: ['underline'],
    isActive: (editor) => editor.isActive('underline'),
    run: (editor) => focused(editor).toggleUnderline().run(),
  },
  {
    id: 'strike',
    label: '打ち消し線',
    group: 'mark',
    glyph: 'S',
    keywords: ['strike', 'strikethrough'],
    isActive: (editor) => editor.isActive('strike'),
    run: (editor) => focused(editor).toggleStrike().run(),
  },
  {
    id: 'code',
    label: 'インラインコード',
    group: 'mark',
    glyph: '</>',
    keywords: ['code', 'inline', 'inlinecode'],
    isActive: (editor) => editor.isActive('code'),
    run: (editor) => focused(editor).toggleCode().run(),
  },
  // --- ブロックの種類変換（turn into） ---
  {
    id: 'heading1',
    label: '見出し1',
    group: 'turn',
    glyph: 'H1',
    keywords: ['h1', 'heading1', 'heading', 'title'],
    isActive: (editor) => editor.isActive('heading', { level: 1 }),
    run: (editor) => focused(editor).toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'heading2',
    label: '見出し2',
    group: 'turn',
    glyph: 'H2',
    keywords: ['h2', 'heading2', 'heading', 'subtitle'],
    isActive: (editor) => editor.isActive('heading', { level: 2 }),
    run: (editor) => focused(editor).toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'heading3',
    label: '見出し3',
    group: 'turn',
    glyph: 'H3',
    keywords: ['h3', 'heading3', 'heading'],
    isActive: (editor) => editor.isActive('heading', { level: 3 }),
    run: (editor) => focused(editor).toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'bulletList',
    label: '箇条書き',
    group: 'turn',
    glyph: '•',
    keywords: ['bullet', 'bulletlist', 'list', 'ul', 'unordered'],
    isActive: (editor) => editor.isActive('bulletList'),
    run: (editor) => focused(editor).toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    label: '番号付きリスト',
    group: 'turn',
    glyph: '1.',
    keywords: ['ordered', 'orderedlist', 'number', 'numbered', 'list', 'ol'],
    isActive: (editor) => editor.isActive('orderedList'),
    run: (editor) => focused(editor).toggleOrderedList().run(),
  },
  {
    id: 'blockquote',
    label: '引用',
    group: 'turn',
    glyph: '“',
    keywords: ['quote', 'blockquote', 'citation'],
    isActive: (editor) => editor.isActive('blockquote'),
    run: (editor) => focused(editor).toggleBlockquote().run(),
  },
  {
    id: 'codeBlock',
    label: 'コードブロック',
    group: 'turn',
    glyph: '{ }',
    keywords: ['codeblock', 'pre', 'fence'],
    isActive: (editor) => editor.isActive('codeBlock'),
    run: (editor) => focused(editor).toggleCodeBlock().run(),
  },
  // --- カーソル位置への挿入 ---
  {
    id: 'taskList',
    label: 'タスクリスト',
    group: 'turn',
    glyph: 'チェック',
    icon: { set: 'fs', name: 'clipboard-check' },
    keywords: ['task', 'tasklist', 'todo', 'check', 'checkbox', 'checklist'],
    isActive: (editor) => editor.isActive('taskList'),
    run: (editor) => focused(editor).toggleTaskList().run(),
  },
  {
    id: 'table',
    label: '表',
    group: 'insert',
    glyph: '表',
    icon: { set: 'fs', name: 'grid' },
    keywords: ['table', 'grid'],
    run: (editor) => focused(editor).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'horizontalRule',
    label: '水平線',
    group: 'insert',
    glyph: '—',
    keywords: ['hr', 'rule', 'divider', 'separator'],
    run: (editor) => focused(editor).setHorizontalRule().run(),
  },
  // --- 履歴 ---
  {
    id: 'undo',
    label: '元に戻す',
    group: 'history',
    glyph: '戻す',
    icon: { set: 'format', name: 'undo' },
    keywords: ['undo'],
    isEnabled: (editor) => editor.can().undo(),
    run: (editor) => focused(editor).undo().run(),
  },
  {
    id: 'redo',
    label: 'やり直す',
    group: 'history',
    glyph: 'やり直す',
    icon: { set: 'format', name: 'redo' },
    keywords: ['redo'],
    isEnabled: (editor) => editor.can().redo(),
    run: (editor) => focused(editor).redo().run(),
  },
  // --- 表の操作（カーソルが表の中にあるときだけ実行できる） ---
  // 表の中にいなければ tiptap の can() が false を返すので、吹き出しは押せない状態になり、
  // '/' メニューは候補から外す（availableSlashItems）。字面は「どこに何をするか」が
  // 一目で分かる短い日本語＋矢印にし、読み上げ名（label）は文として書く。
  {
    id: 'addRowBefore',
    label: '上に行を足す',
    group: 'table',
    glyph: '↑行',
    keywords: ['row', 'rowabove', 'addrowbefore'],
    isEnabled: (editor) => editor.can().addRowBefore(),
    run: (editor) => focused(editor).addRowBefore().run(),
  },
  {
    id: 'addRowAfter',
    label: '下に行を足す',
    group: 'table',
    glyph: '↓行',
    keywords: ['row', 'rowbelow', 'addrowafter'],
    isEnabled: (editor) => editor.can().addRowAfter(),
    run: (editor) => focused(editor).addRowAfter().run(),
  },
  {
    id: 'addColumnBefore',
    label: '左に列を足す',
    group: 'table',
    glyph: '←列',
    keywords: ['column', 'col', 'columnleft', 'addcolumnbefore'],
    isEnabled: (editor) => editor.can().addColumnBefore(),
    run: (editor) => focused(editor).addColumnBefore().run(),
  },
  {
    id: 'addColumnAfter',
    label: '右に列を足す',
    group: 'table',
    glyph: '→列',
    keywords: ['column', 'col', 'columnright', 'addcolumnafter'],
    isEnabled: (editor) => editor.can().addColumnAfter(),
    run: (editor) => focused(editor).addColumnAfter().run(),
  },
  {
    id: 'deleteRow',
    label: '行を消す',
    group: 'table',
    glyph: '−行',
    keywords: ['deleterow', 'removerow'],
    isEnabled: (editor) => editor.can().deleteRow(),
    run: (editor) => focused(editor).deleteRow().run(),
  },
  {
    id: 'deleteColumn',
    label: '列を消す',
    group: 'table',
    glyph: '−列',
    keywords: ['deletecolumn', 'removecolumn'],
    isEnabled: (editor) => editor.can().deleteColumn(),
    run: (editor) => focused(editor).deleteColumn().run(),
  },
  {
    id: 'toggleHeaderRow',
    label: '見出し行の切り替え',
    group: 'table',
    glyph: '見出し行',
    keywords: ['header', 'headerrow', 'toggleheaderrow'],
    isEnabled: (editor) => editor.can().toggleHeaderRow(),
    run: (editor) => focused(editor).toggleHeaderRow().run(),
  },
  {
    id: 'mergeOrSplit',
    label: 'セルを結合／分割',
    group: 'table',
    glyph: '結合',
    keywords: ['merge', 'split', 'mergecells', 'splitcell'],
    // 複数のセルを選んでいれば結合、結合済みのセルなら分割。どちらでもなければ押せない。
    isEnabled: (editor) => editor.can().mergeOrSplit(),
    run: (editor) => focused(editor).mergeOrSplit().run(),
  },
  {
    id: 'deleteTable',
    label: '表を消す',
    group: 'table',
    glyph: '×表',
    keywords: ['deletetable', 'removetable'],
    isEnabled: (editor) => editor.can().deleteTable(),
    run: (editor) => focused(editor).deleteTable().run(),
  },
  // --- ブロックの操作（いちばん外のブロック単位。取っ手のメニュー・'/'・Alt+↑↓ が同じ命令を呼ぶ） ---
  {
    id: 'moveBlockUp',
    label: '上へ移動',
    group: 'block',
    glyph: '↑',
    icon: { set: 'fs', name: 'arrow-up' },
    keywords: ['moveup', 'up'],
    isEnabled: (editor) => editor.can().moveBlockUp(),
    run: (editor) => focused(editor).moveBlockUp().run(),
  },
  {
    id: 'moveBlockDown',
    label: '下へ移動',
    group: 'block',
    glyph: '↓',
    icon: { set: 'fs', name: 'arrow-down' },
    keywords: ['movedown', 'down'],
    isEnabled: (editor) => editor.can().moveBlockDown(),
    run: (editor) => focused(editor).moveBlockDown().run(),
  },
  {
    id: 'duplicateBlock',
    label: '複製',
    group: 'block',
    glyph: '複製',
    keywords: ['duplicate', 'copy', 'clone'],
    isEnabled: (editor) => editor.can().duplicateBlock(),
    run: (editor) => focused(editor).duplicateBlock().run(),
  },
  {
    id: 'deleteBlock',
    label: 'ブロックを削除',
    group: 'block',
    glyph: '削除',
    keywords: ['delete', 'remove', 'deleteblock'],
    isEnabled: (editor) => editor.can().deleteBlock(),
    run: (editor) => focused(editor).deleteBlock().run(),
  },
];

/*
 * --- リンク操作 ---
 *
 * リンクだけは EDITOR_COMMANDS（記述子の配列）に載せず、専用の関数として置く。
 * 記述子の実行本体は `run(editor)` という「引数を取らない」形で、太字やリストのように
 * その場で完結する操作を前提にしている。リンクは掛ける先の URL を人から受け取る必要があり、
 * この形に収まらない。無理に載せるより、入力を伴う操作として別に書くほうが素直に読める。
 * 掛ける・外す（applyLink / removeLink）は shared/lib/editorLink にある。バックログの本文エディタも
 * 同じ LinkUrlForm を通して呼ぶので、ナレッジ専用のここには置かない。ここに残るのは、書式の
 * 吹き出しが「いま掛かっている URL」を知るための activeLinkHref だけ。
 */

/** activeLinkHref はキャレット / 選択範囲に掛かっているリンクの href を返す（無ければ null）。 */
export function activeLinkHref(editor: Editor): string | null {
  const href: unknown = editor.getAttributes(LINK_MARK_NAME).href;
  return typeof href === 'string' ? href : null;
}

/**
 * getEditorCommands は指定グループのコマンドだけを、EDITOR_COMMANDS の並び順のまま返す。
 * 引数なしなら全件。UI（バブル=mark+turn 等）の出し分けに使う。
 */
export function getEditorCommands(...groups: EditorCommandGroup[]): EditorCommand[] {
  if (groups.length === 0) return EDITOR_COMMANDS;
  const wanted = new Set(groups);
  return EDITOR_COMMANDS.filter((command) => wanted.has(command.group));
}
