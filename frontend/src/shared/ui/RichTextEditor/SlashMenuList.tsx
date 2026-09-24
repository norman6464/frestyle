import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { EditorCommand } from './editorCommands';
import EditorCommandGlyph from './EditorCommandGlyph';

export interface SlashMenuListProps {
  items: EditorCommand[];
  /** 項目確定時に呼ばれる（Enter / クリック）。 */
  onSelect: (item: EditorCommand) => void;
  /** listbox 要素に付与する id（editor 側の aria-controls と対にする）。 */
  listboxId?: string;
  /**
   * 選択中 option の id が変わるたびに通知する。DOM フォーカスは editor（textbox）に
   * 残るため、呼び出し側が textbox の aria-activedescendant に反映して
   * スクリーンリーダーへ選択中項目を伝える。
   */
  onActiveChange?: (optionId: string) => void;
}

/** SlashMenuListHandle は Suggestion の onKeyDown からキー操作を流し込むためのハンドル。 */
export interface SlashMenuListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/** optionId は listbox 内の各 option の安定 id を作る。 */
function optionId(listboxId: string | undefined, item: EditorCommand): string {
  return `${listboxId ?? 'rte-slash'}-option-${item.id}`;
}

/**
 * SlashMenuList は '/' メニューの候補リスト（presentational）。
 * 表示はレジストリの日本語ラベル＋英語トリガ（id）。矢印キーで選択、Enter で確定する。
 * 位置決め・表示切替は呼び出し側（Suggestion の mount）が担う。
 */
const SlashMenuList = forwardRef<SlashMenuListHandle, SlashMenuListProps>(
  function SlashMenuList({ items, onSelect, listboxId, onActiveChange }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);

    // 絞り込みで件数が変わったら先頭へ戻す（範囲外選択を防ぐ）。
    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    // 選択中 option の id を親（editor の aria-activedescendant）へ伝える。
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
      return <p className="rte-slash-empty">該当するコマンドがありません</p>;
    }

    return (
      <ul id={listboxId} role="listbox" aria-label="ブロックの挿入" className="rte-slash-list">
        {items.map((item, index) => (
          // 操作を受けるのは option である li 自身。中にボタンを入れない
          // （listbox の option に押せるものを入れ子にすると、支援技術からは「押せるものの
          //  中に押せるものがある」壊れた形に見え、どちらを選んだのか決まらない）。
          // フォーカスは本文に残したまま、選択は aria-activedescendant で伝えているので、
          // この行自体はフォーカスを受け取らなくてよい。
          <li
            key={item.id}
            id={optionId(listboxId, item)}
            role="option"
            aria-selected={index === selectedIndex}
            className={`rte-slash-item ${index === selectedIndex ? 'is-active' : ''}`}
            // mousedown での blur によりメニューが先に閉じないようにする。
            onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
            onClick={() => onSelect(item)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="rte-slash-glyph" aria-hidden="true">
              <EditorCommandGlyph command={item} />
            </span>
            <span className="rte-slash-label">{item.label}</span>
            <span className="rte-slash-trigger">/{item.id.toLowerCase()}</span>
          </li>
        ))}
      </ul>
    );
  },
);

export default SlashMenuList;
