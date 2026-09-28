import type { KbPage, KbSpace } from '@/entities/kb';

/**
 * 表示順（スペースの並び → 見えるスペースに無いもの）に平坦化した検索結果 1 面分。
 *
 * T は KbPage 自身、または検索結果（KbSearchResult — matchField/excerpt 等を持つ）。
 * ジェネリクスにしているのは、束ねる際に一致箇所の情報（excerpt 等）を型ごと
 * 消してしまわないため（KbPage 固定だと、呼び出し側で毎回 as で戻す必要が出る）。
 */
export interface SearchView<T extends KbPage = KbPage> {
  groups: { space: KbSpace; pages: T[] }[];
  orphan: T[];
  flat: T[];
}

/**
 * buildSearchView は結果をスペースごとに束ね、キーボード選択用の平坦な並びも作る。
 *
 * 結果は木の形では出さない — 一致した行の祖先は応答に含まれておらず、フロントで
 * 木を組み立てるとサーバーの伏せた祖先を推測で埋めることになる。場所の手掛かりは
 * スペースの見出しまで。見えるスペース一覧に無いスペースのページ（個別に許可された
 * ページ等）は名前が引けないので、末尾に見出しなしで並べる（落とすと「検索では
 * 返ったのに画面に出ない」という消え方をする）。
 */
export function buildSearchView<T extends KbPage>(pages: T[], spaces: KbSpace[]): SearchView<T> {
  const bySpace = new Map<string, T[]>();
  for (const page of pages) {
    const list = bySpace.get(page.spaceId) ?? [];
    list.push(page);
    bySpace.set(page.spaceId, list);
  }
  const groups = spaces
    .filter((space) => bySpace.has(space.id))
    .map((space) => ({ space, pages: bySpace.get(space.id) ?? [] }));
  const known = new Set(spaces.map((space) => space.id));
  const orphan = pages.filter((page) => !known.has(page.spaceId));
  return { groups, orphan, flat: [...groups.flatMap((g) => g.pages), ...orphan] };
}
