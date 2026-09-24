import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import Link from '@tiptap/extension-link';
import { FormatIcon, type FormatIconName } from '@/shared/ui';
import {
  emptyRichDoc,
  isAllowedLinkHref,
  isRichDoc,
  LinkUrlForm,
  sanitizeDocLinks,
  type RichDocContent,
} from '@/shared/ui/RichTextEditor';

export interface TicketDescriptionEditorProps {
  /** 表示・編集するチケット本文（tiptap の doc JSON）。 */
  value: RichDocContent;
  /** 編集できるか。false のときは読み取り専用（書式バーも出さない）。 */
  editable: boolean;
  /**
   * 「保存」を押したときだけ呼ばれる。失敗は投げてくる前提（投げられたら編集を保つ）。
   * ナレッジ本文と違い打鍵ごとの自動保存はしない（下の「なぜ分けたか」参照）。
   */
  onSave: (doc: RichDocContent) => Promise<void>;
  placeholder?: string;
}

/**
 * TicketDescriptionEditor はチケット本文専用のエディタ。
 *
 * **なぜナレッジ用（shared/ui/RichTextEditor）と分けたか**
 *
 * 1. 保存の仕方が逆。ナレッジは書きながら勝手に保存されるのが正しく、チケットは「保存」を
 *    押すまで確定しないのが正しい。1 つの部品に両方を入れると、どちらの画面でも
 *    「自動保存するか」の分岐が本文・題名・属性すべてに波及する。
 * 2. 要る道具が違う。チケット本文に表・画像・版・提案は要らない。逆に狭い詳細パネル
 *    （幅 420px 前後）に '/' メニューの一覧は収まらない。
 * 3. 壊れる範囲を閉じられる。ナレッジ側の都合で RichTextEditor を触っても、バックログの
 *    3 画面（一覧の詳細パネル・全画面・子の一覧）は巻き込まれない。
 *
 * 業務を知らない判定（リンクの安全確認）だけは shared のものを共有する。
 */
