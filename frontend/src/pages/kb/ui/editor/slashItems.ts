import { getEditorCommands, type EditorCommand } from './editorCommands';

/**
 * buildSlashItems は '/' メニューに出すコマンド一覧を組み立てる。
 *
 * ベースはコマンドレジストリのブロック変換（turn）と挿入（insert）。マーク（太字等）は
 * 選択済みテキストに掛けるものなのでバブルメニューに任せ、'/' には出さない。
 * extra には利用側だけが知る操作（例: 画像アップロード）を差し込める。
 */
export function buildSlashItems(extra: EditorCommand[] = []): EditorCommand[] {
  return [...getEditorCommands('turn', 'insert'), ...extra];
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
