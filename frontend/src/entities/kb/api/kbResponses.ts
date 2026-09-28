import { toArray } from '@/shared/lib/toArray';
import type {
  KbAncestorRef,
  KbEditorRef,
  KbFavoritePage,
  KbIcon,
  KbLabel,
  KbPage,
  KbPageContentSaveResult,
  KbPageDoc,
  KbPageTemplate,
  KbPageTree,
  KbPageTreeNode,
  KbRecentPage,
  KbResolvedCover,
  KbResolvedPage,
  KbSearchResult,
} from '../model/types';

/*
 * ナレッジの応答を、画面が使う形（model/types.ts）へ揃える。
 *
 * backend は「無い」値を Go のポインタ + `omitempty` で返すので、**無いときはキーごと欠ける**
 * （null ではない）。画面の型は「無い」を null で表すと決めてあるので、取得の口を出る前に
 * ここで揃える。画面の側で `?? null` や `=== undefined` を書き散らさないため。
 */

/** ページ 1 件の生の応答。無いときキーごと欠ける項目がある。 */
export type KbPageWire = Omit<KbPage, 'parentId' | 'archivedAt' | 'icon' | 'lastEditedByUserId'> & {
  parentId?: string | null;
  archivedAt?: string | null;
  icon?: KbIcon | null;
  lastEditedByUserId?: number | null;
};

export function normalizePage(raw: KbPageWire): KbPage {
  return {
    id: raw.id,
    spaceId: raw.spaceId,
    parentId: raw.parentId ?? null,
    title: raw.title,
    createdByUserId: raw.createdByUserId,
    archivedAt: raw.archivedAt ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    icon: raw.icon ?? null,
    lastEditedByUserId: raw.lastEditedByUserId ?? null,
    visibility: raw.visibility,
  };
}

type KbPageTreeNodeWire = Omit<KbPageTreeNode, 'page' | 'children'> & {
  page: KbPageWire;
  children?: KbPageTreeNodeWire[] | null;
};

function normalizeTreeNode(raw: KbPageTreeNodeWire): KbPageTreeNode {
  return {
    page: normalizePage(raw.page),
    children: toArray<KbPageTreeNodeWire>(raw.children).map(normalizeTreeNode),
    hasHiddenChildren: raw.hasHiddenChildren,
    parentArchived: raw.parentArchived,
  };
}

/** ツリー取得の応答。pages が欠けた応答（想定外）でも描画側が落ちないよう、配列だけは必ず用意する。 */
export function normalizePageTree(raw: { pages?: KbPageTreeNodeWire[] | null; hasHiddenChildren?: boolean } | null): KbPageTree {
  return {
    pages: toArray<KbPageTreeNodeWire>(raw?.pages).map(normalizeTreeNode),
    hasHiddenChildren: raw?.hasHiddenChildren ?? false,
  };
}

/**
 * 検索結果 1 件の生の応答。本文の一致（matchField が body）のときだけ抜粋が付く。位置と長さは
 * 整数の `omitempty` なので、**一致が抜粋の先頭（位置 0）のとき matchStart がキーごと欠ける**。
 */
export type KbSearchResultWire = KbPageWire & {
  matchField: 'title' | 'body';
  excerpt?: string;
  matchStart?: number;
  matchLen?: number;
};

export function normalizeSearchResult(raw: KbSearchResultWire): KbSearchResult {
  const page = normalizePage(raw);
  if (raw.matchField === 'body' && raw.excerpt !== undefined) {
    return { ...page, matchField: 'body', excerpt: raw.excerpt, matchStart: raw.matchStart ?? 0, matchLen: raw.matchLen ?? 0 };
  }
  return { ...page, matchField: 'title' };
}

export type KbPageDocWire = Omit<KbPageDoc, 'page'> & { page: KbPageWire };

export function normalizePageDoc(raw: KbPageDocWire): KbPageDoc {
  return { page: normalizePage(raw.page), doc: raw.doc };
}

/**
 * /kb/{pageId} の解決の生の応答。最終編集とカバーは無いときキーごと欠ける。祖先の列とラベルは
 * Go の配列なので、0 件のとき null で返りうる。
 */
export type KbResolvedPageWire = Omit<
  KbResolvedPage,
  'page' | 'ancestors' | 'lastEditedBy' | 'lastEditedAt' | 'cover' | 'labels'
> & {
  page: KbPageWire;
  ancestors?: KbAncestorRef[] | null;
  lastEditedBy?: KbEditorRef | null;
  lastEditedAt?: string | null;
  cover?: KbResolvedCover | null;
  labels?: KbLabel[] | null;
};

export function normalizeResolvedPage(raw: KbResolvedPageWire): KbResolvedPage {
  return {
    ...raw,
    page: normalizePage(raw.page),
    ancestors: toArray<KbAncestorRef>(raw.ancestors),
    lastEditedBy: raw.lastEditedBy ?? null,
    lastEditedAt: raw.lastEditedAt ?? null,
    cover: raw.cover ?? null,
    labels: toArray<KbLabel>(raw.labels),
  };
}

export type KbPageContentSaveResultWire = Omit<KbPageContentSaveResult, 'lastEditedBy' | 'lastEditedAt'> & {
  lastEditedBy?: KbEditorRef | null;
  lastEditedAt?: string | null;
};

export function normalizeSaveResult(raw: KbPageContentSaveResultWire): KbPageContentSaveResult {
  return { ...raw, lastEditedBy: raw.lastEditedBy ?? null, lastEditedAt: raw.lastEditedAt ?? null };
}

export type KbFavoritePageWire = Omit<KbFavoritePage, 'icon'> & { icon?: KbIcon | null };

export function normalizeFavorite(raw: KbFavoritePageWire): KbFavoritePage {
  return { ...raw, icon: raw.icon ?? null };
}

export type KbRecentPageWire = Omit<KbRecentPage, 'icon'> & { icon?: KbIcon | null };

export function normalizeRecentPage(raw: KbRecentPageWire): KbRecentPage {
  return { ...raw, icon: raw.icon ?? null };
}

/** 雛形の生の応答。ワークスペース全体の雛形は spaceId がキーごと欠ける。 */
export type KbPageTemplateWire = Omit<KbPageTemplate, 'icon' | 'spaceId'> & {
  icon?: KbIcon | null;
  spaceId?: string | null;
};

export function normalizeTemplate(raw: KbPageTemplateWire): KbPageTemplate {
  return { ...raw, icon: raw.icon ?? null, spaceId: raw.spaceId ?? null };
}
