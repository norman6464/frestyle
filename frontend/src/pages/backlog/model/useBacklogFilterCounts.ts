import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ticketCountsQuery, type TicketCounts } from '@/entities/ticket';

export interface BacklogFilterCounts {
  /** 件数。まだ取れていなければ null。 */
  counts: TicketCounts | null;
  /**
   * 直前の取得が失敗した。画面は数字の代わりに「—」を出す（古い数字を出し続けると
   * 「動かしたのに減らない」と読まれる。0 と同じ表示にすると失敗が隠れる）。
   */
  failed: boolean;
  /** 取り直す。 */
  refresh: () => void;
}

/**
 * useBacklogFilterCounts はバックログの見出しの固定の「保存した絞り込み」の件数バッジ
 * （自分の担当・期限切れ・未割り当て）と全件数を読む。件数はワークスペース全チケットの走査と
 * 自分の principal 解決が要るため、backend の GetTicketCounts を叩くだけでフロントでは
 * 計算しない。
 *
 * 失敗しても画面は塞がない（件数は絞り込みの補助表示でしかなく、ここでエラーを出しても
 * 行き止まりにしかならない）。ただし失敗したことは `failed` で表に出す。
 *
 * 件数は共有の問い合わせ（ticketCountsQuery）から読み、チケットを書き換えたら書き込みの側
 * （refreshTicketDerived）が古いものにして取り直させる。**一覧と違い、取り直しに失敗したら
 * `failed` を立てる**（持っている数字があっても。画面は数字の代わりに「—」を出す）。
 */
export function useBacklogFilterCounts(
  workspaceSlug: string | undefined,
  projectId: string | undefined,
): BacklogFilterCounts {
  const active = workspaceSlug !== undefined && projectId !== undefined;
  const result = useQuery({ ...ticketCountsQuery(workspaceSlug ?? '', projectId ?? ''), enabled: active });
  const failed = active && result.isError && !result.isFetching;
  const { refetch } = result;
  const refresh = useCallback(() => {
    if (active) void refetch();
  }, [active, refetch]);
  // 取り直しに失敗しても数字は持ったまま failed を立てる（「—」に出し替えるのは画面の側）。
  return { counts: active ? (result.data ?? null) : null, failed, refresh };
}
