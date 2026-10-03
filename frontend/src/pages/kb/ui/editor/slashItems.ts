import type { Editor } from '@tiptap/react';
import { getEditorCommands, type EditorCommand } from './editorCommands';

/**
 * buildSlashItems は '/' メニューに出すコマンド一覧を組み立てる。
 *
 * ベースはコマンドレジストリのブロック変換（turn）・挿入（insert）・表の操作（table）・
 * ブロックの操作（block）・注意書きの種類（callout）。マーク（太字等）は選択済みテキストに掛けるものなのでバブルメニューに
 * 任せ、'/' には出さない。表の操作とブロックの操作は、吹き出しや取っ手をマウスで押せない人が
 * キーボードだけで届くように '/' にも載せる（その場で実行できないものは availableSlashItems が外す）。
 * extra には利用側だけが知る操作（例: 画像アップロード）を差し込める。
 */
export function buildSlashItems(extra: EditorCommand[] = []): EditorCommand[] {
  return [...getEditorCommands('turn', 'insert', 'table', 'block', 'callout'), ...extra];
}

/**
 * availableSlashItems は、いまのカーソル位置で実行できるコマンドだけに絞る。
 * isEnabled を持たないコマンド（見出し・リスト・挿入）は常に出す。表の操作のように
 * 場所に依るものは、押せない候補を並べて「選んだのに何も起きない」を起こさないために外す。
 */
export function availableSlashItems(editor: Editor, items: EditorCommand[]): EditorCommand[] {
  return items.filter((item) => item.isEnabled?.(editor) ?? true);
}

/**
 * filterSlashItems は '/' 直後に入力された query でコマンドを絞り込む。
 *
 * トリガは英単語のみ（id と keywords。日本語ラベルでは照合しない）。
 * 前方一致を優先し、次いで部分一致を並べる（/h → h1,h2,h3 が先頭に来る）。
 */
export function filterSlashItems(items: EditorCommand[], query: string): EditorCommand[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery === '') return items;

  const tokensOf = (item: EditorCommand): string[] =>
    [item.id.toLowerCase(), ...(item.keywords ?? []).map((keyword) => keyword.toLowerCase())];

  const prefix: EditorCommand[] = [];
  const partial: EditorCommand[] = [];
  for (const item of items) {
    const tokens = tokensOf(item);
    if (tokens.some((token) => token.startsWith(normalizedQuery))) prefix.push(item);
    else if (tokens.some((token) => token.includes(normalizedQuery))) partial.push(item);
  }
  return [...prefix, ...partial];
}
