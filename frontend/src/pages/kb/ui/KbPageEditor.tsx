import { memo } from 'react';
import type { CommentAnchor, KbResolvedPage } from '@/entities/kb';
import { emptyRichDoc, isRichDoc } from '@/shared/lib/richDoc';
import {
  RichTextEditor,
  type CommentBadgeCounts,
  type EditorCommand,
  type SearchPagesForRef,
  type SearchTicketsForRef,
} from './editor';
import type { KbSelectedVersionState } from '../model/useKbPageVersions';

export interface KbPageEditorProps {
  data: KbResolvedPage;
  /** 提案の下書きを書いているか。書いている間は下書きを出す（本文そのものは変えない）。 */
  draftOpen: boolean;
  draft: unknown;
  onDraftChange: (doc: unknown) => void;
  /** プレビュー中の版。null なら今の本文。 */
  preview: KbSelectedVersionState | null;
  onDocChange: (doc: unknown) => void;
  extraSlashCommands: EditorCommand[];
  onNavigateToPage: (path: string) => void;
  onRequestComment: (anchor: CommentAnchor) => void;
  commentBadgeCounts: CommentBadgeCounts;
  onCommentBadgeClick: (blockId: string) => void;
  focusSignal: number;
  onImageUpload: ((file: File) => Promise<string>) | undefined;
  resolveImageSrc: (src: string) => Promise<string>;
  /** `[[` でページを探す口（編集できる形にだけ渡す）。 */
  searchPages: SearchPagesForRef | undefined;
  /** `#` でチケットを探す口（同じく編集できる形にだけ渡す）。 */
  searchTickets: SearchTicketsForRef | undefined;
}

/**
 * ページの本文。提案の下書き中は下書きを、版のプレビュー中はその版を、それ以外は今の本文を出す。
 *
 * memo で包み、渡すものが変わらない限り描き直さない（本文エディタは tiptap を抱えて重い）。
 * ページの中の小さな操作（保存状態の変化・右の欄のタブ・星）は本文に関わらない。渡す関数は
 * KbPage が useCallback で固定しておくこと。
 */
function KbPageEditor({
  data,
  draftOpen,
  draft,
  onDraftChange,
  preview,
  onDocChange,
  extraSlashCommands,
  onNavigateToPage,
  onRequestComment,
  commentBadgeCounts,
  onCommentBadgeClick,
  focusSignal,
  onImageUpload,
  resolveImageSrc,
  searchPages,
  searchTickets,
}: KbPageEditorProps) {
  if (draftOpen) {
    // ドラフトモード中。value/onChange は useKbPageDoc の自動保存とは完全に
    // 別系統のローカルなドラフト state（useKbSuggestionDraft）へ繋ぐ —
    // ここで保存されるのは提案としてであって、本文そのものはまだ変わっていない。
    return (
      <RichTextEditor
        value={isRichDoc(draft) ? draft : emptyRichDoc()}
        editable={true}
        onChange={onDraftChange}
        ariaLabel={`${data.page.title} の本文（提案を編集中）`}
        onNavigateToPage={onNavigateToPage}
        resolveImageSrc={resolveImageSrc}
        searchPages={searchPages}
        searchTickets={searchTickets}
      />
    );
  }
  if (preview) {
    // 版のプレビュー中。揃うまで(取得中・失敗)は本文を出さない — 上の帯/読み込み/
    // 失敗の表示に任せる。**コメント関連 props は渡さない**(editable=false と
    // canComment 省略の組み合わせで RichTextEditor 自身がバブルメニュー自体を
    // 出さなくなる — 過去の版に対しては、今のブロックIDに紐づく錨は意味を
    // 持たないため)。
    if (!preview.detail) return null;
    return (
      <RichTextEditor
        value={isRichDoc(preview.detail.doc) ? preview.detail.doc : emptyRichDoc()}
        editable={false}
        ariaLabel={`${data.page.title} の本文（読み取り専用・過去の版）`}
        onNavigateToPage={onNavigateToPage}
        resolveImageSrc={resolveImageSrc}
      />
    );
  }
  return (
    <RichTextEditor
      // doc は API から来る任意の JSON。形が違えば空の本文として扱い、画面を落とさない。
      value={isRichDoc(data.doc) ? data.doc : emptyRichDoc()}
      editable={data.canEdit}
      onChange={onDocChange}
      ariaLabel={`${data.page.title} の本文`}
      extraSlashCommands={data.canEdit ? extraSlashCommands : undefined}
      onNavigateToPage={onNavigateToPage}
      onRequestComment={onRequestComment}
      canComment={data.canComment}
      commentBadgeCounts={commentBadgeCounts}
      onCommentBadgeClick={onCommentBadgeClick}
      focusSignal={focusSignal}
      onImageUpload={onImageUpload}
      resolveImageSrc={resolveImageSrc}
      searchPages={data.canEdit ? searchPages : undefined}
      searchTickets={data.canEdit ? searchTickets : undefined}
    />
  );
}

export default memo(KbPageEditor);
