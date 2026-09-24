import { useEffect, useId, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog } from '@base-ui/react/dialog';
import { FsIcon } from '@/shared/ui';
import { useCommandPalette } from '../model/useCommandPalette';
import type { CommandItem } from '../config/commandPaletteItems';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

// キーボードの操作の案内（↑↓・Enter・Esc）は、マウスとキーボードで使う環境でだけ出す。
// タッチ端末ではこれらのキーが無く、押せない案内が並ぶだけになる。
const FINE_POINTER_ONLY = 'hidden [@media(hover:hover)_and_(pointer:fine)]:flex';

/**
 * CommandPalette は ⌘K / Ctrl+K で開く「移動先を探す」窓。
 *
 * - Base UI の Dialog に載せる。開いている間は Tab が窓の中だけを回り、背面へ抜けない。
 *   閉じたら、開く前にフォーカスがあった場所へ戻る。Esc・背景を押すでも閉じる
 * - 入力欄は combobox、候補は listbox。フォーカスは入力欄に置いたまま、上下キーで選ぶ候補を
 *   `aria-activedescendant` で読み上げに伝える（候補一覧へ Tab で移らなくてよい）
 * - 候補にマウスを乗せると選択もそこへ動く（乗せた行と選択の行を別の色で並べない）
 */
