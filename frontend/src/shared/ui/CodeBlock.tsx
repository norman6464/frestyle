import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { extractLanguage, extractTextContent } from '@/shared/lib/markdownContent';
import FsIcon from './icons/FsIcon';

/**
 * AI 応答の Markdown 内コードブロックに、言語名表示 + コピーボタン付きのヘッダを足す。
 *
 * ChatGPT / Claude.ai と同じ UX で、ユーザーは AI 応答のコードを 1 クリックでクリップボードに
 * 取り込める。「メッセージ全体コピー」ボタンとは別に、コードブロック単位のコピー UI を提供する。
 *
 * react-markdown が rehype-highlight 後に渡してくる構造:
 *
 *   <pre>            ← この `pre` コンポーネント置換が CodeBlock のエントリ
 *     <code class="language-py">
 *       <span class="hljs-keyword">def</span>
 *       ...
 *     </code>
 *   </pre>
 *
 * `children` の最も内側の文字列を再帰的に集めて生コードを復元する（rehype-highlight が
 * 挿入した <span> はクラスだけ付けて textContent は変えないため、テキスト連結で正確に
 * 元のコードが復元できる）。
 */
export default function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  // setTimeout id を ref で 保持し、 再 コピー / アン マウント 時 に clear する。
  // ref を 使わ ない と 「コピー 直後 に メッセージ が DOM から 消えた」 ケースで
  // setState on unmounted component の warning が 出る + リーク に なる。
  const copyTimeoutRef = useRef<number | null>(null);

  const language = useMemo(() => extractLanguage(children), [children]);
  const rawCode = useMemo(
    () => extractTextContent(children).replace(/\n$/, ''),
    [children]
  );

  // アン マウント 時 に 残った timeout を 確実 に clear。
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    if (!rawCode) return;
    try {
      await navigator.clipboard.writeText(rawCode);
      setCopied(true);
      // 連続 クリック で 前回 の timer が 残ら ない よう 先 に clear。
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        copyTimeoutRef.current = null;
      }, 1500);
    } catch {
      // clipboard API はブラウザ設定 / HTTP 環境で拒否されることがある。
      // エラーは握りつぶし、ユーザーには反応なしのままにする（壊れた挙動より無反応の方が安全）。
    }
  };

  return (
    <div className="my-2 rounded-md overflow-hidden bg-[var(--color-surface-3)]">
      <div className="flex items-center justify-between px-3 py-1 bg-[var(--color-surface-2)] border-b border-[var(--color-surface-3)] text-xs">
        <span className="text-[var(--color-text-muted)] font-mono">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'コードをコピーしました' : 'コードをコピー'}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors"
        >
          {copied ? (
            <>
              <FsIcon name="clipboard-check" className="w-3.5 h-3.5 text-success" />
              <span>コピー済み</span>
            </>
          ) : (
            <>
              <FsIcon name="clipboard" className="w-3.5 h-3.5" />
              <span>コピー</span>
            </>
          )}
        </button>
      </div>
      {/*
        横に流れる領域は、キーボードだけの人も動かせるようにフォーカスを受け取れる必要がある
        （受け取れないと、はみ出したコードの右側に到達する手段が無くなる）。
      */}
      <pre tabIndex={0} className="p-3 overflow-x-auto text-xs">
        {children}
      </pre>
    </div>
  );
}
