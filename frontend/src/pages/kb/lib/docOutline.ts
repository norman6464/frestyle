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

/** 本文の木を歩く深さの上限（壊れた本文でスタックを使い切らないため。通常は数段）。 */
const MAX_WALK_DEPTH = 50;

/**
 * extractHeadings は本文（tiptap の doc JSON）から見出しだけを文書の順に取り出す。
 *
 * 目次は見出し 1〜3 段まで。4 段以降は本文の中の細かい区切りで、目次に並べると
 * 行が増えるだけで見通しが悪くなる。文字の無い見出し（打ちかけの空行）は飛ばす —
 * 目次に空の行が並ぶと、押しても何も起きないように見える。
 * 容器（注意書き・折りたたみ・段組み）の中の見出しも拾う（再帰）。閉じた折りたたみの
 * 中の見出しも目次には出す — 飛び先は KbTocPanel が data-block-id で引く。
 */
export function extractHeadings(doc: unknown): DocHeading[] {
  const root = doc as DocNode | null | undefined;
  if (!root || !Array.isArray(root.content)) return [];
  const out: DocHeading[] = [];
  const walk = (nodes: DocNode[], depth: number) => {
    if (depth > MAX_WALK_DEPTH) return;
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'heading') {
        const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1;
        if (level > 3) continue;
        const text = textOf(node).trim();
        if (text === '') continue;
        const id = typeof node.attrs?.id === 'string' ? node.attrs.id : undefined;
        out.push({ id, level, text, index: out.length });
        continue;
      }
      if (Array.isArray(node.content)) walk(node.content, depth + 1);
    }
  };
  walk(root.content, 0);
  return out;
}
