import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useEditor } from '@tiptap/react';
import FormatMenuBar from '../FormatMenuBar';
import { createEditorExtensions } from '../editorExtensions';
import { emptyRichDoc } from '@/shared/lib/richDoc';
import type { CommentAnchor } from '../commentAnchor';

// FormatMenuBar は実 editor を必要とするので、useEditor で用意した editor を渡す薄いハーネスで包む。
function Harness({
  editable = true,
  onRequestComment,
}: { editable?: boolean; onRequestComment?: (anchor: CommentAnchor) => void } = {}) {
  const editor = useEditor({
    extensions: createEditorExtensions(),
    content: emptyRichDoc(),
  });
  if (!editor) return null;
  return <FormatMenuBar editor={editor} editable={editable} onRequestComment={onRequestComment} />;
}

describe('FormatMenuBar', () => {
  it('マーク＋ブロック変換のボタンを出す（挿入・履歴系は出さない）', () => {
    render(<Harness />);
    expect(screen.getByRole('toolbar', { name: '書式メニュー' })).toBeInTheDocument();
    for (const name of ['太字', '斜体', '下線', '打ち消し線', 'インラインコード', '見出し1', '箇条書き', '引用', 'コードブロック']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    // 水平線（insert）・元に戻す（history）はバブルメニューには出さない。
    expect(screen.queryByRole('button', { name: '水平線' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '元に戻す' })).not.toBeInTheDocument();
  });

  it.each(['太字', '斜体', '見出し1', '箇条書き', 'コードブロック'])(
    '「%s」クリックで aria-pressed が true になる',
    async (name) => {
      render(<Harness />);
      const button = screen.getByRole('button', { name });
      expect(button).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(button);
      await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
    },
  );

  it('onRequestComment を渡していなければ「コメント」ボタンは出ない', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'コメント' })).not.toBeInTheDocument();
  });

  it('onRequestComment を渡すと「コメント」ボタンがリンクの隣（末尾）に出る', () => {
    render(<Harness onRequestComment={vi.fn()} />);
    const toolbar = screen.getByRole('toolbar', { name: '書式メニュー' });
    const buttons = within(toolbar).getAllByRole('button');
    // リンク → コメント の順で並ぶ（末尾 2 つ）。
    expect(buttons.at(-2)).toHaveAccessibleName('リンク');
    expect(buttons.at(-1)).toHaveAccessibleName('コメント');
  });

  // 編集権限は無いがコメントだけできる立場（domain.GrantRoleCommenter）がいるため、
  // editable と「コメントボタンを出すか」は別軸でなければならない — CodeRabbit 指摘。
  it('editable=falseでも onRequestComment があれば「コメント」ボタンだけは出る（書式ボタン・リンクは出ない）', () => {
    render(<Harness editable={false} onRequestComment={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'コメント' })).toBeInTheDocument();
    for (const name of ['太字', '斜体', '下線', '打ち消し線', 'インラインコード', '見出し1', '箇条書き', '引用', 'コードブロック', 'リンク']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('editable=falseかつonRequestCommentも無ければボタンは一切出ない', () => {
    render(<Harness editable={false} />);
    const toolbar = screen.getByRole('toolbar', { name: '書式メニュー' });
    expect(within(toolbar).queryAllByRole('button')).toHaveLength(0);
  });
});
