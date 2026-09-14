import { useEffect } from 'react';
import type { TicketStatus } from '@/entities/ticket';
import { useTicketChildren } from '../model/useTicketChildren';
import TicketChildrenList from './TicketChildrenList';

export interface TicketChildrenSectionProps {
  workspaceSlug: string;
  ticketId: string;
  projectKey: string;
  statuses: TicketStatus[];
  /** 取得できた件数を親へ知らせる（見出しに出すため）。 */
  onCountChange?: (count: number) => void;
}

/**
 * TicketChildrenSection は直下の子の一式（取得のみ）をまとめる。
 *
 * 全画面の副列とバックログの副パネルの両方から使う（TicketCommentSection /
 * TicketAttachmentSection と同じ考え方 — 互いに同時マウントされない別ルートなので、
 * それぞれが自分の useTicketChildren を持ってよい）。
 */
export default function TicketChildrenSection({
  workspaceSlug,
  ticketId,
  projectKey,
  statuses,
  onCountChange,
}: TicketChildrenSectionProps) {
  const { children, loading, error } = useTicketChildren(workspaceSlug, ticketId);
  // 件数は見出し（TicketSection の count）が持つ。ここは数えて渡すだけ。
  useEffect(() => {
    onCountChange?.(children.length);
  }, [children.length, onCountChange]);
  return <TicketChildrenList tickets={children} loading={loading} error={error} projectKey={projectKey} statuses={statuses} />;
}
