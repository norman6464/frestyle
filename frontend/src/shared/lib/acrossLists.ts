/**
 * 入れ物（ワークスペースなど）ごとに取る一覧を並べて、その上で「どこにあるか」「最初の 1 つはどれか」
 * を決める判断。ナレッジのスペースの解決と、バックログのプロジェクトの解決が使う。
 *
 * 一覧が取れていない・取り直している間は決めない（作ったばかりのものへ移った直後に「見つからない」
 * を一瞬出さない。並び順どおりに最初の 1 つを選ぶ）。
 */

/** 1 つの入れ物の一覧の、今の取り具合。 */
export interface OwnedListState<T> {
  /** どの入れ物の一覧か（ワークスペースの slug など）。 */
  owner: string;
  data: T[] | undefined;
  isError: boolean;
  isFetching: boolean;
}

export type AcrossListsResolution<T> =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'found'; owner: string; item: T }
  | { kind: 'none' };

/**
 * findAcrossLists は、条件に合うものをどれかの一覧から探す。どこかの一覧にあれば、ほかの一覧を
 * 待たずに決める（ID は入れ物をまたいで一意）。見つからないと言えるのは、すべての一覧がそろい、
 * どれも取り直し中でないときだけ。見つからず、読めなかった一覧があれば失敗（見つからないとは
 * 言えない）。
 */
export function findAcrossLists<T>(lists: OwnedListState<T>[], match: (item: T) => boolean): AcrossListsResolution<T> {
  for (const list of lists) {
    const item = list.data?.find(match);
    if (item !== undefined) return { kind: 'found', owner: list.owner, item };
  }
  if (lists.some((list) => list.isFetching || (list.data === undefined && !list.isError))) return { kind: 'loading' };
  if (lists.some((list) => list.data === undefined)) return { kind: 'error' };
  return { kind: 'none' };
}

/**
 * firstAcrossLists は、並べた順に見て、中身のある最初の一覧の最初の 1 つを選ぶ。前の一覧がまだ
 * 無い・取り直し中なら決めない（後ろの一覧を先に選ぶと、並び順どおりにならない）。空の一覧を
 * 取り直している間も決めない（作ったばかりのものが、取り直せば入ってくる）。
 */
export function firstAcrossLists<T>(lists: OwnedListState<T>[]): AcrossListsResolution<T> {
  for (const list of lists) {
    if (list.data === undefined) return list.isError && !list.isFetching ? { kind: 'error' } : { kind: 'loading' };
    const [first] = list.data;
    if (first !== undefined) return { kind: 'found', owner: list.owner, item: first };
    if (list.isFetching) return { kind: 'loading' };
  }
  return { kind: 'none' };
}
