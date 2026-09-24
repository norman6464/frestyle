import { TicketRepository, type TicketReference } from '@/entities/ticket';
import { useHomeResource } from './useHomeResource';

/** 最後に開いたページに添える参照チケットの上限。 */
export const REFERENCE_PREVIEW_LIMIT = 2;

const EMPTY: TicketReference[] = [];

/**
 * 最後に開いたページを本文で参照しているチケット。取るのは最新の 1 ページ分だけ（履歴の全行に
 * 広げない）。ページが変わったら前の結果を捨てる。バックログを見られない人には空が返る。
 */
export function usePageTicketReferences(page: { workspaceSlug: string; pageId: string } | null) {
  const key = page ? `${page.workspaceSlug}/${page.pageId}` : null;
  return useHomeResource(
    key,
    (signal) =>
      page
        ? TicketRepository.fetchPageTicketReferences(page.workspaceSlug, page.pageId, REFERENCE_PREVIEW_LIMIT, signal)
        : Promise.resolve(EMPTY),
    EMPTY,
  );
}
