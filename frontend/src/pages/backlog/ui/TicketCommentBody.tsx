import type { TicketCommentBlock, TicketCommentMarks, TicketCommentSegment } from '@/entities/ticket';

export interface TicketCommentBodyProps {
  body: TicketCommentBlock[];
  /** userId から表示名を引く。引けなければ null（画面側が「不明なユーザー」に落とす）。 */
  resolveMentionName: (userId: string) => string | null;
}

/**
 * 発言の本文を素の React で描く。
 *
 * 発言 1 件ごとに入力欄（tiptap）を立てる作りは採らない — エディタ 1 台につき
 * 内部の拡張が 92 個立つ（実測）。20 件のスレッドで 1,840 個になる。
 *
 * 書式（太字・斜体・打ち消し・コード・リンク）は区間に付いてくる。**飛び先の安全確認は
 * ここではしない** —— 読み込み（entities/ticket/lib/commentBody.ts の readMarks）で
 * 許可したスキーム以外を落としてあるので、ここへ届く href は既に通ったものだけ。
 * 関所を 2 か所に分けると「どちらかが守っているはず」で両方緩む。
 */
export default function TicketCommentBody({ body, resolveMentionName }: TicketCommentBodyProps) {
  return (
    <div className="text-sm text-[var(--color-text-secondary)]">
      {body.map((block, blockIndex) => {
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return (
            <List
              key={blockIndex}
              className={`my-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
            >
              {block.items.map((segments, itemIndex) => (
                <li key={itemIndex} className="break-words">
                  <Segments segments={segments} resolveMentionName={resolveMentionName} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={blockIndex} className="whitespace-pre-wrap break-words">
            <Segments segments={block.segments} resolveMentionName={resolveMentionName} />
          </p>
        );
      })}
    </div>
  );
}

function Segments({
  segments,
  resolveMentionName,
}: {
  segments: TicketCommentSegment[];
  resolveMentionName: (userId: string) => string | null;
}) {
  return (
    <>
      {segments.map((segment, i) => {
        if (segment.kind === 'mention') {
          const name = resolveMentionName(segment.userId);
          return (
            <span key={i} className="rounded bg-brand-50 px-1 text-brand-700">
              @{name ?? '不明なユーザー'}
            </span>
          );
        }
        return (
          <span key={i} className={markClass(segment.marks)}>
            {segment.marks?.href ? (
              <a
                href={segment.marks.href}
                target="_blank"
                // 開いた先から window.opener 経由でこの画面を触られないようにする。
                rel="noopener noreferrer"
                className="text-brand-700 underline hover:no-underline"
              >
                {segment.text}
              </a>
            ) : (
              segment.text
            )}
          </span>
        );
      })}
    </>
  );
}

/** 区間の書式を class に畳む。リンクは <a> 側で塗るのでここには含めない。 */
function markClass(marks: TicketCommentMarks | undefined): string {
  if (!marks) return '';
  const classes: string[] = [];
  if (marks.bold) classes.push('font-bold');
  if (marks.italic) classes.push('italic');
  if (marks.strike) classes.push('line-through');
  if (marks.code) classes.push('rounded bg-surface-2 px-1 font-mono text-[0.9em]');
  return classes.join(' ');
}
