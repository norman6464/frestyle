import { useEffect, useMemo, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import Link from '@tiptap/extension-link';
import { isAllowedLinkHref, normalizeLinkInput } from '@/shared/ui/RichTextEditor';
import { FormatIcon, type FormatIconName } from '@/shared/ui';
import type { KbWorkspaceMember } from '@/entities/kb';
import type { TicketCommentBlock } from '@/entities/ticket';
import { CommentComposerEnter, Mention, setMentionMembers } from './mentionExtension';
import { editorContentToBlocks, isEditorContentEmpty, blocksToEditorContent } from '../lib/mentionComposerContent';

export interface TicketCommentComposerProps {
  /** 失敗は投げてくる前提（投げられたら入力を保つ）。 */
  onSubmit: (body: TicketCommentBlock[]) => Promise<void>;
  /** '@' の候補。ワークスペースに属する人（useWorkspaceMembers）。 */
  members: KbWorkspaceMember[];
  /** 発言の編集を開いたときの下書きの種。省略時は空欄から始める。 */
  initialBlocks?: TicketCommentBlock[];
  /** initialBlocks の mention に表示名を当てる（引けなければ「不明なユーザー」）。 */
  resolveMentionName?: (userId: string) => string | null;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  /**
   * 「キャンセル」を出す。発言の編集・返信のように「やめる」先がある場面で渡す
   * （新規の入力欄は畳むことがやめることなので渡さない）。
   */
  onCancel?: () => void;
  /**
   * 畳んだ姿から始める。押すと開く。新規の入力欄だけがこれを使う
   * （常時開いていると、発言の並びの下に空の枠がいつも居座って読みにくい）。
   */
  collapsible?: boolean;
}

/** 名前の候補として並べる人数の上限（幅 420px の詳細パネルで 1〜2 行に収まる数）。 */
const MENTION_SUGGESTION_COUNT = 4;

/**
 * 発言の入力欄。'@' に続けて日本語で打つと、ワークスペースに属する人の候補が出る
 * （tiptap の Suggestion。shared/ui/RichTextEditor の '/' コマンドと同じ仕組み）。
 * 選ぶと名指しは 1 個の不可分な単位になり、Backspace で丸ごと消える。
 *
 * エディタのスキーマは本文エディタ（RichTextEditor）とは別で、design.pen の書式バーに
 * 並ぶ分だけに絞ってある（段落・箇条書き・番号付き＋文字書式）。表・画像・'/' の献立は無い。
 *
 * 空判定は「文字も名指しも無い」。backend は「配列が空」または「text ノードだけで trim 後が
 * 全部空」を本文全体ごと 400 で拒む境界を持つので、ここで先に止める。
 */
export default function TicketCommentComposer({
  onSubmit,
  members,
  initialBlocks = [],
  resolveMentionName,
  placeholder = 'コメントを書く',
  submitLabel = '送信',
  autoFocus = false,
  onCancel,
  collapsible = false,
}: TicketCommentComposerProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(!collapsible);

  // マウント時の下書きの種だけを見る（以降 initialBlocks が変わっても打ち直さない —
  // 発言の編集はコンポーザごと開閉されるたびに新しく積むので、この eslint-disable で十分）。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialContent = useMemo(() => blocksToEditorContent(initialBlocks, resolveMentionName ?? (() => null)), []);
  const [empty, setEmpty] = useState(() => isEditorContentEmpty(initialContent));

  const editor = useEditor({
    editable: !submitting,
    extensions: [
      // 許すのは design.pen の書式バーに並ぶものだけ —— 文字書式（太字・斜体・打ち消し・
      // コード・リンク）と、段落・箇条書き・番号付き。見出し・引用・コードの囲み・区切り線は
      // 持たない（発言は短い文の往復で、節を立てる場所ではないため）。
      //
      // ここで許した形がそのまま wire に出る。読み込み側（entities/ticket/lib/commentBody.ts）は
      // 知らない塊・知らない marks を落とすので、増やすときは両方を揃える。
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        link: false,
        blockquote: false,
        horizontalRule: false,
        dropcursor: false,
        gapcursor: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: false,
        // 既定の許可判定はライブラリの都合で広がりうるので、こちらの許可リストで固定する。
        isAllowedUri: (href: string) => isAllowedLinkHref(href),
      }),
      // members は初回描画時点の値で足りる。読み込みが遅れて後から届いた分は下の
      // useEffect が editor.storage.mention へ書き足す（拡張一覧は生成時に固定されるため）。
      Mention.configure({ members }),
      CommentComposerEnter,
      Placeholder.configure({ placeholder }),
    ],
    content: initialContent,
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        // 箇条書きの点・番号は Tailwind の preflight が消してしまうので、この入力欄の中だけ
        // 明示的に戻す（表示側 TicketCommentBody の <ul>/<ol> と同じ字下げ・同じ記号に揃える。
        // 書いている姿と投稿後の姿がずれないため）。
        class:
          'text-sm text-[var(--color-text-primary)] focus:outline-none ' +
          '[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': placeholder,
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      setEmpty(isEditorContentEmpty(currentEditor.getJSON()));
    },
  });

  useEffect(() => {
    if (editor && !editor.isDestroyed) setMentionMembers(editor, members);
  }, [editor, members]);

  const canSubmit = !empty && !submitting;

  const handleSubmit = async () => {
    if (!editor || !canSubmit) return;
    const segments = editorContentToBlocks(editor.getJSON());
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(segments);
      editor.commands.clearContent();
      setEmpty(true);
      if (collapsible) setOpen(false);
    } catch {
      setError('送信できませんでした。もう一度お試しください。');
    } finally {
      setSubmitting(false);
    }
  };

  /** 畳んだ姿から開く。 */
  const openWith = () => {
    setOpen(true);
    if (!editor || editor.isDestroyed) return;
    // focus は次の描画でエディタが立ってから効かせる（畳んでいる間は EditorContent が
    // 居ないので、同期に撃つとカーソルが乗らない）。
    window.setTimeout(() => {
      if (editor.isDestroyed) return;
      editor.commands.focus('end');
      setEmpty(isEditorContentEmpty(editor.getJSON()));
    }, 0);
  };

  const handleCancel = () => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.clearContent();
    setEmpty(true);
    setError(null);
    if (collapsible) setOpen(false);
    onCancel?.();
  };

  /** 名前を 1 件挿し込む（'@' を打たずに候補から選ぶ経路）。 */
  const insertMention = (member: KbWorkspaceMember) => {
    if (!editor || editor.isDestroyed) return;
    editor
      .chain()
      .focus()
      .insertContent([
        { type: 'mention', attrs: { userId: String(member.userId), name: member.name } },
        { type: 'text', text: ' ' },
      ])
      .run();
    setEmpty(isEditorContentEmpty(editor.getJSON()));
  };

  if (collapsible && !open) {
    return (
      <div>
        <div className="rounded-lg border border-surface-3 bg-surface-1 px-4 py-3">
          <button
            type="button"
            onClick={() => openWith()}
            className="block w-full text-left text-sm text-[var(--color-text-muted)]"
          >
            {placeholder}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--color-text-muted)]">
          <span className="font-semibold">プロのヒント:</span>{' '}
          <kbd className="rounded border border-surface-3 bg-surface-2 px-1.5 py-px font-sans text-[10px] font-semibold text-[var(--color-text-secondary)]">
            M
          </kbd>{' '}
          を押すとコメントできます
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-brand-600 bg-surface-1">
        {editor && <CommentFormatBar editor={editor} disabled={submitting} />}
        <div className="p-3">
        <EditorContent editor={editor} />
        {members.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span aria-hidden="true" className="mr-0.5 text-[11px] text-[var(--color-text-muted)]">
              @
            </span>
            {members.slice(0, MENTION_SUGGESTION_COUNT).map((member) => (
              <button
                key={member.principalId}
                type="button"
                onClick={() => insertMention(member)}
                disabled={submitting}
                className="rounded-lg border border-surface-3 px-2.5 py-1 text-xs text-[var(--color-text-primary)] transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                + {member.name || '不明なユーザー'}
              </button>
            ))}
          </div>
        )}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-sm leading-relaxed text-danger-ink">
          {error}
        </p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {submitting ? '送信中…' : submitLabel}
        </button>
        {(collapsible || onCancel) && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={submitting}
            className="rounded-lg px-4 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            キャンセル
          </button>
        )}
        <span className="ml-auto text-[11px] text-[var(--color-text-muted)]">@ で名前を挙げると通知が届きます</span>
      </div>
    </div>
  );
}

