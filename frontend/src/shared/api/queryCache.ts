import type { DataTag, QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * reflectWrite は、書き込み（作成・改名・削除・保存）の応答を共有の結果へ映す。
 * 書き込んだあとに setQueryData を直接呼ばず、必ずここを通す。
 *
 * 1. その鍵で飛んでいる取得を止める。止めないと、書き込みより前に投げた取得の古い結果が
 *    あとから届き、映したばかりの変更を上書きする（作ったものが消える・改名が戻る）
 * 2. 結果を持っていれば update で差し替える（取り直さない）
 * 3. まだ持っていなければ（最初の読み込み中に書いた）、差し替えずに取り直させる。
 *    無い一覧に足すと「書いた 1 件だけの一覧」ができ、ほかの項目が消えて見える
 */
export async function reflectWrite<TData>(
  queryClient: QueryClient,
  queryKey: DataTag<QueryKey, TData, Error>,
  update: (prev: TData) => TData,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey, exact: true });
  const prev = queryClient.getQueryData(queryKey);
  if (prev === undefined) {
    void queryClient.invalidateQueries({ queryKey, exact: true });
    return;
  }
  queryClient.setQueryData(queryKey, update(prev));
}
