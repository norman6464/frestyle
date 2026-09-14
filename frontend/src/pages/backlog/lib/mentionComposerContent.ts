import type { JSONContent } from '@tiptap/core';
import type { TicketCommentBlock, TicketCommentMarks, TicketCommentSegment } from '@/entities/ticket';

/** tiptap の marks 配列を区間の書式へ畳む（許可されたものだけ。知らない飾りは捨てる）。 */
function toMarks(raw: JSONContent['marks']): TicketCommentMarks | undefined {
  if (!raw || raw.length === 0) return undefined;
  const marks: TicketCommentMarks = {};
  let any = false;
  for (const mark of raw) {
    if (mark.type === 'bold' || mark.type === 'italic' || mark.type === 'strike' || mark.type === 'code') {
      marks[mark.type] = true;
      any = true;
      continue;
    }
    if (mark.type === 'link' && typeof mark.attrs?.href === 'string') {
      marks.href = mark.attrs.href;
      any = true;
    }
  }
  return any ? marks : undefined;
}

/** 区間の書式を tiptap の marks 配列へ戻す。 */
function fromMarks(marks: TicketCommentMarks | undefined): JSONContent['marks'] | undefined {
  if (!marks) return undefined;
  const out: NonNullable<JSONContent['marks']> = [];
  for (const type of ['bold', 'italic', 'strike', 'code'] as const) {
    if (marks[type]) out.push({ type });
  }
  if (marks.href) out.push({ type: 'link', attrs: { href: marks.href } });
  return out.length > 0 ? out : undefined;
}

/** 書式が同じ区間かどうか（隣り合う text をまとめてよいかの判定）。 */
function sameMarks(a: TicketCommentMarks | undefined, b: TicketCommentMarks | undefined): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * 発言入力欄（tiptap）の中身を、送信できる塊の列へ畳む。
 *
 * 入力欄のスキーマは doc → [paragraph | bulletList | orderedList]* で、その中は
 * [text | mention | hardBreak]* の一列（TicketCommentComposer の StarterKit 設定が正）。
 * 段落の中の Enter は hardBreak（CommentComposerEnter が固定）なので、ここで '\n' の文字へ
 * 畳む —— 送信される wire に hardBreak ノードは一切現れない（読み込み側の
 * commentBody.ts も hardBreak を知らない）。
 *
 * 知らない塊（貼り付けで紛れ込んだ見出し・引用など）は段落として扱う —— 中の inline だけを
 * 拾うので、文字が消えることはない。
 */
export function editorContentToBlocks(doc: JSONContent): TicketCommentBlock[] {
  const blocks: TicketCommentBlock[] = [];
  for (const node of doc.content ?? []) {
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const items = (node.content ?? [])
        .map((item) => inlineToSegments(collectItemInline(item)))
        .filter((segments) => segments.length > 0);
      if (items.length > 0) blocks.push({ kind: 'list', ordered: node.type === 'orderedList', items });
      continue;
    }
    const segments = inlineToSegments(node.content ?? []);
    if (segments.length > 0) blocks.push({ kind: 'paragraph', segments });
  }
  return blocks;
}

/** 項目（listItem）の中の inline を集める（中の段落 1 段ぶんまで潜る）。 */
function collectItemInline(item: JSONContent): JSONContent[] {
  const out: JSONContent[] = [];
  for (const child of item.content ?? []) {
    if (child.content) {
      out.push(...child.content);
      continue;
    }
    out.push(child);
  }
  return out;
}

/** inline ノードの列を区間の列へ畳む。 */
function inlineToSegments(nodes: JSONContent[]): TicketCommentSegment[] {
  const segments: TicketCommentSegment[] = [];

  // 書式が同じ隣り合う text だけをまとめる（違う書式を 1 区間に混ぜない）。
  const pushText = (text: string, marks?: TicketCommentMarks) => {
    if (text === '') return;
    const last = segments[segments.length - 1];
    if (last?.kind === 'text' && sameMarks(last.marks, marks)) {
      last.text += text;
    } else {
      segments.push(marks ? { kind: 'text', text, marks } : { kind: 'text', text });
    }
  };

  for (const node of nodes) {
    if (node.type === 'text' && typeof node.text === 'string') {
      pushText(node.text, toMarks(node.marks));
      continue;
    }
    if (node.type === 'hardBreak') {
      pushText('\n');
      continue;
    }
    if (node.type === 'mention') {
      const userId = node.attrs?.userId;
      if (typeof userId === 'string' && userId !== '') {
        segments.push({ kind: 'mention', userId });
      }
    }
  }
  return segments;
}

/**
 * 区間の列から編集欄の初期状態を組み立てる（発言の編集を開いたときの下書きの種）。
 * mention は表示名を持たない（wire には userId しかない）ので、呼び出し側が
 * 名前解決を渡す — 引けなければ「不明なユーザー」で埋める（TicketCommentBody と同じ扱い）。
 */
export function blocksToEditorContent(
  blocks: TicketCommentBlock[],
  resolveMentionName: (userId: string) => string | null,
): JSONContent {
  const toInline = (segments: TicketCommentSegment[]): JSONContent[] => {
    const content: JSONContent[] = [];
    for (const segment of segments) {
      if (segment.kind === 'mention') {
        content.push({
          type: 'mention',
          attrs: { userId: segment.userId, name: resolveMentionName(segment.userId) ?? '不明なユーザー' },
        });
        continue;
      }
      const marks = fromMarks(segment.marks);
      segment.text.split('\n').forEach((line, i) => {
        if (i > 0) content.push({ type: 'hardBreak' });
        if (line !== '') content.push(marks ? { type: 'text', text: line, marks } : { type: 'text', text: line });
      });
    }
    return content;
  };

  const content: JSONContent[] = blocks.map((block) => {
    if (block.kind === 'list') {
      return {
        type: block.ordered ? 'orderedList' : 'bulletList',
        content: block.items.map((segments) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: toInline(segments) }],
        })),
      };
    }
    return { type: 'paragraph', content: toInline(block.segments) };
  });

  // 中身が無いときも段落 1 つは要る（tiptap の doc は空にできない）。
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }] };
}

/** 編集欄が空かどうか（trim 後の text が全部空 かつ mention も無い）。 */
export function isEditorContentEmpty(doc: JSONContent): boolean {
  const segments = editorContentToBlocks(doc).flatMap((block) =>
    block.kind === 'list' ? block.items.flat() : block.segments,
  );
  return segments.every((s) => s.kind === 'text' && s.text.trim() === '');
}
