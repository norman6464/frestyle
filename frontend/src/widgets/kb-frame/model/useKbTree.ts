import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { reflectWrite } from '@/shared/api/queryCache';
import {
  NOTE_NEW_PAGE_TITLE,
  KbRepository,
  kbMySpacesQuery,
  kbPageTreeQuery,
  kbSpacesQuery,
  refreshKbPageTrees,
  reflectKbPageInTrees,
  emitKbTreeEvent,
  collectKbAncestorIds,
  forgetVisitedPageIfMatches,
  getLastVisitedPageId,
  moveKbPageInTree,
  type KbDropTarget,
  type KbPage,
  type KbPageTree,
  type KbSpace,
} from '@/entities/kb';
import { workspacesQuery, type Workspace, WorkspaceRepository } from '@/entities/workspace';

const NO_WORKSPACES: Workspace[] = [];
const NO_SPACES: KbSpace[] = [];

/** 今のスペースの読み込み状態。 */
export interface KbSpaceState {
  loading: boolean;
  /** 取得に失敗した理由。表示して再試行させる（黙って空にしない）。 */
  error: string | null;
  tree: KbPageTree | null;
}

export interface UseKnowledgeBaseTreeOptions {
  /** URL が指しているワークスペース。未指定なら所属の先頭を選ぶ。 */
  workspaceSlug?: string;
  /** 今いるスペース（段14。サイドバーはこの 1 つの木だけを描く）。 */
  spaceId: string;
  /** URL が指しているページ。祖先を自動で開くために使う。 */
  activePageId?: string;
}

/**
 * useKbTree はサイドバーが要るものを全部揃える。
 *
 * 段14でスペース単位（1 つの spaceId の木だけを持つ）に組み替えた。ワークスペースの
 * 一覧・スペースの一覧（切替・検索・バックログ導線が使う）は変更なしで残すが、
 * 「開いたスペースだけ木を取りに行く」段の管理（旧 spaceStates の dict・toggleSpace）は
 * 無くなり、渡された 1 つの spaceId の木だけを保持・取得する。
 *
 * 失敗は必ず状態として持ち、画面に出す。既にこのリポジトリには
 * 「操作は失敗したのに成功の表示が出る」轍があるので、同じ形を作らない。
 */
