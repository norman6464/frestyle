import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { FsIcon } from '@/shared/ui';
import type { PageRefCandidate } from './pageRefSuggestion';

export interface PageRefMenuListProps {
  items: PageRefCandidate[];
  /** `[[` のあとに打った文字（空なら「題名を入力」の案内を出す）。 */
  query: string;
  /** 項目確定時に呼ばれる（Enter / クリック）。 */
  onSelect: (item: PageRefCandidate) => void;
  /** listbox 要素に付与する id（editor 側の aria-controls と対にする）。 */
  listboxId?: string;
  /** 選択中 option の id が変わるたびに通知する（SlashMenuList と同じ形）。 */
  onActiveChange?: (optionId: string) => void;
}

/** PageRefMenuListHandle は Suggestion の onKeyDown からキー操作を流し込むためのハンドル。 */
export interface PageRefMenuListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

function optionId(listboxId: string | undefined, item: PageRefCandidate): string {
  return `${listboxId ?? 'rte-pageref'}-option-${item.id}`;
}

/**
 * PageRefMenuList は `[[` の候補リスト（presentational）。
 * SlashMenuList と同じ形: 矢印キーで選択、Enter で確定、フォーカスは本文に残し aria-activedescendant で伝える。
 */
const PageRefMenuList = forwardRef<PageRefMenuListHandle, PageRefMenuListProps>(function PageRefMenuList(
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
    return <p className="rte-slash-empty">{query.trim() === '' ? 'ページの題名を入力' : '該当するページがありません'}</p>;
  }

  return (
    <ul id={listboxId} role="listbox" aria-label="ページの候補" className="rte-slash-list">
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
            <FsIcon name="document" className="h-4 w-4" />
          </span>
          <span className="rte-slash-label">{item.title}</span>
        </li>
      ))}
    </ul>
  );
});

export default PageRefMenuList;
