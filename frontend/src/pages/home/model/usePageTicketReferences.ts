import { useQuery } from '@tanstack/react-query';
import { pageTicketReferencesQuery, type TicketReference } from '@/entities/ticket';
import { toHomeResource, type HomeResource } from './homeResource';

/** 最後に開いたページに添える参照チケットの上限。 */
export const REFERENCE_PREVIEW_LIMIT = 2;

const EMPTY: TicketReference[] = [];

/**
 * 最後に開いたページを本文で参照しているチケット。取るのは最新の 1 ページ分だけ（履歴の全行に
 * 広げない）。ページごとの鍵なので、ページが変わったら前の結果は出さない。バックログを見られない
 * 人には空が返る。
 */
export function usePageTicketReferences(
  page: { workspaceSlug: string; pageId: string } | null,
): HomeResource<TicketReference[]> {
  return toHomeResource(
    useQuery({
      ...pageTicketReferencesQuery(page?.workspaceSlug ?? '', page?.pageId ?? '', REFERENCE_PREVIEW_LIMIT),
      enabled: page !== null,
    }),
    EMPTY,
  );
}