export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { query, selectedIndex, filteredItems, setQuery, selectNext, selectPrev, select, close } = useCommandPalette();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    // Dialog の initialFocus も入力欄を指すが、描画直後に確実に置いておく
    // （開いた直後に打ち始めた文字を取りこぼさない）。
    inputRef.current?.focus();
  }, [isOpen, setQuery]);

  const closeAll = useCallback(() => {
    close();
    onClose();
  }, [close, onClose]);

  const executeCommand = useCallback((item: CommandItem) => {
    if (item.action.type === 'navigate') {
      navigate(item.action.path);
    }
    closeAll();
  }, [navigate, closeAll]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // 日本語入力の変換キャンセルの Escape は窓を閉じる操作ではない（打ちかけの検索語を守る）。
    // Dialog は Escape を文書全体で拾って閉じるので、ここで止める。
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      if (e.key === 'Escape') e.stopPropagation();
      if (e.key !== 'Enter') return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeAll();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectNext();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectPrev();
      return;
    }
    if (e.key === 'Enter') {
      // 日本語入力の変換確定 Enter は選択の確定ではない。isComposing を見ないと、
      // 検索語を変換するたびに、そのとき選ばれているコマンドが実行されてしまう
      // （keyCode 229 は Safari の変換中の値）。
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        executeCommand(filteredItems[selectedIndex]);
      }
    }
  }, [closeAll, selectNext, selectPrev, filteredItems, selectedIndex, executeCommand]);

  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector('[aria-selected="true"]');
    if (selected && typeof selected.scrollIntoView === 'function') {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // カテゴリ別にグループ化
  const categories = new Map<string, { items: CommandItem[]; startIndex: number }>();
  let idx = 0;
  for (const item of filteredItems) {
    if (!categories.has(item.category)) {
      categories.set(item.category, { items: [], startIndex: idx });
    }
    categories.get(item.category)!.items.push(item);
    idx++;
  }

  const hasResults = filteredItems.length > 0;
  // 絞り込んだ結果を読み上げに伝える（目で見えている件数・「無い」を、画面を見ない人にも）。
  // 画面に出ている「該当するコマンドがありません」とは言い回しを変える（同じ文字が 2 か所に
  // あると、読み上げの領域と見える文字の区別が付かない）。
  const resultAnnouncement = query.trim()
    ? hasResults
      ? `${filteredItems.length} 件の移動先`
      : '一致する移動先は 0 件です'
    : '';

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) closeAll(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop
          data-testid="command-palette-overlay"
          className="fixed inset-0 z-[100] bg-black/50"
          onClick={closeAll}
        />
        <Dialog.Popup
          aria-modal="true"
          initialFocus={inputRef}
          className="fixed left-1/2 top-[12vh] z-[100] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--color-surface-3)] bg-[var(--color-surface-1)] shadow-2xl focus:outline-none sm:top-[20vh]"
        >
          <Dialog.Title className="sr-only">移動先を探す</Dialog.Title>

          {/* 検索入力 */}
          <div className="flex items-center gap-3 border-b border-[var(--color-surface-3)] py-2 pl-4 pr-2">
            <FsIcon name="search" className="h-5 w-5 flex-shrink-0 text-[var(--color-text-muted)]" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label="移動先を探す"
              aria-expanded={hasResults}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={hasResults ? optionId(selectedIndex) : undefined}
              placeholder="移動先を探す..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-h-10 flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none"
            />
            <kbd className={`${FINE_POINTER_ONLY} items-center rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-text-muted)]`}>
              ESC
            </kbd>
            <Dialog.Close
              aria-label="閉じる"
              className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            >
              <FsIcon name="x" className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <p role="status" className="sr-only">
            {resultAnnouncement}
          </p>

          {/*
            コマンドリスト。

            一致が無いときは listbox にしない。listbox は「選べるものが並んでいる」という
            約束なので、中身が空のまま名乗ると、読み上げソフトには選択肢があるように伝わって
            何も無い、という食い違いになる。

            フォーカスは入力欄に置いたまま（aria-activedescendant）なので、一覧は Tab の
            止まり先にしない。選択は上下キーで動かし、見えない位置なら自動でスクロールする。
          */}
          {!hasResults ? (
            <div className="max-h-80 overflow-y-auto p-2">
              <div className="px-3 py-8 text-center text-sm text-[var(--color-text-muted)]">
                該当するコマンドがありません
              </div>
            </div>
          ) : (
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label="移動先"
              // スクロールできる箱はブラウザが勝手に Tab の止まり先にする。フォーカスは入力欄に
              // 置いたまま選ぶ作りなので、ここには止まらせない。
              tabIndex={-1}
              className="max-h-80 overflow-y-auto p-2"
            >
              {Array.from(categories.entries()).map(([category, { items, startIndex }]) => (
                <div key={category} role="group" aria-label={category}>
                  <div aria-hidden="true" className="px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)]">
                    {category}
                  </div>
                  {items.map((item, i) => {
                    const globalIndex = startIndex + i;
                    const isSelected = globalIndex === selectedIndex;
                    return (
                      <div
                        key={item.id}
                        id={optionId(globalIndex)}
                        role="option"
                        aria-selected={isSelected}
                        // 選択中は塗りに加えて左の縦罫（brand-600。白地で 5:1）で示す。
                        // 薄い塗りだけだと白地に 1.2:1 ほどで、どこを選んでいるか見えない。
                        className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                          isSelected
                            ? 'bg-[var(--color-nav-selected)] text-[var(--color-nav-selected-text)] shadow-[inset_3px_0_0_var(--color-nav-selected-rule)]'
                            : 'text-[var(--color-text-secondary)]'
                        }`}
                        onClick={() => executeCommand(item)}
                        onMouseMove={() => {
                          if (!isSelected) select(globalIndex);
                        }}
                      >
                        <FsIcon name={item.icon} className="h-4 w-4 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{item.label}</div>
                          {item.description && (
                            <div className="truncate text-xs text-[var(--color-text-muted)]">
                              {item.description}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* フッター（キーボードの案内）。タッチ端末では出さない。 */}
          <div className={`${FINE_POINTER_ONLY} items-center gap-4 border-t border-[var(--color-surface-3)] px-4 py-2 text-xs text-[var(--color-text-muted)]`}>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-2)] px-1 py-0.5 font-mono">↑↓</kbd>
              移動
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-2)] px-1 py-0.5 font-mono">↵</kbd>
              実行
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-[var(--color-surface-3)] bg-[var(--color-surface-2)] px-1 py-0.5 font-mono">esc</kbd>
              閉じる
            </span>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
