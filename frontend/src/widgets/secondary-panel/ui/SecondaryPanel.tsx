import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  XMarkIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
} from '@heroicons/react/24/outline';
import { usePanelMode } from '@/shared/lib/hooks/usePanelMode';
import { useResizablePanel } from '@/shared/lib/hooks/useResizablePanel';

// リサイズの既定幅・下限・上限（画面幅に対する割合）。固定表示・通常表示どちらでも共通。
const RESIZE_DEFAULT_WIDTH = 288; // w-72 相当
const RESIZE_MIN_WIDTH = 288;
const RESIZE_MAX_WIDTH_RATIO = 0.5;

interface SecondaryPanelProps {
  title: string;
  badge?: string;
  /**
   * 見出しと**同じ行**の右端に置く小物（閉じる・全画面で開く等）。
   * headerContent は見出しの下の段に置かれるので、アイコンだけの操作はこちらを使う
   * —— 見出し 1 行とアイコン 1 行で 2 段になると、上が無駄に厚くなる。
   */
  headerActions?: React.ReactNode;
  headerContent?: React.ReactNode;
  children: React.ReactNode;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  /** デスクトップでパネルを折りたたみ可能にする（章一覧などで本文幅を稼ぐ用途）。 */
  collapsible?: boolean;
  /** collapsible のとき、 折りたたみ中かどうか。 */
  collapsed?: boolean;
  /** 折りたたみ / 展開のトグル。 */
  onToggleCollapsed?: () => void;
  /**
   * 一時表示モード（デスクトップ）。« で隠すと本文が全幅になり、左端ホバーか ☰ で
   * オーバーレイとして浮いて出る。☰ / » クリックで固定へ戻る。状態は storageKey ごとに保存。
   * collapsible とは独立の新しい機構（指定時は collapsible を無視する）。
   */
  peekable?: boolean;
  /** peekable の表示モードを保存する localStorage キー（画面ごとに分ける）。 */
  storageKey?: string;
  /**
   * モバイルの固定パネルがどちら側からスライドインするか（既定 'left'）。
   *
   * デスクトップの表示（peekable / collapsible / 通常）は呼び出し側の DOM 順（flex の並び）
   * で位置が決まるのでこの prop の影響を受けない。**モバイルだけ** 'fixed inset-y-0 left-0'
   * に固定されていたので、右側の面（コメント等）を追加すると左のサイドバーと見分けが
   * つかず両方「左からスライドイン」してしまう問題への対処。
   */
  side?: 'left' | 'right';
  /**
   * 本文と接する側の縁をドラッグして横幅を変えられるようにする（固定表示・通常表示のみ。
   * 一時表示のオーバーレイ・折りたたみ中の細い帯・モバイルは対象外）。上限は画面幅の半分。
   */
  resizable?: boolean;
  /** resizable の横幅を覚える localStorage キー。省略時は保存されず、再訪では defaultWidth に戻る。 */
  resizeStorageKey?: string;
  /** resizable の既定幅（px）。省略時 288（w-72 相当）。 */
  defaultWidth?: number;
}

