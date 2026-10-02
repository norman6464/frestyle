import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Avatar } from '@/shared/ui';
import type { MentionCandidate } from './mentionSuggestion';

export interface MentionMenuListProps {
  items: MentionCandidate[];
  /** `@` のあとに打った文字（空なら全員が出るので案内は要らない。該当なしのときだけ文言を出す）。 */
  query: string;
  /** 項目確定時に呼ばれる（Enter / クリック）。 */
  onSelect: (item: MentionCandidate) => void;
  /** listbox 要素に付与する id（editor 側の aria-controls と対にする）。 */
  listboxId?: string;
  /** 選択中 option の id が変わるたびに通知する（SlashMenuList と同じ形）。 */
  onActiveChange?: (optionId: string) => void;
}

/** MentionMenuListHandle は Suggestion の onKeyDown からキー操作を流し込むためのハンドル。 */
export interface MentionMenuListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

function optionId(listboxId: string | undefined, item: MentionCandidate): string {
  return `${listboxId ?? 'rte-mention'}-option-${item.userId}`;
}

/**
 * MentionMenuList は `@` の候補リスト（presentational）。
 * PageRefMenuList と同じ形: 矢印キーで選択、Enter で確定、フォーカスは本文に残し
 * aria-activedescendant で伝える。1 行は 頭文字の丸・名前（チケットの発言の候補と同じ読み方）。
 */
const MentionMenuList = forwardRef<MentionMenuListHandle, MentionMenuListProps>(function MentionMenuList(
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
      <p className="rte-slash-empty">{query.trim() === '' ? '名指しできる人がいません' : '該当する人がいません'}</p>
    );
  }

  return (
    <ul id={listboxId} role="listbox" aria-label="名指しする相手" className="rte-slash-list">
      {items.map((item, index) => (
        <li
          key={item.userId}
          id={optionId(listboxId, item)}
          role="option"
          aria-selected={index === selectedIndex}
          className={`rte-slash-item ${index === selectedIndex ? 'is-active' : ''}`}
          onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
          onClick={() => onSelect(item)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span className="rte-slash-glyph" aria-hidden="true">
            <Avatar name={item.name} size="sm" />
          </span>
          <span className="rte-slash-label">{item.name}</span>
        </li>
      ))}
    </ul>
  );
});

export default MentionMenuList;
