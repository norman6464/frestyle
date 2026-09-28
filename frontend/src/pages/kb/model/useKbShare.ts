import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import {
  KbRepository,
  kbGrantablePrincipalsQuery,
  kbKeys,
  kbPageGrantsQuery,
  type KbGrantablePrincipal,
  type KbPageGrant,
} from '@/entities/kb';
import type { GrantRole } from '@/entities/workspace';
import type { SharePrincipal, ShareRow } from '@/features/permission-sharing';

export interface NoteShareState {
  rows: ShareRow[];
  /** まだ権限を張っていない相手（追加の候補）。 */
  candidates: SharePrincipal[];
  loading: boolean;
  /** 失敗の理由。null なら失敗していない。 */
  error: string | null;
  /** 書き込み（付与・取り消し）が飛んでいる間 true。 */
  saving: boolean;
}

const NO_ROWS: ShareRow[] = [];
const NO_CANDIDATES: SharePrincipal[] = [];

const LOAD_FAILED =
  '権限を読めませんでした。通信が切れたか、このページの権限を変える立場でなくなっています。';
const WRITE_FAILED = '権限を変えられませんでした。もう一度お試しください。';

/**
 * useKbShare はページ 1 枚の共有設定（ページ単位の付与）を読み書きする。
 *
 * # 2 本引いて突き合わせる理由
 *
 * 一覧（grants）は主体を ID でしか返さない。名前の正本は kind ごとに別の表にあり、
 * backend はそれを相手の一覧（principals）側で解決している。ここで ID を突き合わせて
 * 名前を付ける。2 本は共有の問い合わせで、独立に同時に取る。
 *
 * **突き合わない ID は行を落とさず ID のまま出す。** 引いた直後に主体が消えた場合など、
 * 名前が引けないことは起こる。そこで行を消すと、消せない権限が画面から見えないまま残り、
 * 誰が見られるのかを人が説明できなくなる。
 *
 * # 応答は「いま見ているページ宛て」だけを受け取る
 *
 * ページごとの鍵なので、飛んでいる要求より先にページが変わったりパネルが閉じたりしても、
 * 前のページの一覧は新しいページのパネルに出ない。書き込みのあとは**書いたページの**付与の
 * 一覧を取り直させる。その間に別のページへ移っていれば、古い印を付けるだけで取りに行かない
 * （次にそのページを開いたときに取り直す）。書き込みの失敗も書いたページと組で持ち、
 * 移った先のパネルには出さない。
 *
 * # 一覧が空でも「誰も見られない」ではない
 *
 * 返るのはこのページ自身に張った行だけで、ワークスペース / スペース / 祖先のページから
 * 届いている相手は含まれない。空 = この段では何も足していない、という意味しか無い。
 * それを画面に書くのは呼び出し側（NoteSharePanel）の責任。
 */
export function useKbShare(workspaceSlug: string | undefined, pageId: string | undefined) {
  const queryClient = useQueryClient();
  const hasTarget = workspaceSlug !== undefined && pageId !== undefined;
  const pageKey = hasTarget ? `${workspaceSlug}/${pageId}` : null;
  const grantsResult = useQuery({ ...kbPageGrantsQuery(workspaceSlug ?? '', pageId ?? ''), enabled: hasTarget });
  const principalsResult = useQuery({
    ...kbGrantablePrincipalsQuery(workspaceSlug ?? '', pageId ?? ''),
    enabled: hasTarget,
  });
  const [inFlight, setInFlight] = useState(0);
  const [writeError, setWriteError] = useState<{ pageKey: string } | null>(null);
  // 書き込みが終わった時点で、まだ同じページを見ているか。描き終えた直後に写す
  // （描いている途中で ref を書き換えない）。
  const shownPageKey = useRef(pageKey);
  useLayoutEffect(() => {
    shownPageKey.current = pageKey;
  }, [pageKey]);

  const grantsView = queryShownState(grantsResult, hasTarget);
  const principalsView = queryShownState(principalsResult, hasTarget);
  const grants = grantsView.data;
  const principals = principalsView.data;
  const joined = useMemo(() => {
    if (grants === undefined || principals === undefined) return null;
    const granted = new Set(grants.map((grant) => grant.principalId));
    return {
      rows: joinRows(grants, principals),
      candidates: principals.filter((principal) => !granted.has(principal.id)),
    };
  }, [grants, principals]);

  // 2 本のどちらかがまだ 1 度も取れていない間だけ、読み込み中・失敗を出す。
  const loading = grantsView.loading || principalsView.loading;
  const loadFailed = grantsView.failed || principalsView.failed;

  /**
   * write は書き込みを 1 回行い、成功したかを返す。成功したら書いたページの付与の一覧を
   * 取り直させ、見ている間はその取り直しを待ってから返す（画面と実態をずらさない）。
   * 書いている間に別のページへ移っていたら false を返す（移った先のパネルで成功として
   * 扱わせない。書いたページの一覧は古い印を付けるだけで、取りに行かない）。
   */
  const write = useCallback(
    async (run: (slug: string, page: string) => Promise<unknown>): Promise<boolean> => {
      if (!workspaceSlug || !pageId || pageKey === null) return false;
      setInFlight((n) => n + 1);
      setWriteError(null);
      const send = async (): Promise<boolean> => {
        const sent = await run(workspaceSlug, pageId).then(
          () => true,
          () => false,
        );
        if (!sent) {
          setWriteError({ pageKey });
          return false;
        }
        await queryClient.invalidateQueries({ queryKey: kbKeys.pageGrants(workspaceSlug, pageId) });
        return shownPageKey.current === pageKey;
      };
      return send().finally(() => setInFlight((n) => n - 1));
    },
    [workspaceSlug, pageId, pageKey, queryClient],
  );

  const grant = useCallback(
    (principalId: string, role: GrantRole) =>
      write((slug, page) => KbRepository.grantPageRole(slug, page, principalId, role)),
    [write],
  );

  const revoke = useCallback(
    (principalId: string) => write((slug, page) => KbRepository.revokePageRole(slug, page, principalId)),
    [write],
  );

  const { refetch: refetchGrants } = grantsResult;
  const { refetch: refetchPrincipals } = principalsResult;
  const reload = useCallback(async () => {
    await Promise.all([refetchGrants(), refetchPrincipals()]);
  }, [refetchGrants, refetchPrincipals]);

  const writeFailedHere = writeError !== null && writeError.pageKey === pageKey;
  return {
    rows: hasTarget ? (joined?.rows ?? NO_ROWS) : NO_ROWS,
    candidates: hasTarget ? (joined?.candidates ?? NO_CANDIDATES) : NO_CANDIDATES,
    loading,
    error: loadFailed ? LOAD_FAILED : writeFailedHere ? WRITE_FAILED : null,
    saving: inFlight > 0,
    /** 読めなかったときの取り直し。読めているとき（書き込みの失敗など）は無い。 */
    retry: loadFailed ? reload : undefined,
    grant,
    revoke,
    reload,
  };
}

/** joinRows は張った権限に表示名を付ける（付かない行も落とさない）。 */
function joinRows(grants: KbPageGrant[], principals: KbGrantablePrincipal[]): ShareRow[] {
  const principalsById = new Map(principals.map((principal) => [principal.id, principal]));
  return grants.map((grant) => {
    const principal = principalsById.get(grant.principalId);
    return {
      principalId: grant.principalId,
      role: grant.role,
      name: principal?.name ?? '',
      kind: principal?.kind ?? 'unknown',
    };
  });
}
