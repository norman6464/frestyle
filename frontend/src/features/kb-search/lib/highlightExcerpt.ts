/**
 * 検索結果の抜粋（excerpt）を、一致箇所を挟んだ 3 つの文字列に分ける。
 *
 * matchStart / matchLen は **excerpt 文字列内での**一致開始位置と長さ（backend の
 * KbSearchResult と同じ約束 — ページ本文全体での位置ではない）。
 *
 * ここでは HTML 文字列を組み立てない（`<mark>` タグの文字列を作って
 * dangerouslySetInnerHTML で流し込む、ということをしない）。呼び出し側
 * （KbSearchResultRow）が before / match / after の 3 つをそれぞれ別々の React ノード
 * として描画すれば、excerpt に `<` `>` `&` 等の HTML として解釈され得る文字が
 * 含まれていても、React が通常の文字列描画として扱う（HTML として解釈しない）ので
 * 安全になる。ここではその 3 分割だけを担う。
 */
export interface HighlightSegments {
  before: string;
  match: string;
  after: string;
}

/**
 * splitExcerptMatch は matchStart / matchLen を excerpt の範囲にクランプしてから
 * 3 分割する。backend の値が旧仕様や想定外（負数・excerpt の長さを超える等）でも
 * 画面を落とさない（防御的な丸め — 呼び出し側は境界チェックを気にしなくてよい）。
 *
 * matchLen が 0（または丸めた結果 0）なら match は空文字になる。呼び出し側は
 * その場合 `<mark>` で囲まず、素の文字列として出してよい。
 */
export function splitExcerptMatch(
  excerpt: string,
  matchStart: number,
  matchLen: number,
): HighlightSegments {
  // backend の matchStart/matchLen は Go の rune 単位（Unicode コードポイント）で計算されて
  // いる（permission_usecase.go の computeSearchExcerpt）。JS の文字列 index/length/slice は
  // UTF-16 コードユニット単位で、絵文字等のサロゲートペア文字を 2 として数える —
  // 単位を揃えないと、そうした文字を含む抜粋でハイライト位置がずれる・サロゲートペアの
  // 片方だけを切り出して壊れた文字になり得る。Array.from はコードポイント単位で反復する
  // （サロゲートペアを 1 要素にまとめる）ので、これで rune 単位と揃える。
  const codePoints = Array.from(excerpt);
  const length = codePoints.length;
  const start = Math.min(Math.max(matchStart, 0), length);
  const end = Math.min(Math.max(start + Math.max(matchLen, 0), start), length);
  return {
    before: codePoints.slice(0, start).join(''),
    match: codePoints.slice(start, end).join(''),
    after: codePoints.slice(end).join(''),
  };
}
