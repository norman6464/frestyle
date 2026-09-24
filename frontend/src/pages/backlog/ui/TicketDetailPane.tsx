import { useEffect, useRef, type ReactNode } from 'react';
import { useResizablePanel } from '@/shared/lib/hooks/useResizablePanel';

const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 360;
const MAX_WIDTH_RATIO = 0.55;
const STORAGE_KEY = 'frestyle.panel.ticket-detail.width';

export interface TicketDetailPaneProps {
  /** 上の帯（選択中 KEY・並び替え・選択解除）。見出し h2 を含む。 */
  band: ReactNode;
  /** 閉じる（Escape）。呼び出し側が選択を外し、行へフォーカスを戻す。 */
  onClose: () => void;
  /**
   * 開いた直後に帯の見出しへフォーカスを移すか。行を押して開いたときだけ true
   * （URL から選択付きで開いたときに、読み込みと同時にフォーカスを奪わない）。
   */
  autoFocus: boolean;
  children: ReactNode;
}

/** 入力中の欄の Escape は欄のもの（打ちかけを消さない）。閉じる判定から外す。 */
function isEditable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[contenteditable="true"], textarea, input, select') !== null;
}

/**
 * 広い画面の詳細（設計ボード ST10）。一覧の右に並ぶ列で、幅は境界線をつまんで変えられる。
 *
 * ランドマークは aside（「選択中のチケット」）。開いたら帯の見出しへフォーカスを移し、
 * Escape で閉じる（ST14 の 04「開くと見出しへ、閉じると起点へ、Esc で閉じる」）。
 * 入力中の欄の Escape と、選択欄の候補など列の外へ描かれる物の Escape は閉じる判定に使わない。
 *
 * 狭い画面用の DOM は持たない（呼び出し側が画面幅で TicketDetailSheet と出し分ける）。
 * 同じ中身を 2 か所に描くと、取得も下書きも二重に動く。
 */
export default function TicketDetailPane({ band, onClose, autoFocus, children }: TicketDetailPaneProps) {
  const asideRef = useRef<HTMLElement>(null);
  const resize = useResizablePanel({
    side: 'right',
    storageKey: STORAGE_KEY,
    defaultWidth: DEFAULT_WIDTH,
    minWidth: MIN_WIDTH,
    maxWidthRatio: MAX_WIDTH_RATIO,
  });

  // 開いた直後（このチケットで初めて描かれたとき）に帯の見出しへ。呼び出し側は key を
  // チケットごとに変えるので、別のチケットを選び直したときもここを通る。
  useEffect(() => {
    if (autoFocus) asideRef.current?.querySelector<HTMLElement>('h2')?.focus();
    // 開いた瞬間の 1 回だけ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <aside
      ref={asideRef}
      aria-label="選択中のチケット"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        const target = event.target as Node | null;
        // React のイベントはポータルの中からも上ってくる。列の DOM の中で起きたものだけを見る。
        if (!target || !asideRef.current?.contains(target) || isEditable(event.target)) return;
        event.preventDefault();
        onClose();
      }}
      className="relative flex shrink-0 flex-col self-stretch border-l border-surface-3 bg-surface-1"
      style={{ width: resize.width }}
    >
      <div className="shrink-0 border-b border-surface-3">{band}</div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="詳細の幅を変更する"
        aria-valuenow={Math.round(resize.width)}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={Math.round(window.innerWidth * MAX_WIDTH_RATIO)}
        tabIndex={0}
        onMouseDown={resize.onHandleMouseDown}
        onKeyDown={resize.onHandleKeyDown}
        className="group/resize absolute inset-y-0 -left-1 w-2 cursor-col-resize outline-none"
      >
        <div
          className={`mx-auto h-full w-0.5 transition-colors ${
            resize.isResizing
              ? 'bg-brand-600'
              : 'bg-transparent group-hover/resize:bg-brand-500 group-focus-visible/resize:bg-brand-600'
          }`}
        />
      </div>
    </aside>
  );
}