/** PanelTooltip は «/»/☰ に付けるホバー説明（ラベル＋ショートカット）。 */
function PanelTooltip({ label, align = 'left' }: { label: string; align?: 'left' | 'right' }) {
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute top-full z-50 mt-1.5 hidden whitespace-pre rounded-md bg-[var(--color-text-primary)] px-2 py-1.5 text-xs font-medium leading-tight text-[var(--color-surface-1)] shadow-lg group-hover/ptip:block ${
        align === 'right' ? 'right-0' : 'left-0'
      }`}
    >
      {`${label}\n⌘\\`}
    </span>
  );
}

/** PanelHeader はデスクトップパネルの見出し行（タイトル＋バッジ＋トグル）。 */
function PanelHeader({
  title,
  badge,
  headerContent,
  toggle,
}: {
  title: string;
  badge?: string;
  headerContent?: ReactNode;
  toggle?: ReactNode;
}) {
  return (
    <div className="px-4 py-3 border-b border-surface-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 truncate text-sm font-semibold text-[var(--color-text-primary)]">
          {title}
          {badge && <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">{badge}</span>}
        </h2>
        {toggle}
      </div>
      {headerContent && <div className="mt-2">{headerContent}</div>}
    </div>
  );
}

/** ResizeHandle は本文と接する側の縁に置く、ドラッグ／矢印キーで幅を変えるハンドル。 */
function ResizeHandle({
  position,
  width,
  minWidth,
  maxWidth,
  isResizing,
  onMouseDown,
  onKeyDown,
}: {
  position: 'left' | 'right';
  width: number;
  minWidth: number;
  maxWidth: number;
  isResizing: boolean;
  onMouseDown: (event: React.MouseEvent) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="サイドバーの幅を変更する"
      aria-valuenow={Math.round(width)}
      aria-valuemin={minWidth}
      aria-valuemax={Math.round(maxWidth)}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      className={`absolute inset-y-0 ${position === 'right' ? '-right-1' : '-left-1'} w-2 cursor-col-resize outline-none group/resize`}
    >
      <div
        className={`mx-auto h-full w-0.5 transition-colors ${
          isResizing
            ? 'bg-brand-400'
            : 'bg-transparent group-hover/resize:bg-brand-300 group-focus-visible/resize:bg-brand-400'
        }`}
      />
    </div>
  );
}

/**
 * PeekablePanel は「一時表示 / 固定表示」を切り替えられるデスクトップパネル。
 *
 * - 固定表示: レイアウトに居座り、«（サイドバーを閉じる）で一時表示モードへ
 * - 一時表示: 本文が全幅になり、左端ホバーか ☰（サイドバーを固定表示する）で浮いて出る。
 *   »（またはもう一度 ☰）で固定へ戻す。モードは storageKey ごとに保存され ⌘\ でも切替可
 */
function PeekablePanel({
  title,
  badge,
  headerContent,
  children,
  storageKey,
  resizable = false,
  resizeStorageKey,
  defaultWidth = RESIZE_DEFAULT_WIDTH,
}: {
  title: string;
  badge?: string;
  headerContent?: ReactNode;
  children: ReactNode;
  storageKey: string;
  resizable?: boolean;
  resizeStorageKey?: string;
  defaultWidth?: number;
}) {
  const panel = usePanelMode(storageKey);
  const resize = useResizablePanel({
    side: 'left',
    storageKey: resizeStorageKey,
    defaultWidth,
    minWidth: RESIZE_MIN_WIDTH,
    maxWidthRatio: RESIZE_MAX_WIDTH_RATIO,
  });

  // 一時表示 → 固定表示への切り替え「だけ」を検知する。保存済みの初期状態が最初から
  // pinned のとき（通常の再訪・再読み込み）はここを通らないので、毎回の表示では
  // アニメーションしない — 切り替えた瞬間だけ滑り込ませたい。
  const prevModeRef = useRef(panel.mode);
  const [justPinned, setJustPinned] = useState(false);
  useEffect(() => {
    if (prevModeRef.current !== 'pinned' && panel.mode === 'pinned') {
      setJustPinned(true);
      const timer = setTimeout(() => setJustPinned(false), 250);
      prevModeRef.current = panel.mode;
      return () => clearTimeout(timer);
    }
    prevModeRef.current = panel.mode;
  }, [panel.mode]);

  if (panel.mode === 'pinned') {
    return (
      <div
        className={`hidden md:flex ${resizable ? '' : 'w-72'} relative border-r border-surface-3 bg-[var(--color-nav)] flex-col flex-shrink-0 self-stretch ${justPinned ? 'animate-panel-pin' : ''}`}
        style={resizable ? { width: resize.width } : undefined}
      >
        <PanelHeader
          title={title}
          badge={badge}
          headerContent={headerContent}
          toggle={
            <span className="relative group/ptip inline-flex flex-shrink-0">
              <button
                onClick={panel.collapse}
                aria-label="サイドバーを閉じる"
                className="p-1 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                <ChevronDoubleLeftIcon className="w-4 h-4" />
              </button>
              <PanelTooltip label="サイドバーを閉じる" align="right" />
            </span>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {resizable && (
          <ResizeHandle
            position="right"
            width={resize.width}
            minWidth={RESIZE_MIN_WIDTH}
            maxWidth={window.innerWidth * RESIZE_MAX_WIDTH_RATIO}
            isResizing={resize.isResizing}
            onMouseDown={resize.onHandleMouseDown}
            onKeyDown={resize.onHandleKeyDown}
          />
        )}
      </div>
    );
  }

  // 一時表示モード: レイアウト上は何も占有しない。左端ホバーゾーン＋オーバーレイを出す。
  // 固定表示に戻すボタンはヘッダー左端（FreStyle ロゴの左）に出す（widgets/app-shell/ui/Header.tsx）。
  return (
    <>
      {/* 左端のホバー検知ゾーン。ヘッダー直下から下まで。 */}
      <div
        aria-hidden="true"
        className="hidden md:block fixed left-0 bottom-0 z-30 w-2"
        style={{ top: 'var(--app-header-h)' }}
        onMouseEnter={panel.openPeek}
        onMouseLeave={panel.closePeek}
      />

      {/* 一時表示のオーバーレイパネル（本文は動かさない）。 */}
      <div
        onMouseEnter={panel.openPeek}
        onMouseLeave={panel.closePeek}
        style={{ top: 'calc(var(--app-header-h) + 8px)' }}
        className={`hidden md:flex fixed left-0 bottom-2 z-40 w-72 flex-col overflow-hidden rounded-r-xl border border-surface-3 bg-[var(--color-nav)] shadow-xl transition-all duration-200 ease-out ${
          panel.isPeeking ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0 pointer-events-none'
        }`}
      >
        <PanelHeader
          title={title}
          badge={badge}
          headerContent={headerContent}
          toggle={
            <span className="relative group/ptip inline-flex flex-shrink-0">
              <button
                onClick={panel.pin}
                aria-label="サイドバーを固定表示する"
                className="p-1 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                <ChevronDoubleRightIcon className="w-4 h-4" />
              </button>
              <PanelTooltip label="サイドバーを固定表示する" align="right" />
            </span>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </>
  );
}

export default function SecondaryPanel({
  title,
  badge,
  headerActions,
  headerContent,
  children,
  mobileOpen = false,
  onMobileClose,
  collapsible = false,
  collapsed = false,
  onToggleCollapsed,
  peekable = false,
  storageKey,
  side = 'left',
  resizable = false,
  resizeStorageKey,
  defaultWidth = RESIZE_DEFAULT_WIDTH,
}: SecondaryPanelProps) {
  // モバイル固定パネルの位置・境界線・開閉時のスライド方向。左は既定（従来どおり）、
  // 右は開いた面（コメント等）が右から出てくるようにする。
  const mobileSide =
    side === 'right'
      ? { edge: 'right-0', border: 'border-l', closed: 'translate-x-full' }
      : { edge: 'left-0', border: 'border-r', closed: '-translate-x-full' };

  // 通常表示（peekable・collapsible 無し）のリサイズ。フックは常に呼ぶ（React のルール）が、
  // 実際に使う（style を当てる・ハンドルを出す）のは resizable のときだけ。
  const resize = useResizablePanel({
    side,
    storageKey: resizeStorageKey,
    defaultWidth,
    minWidth: RESIZE_MIN_WIDTH,
    maxWidthRatio: RESIZE_MAX_WIDTH_RATIO,
  });

  return (
    <>
      {/* モバイルオーバーレイ */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={onMobileClose}
        />
      )}

      {/* モバイルパネル */}
      <div
        className={`fixed inset-y-0 ${mobileSide.edge} z-50 w-72 bg-[var(--color-nav)] ${mobileSide.border} border-surface-3 flex flex-col transform transition-transform duration-200 md:hidden ${
          mobileOpen ? 'translate-x-0' : mobileSide.closed
        }`}
      >
        <div className="px-4 py-3 border-b border-surface-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {title}
            {badge && <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">{badge}</span>}
          </h2>
          <div className="flex items-center gap-1.5">
            {headerActions}
            <button
              onClick={onMobileClose}
              className="p-1 hover:bg-surface-2 rounded transition-colors"
              aria-label="パネルを閉じる"
            >
              <XMarkIcon className="w-4 h-4 text-[var(--color-text-muted)]" />
            </button>
          </div>
        </div>
        {headerContent && <div className="px-4 py-2 border-b border-surface-3">{headerContent}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>

      {/* デスクトップ: peekable（一時表示/固定）を優先し、従来の collapsible とは独立に扱う。 */}
      {peekable && storageKey ? (
        <PeekablePanel
          title={title}
          badge={badge}
          headerContent={headerContent}
          storageKey={storageKey}
          resizable={resizable}
          resizeStorageKey={resizeStorageKey}
          defaultWidth={defaultWidth}
        >
          {children}
        </PeekablePanel>
      ) : collapsible && collapsed ? (
        // 折りたたみ中: 細い帯に「開く」ボタンだけ出す。本文が全幅に広がる。
        <div className="hidden md:flex w-10 border-x border-surface-3 bg-[var(--color-nav)] flex-col items-center pt-3 flex-shrink-0 self-stretch">
          <button
            onClick={onToggleCollapsed}
            title="パネルを開く"
            aria-label="パネルを開く"
            className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <ChevronDoubleRightIcon className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div
          className={`hidden md:flex ${resizable ? '' : 'w-72'} relative border-x border-surface-3 bg-[var(--color-nav)] flex-col flex-shrink-0 self-stretch`}
          style={resizable ? { width: resize.width } : undefined}
        >
          <PanelHeader
            title={title}
            badge={badge}
            headerContent={headerContent}
            toggle={
              headerActions ?? (collapsible ? (
                <button
                  onClick={onToggleCollapsed}
                  title="パネルを折りたたむ"
                  aria-label="パネルを折りたたむ"
                  className="p-1 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)] transition-colors flex-shrink-0"
                >
                  <ChevronDoubleLeftIcon className="w-4 h-4" />
                </button>
              ) : undefined)
            }
          />
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          {resizable && (
            <ResizeHandle
              position={side === 'right' ? 'left' : 'right'}
              width={resize.width}
              minWidth={RESIZE_MIN_WIDTH}
              maxWidth={window.innerWidth * RESIZE_MAX_WIDTH_RATIO}
              isResizing={resize.isResizing}
              onMouseDown={resize.onHandleMouseDown}
              onKeyDown={resize.onHandleKeyDown}
            />
          )}
        </div>
      )}
    </>
  );
}
