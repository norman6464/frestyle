/** 本文の見出し 1 つ。目次の行になる。 */
export interface DocHeading {
  /** ブロックの id（保存済みの本文には付いている。無い古い本文では undefined）。 */
  id?: string;
  /** 見出しの段（1〜3）。目次では 1 段目を基準に字下げする。 */
  level: number;
  text: string;
  /** 本文の中で何番目の見出しか（0 始まり）。id が無い本文で飛び先を探すのに使う。 */
  index: number;
}

interface DocNode {
  type?: string;
  attrs?: Record<string, unknown>;
  text?: string;
  content?: DocNode[];
}

/** 見出しの中の文字を全部つなぐ（太字やリンクで分かれていても 1 行の題にする）。 */
function textOf(node: DocNode): string {
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map(textOf).join('');
}

/**
 * extractHeadings は本文（tiptap の doc JSON）から見出しだけを順に取り出す。
 *
 * 目次は見出し 1〜3 段まで。4 段以降は本文の中の細かい区切りで、目次に並べると
 * 行が増えるだけで見通しが悪くなる。文字の無い見出し（打ちかけの空行）は飛ばす —
 * 目次に空の行が並ぶと、押しても何も起きないように見える。
 * 見出しは最上段にしか置けない（引用や表の中の見出しはスキーマが許さない）ので、
 * 最上段のブロックだけを見る。
 */
export function extractHeadings(doc: unknown): DocHeading[] {
  const root = doc as DocNode | null | undefined;
  if (!root || !Array.isArray(root.content)) return [];
  const out: DocHeading[] = [];
  for (const node of root.content) {
    if (node?.type !== 'heading') continue;
    const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1;
    if (level > 3) continue;
    const text = textOf(node).trim();
    if (text === '') continue;
    const id = typeof node.attrs?.id === 'string' ? node.attrs.id : undefined;
    out.push({ id, level, text, index: out.length });
  }
  return out;
}
