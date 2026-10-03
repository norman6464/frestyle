import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { renderDiagram } from './lazyRenderers';

type DiagramState =
  | { kind: 'idle' }
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'ready'; svg: string }
  | { kind: 'error'; message: string };

/** 書いている途中で毎打鍵描き直さないよう、打ち終わりを待つ時間。初回は待たない。 */
const DIAGRAM_RENDER_DELAY_MS = 400;

/**
 * useVisible は要素が画面（の近く）に入ったら true になる。mermaid は数 MB あるので、
 * 図が画面に入るまで読み込みも描画もしない。IntersectionObserver の無い環境（単体テスト）では
 * 最初から見えている扱いにする。
 */
function useVisible(ref: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, ref]);
  return visible;
}

/**
 * DiagramView は図（mermaid の書式の文字を持つ diagram）の NodeView。
 *
 * 編集中は左に元の文字（本文として直接書ける）、右に描いた図。閲覧モードは図だけ。
 * 描けない文字のときは、図の代わりに理由を出す（書いている途中は描けないのが普通なので、
 * 前に描けた図は残さず、いまの文字に対する結果を出す）。
 */
export default function DiagramView({ node, editor }: NodeViewProps) {
  const source = node.textContent;
  const editable = editor.isEditable;
  const previewRef = useRef<HTMLDivElement>(null);
  const visible = useVisible(previewRef);
  const [state, setState] = useState<DiagramState>({ kind: 'idle' });
  const renderedOnce = useRef(false);
  // SVG は文字列が変わったときだけ差し替える（毎回新しい object を渡すと、元の文字を 1 文字打つ
  // たびに描いた図が作り直されてちらつく。MathView と同じ理由）。
  const svgHtml = useMemo(() => ({ __html: state.kind === 'ready' ? state.svg : '' }), [state]);

  useEffect(() => {
    if (!visible) return;
    if (source.trim() === '') {
      setState({ kind: 'empty' });
      return;
    }
    let cancelled = false;
    const delay = renderedOnce.current ? DIAGRAM_RENDER_DELAY_MS : 0;
    const timer = setTimeout(() => {
      renderedOnce.current = true;
      setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
      void renderDiagram(source).then((result) => {
        if (cancelled) return;
        setState('svg' in result ? { kind: 'ready', svg: result.svg } : { kind: 'error', message: result.error });
      });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, visible]);

  return (
    <NodeViewWrapper
      className={`rte-diagram-view${editable ? ' is-editable' : ''}`}
      data-block-id={typeof node.attrs.id === 'string' ? node.attrs.id : undefined}
    >
      <pre className="rte-diagram-source" spellCheck={false} aria-label="図の元の文字（mermaid）">
        <NodeViewContent<'code'> as="code" />
      </pre>
      <div ref={previewRef} className="rte-diagram-preview" contentEditable={false}>
        {state.kind === 'ready' ? (
          // securityLevel: 'strict' の mermaid が消毒済みの SVG。
          <div className="rte-diagram-svg" dangerouslySetInnerHTML={svgHtml} />
        ) : state.kind === 'error' ? (
          <p className="rte-diagram-error" role="note">
            図を描けません（{state.message}）
          </p>
        ) : state.kind === 'empty' ? (
          <p className="rte-diagram-placeholder">図の書式（mermaid）を左に書くと、ここに図が出ます</p>
        ) : (
          <p className="rte-diagram-placeholder">図を描いています…</p>
        )}
      </div>
    </NodeViewWrapper>
  );
}
