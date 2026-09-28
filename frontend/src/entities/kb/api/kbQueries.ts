import { queryOptions } from '@tanstack/react-query';
import { workspaceScope } from '@/shared/api/queryKeys';
import KbRepository from './kbRepository';
import type { KbGrantablePrincipal } from '../model/types';

/**
 * ナレッジの鍵。作成・改名・削除の応答が新しい値そのものなら setQueryData で差し替え、
 * 決まらなければ invalidateQueries で取り直させる（決まりは shared/README.md の「サーバーの状態」）。
 *
 * ワークスペースの中のものは、鍵の根（shared/api/queryKeys.ts）の workspaceScope(slug) の下に置く。
 */
export const kbKeys = {
  /** ワークスペースのスペースの一覧（見られるもの全件）。 */
  spaces: (workspaceSlug: string) => [...workspaceScope(workspaceSlug), 'spaces'] as const,
  /** ワークスペースのうち、自分が役割を持つスペースの一覧（役割つき）。 */
  mySpaces: (workspaceSlug: string) => [...workspaceScope(workspaceSlug), 'my-spaces'] as const,
  /** 1 つのスペースの中のものすべて。 */
  space: (workspaceSlug: string, spaceId: string) => [...workspaceScope(workspaceSlug), 'space', spaceId] as const,
  /** スペースのページの木（現役とアーカイブ済みの両方）。ページを作る・消す・アーカイブしたら取り直させる。 */
  pageTrees: (workspaceSlug: string, spaceId: string) =>
    [...workspaceScope(workspaceSlug), 'space', spaceId, 'page-tree'] as const,
  /** スペースのページの木（現役かアーカイブ済みのどちらか）。 */
  pageTree: (workspaceSlug: string, spaceId: string, archived: boolean) =>
    [...workspaceScope(workspaceSlug), 'space', spaceId, 'page-tree', archived ? 'archived' : 'active'] as const,
  /** 1 枚のページの脇のもの（コメント・版・提案・共有・参照元）すべて。本文は入れない（shared/README.md）。 */
  page: (workspaceSlug: string, pageId: string) => [...workspaceScope(workspaceSlug), 'page', pageId] as const,
  /** このページを参照しているページ。 */
  backlinks: (workspaceSlug: string, pageId: string) =>
    [...workspaceScope(workspaceSlug), 'page', pageId, 'backlinks'] as const,
  /** コメントのスレッド（未解決・解決済み込み）。 */
  commentThreads: (workspaceSlug: string, pageId: string) =>
    [...workspaceScope(workspaceSlug), 'page', pageId, 'comment-threads'] as const,
  /** 版の一覧（新しい順）。 */
  versions: (workspaceSlug: string, pageId: string) =>
    [...workspaceScope(workspaceSlug), 'page', pageId, 'versions'] as const,
  /** 版 1 件（本文込み）。版は書き換わらないので、取ったら取り直さない。 */
  version: (workspaceSlug: string, pageId: string, seq: number) =>
    [...workspaceScope(workspaceSlug), 'page', pageId, 'version', seq] as const,
  /** 未処理の提案。 */
  suggestions: (workspaceSlug: string, pageId: string) =>
    [...workspaceScope(workspaceSlug), 'page', pageId, 'suggestions'] as const,
  /** このページ自身に張った権限（主体は ID だけ）。 */
  pageGrants: (workspaceSlug: string, pageId: string) =>
    [...workspaceScope(workspaceSlug), 'page', pageId, 'grants'] as const,
  /** このページに権限を張れる相手（表示名つき）。 */
  grantablePrincipals: (workspaceSlug: string, pageId: string) =>
    [...workspaceScope(workspaceSlug), 'page', pageId, 'grantable-principals'] as const,
  /**
   * テンプレートの一覧すべて。ワークスペース全体のテンプレートはどのスペースの一覧にも出るので、
   * 作った・消したらこの鍵でまとめて直す。
   */
  templates: (workspaceSlug: string) => [...workspaceScope(workspaceSlug), 'templates'] as const,
  /** スペースで使えるテンプレート（そのスペース専用とワークスペース全体）。 */
  spaceTemplates: (workspaceSlug: string, spaceId: string) =>
    [...workspaceScope(workspaceSlug), 'templates', spaceId] as const,
  /** ワークスペース全体の題名・本文検索（語ごと）。 */
  search: (workspaceSlug: string, needle: string) => [...workspaceScope(workspaceSlug), 'search', needle] as const,
  /** お気に入りのページ（スペースのお気に入りの画面・ホームが共有する）。 */
  favorites: (workspaceSlug: string) => [...workspaceScope(workspaceSlug), 'favorites'] as const,
  /** スペースのメンバー。 */
  spaceMembers: (workspaceSlug: string, spaceId: string) =>
    [...workspaceScope(workspaceSlug), 'space', spaceId, 'members'] as const,
  /** 最近開いたページ（ワークスペースをまたぐ）。 */
  recentPages: () => ['recent-pages'] as const,
};

/** ワークスペースのスペースの一覧。 */
export function kbSpacesQuery(workspaceSlug: string) {
  return queryOptions({
    queryKey: kbKeys.spaces(workspaceSlug),
    queryFn: () => KbRepository.fetchSpaces(workspaceSlug),
  });
}

