import { useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { sanitizeImageSrc } from '@/shared/lib/linkSafety';
/** ナレッジの画像は durable な保存形式として S3 の key をこの接頭辞で持つ。 */
const KB_KEY_PREFIX = 'kb/';

type ResolveImageSrc = (src: string) => Promise<string>;

type ViewState =
  | { kind: 'ready'; src: string }
  | { kind: 'loading' }
  | { kind: 'failed' };

/**
 * ImageView は画像ノードの NodeView。
 *
 * doc.attrs.src は 2 通りの意味を持つ:
 *   - そのまま参照できる URL（http(s)://・data: 等）: そのまま `<img src>` に使う
 *     （既存のテスト・story・データとの互換のため）
 *   - "kb/" で始まる S3 の key（durable な保存形式。presigned URL には期限があるので
 *     doc にはこの key を保存する）: 表示のたびに resolveImageSrc で一時 URL へ解決する
 *
 * resolveImageSrc は Image 拡張の options 経由で渡される（RichTextEditor の
 * `resolveImageSrc` prop → createEditorExtensions → withImageView）。渡されていない
 * 画面（story・他画面）では解決を試みず、"kb/…" もそのまま src として使う
 * （壊れた画像として表示されるだけで、他画面には元々 kb/ の画像は現れない）。
 *
 * **node.attrs.src 自体は書き換えない**（updateAttributes を呼ばない）。保存の差分検出や
 * 共同編集は doc の中身の変化を見て動くため、表示専用の変換を doc に持ち込むと壊れる。
 *
 * src は保存時（linkSafety.ts の sanitizeDocLinks）に既に許可リストへ通してあるが、ここでも
 * 同じ検査を通す（保険）。sanitizeDocLinks は読み込み時・保存時にしか通らないため、
 * 何らかの理由でそこを経由せず node が組み立てられた場合（テスト・story・将来の変更）まで
 * 塞ぐには、実際に <img src> を組み立てる直前にもう一度検査するのが最後の壁になる。
 */
export default function ImageView({ node, extension }: NodeViewProps) {
  const safeSrc = sanitizeImageSrc(node.attrs.src);
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
  const needsResolve = safeSrc !== null && safeSrc.startsWith(KB_KEY_PREFIX);
  const resolveImageSrc = (extension.options as { resolveImageSrc?: ResolveImageSrc } | undefined)
    ?.resolveImageSrc;
  const shouldResolve = needsResolve && Boolean(resolveImageSrc);

  const [state, setState] = useState<ViewState>(() => {
    if (safeSrc === null) return { kind: 'failed' };
    return shouldResolve ? { kind: 'loading' } : { kind: 'ready', src: safeSrc };
  });
  // 期限切れ対策の再解決は 1 回だけ（無限ループ防止）。src が変われば新しい画像として
  // 改めて 1 回だけ許す（下の useEffect でリセットする）。
  const retriedRef = useRef(false);

  // ReactNodeViewRenderer は NodeView の React コンポーネントを維持したまま、node の
  // 属性が変わると新しい node を渡すだけで再マウントしない（Tiptap の仕様）。そのため
  // src が別の画像に変わっても、依存配列が空だとここが 1 回しか走らず、古い画像の
  // 解決結果・読み込み中/失敗の表示が新しい画像にそのまま残ってしまう。
  // safeSrc・shouldResolve・resolveImageSrc の変更を deps に含める。
  useEffect(() => {
    retriedRef.current = false;
    if (safeSrc === null) {
      setState({ kind: 'failed' });
      return undefined;
    }
    if (!shouldResolve || !resolveImageSrc) {
      setState({ kind: 'ready', src: safeSrc });
      return undefined;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    resolveImageSrc(safeSrc)
      .then((url) => {
        if (!cancelled) setState({ kind: 'ready', src: url });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [safeSrc, shouldResolve, resolveImageSrc]);

  const handleError = () => {
    // 解決が要らない（素の URL）ときはブラウザの既定の壊れた画像表示に任せる。
    if (!shouldResolve || !resolveImageSrc || safeSrc === null) return;
    if (retriedRef.current) {
      // 無限ループ防止のため、再解決は 1 回だけ。
      setState({ kind: 'failed' });
      return;
    }
    retriedRef.current = true;
    resolveImageSrc(safeSrc)
      .then((url) => setState({ kind: 'ready', src: url }))
      .catch(() => setState({ kind: 'failed' }));
  };

  if (state.kind === 'loading') {
    return (
      <NodeViewWrapper
        className="rte-image rte-image-placeholder"
        data-state="loading"
        role="img"
        aria-label={alt ? `${alt}（読み込み中）` : '画像を読み込み中'}
      >
        画像を読み込み中…
      </NodeViewWrapper>
    );
  }
  if (state.kind === 'failed') {
    return (
      <NodeViewWrapper
        className="rte-image rte-image-placeholder"
        data-state="failed"
        role="img"
        aria-label={alt ? `${alt}（表示できません）` : '画像を表示できません'}
      >
        画像を表示できません
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper className="rte-image">
      <img src={state.src} alt={alt} onError={handleError} />
    </NodeViewWrapper>
  );
}
