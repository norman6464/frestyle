import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Avatar } from '@/shared/ui';
import type { WorkspaceMember } from '@/entities/workspace';

export interface MentionMenuListProps {
  items: WorkspaceMember[];
  /** 項目確定時に呼ばれる（Enter / クリック）。 */
  onSelect: (item: WorkspaceMember) => void;
  /** listbox 要素に付与する id（editor 側の aria-controls と対にする）。 */
  listboxId?: string;
  /**
   * 選択中 option の id が変わるたびに通知する。DOM フォーカスは editor（textbox）に
   * 残るため、呼び出し側が textbox の aria-activedescendant に反映してスクリーンリーダーへ
   * 選択中項目を伝える（SlashMenuList と同じ形）。
   */
  onActiveChange?: (optionId: string) => void;
}

/** MentionMenuListHandle は Suggestion の onKeyDown からキー操作を流し込むためのハンドル。 */
export interface MentionMenuListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

function optionId(listboxId: string | undefined, item: WorkspaceMember): string {
  return `${listboxId ?? 'ticket-mention'}-option-${item.userId}`;
}

/**
 * MentionMenuList は '@' メニューの候補リスト（presentational）。
 * SlashMenuList.tsx と同じ形（矢印キーで選択・Enter で確定・位置決めは呼び出し側）。
 */
const MentionMenuList = forwardRef<MentionMenuListHandle, MentionMenuListProps>(
  function MentionMenuList({ items, onSelect, listboxId, onActiveChange }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useEffect(() => {
      const item = items[selectedIndex];
      if (item) onActiveChange?.(optionId(listboxId, item));
    }, [items, selectedIndex, listboxId, onActiveChange]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent): boolean => {
        if (items.length === 0) return false;
        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length);
          return true;
        }
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === 'Enter') {
          const item = items[selectedIndex];
          if (item) onSelect(item);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return <p className="rounded-lg border border-surface-3 bg-surface-1 px-2 py-1.5 text-xs text-[var(--color-text-muted)]">該当する人がいません</p>;
    }

    return (
      <ul
        id={listboxId}
        role="listbox"
        aria-label="名指しする相手"
        className="max-h-48 w-56 overflow-y-auto rounded-lg border border-surface-3 bg-surface-1 p-1 shadow-lg"
      >
        {items.map((item, index) => (
          <li
            key={item.userId}
            id={optionId(listboxId, item)}
            role="option"
            aria-selected={index === selectedIndex}
            className={`flex items-center gap-2 rounded px-1.5 py-1 text-sm ${
              index === selectedIndex ? 'bg-brand-50' : ''
            }`}
            onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
            onClick={() => onSelect(item)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <Avatar name={item.name} size="sm" />
            <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">{item.name}</span>
          </li>
        ))}
      </ul>
    );
  },
);

export default MentionMenuList;
