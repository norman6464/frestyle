import { useEffect, useRef } from 'react';
import { Button, FsIcon } from '@/shared/ui';

export interface InvitationJoinedCardProps {
  workspaceName: string;
  roleLabel: string;
  onOpen: () => void;
}

/**
 * 参加が済んだことを知らせるカード（設計ボード ST17）。自動で移動せず、ここで「ワークスペースを
 * 開く」を選ばせる —— ほかにも届いている招待があれば、続けて応答できる。
 *
 * 出たら見出しへフォーカスを移す（押した「参加する」はカードごと消えるので、フォーカスの
 * 行き場を失わせない）。
 */
export default function InvitationJoinedCard({ workspaceName, roleLabel, onOpen }: InvitationJoinedCardProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="invitation-joined-heading" className="rounded-2xl bg-brand-50 p-6">
      <h2
        id="invitation-joined-heading"
        ref={headingRef}
        tabIndex={-1}
        className="flex items-center gap-2 rounded-md text-xl font-bold text-[var(--color-text-primary)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [overflow-wrap:anywhere]"
      >
        <FsIcon name="check-circle" className="h-6 w-6 shrink-0 text-brand-700" />
        {workspaceName} に参加しました
      </h2>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{roleLabel}として利用できます。</p>
      <Button variant="secondary" onClick={onOpen} className="mt-4 min-h-12 w-full sm:w-auto">
        ワークスペースを開く
      </Button>
    </section>
  );
}
