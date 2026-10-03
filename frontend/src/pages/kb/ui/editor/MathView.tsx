import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Selection } from '@tiptap/pm/state';
import { MATH_LATEX_MAX_LENGTH } from './schemaExtensions';
import { renderMath } from './lazyRenderers';
import { MATH_EDIT_EVENT, takeMathEditRequest } from './mathAndDiagram';

type RenderState = { kind: 'loading' } | { kind: 'ready'; html: string } | { kind: 'error'; message: string };

/**
 * MathView は数式（行内の数式 inlineMath・行の数式 blockMath）の NodeView。
 *
 * - 描画は lazyRenderers.renderMath（KaTeX を初めて描くときにだけ読む）。読めない式は理由と元の式を出す
 * - 編集は、数式を押す・選んで Enter・挿入した直後に開く入力欄で行う（閲覧モードでは開かない）。
 *   矢印キーで数式を通り過ぎるだけでは開かない（入力欄へ焦点が飛んで本文の移動が止まらないように）
 * - 入力欄を閉じるのは Enter（行内）／Ctrl+Enter（行）／Escape。カーソルは数式の後ろへ戻る
 */
export default function MathView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const display = node.type.name === 'blockMath';
  const latex = typeof node.attrs.latex === 'string' ? node.attrs.latex : '';
  const editable = editor.isEditable;
  const [state, setState] = useState<RenderState>({ kind: 'loading' });
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const editing = open && selected && editable;

  useEffect(() => {
    if (latex.trim() === '') {
      setState({ kind: 'ready', html: '' });
      return;
    }
    let cancelled = false;
    void renderMath(latex, display).then((result) => {
      if (cancelled) return;
      setState('html' in result ? { kind: 'ready', html: result.html } : { kind: 'error', message: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [latex, display]);

  // 挿入した直後（'/'・入力規則）は入力欄を開いた状態で始める。
  useEffect(() => {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (typeof pos === 'number' && takeMathEditRequest(editor, pos)) setOpen(true);
  }, [editor, getPos]);

  // 選択が外れたら閉じる（ほかの場所を押した・矢印で離れた）。
  useEffect(() => {
    if (!selected) setOpen(false);
  }, [selected]);

  // Enter（数式を選んだ状態で押す）は拡張から自前の出来事で届く。
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onEdit = () => setOpen(true);
    el.addEventListener(MATH_EDIT_EVENT, onEdit);
    return () => el.removeEventListener(MATH_EDIT_EVENT, onEdit);
  }, []);

  useEffect(() => {
    if (!editing) return;
    // 押して開いた直後は、離す・click に対する ProseMirror の処理が本文へ焦点を戻すので、
    // その一連が終わってから入力欄へ移す。
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  const leave = () => {
    setOpen(false);
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (typeof pos !== 'number') return;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setSelection(Selection.near(tr.doc.resolve(pos + node.nodeSize)));
        return true;
      })
      .run();
  };

  // 押したら自分で数式を選び、入力欄を開く（選択の切り替えを ProseMirror 任せにすると、押した時点では
  // まだ選ばれておらず開かない）。入力欄の中を押したときは何もしない。
  const openFromPointer = (event: MouseEvent<HTMLElement>) => {
    if (!editable) return;
    if (event.target instanceof Element && event.target.closest('.rte-math-editor, .rte-math-popover')) return;
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (typeof pos !== 'number') return;
    editor.commands.setNodeSelection(pos);
    setOpen(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Escape' || (event.key === 'Enter' && (!display || event.metaKey || event.ctrlKey))) {
      event.preventDefault();
      leave();
    }
  };

  const Tag = display ? 'div' : 'span';
  // 中身の HTML は文字列が変わったときだけ差し替える。毎回新しい object を渡すと、React は描き直すたびに
  // innerHTML を入れ直し、式の中の要素が作り直される（押した要素が離す前に外れて click が出ず、
  // 押しても入力欄が開かなかった）。
  const renderedHtml = useMemo(() => ({ __html: state.kind === 'ready' ? state.html : '' }), [state]);
  const rendered =
    state.kind === 'error' ? (
      <Tag className="rte-math-error" title={state.message}>
        <Tag className="rte-math-error-message">数式を読めません（{state.message}）</Tag>
        <code>{latex}</code>
      </Tag>
    ) : state.kind === 'ready' && state.html === '' ? (
      <Tag className="rte-math-placeholder">{display ? '数式を入力（LaTeX）' : '数式'}</Tag>
    ) : state.kind === 'ready' ? (
      // KaTeX（trust: false）の出力。利用者の文字は KaTeX がエスケープ済み。
      <Tag className="rte-math-rendered" dangerouslySetInnerHTML={renderedHtml} />
    ) : (
      <Tag className="rte-math-loading">{latex}</Tag>
    );

  return (
    <NodeViewWrapper
      as={Tag}
      ref={wrapperRef}
      data-math-view=""
      data-block-id={display && typeof node.attrs.id === 'string' ? node.attrs.id : undefined}
      className={`${display ? 'rte-math-block' : 'rte-math-inline'}${selected ? ' is-selected' : ''}`}
      // 離したとき（mouseup）にも開く。ブラウザは押した要素が離すまでに作り直されると click を
      // 出さないので、click だけに頼らない（読み上げソフトの「実行」は click を出すので両方受ける）。
      onMouseUp={openFromPointer}
      onClick={openFromPointer}
    >
      {rendered}
      {editing && (
        <Tag className={display ? 'rte-math-editor' : 'rte-math-popover'} contentEditable={false}>
          {display ? (
            <textarea
              ref={inputRef}
              value={latex}
              rows={3}
              maxLength={MATH_LATEX_MAX_LENGTH}
              spellCheck={false}
              aria-label="数式（LaTeX）"
              onChange={(event) => updateAttributes({ latex: event.target.value })}
              onKeyDown={onKeyDown}
            />
          ) : (
            <input
              ref={inputRef}
              type="text"
              value={latex}
              maxLength={MATH_LATEX_MAX_LENGTH}
              spellCheck={false}
              aria-label="数式（LaTeX）"
              onChange={(event) => updateAttributes({ latex: event.target.value })}
              onKeyDown={onKeyDown}
            />
          )}
          <Tag className="rte-math-hint">{display ? 'Ctrl+Enter か Esc で戻る' : 'Enter か Esc で戻る'}</Tag>
        </Tag>
      )}
    </NodeViewWrapper>
  );
}
