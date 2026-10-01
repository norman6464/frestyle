import type { JSONContent } from '@tiptap/core';

/**
 * 文字色・蛍光ペンの色は**名前**だけを持つ。生の色コード（hex）や CSS の値は保存しない。
 * 書いた人の選んだ値がそのまま全員の画面に流れないよう、名前を決まった色（richTextEditor.css の
 * トークン）に対応づける。保存側（backend）も同じ名前だけを残し、通らないマークは剥がす。
 *
 * 名前を足すときは contracts/kb-inline-attrs.json も直す（突き合わせのテストが
 * __tests__/inlineColors.test.ts にある。backend も同じファイルを読む）。
 */
export const INLINE_MARK_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray'] as const;
export type InlineMarkColor = (typeof INLINE_MARK_COLORS)[number];

/** attrs.color を持つ（名前で検査する）マークの種類。 */
export const COLORED_MARK_TYPES = ['textStyle', 'highlight'] as const;

/** 色の読み上げ名（パレットのボタンの名前）。 */
export const INLINE_MARK_COLOR_LABELS: Record<InlineMarkColor, string> = {
  red: '赤',
  orange: '橙',
  yellow: '黄',
  green: '緑',
  blue: '青',
  purple: '紫',
  pink: '桃',
  gray: '灰',
};

const colorSet: ReadonlySet<string> = new Set(INLINE_MARK_COLORS);
const coloredMarkSet: ReadonlySet<string> = new Set(COLORED_MARK_TYPES);

/** isInlineMarkColor は許した色の名前かを返す（大文字違い・空白・文字列以外は通さない）。 */
export function isInlineMarkColor(value: unknown): value is InlineMarkColor {
  return typeof value === 'string' && colorSet.has(value);
}

/** isColoredMarkType は、そのマークが色の名前を検査する種類かを返す。 */
export function isColoredMarkType(type: unknown): boolean {
  return typeof type === 'string' && coloredMarkSet.has(type);
}

// linkSafety の MAX_DOC_WALK_DEPTH と同じ理由・同じ値（上限が無いと極端に深い doc でスタックを使い切る）。
const MAX_DOC_WALK_DEPTH = 300;

type DocMark = NonNullable<JSONContent['marks']>[number];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * sanitizeDocColors は doc(JSON) を歩き、色付きのマーク（textStyle・highlight）のうち color が
 * 許した名前でないものをマークごと落とす（文字とほかのマークは残す）。
 *
 * API から来た doc は保存側で検査済みだが、古い本文や別の経路で入った値に備えて、読み込み時と
 * 保存時の両方で通す（sanitizeDocLinks と同じ考え）。変更が無ければ同じ参照を返す。
 */
export function sanitizeDocColors<T extends JSONContent>(node: T, depth = 0): T {
  const nextMarks = sanitizeColorMarks(node.marks);
  const nextContent = depth >= MAX_DOC_WALK_DEPTH ? node.content : sanitizeColorContent(node.content, depth + 1);
  if (nextMarks === node.marks && nextContent === node.content) return node;

  const next: JSONContent = { ...node };
  if (nextMarks === undefined) delete next.marks;
  else next.marks = nextMarks;
  if (nextContent !== undefined) next.content = nextContent;
  return next as T;
}

function sanitizeColorContent(content: JSONContent[] | undefined, depth: number): JSONContent[] | undefined {
  if (!Array.isArray(content)) return content;
  let changed = false;
  const next: JSONContent[] = [];
  for (const child of content) {
    if (!isPlainObject(child)) {
      next.push(child);
      continue;
    }
    const sanitized = sanitizeDocColors(child as JSONContent, depth);
    if (sanitized !== child) changed = true;
    next.push(sanitized);
  }
  return changed ? next : content;
}

function sanitizeColorMarks(marks: DocMark[] | undefined): DocMark[] | undefined {
  if (!Array.isArray(marks)) return marks;
  let changed = false;
  const next: DocMark[] = [];
  for (const mark of marks) {
    if (isPlainObject(mark) && isColoredMarkType(mark.type) && !isInlineMarkColor((mark as DocMark).attrs?.color)) {
      changed = true;
      continue;
    }
    next.push(mark);
  }
  if (!changed) return marks;
  // 1 つも残らなければ marks 自体を落とす（tiptap の getJSON も空の marks は書かない）。
  return next.length > 0 ? next : undefined;
}
