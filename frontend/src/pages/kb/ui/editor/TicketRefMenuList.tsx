import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { FsIcon, type FsIconName } from '@/shared/ui';
import type { TicketRefCandidate } from './ticketRefSuggestion';
import type { TicketRefStatusCategory } from './schemaExtensions';

export interface TicketRefMenuListProps {
  items: TicketRefCandidate[];
  /** `#` のあとに打った文字（空なら「鍵か題名を入力」の案内を出す）。 */
  query: string;
  /** 項目確定時に呼ばれる（Enter / クリック）。 */
  onSelect: (item: TicketRefCandidate) => void;
  /** listbox 要素に付与する id（editor 側の aria-controls と対にする）。 */
  listboxId?: string;
  /** 選択中 option の id が変わるたびに通知する（SlashMenuList と同じ形）。 */
  onActiveChange?: (optionId: string) => void;
}

/** TicketRefMenuListHandle は Suggestion の onKeyDown からキー操作を流し込むためのハンドル。 */
export interface TicketRefMenuListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/**
 * 状態の枠ごとの印。entities/ticket の STATUS_ICON と同じ形（未着手＝空の輪・進行中＝輪の中に
 * 点・完了＝輪の中に印）。本文エディタは entities を読まない（候補の形は検索の応答で決まる）
 * ので、対応表だけをここに持つ。
 */
const STATUS_GLYPH: Record<TicketRefStatusCategory, FsIconName> = {
  todo: 'status-todo',
  in_progress: 'status-progress',
  done: 'status-done',
};

function optionId(listboxId: string | undefined, item: TicketRefCandidate): string {
  return `${listboxId ?? 'rte-ticketref'}-option-${item.id}`;
}

/**
 * TicketRefMenuList は `#` の候補リスト（presentational）。
 * PageRefMenuList と同じ形: 矢印キーで選択、Enter で確定、フォーカスは本文に残し
 * aria-activedescendant で伝える。1 行は 鍵・題名・状態 の順（バックログの一覧と同じ並び）。
 */
const TicketRefMenuList = forwardRef<TicketRefMenuListHandle, TicketRefMenuListProps>(function TicketRefMenuList(
  { items, query, onSelect, listboxId, onActiveChange },
  ref,
) {
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
    return (
      <p className="rte-slash-empty">
        {query.trim() === '' ? 'チケットの鍵か題名を入力' : '該当するチケットがありません'}
      </p>
    );
  }

  return (
    <ul id={listboxId} role="listbox" aria-label="チケットの候補" className="rte-slash-list">
      {items.map((item, index) => (
        <li
          key={item.id}
          id={optionId(listboxId, item)}
          role="option"
          aria-selected={index === selectedIndex}
          className={`rte-slash-item ${index === selectedIndex ? 'is-active' : ''}`}
          onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
          onClick={() => onSelect(item)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span className="rte-slash-glyph" aria-hidden="true">
            <FsIcon name={STATUS_GLYPH[item.statusCategory] ?? 'status-todo'} className="h-4 w-4" />
          </span>
          <span className="rte-ticketref-key">{item.key}</span>
          <span className="rte-slash-label">{item.title}</span>
          <span className="rte-slash-trigger">{item.statusName}</span>
        </li>
      ))}
    </ul>
  );
});

export default TicketRefMenuList;