export function useKbTree(options: UseKnowledgeBaseTreeOptions) {
  const { workspaceSlug, spaceId, activePageId } = options;

  const queryClient = useQueryClient();

  // 所属ワークスペースの一覧。管理の画面・ホームなどと同じ問い合わせを使い、1 回だけ取る。
  // 読み込み中・失敗の出し方は queryShownState（一覧が 1 度も取れていないときだけ出す。取り直しが
  // 403・404 なら持っている一覧も出さない）。
  const workspacesResult = useQuery(workspacesQuery());
  const workspacesView = queryShownState(workspacesResult);
  const workspaces = workspacesView.data ?? NO_WORKSPACES;
  const workspacesLoading = workspacesView.loading;
  const workspacesError = workspacesView.failed ? 'ワークスペースを読み込めませんでした' : null;

  // 選んだワークスペース（URL か切り替え）。選んでいなければ所属の先頭を開く。所属が 0 件なら選ばない。
  const [chosenSlug, setChosenSlug] = useState<string | null>(workspaceSlug ?? null);
  const activeSlug = chosenSlug ?? workspaces[0]?.slug ?? null;
  // URL 側が変わったら追従する（戻る / 進むでも表示が合う）。
  //
  // この hook では、外から渡る値が変わったときの合わせ込みを effect ではなく**描いている途中**で
  // 行う（前回の値を state に持って比べる。React が勧める形）。effect で合わせると、古い state の
  // まま 1 回画面に出してから、合わせた state でもう 1 回描き直すことになる（別のスペースの名前の
  // 下に前のスペースの木が一瞬出る、など）。描いている途中で state を変えると、React はその場で
  // 描き直してから画面に出す。
  const [seenWorkspaceSlug, setSeenWorkspaceSlug] = useState(workspaceSlug);
  if (workspaceSlug !== seenWorkspaceSlug) {
    setSeenWorkspaceSlug(workspaceSlug);
    if (workspaceSlug) setChosenSlug(workspaceSlug);
  }
  // 選んでいたワークスペースが一覧から消えたら（どこかで削除した）、所属の先頭へ戻す。一覧に
  // まだ載っていないだけ（一覧を読み込む前・URL で直接来た）なら、選んだまま待つ。
  const [seenWorkspaces, setSeenWorkspaces] = useState(workspacesResult.data);
  if (workspacesResult.data !== seenWorkspaces) {
    setSeenWorkspaces(workspacesResult.data);
    const listed = (list: Workspace[] | undefined) => list?.some((w) => w.slug === chosenSlug) ?? false;
    if (chosenSlug !== null && listed(seenWorkspaces) && !listed(workspacesResult.data)) setChosenSlug(null);
  }

  // 選んでいるワークスペースのスペース一覧（切替ドロップダウン・検索・バックログ導線が使う。
  // 「今いるスペース」の決定そのものには関わらない — それは呼び出し側が spaceId で渡す）。
  // ワークスペースごとの鍵で持つので、切り替えたら前の一覧は出ず、読み込み中になる。
  const spacesResult = useQuery({ ...kbSpacesQuery(activeSlug ?? ''), enabled: activeSlug !== null });
  const spacesView = queryShownState(spacesResult, activeSlug !== null);
  const spaces = spacesView.data ?? NO_SPACES;
  const spacesLoading = spacesView.loading;
  const spacesError = spacesView.failed ? 'スペースを読み込めませんでした' : null;

  const [expandedPageIds, setExpandedPageIds] = useState<ReadonlySet<string>>(new Set());
  // アーカイブ済みを見ているか。現役とアーカイブ済みは鍵の違う別の木なので、切り替えても
  // 前のスコープの木は出ない（切り替えた直後だけ前の木が見える、が起きない）。
  const [archivedMode, setArchivedModeState] = useState(false);

  // 今のスペースの木。すべてのページの画面・素の /kb の入口と同じ問い合わせを使う。スペース
  // （ワークスペースと spaceId の組）ごとの鍵なので、別のスペースへ移ったら前の木は出ず読み込み中になる。
  // 取り直しの間も持っている木は出したまま（一瞬空になり、開いていた段も畳まれて見えるのを避ける）。
  // 読み込み中と失敗を出すのは、木が 1 度も取れていないときだけ。
  const hasTreeScope = activeSlug !== null && spaceId !== '';
  const treeResult = useQuery({ ...kbPageTreeQuery(activeSlug ?? '', spaceId, archivedMode), enabled: hasTreeScope });
  const treeView = queryShownState(treeResult, hasTreeScope);
  const tree = treeView.data ?? null;
  const treeLoading = treeView.loading;
  const treeError = treeView.failed;
  // 呼び出し側（KbFrame）が読む形。描くたびに作り直すと、木を使う控えがすべて外れる。
  const spaceState = useMemo<KbSpaceState>(
    () => ({ loading: treeLoading, error: treeError ? 'ページを読み込めませんでした' : null, tree }),
    [treeLoading, treeError, tree],
  );

  // 木を持っているスペース（ワークスペースと spaceId の組）。変わったら（切替・別ページへの
  // 遷移）、描いている途中で前のスペースの開閉を捨てる。
  const treeKey = `${activeSlug ?? ''} ${spaceId}`;
  const [treeFor, setTreeFor] = useState(treeKey);
  // 祖先を開いた相手（今のページと木）。どちらかが変わったら、今のページの祖先を開く。
  //
  // 木が届いたときだけでなく、**既に読み込んだ木の中で別のページへ移動したとき**も開く
  // （リンクを辿ると、開いたページが閉じた枝の中に隠れたままになるため）。作ったページを
  // 開いたときも、その祖先（作った先の親）がここで開く。
  const [ancestorsFor, setAncestorsFor] = useState<{ pageId?: string; tree: KbPageTree | null }>({
    pageId: activePageId,
    tree: null,
  });
  if (treeFor !== treeKey) {
    setTreeFor(treeKey);
    setExpandedPageIds(new Set());
  } else if (ancestorsFor.pageId !== activePageId || ancestorsFor.tree !== tree) {
    setAncestorsFor({ pageId: activePageId, tree });
    const ancestors = activePageId && tree ? collectKbAncestorIds(tree.pages, activePageId) : [];
    if (ancestors.length > 0) {
      setExpandedPageIds((prev) => {
        // 既に全部開いていれば新しい集合を作らない（作ると、開閉は変わらないのに木の全行を描き直す）。
        if (ancestors.every((id) => prev.has(id))) return prev;
        return new Set([...prev, ...ancestors]);
      });
    }
  }

  // 移動が走っているか。同じスペースの移動を重ねないための札。
  const moving = useRef(false);

  const { refetch: refetchWorkspaces } = workspacesResult;
  const retryWorkspaces = useCallback(() => {
    void refetchWorkspaces();
  }, [refetchWorkspaces]);

  const { refetch: refetchSpaces } = spacesResult;
  const retrySpaces = useCallback(() => {
    void refetchSpaces();
  }, [refetchSpaces]);

  /**
   * 木を取り直させる（作成・アーカイブ・削除のあと）。現役とアーカイブ済みの両方が古くなる
   * （アーカイブは現役からアーカイブ済みへ移す操作）。取り直しの間も前の木は出したまま。
   */
  const loadSpaceTree = useCallback(() => {
    if (!activeSlug || !spaceId) return;
    void refreshKbPageTrees(queryClient, activeSlug, spaceId);
  }, [activeSlug, spaceId, queryClient]);

  /** 現役とアーカイブ済みを切り替える。開いていた段は畳む（中身がまったく別なので）。 */
  const setArchivedMode = useCallback((next: boolean) => {
    setArchivedModeState(next);
    setExpandedPageIds(new Set());
  }, []);

  /**
   * ワークスペースを作る。**失敗は握り潰さず投げる。**
   *
   * 作った本人が admin になるので、続けてスペースを作れる。作ったら一覧へ足し、
   * そのワークスペースへ切り替える（作ってから自分で選び直させない）。
   */
  const createWorkspace = useCallback(async (input: { name: string }): Promise<Workspace> => {
    // URL に出る slug はサーバーが自動採番する（人に決めさせない）。
    const workspace = await WorkspaceRepository.createWorkspace({ name: input.name });
    // 一覧は管理の画面・ホームと共有している。差し替えればどこにも出る。
    await reflectWrite(queryClient, workspacesQuery().queryKey, (prev) =>
      prev.some((w) => w.slug === workspace.slug) ? prev : [...prev, workspace],
    );
    setChosenSlug(workspace.slug);
    return workspace;
  }, [queryClient]);

  /**
   * スペースを作る。**失敗は握り潰さず投げる。**
   */
  const createSpace = useCallback(
    async (input: { name: string; visibility?: 'workspace' | 'private' }): Promise<KbSpace> => {
      if (!activeSlug) throw new Error('workspace is not selected');
      const space = await KbRepository.createSpace(activeSlug, input);
      // 頼んだ見え方で作られたかを確かめる。応答が visibility を持たない（列が届く前の
      // サーバー）と、プライベートのつもりが**全員に見えるスペース**として作られたまま
      // 「成功」に見えてしまう。取り違えたら投げて、呼び出し側に知らせを出させる。
      if (input.visibility && space.visibility !== input.visibility) {
        throw new Error('space visibility mismatch');
      }
      await reflectWrite(queryClient, kbSpacesQuery(activeSlug).queryKey, (prev) =>
        prev.some((s) => s.id === space.id) ? prev : [...prev, space],
      );
      // 自分の役割つきの一覧（スペース切替・スペースの画面の解決が使う）は、作った本人の役割を
      // 応答が持たないので取り直させる。待たずに返す — 作った直後にそのスペースへ移っても、
      // スペースの画面は一覧を取り直している間は「見つからない」と言わない（locateKbSpace）。
      void queryClient.invalidateQueries({ queryKey: kbMySpacesQuery(activeSlug).queryKey });
      return space;
    },
    [activeSlug, queryClient],
  );

  const renameSpace = useCallback(
    async (id: string, name: string): Promise<KbSpace> => {
      if (!activeSlug) throw new Error('workspace is not selected');
      const space = await KbRepository.renameSpace(activeSlug, id, name);
      // 見出しは spaces の配列から描くので、そこだけ差し替える（木は名前を持たない）。
      // 役割つきの一覧も名前だけ差し替える（スペースの画面の見出しとスペース切替に出る）。
      await reflectWrite(queryClient, kbSpacesQuery(activeSlug).queryKey, (prev) =>
        prev.map((s) => (s.id === space.id ? space : s)),
      );
      await reflectWrite(queryClient, kbMySpacesQuery(activeSlug).queryKey, (prev) =>
        prev.map((s) => (s.id === space.id ? { ...s, name: space.name } : s)),
      );
      return space;
    },
    [activeSlug, queryClient],
  );

  /**
   * ページを（子孫ごと）アーカイブする。**失敗は握り潰さず投げる。**
   *
   * 成功したら木を取り直す。消えるのは 1 枚とは限らない（子孫ごと消える）ので、
   * 手元で 1 枚だけ抜くと表示と中身がずれる。
   */
  const archivePage = useCallback(
    async (pageId: string): Promise<void> => {
      if (!activeSlug) throw new Error('workspace is not selected');
      await KbRepository.archivePage(activeSlug, pageId);
      loadSpaceTree();
    },
    [activeSlug, loadSpaceTree],
  );

  /**
   * アーカイブしたページを現役へ戻す。**失敗は握り潰さず投げる。**
   */
  const unarchivePage = useCallback(
    async (pageId: string): Promise<void> => {
      if (!activeSlug) throw new Error('workspace is not selected');
      await KbRepository.unarchivePage(activeSlug, pageId);
      loadSpaceTree();
    },
    [activeSlug, loadSpaceTree],
  );

  /**
   * ドラッグで動かす。**先に画面を動かし、断られたら元の並びへ戻す。**
   *
   * ドラッグは即座に動かないと使えないが、サーバーは拒否しうる（権限・競合・循環）。
   * だから先に動かす。ただし**戻せる形でしか動かさない**こと — 戻せないと、画面と
   * DB が食い違ったまま利用者が次の操作をする。
   *
   * 巻き戻しは木の取り直しではなく、**動かす前の木をそのまま書き戻す**。取り直すと
   * 失敗が見えないまま画面だけ整い、しかも取り直しの間に別の操作が挟まると
   * どちらが正か分からなくなる。
   *
   * 成功しても取り直さない。サーバーが受け入れた並びは、こちらが先に描いたものと同じ
   * （どの兄弟の隣かで指定しているので、解釈が割れる余地が無い）。
   *
   * **失敗は握り潰さず投げる。** 巻き戻しはここで済ませるが、知らせるのは呼び出し側。
   */
  const movePage = useCallback(
    async (pageId: string, target: KbDropTarget): Promise<void> => {
      if (!activeSlug) throw new Error('workspace is not selected');
      // 移動が走っている間は次を受け付けない（理由は useKbTree のドキュメント参照）。
      if (moving.current) throw new Error('move already in flight');

      // 動かせるかは、今描いている木（利用者がドラッグした木）で判定する。更新関数の中で
      // 判定して結果を外へ書き出す形にはしない — 更新関数は呼んだその場では走らないので、
      // 直後に読むとまだ書かれていないことがある（実際、たまたま動いていただけだった）。
      const current = tree;
      if (!current) throw new Error('invalid drop target');
      const pages = moveKbPageInTree(current.pages, pageId, target);
      // 動かせない指定（自分自身・自分の子孫の中・落下先が無い）は、投げる前に断る。
      if (!pages) throw new Error('invalid drop target');

      // 動かす前の木を控える。これが唯一の巻き戻し先。
      const previous = current;
      const treeQueryKey = kbPageTreeQuery(activeSlug, spaceId, archivedMode).queryKey;
      moving.current = true;
      // 取りに行っている途中の木があとから届いて、先に動かした並びを上書きしないよう止めてから動かす。
      await queryClient.cancelQueries({ queryKey: treeQueryKey, exact: true });
      // 控えに入った木（同じ部分は前の木の物を使い回した形）を、巻き戻すときの目印にする。
      const optimistic = queryClient.setQueryData(treeQueryKey, { ...current, pages });
      // 子として入れたときは、その段を開いておく。開かないと、動かしたページが
      // 畳まれた段の中に入り、成功したのに画面から消えたように見える。
      if (target.kind === 'into') {
        setExpandedPageIds((prev) =>
          prev.has(target.pageId) ? prev : new Set([...prev, target.pageId]),
        );
      }

      // 落下先を API の言葉へ移す。**並び順のキーは送らない**（そもそも持っていない）。
      const request =
        target.kind === 'into'
          ? { parentId: target.pageId }
          : {
              parentId: parentIdOf(previous, target.pageId) ?? '',
              ...(target.kind === 'before'
                ? { beforePageId: target.pageId }
                : { afterPageId: target.pageId }),
            };

      await KbRepository.movePage(activeSlug, pageId, request)
        .catch((error: unknown) => {
          // 自分が描いた木がまだ控えにあるときだけ戻す。別のものに変わっていたら
          // （取り直し）、そちらのほうが新しいので触らない。
          queryClient.setQueryData(treeQueryKey, (prev) => (prev === optimistic ? previous : prev));
          throw error;
        })
        .finally(() => {
          moving.current = false;
        });
    },
    [activeSlug, spaceId, archivedMode, tree, queryClient],
  );

  const togglePage = useCallback((pageId: string) => {
    setExpandedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }, []);

  // ページ画面（/p）での作成・更新（改名・アイコン・カバー）は、ページ画面が木の控えを直接
  // 直す（refreshKbPageTrees / reflectKbPageInTrees）。ここで知らせを聞く必要は無い。

  /**
   * ページを作る。**失敗は握り潰さず投げる。**
   *
   * このリポジトリには「操作は失敗したのに成功の表示が出る」轍が既にあり、
   * 原因はどれも**操作関数が失敗を投げなかった**こと。
   * 返り値の真偽で伝えると、呼び出し側は見なくても書けてしまう。投げれば、
   * 握り潰すには try/catch を書くしかなく、握り潰したことがコードに残る。
   *
   * 成功したら木を取り直す。**兄弟のどこに入るかを決めるのはサーバー**なので、
   * 手元で組み立てると必ずずれる（並び順のキーは応答にも入っていない）。
   */
  const createPage = useCallback(
    async (parentId?: string): Promise<KbPage> => {
      if (!activeSlug) throw new Error('workspace is not selected');
      const page = await KbRepository.createPage(activeSlug, spaceId, {
        title: KB_NEW_PAGE_TITLE,
        parentId,
      });
      // 親の下に作ったなら、その親を開いておく（開かないと作ったページが見えない）。
      if (parentId) {
        setExpandedPageIds((prev) => (prev.has(parentId) ? prev : new Set([...prev, parentId])));
      }
      loadSpaceTree();
      return page;
    },
    [activeSlug, spaceId, loadSpaceTree],
  );

  /**
   * 題名を変える。**失敗は握り潰さず投げる**（createPage と同じ理由）。
   *
   * 成功したら木ごと取り直さず、サーバーが返したページで 1 枚だけ差し替える。
   * 取り直すと一瞬空になり、開いていた段も畳まれて見えるため。
   */
  const renamePage = useCallback(
    async (pageId: string, title: string): Promise<KbPage> => {
      if (!activeSlug) throw new Error('workspace is not selected');
      const page = await KbRepository.renamePage(activeSlug, pageId, title);
      await reflectKbPageInTrees(queryClient, activeSlug, page);
      // 本文（開いているページの題名・パンくず）へも知らせる。木だけ差し替えると、そのページを
      // 開いていた本文は古い題名のまま残る。自分にも届くが、木の差し替えは冪等。
      emitKbTreeEvent({ type: 'page-updated', page });
      return page;
    },
    [activeSlug, queryClient],
  );

  /**
   * ページを子孫ごと物理削除する。**失敗は握り潰さず投げる。**
   * 成功したら木を取り直す（部分木がまとめて消えるので 1 枚差し替えでは表せない）。
   */
  const deletePage = useCallback(
    async (pageId: string): Promise<void> => {
      if (!activeSlug) throw new Error('workspace is not selected');
      await KbRepository.deletePage(activeSlug, pageId);
      // 「前回開いたページ」が消えた部分木の中なら、その記録を外す。残すと、次に素の /kb を
      // 開いたとき入口が消えたページを選んで「ページを開けません」になる（ページを開いて
      // いない画面から消した場合も含む。開いている本文はそれとは別に自分で外す）。
      const lastVisited = getLastVisitedPageId();
      if (
        lastVisited &&
        (lastVisited === pageId ||
          (tree && collectKbAncestorIds(tree.pages, lastVisited).includes(pageId)))
      ) {
        forgetVisitedPageIfMatches(lastVisited);
      }
      // 開いている画面が「消えた場所」かの判定はページ側が行う（ページは自分の祖先を
      // サーバー応答で知っている。サイドバーの現役の木では、アーカイブ済みの子孫を
      // 開いている場合を見落とす）。
      emitKbTreeEvent({ type: 'page-deleted', pageId });
      loadSpaceTree();
    },
    [activeSlug, tree, loadSpaceTree],
  );

  const { refetch: refetchTree } = treeResult;
  const retrySpace = useCallback(() => {
    void refetchTree();
  }, [refetchTree]);

  return {
    workspaces,
    workspacesLoading,
    workspacesError,
    retryWorkspaces,
    activeSlug,
    spaces,
    spacesLoading,
    spacesError,
    retrySpaces,
    spaceState,
    expandedPageIds,
    togglePage,
    createPage,
    renamePage,
    deletePage,
    archivePage,
    unarchivePage,
    movePage,
    createWorkspace,
    createSpace,
    renameSpace,
    selectWorkspace: setChosenSlug,
    archivedMode,
    setArchivedMode,
    retrySpace,
    /** ほかの口（テンプレートから作るなど）でページを作ったあとに、木を取り直させる。 */
    refreshTree: loadSpaceTree,
  };
}

/** parentIdOf は木の中でそのページの親の ID を返す（スペース直下なら null）。 */
function parentIdOf(tree: KbPageTree | null, pageId: string): string | null {
  if (!tree) return null;
  const walk = (nodes: KbPageTree['pages'], parentId: string | null): string | null | undefined => {
    for (const node of nodes) {
      if (node.page.id === pageId) return parentId;
      const found = walk(node.children, node.page.id);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(tree.pages, null) ?? null;
}

/** 新しく作ったページの題名。正本は entities/kb（エディタの /page と共用）。 */
export const KB_NEW_PAGE_TITLE = NOTE_NEW_PAGE_TITLE;
