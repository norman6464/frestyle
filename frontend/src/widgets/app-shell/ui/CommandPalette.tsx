import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FsIcon } from '@/shared/ui';
import { useCommandPalette } from '../model/useCommandPalette';
import type { CommandItem } from '../config/commandPaletteItems';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { query, selectedIndex, filteredItems, setQuery, selectNext, selectPrev, close } = useCommandPalette();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen, setQuery]);

  const executeCommand = useCallback((item: CommandItem) => {
    if (item.action.type === 'navigate') {
      navigate(item.action.path);
    }
    close();
    onClose();
  }, [navigate, close, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      onClose();
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
  }, [close, onClose, selectNext, selectPrev, filteredItems, selectedIndex, executeCommand]);

  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector('[aria-selected="true"]');
    if (selected && typeof selected.scrollIntoView === 'function') {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

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

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh]">
      <div
        data-testid="command-palette-overlay"
        className="absolute inset-0 bg-black/50"
        onClick={() => { close(); onClose(); }}
      />
      <div className="relative w-full max-w-lg bg-[var(--color-surface-1)] border border-[var(--color-surface-3)] rounded-xl shadow-2xl overflow-hidden">
        {/* 検索入力 */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-surface-3)]">
          <FsIcon name="search" className="h-5 w-5 flex-shrink-0 text-[var(--color-text-muted)]" />
          <input
            ref={inputRef}
            type="text"
            placeholder="移動先を探す..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] outline-none text-sm"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-surface-2)] border border-[var(--color-surface-3)] rounded">
            ESC
          </kbd>
        </div>

        {/*
          コマンドリスト。

          一致が無いときは listbox にしない。listbox は「選べるものが並んでいる」という
          約束なので、中身が空のまま名乗ると、読み上げソフトには選択肢があるように伝わって
          何も無い、という食い違いになる。

          tabIndex は 0。縦に流れるスクロール領域は、キーボードだけの人も動かせる必要がある。
        */}
        {filteredItems.length === 0 ? (
          <div className="max-h-80 overflow-y-auto p-2">
            <div className="px-3 py-8 text-center text-sm text-[var(--color-text-muted)]">
              該当するコマンドがありません
            </div>
          </div>
        ) : (
          <div
            ref={listRef}
            role="listbox"
            aria-label="コマンド"
            tabIndex={0}
            className="max-h-80 overflow-y-auto p-2"
          >
            {Array.from(categories.entries()).map(([category, { items, startIndex }]) => (
              <div key={category}>
                <div className="px-3 py-1.5 text-[11px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                  {category}
                </div>
                {items.map((item, i) => {
                  const globalIndex = startIndex + i;
                  const isSelected = globalIndex === selectedIndex;
                  return (
                    <div
                      key={item.id}
                      role="option"
                      aria-selected={isSelected}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[var(--color-surface-3)] text-[var(--color-text-primary)]'
                          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'
                      }`}
                      onClick={() => executeCommand(item)}
                      onMouseEnter={() => {
                        // マウスホバーで選択を変更するならここで
                      }}
                    >
                      <FsIcon name={item.icon} className="h-4 w-4 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{item.label}</div>
                        {item.description && (
                          <div className="text-xs text-[var(--color-text-muted)] truncate">
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

        {/* フッター */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-[var(--color-surface-3)] text-[10px] text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-[var(--color-surface-2)] border border-[var(--color-surface-3)] rounded font-mono">↑↓</kbd>
            移動
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-[var(--color-surface-2)] border border-[var(--color-surface-3)] rounded font-mono">↵</kbd>
            実行
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-[var(--color-surface-2)] border border-[var(--color-surface-3)] rounded font-mono">esc</kbd>
            閉じる
          </span>
        </div>
      </div>
    </div>
  );
}