export default function TicketDescriptionEditor({
  value,
  editable,
  onSave,
  placeholder = '本文を書く',
}: TicketDescriptionEditorProps) {
  // 編集に入るまでは読み物として出す。Jira 型の「押して編集」を素直に写す。
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 編集を開いた時点の内容。「キャンセル」で戻す先であり、保存後の新しい基準にもなる。
  const baselineRef = useRef<RichDocContent>(isRichDoc(value) ? value : emptyRichDoc());

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        // 表・画像・水平線は持たない（チケット本文の範囲外）。
        horizontalRule: false,
        link: false,
        // 見出しは h2 / h3 だけ。題名が h1 相当なので、本文に h1 は置かせない。
        heading: { levels: [2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        // 既定の許可判定はライブラリの都合で広がりうるので、こちらの許可リストで固定する。
        isAllowedUri: (href: string) => isAllowedLinkHref(href),
      }),
      Placeholder.configure({ placeholder }),
    ],
    [placeholder],
  );

  const editor = useEditor(
    {
      editable: editing && !saving,
      extensions,
      content: isRichDoc(value) ? value : emptyRichDoc(),
      editorProps: {
        attributes: {
          class: 'prose prose-sm max-w-none whitespace-pre-wrap text-[var(--color-text-primary)] focus:outline-none',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': 'チケットの本文',
        },
      },
    },
    [extensions],
  );

  // 編集していない間に外から届いた更新（別の人の保存・チケット切り替え）を反映する。
  // 編集中に上書きすると打ちかけが消えるので、そのときは触らない。
  useEffect(() => {
    if (!editor || editor.isDestroyed || editing) return;
    const next = isRichDoc(value) ? value : emptyRichDoc();
    baselineRef.current = next;
    editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, editing, value]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(editing && !saving);
  }, [editor, editing, saving]);

  const startEditing = useCallback(() => {
    if (!editable || !editor) return;
    baselineRef.current = editor.getJSON() as RichDocContent;
    setError(null);
    setEditing(true);
    editor.commands.focus('end');
  }, [editable, editor]);

  const cancel = useCallback(() => {
    if (!editor) return;
    editor.commands.setContent(baselineRef.current, { emitUpdate: false });
    setError(null);
    setEditing(false);
  }, [editor]);

  const save = useCallback(async () => {
    if (!editor || saving) return;
    // 保存の直前に一度だけ通す。エディタ内で弾いていても、貼り付け経路や過去の保存分が
    // 混じることがあるため、外へ出す値で最終確認する。
    const doc = sanitizeDocLinks(editor.getJSON()) as RichDocContent;
    setSaving(true);
    setError(null);
    try {
      await onSave(doc);
      baselineRef.current = doc;
      setEditing(false);
    } catch {
      setError('保存できませんでした。もう一度お試しください。');
    } finally {
      setSaving(false);
    }
  }, [editor, onSave, saving]);

  if (!editor) return null;

  if (!editing) {
    // 本文が空のときは、見出しと「本文を編集」の間に何も無い帯ができる。
    // その空白に「押せば書ける」と言わせる（editable でないときは何も出さない —— 空は空のまま）。
    const blank = editor.isEmpty;
    return (
      <div>
        {blank && editable ? (
          <button
            type="button"
            onClick={startEditing}
            className="w-full rounded-lg bg-surface-2 px-3 py-4 text-left text-xs text-[var(--color-text-muted)] transition-colors hover:bg-surface-3"
          >
            本文はまだありません。押すと書けます。
          </button>
        ) : (
          <EditorContent editor={editor} />
        )}
        {editable && !blank && (
          <button
            type="button"
            onClick={startEditing}
            className="mt-3 min-h-11 rounded-lg border border-surface-3 px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            本文を編集
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-brand-600">
        <TicketFormatBar editor={editor} disabled={saving} />
        <div className="p-3">
          <EditorContent editor={editor} />
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-sm leading-relaxed text-danger-ink">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 [&_button]:min-h-11 [&_button]:focus-visible:outline [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-brand-600">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="rounded-lg px-4 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}

interface FormatButton {
  id: string;
  label: string;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
  icon: FormatIconName;
}

/**
 * 書式は「チケット本文で実際に使うもの」だけ。ナレッジ用の '/' メニューは持たない
 * （狭いパネルに一覧が収まらず、表・画像のような使わない項目まで並ぶため）。
 */
const FORMAT_BUTTONS: FormatButton[] = [
  { id: 'bold', label: '太字', icon: 'bold', isActive: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
  { id: 'italic', label: '斜体', icon: 'italic', isActive: (e) => e.isActive('italic'), run: (e) => e.chain().focus().toggleItalic().run() },
  { id: 'strike', label: '打ち消し', icon: 'strikethrough', isActive: (e) => e.isActive('strike'), run: (e) => e.chain().focus().toggleStrike().run() },
  {
    id: 'heading',
    label: '見出し',
    icon: 'heading',
    isActive: (e) => e.isActive('heading', { level: 2 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'bulletList',
    label: '箇条書き',
    icon: 'list',
    isActive: (e) => e.isActive('bulletList'),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'orderedList',
    label: '番号付き',
    icon: 'list-ordered',
    isActive: (e) => e.isActive('orderedList'),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  { id: 'code', label: 'コード', icon: 'code', isActive: (e) => e.isActive('code'), run: (e) => e.chain().focus().toggleCode().run() },
  {
    id: 'codeBlock',
    label: 'コードの囲み',
    icon: 'code-block',
    isActive: (e) => e.isActive('codeBlock'),
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'blockquote',
    label: '引用',
    icon: 'quote',
    isActive: (e) => e.isActive('blockquote'),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
];

function TicketFormatBar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  // isActive はエディタの状態であって React の状態ではないので、選択が動いても再描画されない。
  // 書式バーの押下状態を追随させるために、エディタの更新を購読して描画し直す。
  const [, forceRender] = useState(0);
  useEffect(() => {
    const rerender = () => forceRender((n) => n + 1);
    editor.on('selectionUpdate', rerender);
    editor.on('transaction', rerender);
    return () => {
      editor.off('selectionUpdate', rerender);
      editor.off('transaction', rerender);
    };
  }, [editor]);

  const [linkOpen, setLinkOpen] = useState(false);
  const linkActive = editor.isActive('link');

  return (
    <>
      <div
        role="toolbar"
        aria-label="本文の書式"
        className="flex flex-wrap items-center gap-1 border-b border-surface-3 bg-surface-1 p-2 [&_button]:min-h-11 [&_button]:min-w-11 [&_button]:focus-visible:outline [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-brand-600"
      >
        {FORMAT_BUTTONS.map((button) => {
          const active = button.isActive(editor);
          return (
            <button
              key={button.id}
              type="button"
              onClick={() => button.run(editor)}
              disabled={disabled}
              aria-pressed={active}
              aria-label={button.label}
              title={button.label}
              className={`grid h-7 w-7 place-items-center rounded-md text-[15px] transition-colors disabled:opacity-50 ${
                active
                  ? 'bg-brand-100 text-brand-700'
                  : 'text-[var(--color-text-secondary)] hover:bg-surface-2'
              }`}
            >
              <FormatIcon name={button.icon} />
            </button>
          );
        })}
        <span aria-hidden="true" className="mx-1 h-4 w-px bg-surface-3" />
        <button
          type="button"
          // 押下で本文の選択が外れないようにする（外れるとどこにリンクを掛けるのか分からなくなる）。
          onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
          onClick={() => setLinkOpen((prev) => !prev)}
          disabled={disabled}
          aria-pressed={linkActive}
          aria-expanded={linkOpen}
          aria-label="リンク"
          title="リンク"
          className={`grid h-7 w-7 place-items-center rounded-md text-[15px] transition-colors disabled:opacity-50 ${
            linkActive || linkOpen ? 'bg-brand-100 text-brand-700' : 'text-[var(--color-text-secondary)] hover:bg-surface-2'
          }`}
        >
          <FormatIcon name="link" />
        </button>
        <span className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={disabled || !editor.can().undo()}
            aria-label="元に戻す"
            title="元に戻す"
            className="grid h-7 w-7 place-items-center rounded-md text-[15px] text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <FormatIcon name="undo" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={disabled || !editor.can().redo()}
            aria-label="やり直す"
            title="やり直す"
            className="grid h-7 w-7 place-items-center rounded-md text-[15px] text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <FormatIcon name="redo" />
          </button>
        </span>
      </div>
      {linkOpen && (
        <LinkUrlForm
          editor={editor}
          initialHref={(editor.getAttributes('link').href as string | undefined) ?? ''}
          canRemove={linkActive}
          onClose={() => setLinkOpen(false)}
          className="border-b border-surface-3 bg-surface-1 px-2 py-1.5"
        />
      )}
    </>
  );
}
