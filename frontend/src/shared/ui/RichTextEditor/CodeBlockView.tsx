import { useEffect, useRef, useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { CheckIcon, ChevronDownIcon, DocumentDuplicateIcon } from '@heroicons/react/24/outline';
import { filterLanguages, languageLabel, sanitizeCodeBlockLanguage } from './codeBlockLanguages';

/**
 * CodeBlockView はコードブロックの NodeView。
 * 右上（ホバー/フォーカス時）に「言語名 ▾」とコピーを出し、言語バッジのクリックで
 * 検索付きの言語メニューを開く。選択すると language 属性が更新され、
 * CodeBlockLowlight のデコレーションによってハイライトが即時切り替わる。
 */
export default function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  // API から doc を直接書き込める経路があるため、attrs.language は許可リストに無い値
  // （空白混じりの class 注入を含む）を持ちうる。ここで一度だけ丸め、以降の描画
  // （バッジの表示名・class 名・メニューの選択状態）はすべてこの値を使う。
  const language = sanitizeCodeBlockLanguage(node.attrs.language);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // メニュー外クリックで閉じる。
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) {
        return;
      }
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  // メニューを開いたら検索へフォーカス（キーボードだけで選べるように）。
  useEffect(() => {
    if (menuOpen) {
      setQuery('');
      searchRef.current?.focus();
    }
  }, [menuOpen]);

  const selectLanguage = (id: string) => {
    updateAttributes({ language: id });
    setMenuOpen(false);
    // 言語変更後は本文編集へ戻れるようエディタへフォーカスを返す。
    editor.commands.focus();
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* クリップボード不許可時は何もしない（編集は妨げない） */
    }
  };

  const languages = filterLanguages(query);

  return (
    <NodeViewWrapper className="rte-codeblock group/code">
      {/* 右上ツールバー。contentEditable=false で本文編集のキャレットに干渉しない。 */}
      <div className="rte-codeblock-bar" contentEditable={false}>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            aria-label={`コードの言語を選択（現在: ${languageLabel(language)}）`}
            className="rte-codeblock-lang"
          >
            {languageLabel(language)}
            <ChevronDownIcon className="h-3 w-3" aria-hidden="true" />
          </button>

          {menuOpen && (
            <div className="rte-codeblock-menu">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="言語を検索..."
                aria-label="言語を検索"
                className="rte-codeblock-search"
              />
              <ul role="listbox" aria-label="コードの言語" className="rte-codeblock-list">
                {languages.length === 0 ? (
                  <li className="rte-codeblock-empty">該当する言語がありません</li>
                ) : (
                  languages.map((item) => (
                    // 押されるのは option である li 自身。option の中にボタンを入れると、
                    // 支援技術からは「押せるものの中に押せるものがある」壊れた形に見える。
                    <li
                      key={item.id}
                      role="option"
                      aria-selected={item.id === language}
                      onClick={() => selectLanguage(item.id)}
                      className={`rte-codeblock-item ${item.id === language ? 'is-active' : ''}`}
                    >
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.id === language && <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={copyCode}
          aria-label={copied ? 'コピーしました' : 'コードをコピー'}
          title={copied ? 'コピーしました' : 'コードをコピー'}
          className="rte-codeblock-copy"
        >
          {copied ? (
            <CheckIcon className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          ) : (
            <DocumentDuplicateIcon className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>

      <pre>
        {/* spellcheck はコードに不要（波線ノイズを消す）。ジェネリクスでタグを code に指定する。 */}
        <NodeViewContent<'code'>
          as="code"
          spellCheck={false}
          className={`language-${language} hljs`}
        />
      </pre>
    </NodeViewWrapper>
  );
}
