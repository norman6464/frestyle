import { isAllowedLinkHref } from '@/shared/ui/RichTextEditor';
import type { TicketCommentBlock, TicketCommentMarks, TicketCommentSegment } from '../model/types';

/**
 * 受け入れる marks の許可リスト。ここに無い飾りは読み込みの時点で捨てる。
 *
 * 許可リストにするのは、知らない marks が自動的に不許可側へ倒れるようにするため
 * （linkSafety の ALLOWED_LINK_PROTOCOLS と同じ考え方）。拒否リストだと、新しい飾りが
 * 出るたびに漏れる。
 */
const ALLOWED_MARK_TYPES = new Set(['bold', 'italic', 'strike', 'code', 'link']);

/**
 * ノードの marks を、画面が描いてよい形へ畳む。
 *
 * **リンクの飛び先はここで必ず通す。** backend は marks を検証しないので、保存されている
 * href が画面の書いたものだとは限らない。許可したスキーム（http / https / mailto / tel）
 * 以外は href ごと落とし、文字だけを残す（リンクが消えるだけで、発言は読める）。
 */
function readMarks(raw: unknown): TicketCommentMarks | undefined {
  if (!Array.isArray(raw)) return undefined;
  const marks: TicketCommentMarks = {};
  let any = false;
  for (const mark of raw) {
    if (!isRecord(mark) || typeof mark.type !== 'string') continue;
    if (!ALLOWED_MARK_TYPES.has(mark.type)) continue;
    if (mark.type === 'link') {
      const attrs = isRecord(mark.attrs) ? mark.attrs : {};
      const href = attrs.href;
      if (typeof href === 'string' && isAllowedLinkHref(href)) {
        marks.href = href;
        any = true;
      }
      continue;
    }
    marks[mark.type as 'bold' | 'italic' | 'strike' | 'code'] = true;
    any = true;
  }
  return any ? marks : undefined;
}

