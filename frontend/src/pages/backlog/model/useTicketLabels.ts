import { useCallback, useEffect, useRef, useState } from 'react';
import { TicketRepository, type Label, type LabelInput } from '@/entities/ticket';

const LOAD_FAILED = 'ラベルを読み込めませんでした。時間をおいて開き直すと最新の状態が出ます。';

/**
 * useTicketLabels はワークスペースのラベル定義（一覧・作成・改名・削除）を読み書きする。
 *
 * ラベルの語彙はワークスペース単位（ページとチケットで共有する）ので、プロジェクトを
 * 切り替えても同じ一覧が出る。
 *
 * 状態・種別のマスタ（useTicketMasters）と違い、使用中件数のような取得し直さないと
 * ずれる派生値を持たないので、作成・更新・削除の応答をそのまま手元へ反映する
 * （マスタのように毎回一覧を取り直さない）。
 *
 * チケットへの付け外し（ticket.labels の更新）はここでは持たない — 対象がチケット
 * 1 件の状態（useTicketList / useTicketPage）に属するため、それぞれの hook に持たせる。
 */
export function useTicketLabels(workspaceSlug: string | undefined) {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<string | null>(null);

  const load = useCallback(async (slug: string) => {
    setLoading(true);
    setError(null);
    try {
      const list = await TicketRepository.fetchLabels(slug);
      if (active.current !== slug) return;
      setLabels(list);
    } catch {
      if (active.current !== slug) return;
      setError(LOAD_FAILED);
    } finally {
      if (active.current === slug) setLoading(false);
    }
  }, []);

  useEffect(() => {
    active.current = workspaceSlug ?? null;
    if (!workspaceSlug) {
      setLabels([]);
      return;
    }
    void load(workspaceSlug);
  }, [workspaceSlug, load]);

  const refresh = useCallback(() => {
    if (workspaceSlug) void load(workspaceSlug);
  }, [workspaceSlug, load]);

  const requireScope = useCallback((): string => {
    if (!workspaceSlug) throw new Error('backlog: no active scope');
    return workspaceSlug;
  }, [workspaceSlug]);

  const createLabel = useCallback(
    async (input: LabelInput) => {
      const slug = requireScope();
      const created = await TicketRepository.createLabel(slug, input);
      if (active.current === slug) setLabels((prev) => [...prev, created]);
      return created;
    },
    [requireScope],
  );

  const updateLabel = useCallback(
    async (labelId: string, input: LabelInput) => {
      const slug = requireScope();
      const updated = await TicketRepository.updateLabel(slug, labelId, input);
      if (active.current === slug) {
        setLabels((prev) => prev.map((l) => (l.id === labelId ? updated : l)));
      }
      return updated;
    },
    [requireScope],
  );

  const deleteLabel = useCallback(
    async (labelId: string) => {
      const slug = requireScope();
      await TicketRepository.deleteLabel(slug, labelId);
      if (active.current === slug) setLabels((prev) => prev.filter((l) => l.id !== labelId));
    },
    [requireScope],
  );

  return { labels, loading, error, refresh, createLabel, updateLabel, deleteLabel };
}
