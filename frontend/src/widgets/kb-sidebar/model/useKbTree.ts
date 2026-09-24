import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NOTE_NEW_PAGE_TITLE,
  KbRepository,
  emitKbTreeEvent,
  collectKbAncestorIds,
  subscribeKbTreeEvents,
  replaceKbPageInTree,
  moveKbPageInTree,
  type KbDropTarget,
  type KbPage,
  type KbPageTree,
  type KbSpace,
  type KbWorkspace,
} from '@/entities/kb';

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

function emptySpaceState(): KbSpaceState {
  return { loading: true, error: null, tree: null };
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

  const [workspaces, setWorkspaces] = useState<KbWorkspace[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [workspacesError, setWorkspacesError] = useState<string | null>(null);

  const [activeSlug, setActiveSlug] = useState<string | null>(workspaceSlug ?? null);

  const [spaces, setSpaces] = useState<KbSpace[]>([]);
  const [spacesLoading, setSpacesLoading] = useState(false);
  const [spacesError, setSpacesError] = useState<string | null>(null);

  const [spaceState, setSpaceStateRaw] = useState<KbSpaceState>(emptySpaceState);
  // いまの spaceState を同期して持つ控え。
  //
  // useState の更新関数は**呼んだその場では走らない**（次の描画で走る）。その中で
  // 結果を外の変数へ書き出して直後に読むと、まだ書かれていないことがある。
  // 実際、移動の可否をその形で判定していて、たまたま動いていただけだった。
  // 読みたいときは ref を読む。更新関数は state を作るだけに保つ。
  const spaceStateRef = useRef<KbSpaceState>(spaceState);
  const setSpaceState = useCallback((update: (prev: KbSpaceState) => KbSpaceState) => {
    const next = update(spaceStateRef.current);
    spaceStateRef.current = next;
    setSpaceStateRaw(next);
  }, []);
  /** setTree はいまのスペースの木だけを差し替える。 */
  const setTree = useCallback(
    (tree: KbPageTree | null) => {
      setSpaceState((prev) => ({ ...prev, tree }));
    },
    [setSpaceState],
  );
  // 移動が走っているか。同じスペースの移動を重ねないための札。
  const moving = useRef(false);
  // アーカイブ済みを見ているか。
  const [archivedMode, setArchivedModeState] = useState(false);
  // 木を取りに行く関数が**常に「いまのスコープ」で取る**ようにするための控え。
  //
  // state を直接読むと、その関数を作った時点のスコープが閉じ込められる。書き換えの
  // 完了後に木を取り直す経路（アーカイブ・復帰）は await をまたぐので、その間に
  // 切り替えられると**古いスコープで取りに行き、その結果が新しい表示に入る**。
  // ref から読めば、誰がいつ呼んでも取りに行く先はいまのスコープになる。
  const archivedModeRef = useRef(false);
  const [expandedPageIds, setExpandedPageIds] = useState<ReadonlySet<string>>(new Set());

  // 切り替えを速く繰り返したときに、古い応答が新しい表示を上書きするのを防ぐ。
  // 「最後に投げた要求」だけを採用する（AbortController でも良いが、採用可否だけなら世代番号で足りる）。
  const generation = useRef(0);
  // 木そのものの要求連番。generation（ワークスペース/スペースの世代）だけだと、同じ
  // スペースへの要求どうしの追い越しを防げない — 削除後の取り直しより先に投げた古い応答が
  // 後から届くと、消したはずのページが木に蘇る（選ぶと 404）。最後に投げた要求だけを採用する。
  const treeSeq = useRef(0);

  // 所属ワークスペースの一覧。
  //
  // 取りに行く処理を effect の中に直接書かず関数に切り出してあるのは、**失敗したときに
  // 同じ経路でやり直せるようにする**ため。effect の中に閉じ込めると、依存が変わらない限り
  // 二度と走らず、利用者は画面を再読み込みするしか手が無くなる。
  const loadWorkspaces = useCallback(() => {
    setWorkspacesLoading(true);
    setWorkspacesError(null);
    KbRepository.fetchWorkspaces()
      .then((list) => {
        setWorkspaces(list);
        setWorkspacesError(null);
        // URL が何も指していなければ先頭を開く。所属が 0 件なら選ばない。
        setActiveSlug((current) => current ?? list[0]?.slug ?? null);
      })
      .catch(() => {
        setWorkspacesError('ワークスペースを読み込めませんでした');
      })
      .finally(() => {
        setWorkspacesLoading(false);
      });
  }, []);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  // URL 側が変わったら追従する（戻る / 進むでも表示が合う）。
  useEffect(() => {
    if (workspaceSlug) setActiveSlug(workspaceSlug);
  }, [workspaceSlug]);

  // 選んでいるワークスペースのスペース一覧（切替ドロップダウン・検索・バックログ導線が使う。
  // 「今いるスペース」の決定そのものには関わらない — それは呼び出し側が spaceId で渡す）。
  const loadSpaces = useCallback(() => {
    if (!activeSlug) return;
    const token = ++generation.current;
    setSpacesLoading(true);
    setSpaces([]);
    setSpacesError(null);

    KbRepository.fetchSpaces(activeSlug)
      .then((list) => {
        if (token !== generation.current) return;
        setSpaces(list);
        setSpacesError(null);
      })
      .catch(() => {
        if (token !== generation.current) return;
        setSpaces([]);
        setSpacesError('スペースを読み込めませんでした');
      })
      .finally(() => {
        if (token === generation.current) setSpacesLoading(false);
      });
  }, [activeSlug]);

  useEffect(() => {
    loadSpaces();
  }, [loadSpaces]);

  /** いまのスペースの木を取りに行く。マウント時・spaceId 変更時・再試行のときに呼ぶ。 */
  const loadSpaceTree = useCallback(() => {
    if (!activeSlug || !spaceId) return;
    const token = generation.current;
    const seq = ++treeSeq.current;
    setSpaceState(() => ({ loading: true, error: null, tree: spaceStateRef.current.tree }));

    KbRepository.fetchPageTree(activeSlug, spaceId, { archived: archivedModeRef.current })
      .then((tree) => {
        if (token !== generation.current || seq !== treeSeq.current) return;
        setSpaceState(() => ({ loading: false, error: null, tree }));
      })
      .catch(() => {
        if (token !== generation.current || seq !== treeSeq.current) return;
        setSpaceState((prev) => ({ loading: false, error: 'ページを読み込めませんでした', tree: prev.tree }));
      });
  }, [activeSlug, spaceId, setSpaceState]);

  // spaceId が変わったら（切替・別ページへの遷移）取り直す。
  useEffect(() => {
    setSpaceState(() => emptySpaceState());
    setExpandedPageIds(new Set());
    loadSpaceTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, activeSlug]);

  // 現在位置のページの祖先を開く。
  //
  // 木の読み込み完了とは別の effect にしてある。同じ場所でやると、木が届いた瞬間しか
  // 反応せず、**既に読み込んだ木の中で別のページへ移動したとき**に祖先が開かない
  // （リンクを辿ると、開いたページが閉じた枝の中に隠れたままになる）。
  useEffect(() => {
    if (!activePageId || !spaceState.tree) return;
    const ancestors = collectKbAncestorIds(spaceState.tree.pages, activePageId);
    if (ancestors.length === 0) return;
    setExpandedPageIds((prev) => {
      // 既に全部開いていれば新しい集合を作らない（作ると再描画が無限に続く）。
      if (ancestors.every((id) => prev.has(id))) return prev;
      return new Set([...prev, ...ancestors]);
    });
  }, [activePageId, spaceState.tree]);

  /**
   * 現役とアーカイブ済みを切り替える。
   *
   * 取得済みの木は**捨てる**。同じスペースでも中身がまったく別なので、残しておくと
   * 切り替えた直後だけ前のスコープの木が見える。
   */
  const setArchivedMode = useCallback(
    (next: boolean) => {
      // 切り替え前に投げた要求を採用しない（古いスコープの木が後から届く）。
      generation.current += 1;
      // ref を先に更新する。この後の取り直しは必ず新しいスコープで走る。
      archivedModeRef.current = next;
      setArchivedModeState(next);
      setExpandedPageIds(new Set());
      // 取得済みの木は**捨てる**。同じスペースでも中身がまったく別なので、残しておくと
      // 切り替えた直後だけ前のスコープの木が見える（loadSpaceTree は「取得中も前の木を
      // 残す」設計だが、それはページ作成・改名などの部分更新向け。アーカイブ切替では
      // 中身ごと変わるので、ここで明示的に空にしてから取り直す）。
      setSpaceState(() => emptySpaceState());
      loadSpaceTree();
    },
    [loadSpaceTree, setSpaceState],
  );

  /**
   * ワークスペースを作る。**失敗は握り潰さず投げる。**
   *
   * 作った本人が admin になるので、続けてスペースを作れる。作ったら一覧を取り直し、
   * そのワークスペースへ切り替える（作ってから自分で選び直させない）。
   */
  const createWorkspace = useCallback(async (input: { name: string }): Promise<KbWorkspace> => {
    // URL に出る slug はサーバーが自動採番する（人に決めさせない）。
    const workspace = await KbRepository.createWorkspace({ name: input.name });
    setWorkspaces((prev) => [...prev, workspace]);
    setActiveSlug(workspace.slug);
    // 他画面の一覧（useWorkspaceList）は別インスタンスなので、この setState だけでは知れない。
    emitKbTreeEvent({ type: 'workspace-created', workspace });
    return workspace;
  }, []);

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
      setSpaces((prev) => [...prev, space]);
      return space;
    },
    [activeSlug],
  );

  const renameSpace = useCallback(
    async (id: string, name: string): Promise<KbSpace> => {
      if (!activeSlug) throw new Error('workspace is not selected');
      const space = await KbRepository.renameSpace(activeSlug, id, name);
      // 見出しは spaces の配列から描くので、そこだけ差し替える（木は名前を持たない）。
      setSpaces((prev) => prev.map((s) => (s.id === space.id ? space : s)));
      return space;
    },
    [activeSlug],
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

      const current = spaceStateRef.current;
      if (!current.tree) throw new Error('invalid drop target');
      const pages = moveKbPageInTree(current.tree.pages, pageId, target);
      // 動かせない指定（自分自身・自分の子孫の中・落下先が無い）は、投げる前に断る。
      if (!pages) throw new Error('invalid drop target');

      // 動かす前の木を控える。これが唯一の巻き戻し先。
      const previous = current.tree;
      const optimistic = { ...current.tree, pages };
      moving.current = true;
      setTree(optimistic);
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

      try {
        await KbRepository.movePage(activeSlug, pageId, request);
      } catch (error) {
        // 自分が描いた木がまだ表示されているときだけ戻す。別のものに変わっていたら
        // （スコープの切り替え・取り直し）、そちらのほうが新しいので触らない。
        if (spaceStateRef.current.tree === optimistic) {
          setTree(previous);
        }
        throw error;
      } finally {
        moving.current = false;
      }
    },
    [activeSlug, setTree],
  );

  const togglePage = useCallback((pageId: string) => {
    setExpandedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }, []);

  // ページ画面（/p）での作成・更新（改名・アイコン）を木に映す。作成は木ごと取り直し
  // （親子関係の差し込み位置をこちらで計算しない — サーバーの並び順が正）、
  // 更新は値が変わっただけなので 1 枚差し替えで足りる。
  //
  // ワークスペースの作成・削除も同じ購読で映す。他画面の一覧（useWorkspaceList）のような
  // 別インスタンスも、自分自身が発行したイベントも等しく受け取るため、どちらも冪等な
  // 更新にしてある（無ければ足す・無ければ何もしない）。
  useEffect(() => {
    return subscribeKbTreeEvents((event) => {
      if (event.type === 'page-created') {
        if (event.page.spaceId !== spaceId) return;
        const parentId = event.page.parentId;
        if (parentId) {
          setExpandedPageIds((prev) => (prev.has(parentId) ? prev : new Set([...prev, parentId])));
        }
        loadSpaceTree();
        return;
      }
      if (event.type === 'page-updated') {
        if (event.page.spaceId !== spaceId) return;
        setSpaceState((prev) => {
          if (!prev.tree) return prev;
          const pages = replaceKbPageInTree(prev.tree.pages, event.page);
          if (pages === prev.tree.pages) return prev;
          return { ...prev, tree: { ...prev.tree, pages } };
        });
        return;
      }
      if (event.type === 'workspace-created') {
        setWorkspaces((prev) => (prev.some((w) => w.slug === event.workspace.slug) ? prev : [...prev, event.workspace]));
        return;
      }
      if (event.type === 'workspace-deleted') {
        setWorkspaces((prev) => {
          if (!prev.some((w) => w.slug === event.workspaceSlug)) return prev;
          const rest = prev.filter((w) => w.slug !== event.workspaceSlug);
          setActiveSlug((current) => (current === event.workspaceSlug ? (rest[0]?.slug ?? null) : current));
          return rest;
        });
      }
    });
  }, [spaceId, loadSpaceTree, setSpaceState]);

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
      setSpaceState((prev) => {
        if (!prev.tree) return prev;
        const pages = replaceKbPageInTree(prev.tree.pages, page);
        if (pages === prev.tree.pages) return prev;
        return { ...prev, tree: { ...prev.tree, pages } };
      });
      return page;
    },
    [activeSlug, setSpaceState],
  );

  /**
   * ページを子孫ごと物理削除する。**失敗は握り潰さず投げる。**
   * 成功したら木を取り直す（部分木がまとめて消えるので 1 枚差し替えでは表せない）。
   */
  const deletePage = useCallback(
    async (pageId: string): Promise<void> => {
      if (!activeSlug) throw new Error('workspace is not selected');
      await KbRepository.deletePage(activeSlug, pageId);
      // 開いている画面が「消えた場所」かの判定はページ側が行う（ページは自分の祖先を
      // サーバー応答で知っている。サイドバーの現役の木では、アーカイブ済みの子孫を
      // 開いている場合を見落とす）。
      emitKbTreeEvent({ type: 'page-deleted', pageId });
      loadSpaceTree();
    },
    [activeSlug, loadSpaceTree],
  );

  const retrySpace = useCallback(() => {
    loadSpaceTree();
  }, [loadSpaceTree]);

  return {
    workspaces,
    workspacesLoading,
    workspacesError,
    retryWorkspaces: loadWorkspaces,
    activeSlug,
    spaces,
    spacesLoading,
    spacesError,
    retrySpaces: loadSpaces,
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
    selectWorkspace: setActiveSlug,
    archivedMode,
    setArchivedMode,
    retrySpace,
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
