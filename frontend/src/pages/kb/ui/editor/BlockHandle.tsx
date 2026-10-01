import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type RefObject } from 'react';
import { type Editor, useEditorState } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { getEditorCommands } from './editorCommands';
import { selectionForBlock, topLevelBlockOf } from './blockOperations';
import EditorCommandGlyph from './EditorCommandGlyph';

const BLOCK_MENU_COMMANDS = getEditorCommands('block');

/** 乗せているブロックの位置（doc 上の pos）と、本文の器の中での縦位置。 */
interface Hovered {
  pos: number;
  top: number;
}

/**
 * topLevelBlockElement は、本文（.ProseMirror）の中の要素から、doc 直下のブロックに当たる
 * DOM 要素（.ProseMirror の直接の子）を返す。本文の外・本文そのものなら null。
 */
function topLevelBlockElement(proseMirror: HTMLElement, target: EventTarget | null): HTMLElement | null {
  let el = target instanceof Node ? (target.nodeType === Node.TEXT_NODE ? target.parentElement : (target as HTMLElement)) : null;
  while (el && el.parentElement !== proseMirror) {
    el = el.parentElement;
  }
  return el && el !== proseMirror ? el : null;
}

/** 6 つの点の「つかめる」印。読み上げ名はボタンが持つ。 */
function GripGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
      <circle cx="5.5" cy="3.5" r="1.4" />
      <circle cx="10.5" cy="3.5" r="1.4" />
      <circle cx="5.5" cy="8" r="1.4" />
      <circle cx="10.5" cy="8" r="1.4" />
      <circle cx="5.5" cy="12.5" r="1.4" />
      <circle cx="10.5" cy="12.5" r="1.4" />
    </svg>
  );
}

/**
 * BlockHandle は本文の左に出る「ブロックの取っ手」。
 *
 * - ブロックにマウスを乗せると、そのブロックの高さに合わせて左の余白に出る
 * - つかんで動かすと並べ替え（ProseMirror の drop に任せる。view.dragging に「移動」として渡す）
 * - 押すと小さなメニュー: 上へ移動・下へ移動・複製・削除（命令は '/' や Alt+↑↓ と同じもの）
 *
 * 公式の取っ手（@tiptap/extension-drag-handle）を使わないのは、共同編集用の部品
 * （y-tiptap・collaboration）を実行時に無条件に読み込み、使わない yjs 一式が本番の塊に入るため。
 */
export default function BlockHandle({ editor, containerRef }: { editor: Editor; containerRef: RefObject<HTMLDivElement | null> }) {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;
  const hideTimer = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const cancelHide = () => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };
  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => {
      if (!menuOpenRef.current) setHovered(null);
    }, 200);
  };

  // 本文のブロックに乗ったら、その（いちばん外の）ブロックを覚える。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const proseMirror = editor.view.dom;
    const onOver = (event: MouseEvent) => {
      const blockEl = topLevelBlockElement(proseMirror, event.target);
      if (!blockEl) return;
      cancelHide();
      if (menuOpenRef.current) return;
      // (blockEl, 0) は「ブロックの中身の先頭」。そこから doc 直下のブロックの位置へ戻す。
      const inside = editor.view.posAtDOM(blockEl, 0);
      const block = topLevelBlockOf(editor.state.doc.resolve(inside));
      if (!block) return;
      const top = blockEl.getBoundingClientRect().top - container.getBoundingClientRect().top;
      setHovered((prev) => (prev && prev.pos === block.pos && prev.top === top ? prev : { pos: block.pos, top }));
    };
    container.addEventListener('mouseover', onOver);
    container.addEventListener('mouseleave', scheduleHide);
    return () => {
      container.removeEventListener('mouseover', onOver);
      container.removeEventListener('mouseleave', scheduleHide);
      cancelHide();
    };
    // scheduleHide / cancelHide は描画ごとに作られるが、中で参照するのは ref だけ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, containerRef]);

  // メニューを開いたら最初の項目へ焦点を移す（キーボードで続けられるように）。
  useEffect(() => {
    if (!menuOpen) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    first?.focus();
  }, [menuOpen]);

  // メニューの項目の押せる／押せないは、ブロックを選んだあとのエディタの状態から引く。
  const enabled = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => BLOCK_MENU_COMMANDS.map((command) => command.isEnabled?.(currentEditor) ?? true),
  });

  if (!hovered) return null;

  /** 乗せているブロックの中へカーソルを置く（命令はカーソルのあるブロックに効くため）。 */
  const selectHoveredBlock = () => {
    const selection = selectionForBlock(editor.state.doc, hovered.pos);
    if (!selection) return false;
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    return true;
  };

  const closeMenu = (refocus: boolean) => {
    setMenuOpen(false);
    setHovered(null);
    if (refocus) editor.commands.focus();
  };

  const toggleMenu = () => {
    if (menuOpen) {
      closeMenu(true);
      return;
    }
    if (!selectHoveredBlock()) return;
    setMenuOpen(true);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(current + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(current - 1 + items.length) % items.length]?.focus();
    }
  };

  const onDragStart = (event: DragEvent<HTMLButtonElement>) => {
    const node = editor.state.doc.nodeAt(hovered.pos);
    if (!node) return;
    const selection = NodeSelection.create(editor.state.doc, hovered.pos);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    // ProseMirror の drop は view.dragging を見て「移動」として扱う（元の場所から消し、落とした場所へ入れる）。
    editor.view.dragging = { slice: selection.content(), move: true };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', node.textContent);
    const blockEl = editor.view.nodeDOM(hovered.pos);
    if (blockEl instanceof HTMLElement) event.dataTransfer.setDragImage(blockEl, 0, 0);
    setMenuOpen(false);
  };

  const onDragEnd = () => {
    // 本文の外で離したときに「移動中」のまま残らないようにする（本文の中で離せば drop が片付ける）。
    editor.view.dragging = null;
    setHovered(null);
  };

  return (
    <div className="rte-block-handle" style={{ top: hovered.top }} onMouseEnter={cancelHide} onMouseLeave={scheduleHide}>
      <button
        type="button"
        aria-label="ブロックの操作"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="つかんで並べ替え・押して操作"
        draggable
        className="rte-block-handle__grip ui-hit"
        // 押下で本文の選択が外れないようにする。
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggleMenu}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <GripGlyph />
      </button>
      {menuOpen && (
        <div ref={menuRef} role="menu" aria-label="ブロックの操作" className="rte-block-menu" onKeyDown={onMenuKeyDown}>
          {BLOCK_MENU_COMMANDS.map((command, index) => (
            <button
              key={command.id}
              type="button"
              role="menuitem"
              disabled={!enabled[index]}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                command.run(editor);
                closeMenu(false);
              }}
            >
              {/* 字面（glyph）が読み上げ名と重ならないよう、線のアイコンがあるときだけ印を出す。 */}
              {command.icon ? <EditorCommandGlyph command={command} /> : <span aria-hidden="true" className="w-4" />}
              <span>{command.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