/** 区間の marks を tiptap / backend の形（marks 配列）へ戻す。 */
function writeMarks(marks: TicketCommentMarks | undefined): unknown[] | undefined {
  if (!marks) return undefined;
  const out: unknown[] = [];
  for (const type of ['bold', 'italic', 'strike', 'code'] as const) {
    if (marks[type]) out.push({ type });
  }
  // 送る側でも通す（貼り付け経路や過去の保存分が混じることがあるため）。守りの本体は
  // 読み込み側（readMarks）で、こちらは「おかしな値を増やさない」ための二重化。
  if (marks.href && isAllowedLinkHref(marks.href)) {
    out.push({ type: 'link', attrs: { href: marks.href } });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * 発言の本文（ノードの配列）と、画面が扱う塊の列との往復。
 *
 * backend が受け取る本文はノードの配列そのもので、チケット本体の `doc`
 * （`{type:'doc',content:[…]}`）のような外枠を持たない。往復をこの 1 か所に閉じ、画面側は
 * `TicketCommentBlock[]` だけを見ればよいようにする。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 応答の本文を区間の列へ畳む。
 *
 * text と名指し以外のノードは、文字を持っていればその文字だけを拾い、持っていなければ捨てる。
 * backend は本文のノード種別を検証しないので、この画面が書いたもの以外が入っている可能性を
 * 完全には否定できない — 読めない飾りのために発言そのものが表示できなくなる方が困る。
 *
 * **marks は許可リストで受ける。** 太字・斜体・打ち消し・コード・リンクだけを残し、
 * 他は捨てる（ALLOWED_MARK_TYPES）。
 *
 * 以前は marks を一切読まない方針だった —— 描画に使わなければ無害化そのものが要らない、
 * という理屈。書式バーを入れて描画するようになった以上、その前提は崩れるので、
 * **読み込みの時点で必ず通す**形に変えた。backend は marks を検証しないので、
 * ここが唯一の関所になる（保存されている値が画面の書いたものだとは限らない）。
 */
export function readCommentBody(body: unknown): TicketCommentBlock[] {
  if (!Array.isArray(body)) return [];

  const blocks: TicketCommentBlock[] = [];
  // 古い本文（塊を持たない一列）は、ここに溜めて最後に 1 つの段落へ畳む。
  let loose: TicketCommentSegment[] = [];
  const flushLoose = () => {
    if (loose.length === 0) return;
    blocks.push({ kind: 'paragraph', segments: loose });
    loose = [];
  };

  for (const node of body) {
    if (!isRecord(node)) continue;

    if (node.type === 'bulletList' || node.type === 'orderedList') {
      flushLoose();
      const items: TicketCommentSegment[][] = [];
      for (const item of Array.isArray(node.content) ? node.content : []) {
        const segments = readInlineNodes(collectInline(item));
        if (segments.length > 0) items.push(segments);
      }
      if (items.length > 0) blocks.push({ kind: 'list', ordered: node.type === 'orderedList', items });
      continue;
    }

    if (Array.isArray(node.content)) {
      // paragraph など、中に inline を持つ塊。知らない塊でも中の文字は拾う
      // （読めない飾りのために発言そのものが表示できなくなる方が困る）。
      flushLoose();
      const segments = readInlineNodes(node.content);
      if (segments.length > 0) blocks.push({ kind: 'paragraph', segments });
      continue;
    }

    // 塊を持たない古い形。溜めておいて最後に 1 段落へ。
    loose = loose.concat(readInlineNodes([node]));
  }
  flushLoose();
  return blocks;
}

/** 項目（listItem）の中から inline ノードを集める（段落 1 段ぶんだけ潜る）。 */
function collectInline(item: unknown): unknown[] {
  if (!isRecord(item)) return [];
  const content = Array.isArray(item.content) ? item.content : [];
  const out: unknown[] = [];
  for (const child of content) {
    if (isRecord(child) && Array.isArray(child.content)) {
      out.push(...child.content);
      continue;
    }
    out.push(child);
  }
  return out;
}

/** inline ノードの列を区間の列へ畳む（text と名指しだけを拾う）。 */
function readInlineNodes(nodes: unknown[]): TicketCommentSegment[] {
  const segments: TicketCommentSegment[] = [];
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    if (node.type === 'mention') {
      const attrs = isRecord(node.attrs) ? node.attrs : {};
      const userId = attrs.userId;
      if (typeof userId === 'string' && userId !== '') {
        segments.push({ kind: 'mention', userId });
      } else if (typeof userId === 'number' && Number.isFinite(userId)) {
        segments.push({ kind: 'mention', userId: String(userId) });
      }
      continue;
    }
    if (typeof node.text === 'string' && node.text !== '') {
      const marks = readMarks(node.marks);
      segments.push(marks ? { kind: 'text', text: node.text, marks } : { kind: 'text', text: node.text });
    }
  }
  return segments;
}

/**
 * 区間の列を、送信できる本文へ組み立てる。
 *
 * 空白だけの text は backend が**本文全体ごと**拒む（400）。名指しを 2 つ続けて書いたときの
 * 区切りの空白がまさにこれに当たるので、ここで落とす。落とした空白は表示側の余白で補う。
 * 全部落ちて空配列になったら送信してはいけない（空の本文も同じく 400）— 呼び出し側は
 * 戻り値の長さを見て送信可否を決めること。
 */
export function buildCommentBody(blocks: TicketCommentBlock[]): unknown[] {
  const out: unknown[] = [];
  for (const block of blocks) {
    if (block.kind === 'list') {
      const items = block.items
        .map((segments) => writeInlineNodes(segments))
        .filter((nodes) => nodes.length > 0)
        .map((nodes) => ({ type: 'listItem', content: [{ type: 'paragraph', content: nodes }] }));
      if (items.length > 0) out.push({ type: block.ordered ? 'orderedList' : 'bulletList', content: items });
      continue;
    }
    const nodes = writeInlineNodes(block.segments);
    if (nodes.length > 0) out.push({ type: 'paragraph', content: nodes });
  }
  return out;
}

/** 区間の列を inline ノードの列へ。空白だけの text は落とす（backend が本文ごと拒むため）。 */
function writeInlineNodes(segments: TicketCommentSegment[]): unknown[] {
  const nodes: unknown[] = [];
  for (const segment of segments) {
    if (segment.kind === 'mention') {
      if (segment.userId === '') continue;
      nodes.push({ type: 'mention', attrs: { userId: segment.userId } });
      continue;
    }
    if (segment.text.trim() === '') continue;
    const marks = writeMarks(segment.marks);
    nodes.push(marks ? { type: 'text', text: segment.text, marks } : { type: 'text', text: segment.text });
  }
  return nodes;
}