/** ワークスペースのうち、自分が役割を持つスペースの一覧。 */
export function kbMySpacesQuery(workspaceSlug: string) {
  return queryOptions({
    queryKey: kbKeys.mySpaces(workspaceSlug),
    queryFn: () => KbRepository.fetchMySpaces(workspaceSlug),
  });
}

/**
 * スペースのページの木。左の列・すべてのページ・素の /kb の入口が共有する。
 * 現役とアーカイブ済みは同じ口のスコープ違いなので、鍵を分けて別々に持つ。
 */
export function kbPageTreeQuery(workspaceSlug: string, spaceId: string, archived = false) {
  return queryOptions({
    queryKey: kbKeys.pageTree(workspaceSlug, spaceId, archived),
    queryFn: () => KbRepository.fetchPageTree(workspaceSlug, spaceId, { archived }),
  });
}

/** このページを参照しているページ。 */
export function kbBacklinksQuery(workspaceSlug: string, pageId: string) {
  return queryOptions({
    queryKey: kbKeys.backlinks(workspaceSlug, pageId),
    queryFn: () => KbRepository.listBacklinks(workspaceSlug, pageId),
  });
}

/** コメントのスレッド。エディタの件数バッジとコメントの欄が共有する。 */
export function kbCommentThreadsQuery(workspaceSlug: string, pageId: string) {
  return queryOptions({
    queryKey: kbKeys.commentThreads(workspaceSlug, pageId),
    queryFn: () => KbRepository.listCommentThreads(workspaceSlug, pageId),
  });
}

/** 版の一覧（新しい順）。 */
export function kbPageVersionsQuery(workspaceSlug: string, pageId: string) {
  return queryOptions({
    queryKey: kbKeys.versions(workspaceSlug, pageId),
    queryFn: () => KbRepository.listPageVersions(workspaceSlug, pageId),
  });
}

/** 版 1 件（本文込み）。版は書き換わらないので、取ったら取り直さない。 */
export function kbPageVersionQuery(workspaceSlug: string, pageId: string, seq: number) {
  return queryOptions({
    queryKey: kbKeys.version(workspaceSlug, pageId, seq),
    queryFn: () => KbRepository.getPageVersion(workspaceSlug, pageId, seq),
    staleTime: Infinity,
  });
}

/** 未処理の提案。 */
export function kbSuggestionsQuery(workspaceSlug: string, pageId: string) {
  return queryOptions({
    queryKey: kbKeys.suggestions(workspaceSlug, pageId),
    queryFn: () => KbRepository.listOpenSuggestions(workspaceSlug, pageId),
  });
}

/** このページ自身に張った権限（主体は ID だけ）。 */
export function kbPageGrantsQuery(workspaceSlug: string, pageId: string) {
  return queryOptions({
    queryKey: kbKeys.pageGrants(workspaceSlug, pageId),
    queryFn: () => KbRepository.listPageGrants(workspaceSlug, pageId),
  });
}

/** このページに権限を張れる相手（表示名つき）。共有のパネルと、チケットの担当の名前引きが使う。 */
export function kbGrantablePrincipalsQuery(workspaceSlug: string, pageId: string) {
  return queryOptions({
    queryKey: kbKeys.grantablePrincipals(workspaceSlug, pageId),
    queryFn: () => KbRepository.listGrantablePrincipals(workspaceSlug, pageId),
  });
}

/** スペースで使えるテンプレート（そのスペース専用とワークスペース全体）。 */
export function kbSpaceTemplatesQuery(workspaceSlug: string, spaceId: string) {
  return queryOptions({
    queryKey: kbKeys.spaceTemplates(workspaceSlug, spaceId),
    queryFn: () => KbRepository.listPageTemplates(workspaceSlug, spaceId),
  });
}

/**
 * ワークスペース全体の題名・本文検索。語ごとに控えるので、打ち直して前の語に戻ったときは
 * 待たずに出す。ページは書き換わるので、開くたびに裏で取り直す（控えは古いものとして扱う）。
 */
export function kbSearchQuery(workspaceSlug: string, needle: string) {
  return queryOptions({
    queryKey: kbKeys.search(workspaceSlug, needle),
    queryFn: () => KbRepository.searchPages(workspaceSlug, needle),
    staleTime: 0,
  });
}

/** お気に入りのページ。ページの星を付け外ししたら古いものにする。 */
export function kbFavoritesQuery(workspaceSlug: string) {
  return queryOptions({
    queryKey: kbKeys.favorites(workspaceSlug),
    queryFn: () => KbRepository.fetchFavorites(workspaceSlug),
  });
}

/** スペースのメンバー。 */
export function kbSpaceMembersQuery(workspaceSlug: string, spaceId: string) {
  return queryOptions({
    queryKey: kbKeys.spaceMembers(workspaceSlug, spaceId),
    queryFn: () => KbRepository.fetchSpaceMembers(workspaceSlug, spaceId),
  });
}

/**
 * 最近開いたページ。ページを開くたびに変わるので、控えはすぐ出しつつ、画面を開くたびに
 * 裏で取り直す（控えは古いものとして扱う）。
 */
export function kbRecentPagesQuery() {
  return queryOptions({
    queryKey: kbKeys.recentPages(),
    queryFn: ({ signal }) => KbRepository.fetchRecentPages(signal),
    staleTime: 0,
  });
}