interface CommentFormatButton {
  id: string;
  label: string;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
  icon: FormatIconName;
}

/** 発言に付けられる書式。並びは design.pen の書式バーに合わせてある。 */
const COMMENT_FORMAT_BUTTONS: CommentFormatButton[] = [
  { id: 'bold', label: '太字', icon: 'bold', isActive: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
  {
    id: 'italic',
    label: '斜体',
    icon: 'italic',
    isActive: (e) => e.isActive('italic'),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    id: 'strike',
    label: '打ち消し',
    icon: 'strikethrough',
    isActive: (e) => e.isActive('strike'),
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
  { id: 'code', label: 'コード', icon: 'code', isActive: (e) => e.isActive('code'), run: (e) => e.chain().focus().toggleCode().run() },
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
];

function CommentFormatBar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  // isActive はエディタの状態で React の状態ではないので、選択が動いても再描画されない。
  // 押下状態を追随させるためにエディタの更新を購読する（本文側の書式バーと同じ作り）。
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

  const addLink = () => {
    const current = editor.getAttributes('link').href as string | undefined;
    const input = window.prompt('リンク先の URL', current ?? '');
    if (input === null) return;
    if (input.trim() === '') {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const href = normalizeLinkInput(input);
    if (!href) {
      window.alert('この URL は開けません（http / https / mailto / tel のみ）');
      return;
    }
    editor.chain().focus().setLink({ href }).run();
  };

  return (
    <div
      role="toolbar"
      aria-label="発言の書式"
      className="flex flex-wrap items-center gap-0.5 border-b border-surface-3 px-1.5 py-1"
    >
      {COMMENT_FORMAT_BUTTONS.map((button) => {
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
              active ? 'bg-brand-100 text-brand-700' : 'text-[var(--color-text-secondary)] hover:bg-surface-2'
            }`}
          >
            <FormatIcon name={button.icon} />
          </button>
        );
      })}
      <button
        type="button"
        onClick={addLink}
        disabled={disabled}
        aria-pressed={editor.isActive('link')}
        aria-label="リンク"
        title="リンク"
        className={`grid h-7 w-7 place-items-center rounded-md text-[15px] transition-colors disabled:opacity-50 ${
          editor.isActive('link')
            ? 'bg-brand-100 text-brand-700'
            : 'text-[var(--color-text-secondary)] hover:bg-surface-2'
        }`}
      >
        <FormatIcon name="link" />
      </button>
    </div>
  );
}
