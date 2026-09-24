import { useEffect, useEffectEvent, type RefObject } from 'react';

/**
 * 開いているポップアップ（メニュー・切替一覧）を、外を押したら・Escape で閉じる。
 *
 * `inside` に並べた要素の中で押したときは閉じない。引き金のボタンとポップアップ本体は
 * DOM 上は兄弟で 1 つの枠に包めないことが多いので、ref を複数受ける。
 *
 * - 判定は click ではなく mousedown。click だと、外を押した拍子に外の要素が消えたり動いたり
 *   したとき（別のメニューが開く等）に click が成立せず、閉じ損ねる。
 * - 日本語入力の変換キャンセルの Escape では閉じない。閉じるとポップアップ内の入力欄ごと消え、
 *   打ちかけの文字が失われる（keyCode 229 は Safari の変換中の値）。
 * - `open` が false のあいだは document にリスナーを付けない。
 * - `inside` と `onDismiss` は毎描画で作り直して構わない。effect の依存は open だけで、
 *   最新の値は useEffectEvent 経由で読む（描画ごとにリスナーを付け外ししない）。
 * - `returnFocus` を渡すと、**Escape で閉じたとき**フォーカスをその要素（ふつうは引き金の
 *   ボタン）へ戻す。ポップアップの中にフォーカスがあったまま閉じると、フォーカスの行き先が
 *   消えて body に落ち、キーボードの人は位置を見失う。外を押して閉じたときは戻さない
 *   （押した先へフォーカスが移るのが自然なので）。フォーカスがポップアップの外の別の場所に
 *   あるときも奪わない。
 */
export interface DismissOnOutsideOptions {
  returnFocus?: RefObject<HTMLElement | null>;
}

export function useDismissOnOutside(
  open: boolean,
  inside: ReadonlyArray<RefObject<HTMLElement | null>>,
  onDismiss: () => void,
  options: DismissOnOutsideOptions = {},
): void {
  const onDocumentMouseDown = useEffectEvent((event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (inside.some((ref) => ref.current?.contains(target))) return;
    onDismiss();
  });
  const onDocumentKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key !== 'Escape') return;
    const active = document.activeElement;
    const focusWasInside =
      active === null ||
      active === document.body ||
      inside.some((ref) => ref.current?.contains(active));
    onDismiss();
    if (focusWasInside) options.returnFocus?.current?.focus();
  });

  useEffect(() => {
    if (!open) return;
    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
    };
    // useEffectEvent の戻りは effect の依存に入れない（React の規約。中身は描画ごとに最新へ差し替わる）。
    // eslint-plugin-react-hooks 5 系はこれを知らず「依存が足りない」と言うので、この行だけ黙らせる。
    // 6 系（useEffectEvent を理解する）へ上げたら外す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
