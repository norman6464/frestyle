import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmModal from '../ConfirmModal';

describe('ConfirmModal', () => {
  const mockOnConfirm = vi.fn();
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('isOpen=trueでモーダルが表示される', () => {
    render(
      <ConfirmModal isOpen={true} message="削除しますか？" onConfirm={mockOnConfirm} onCancel={mockOnCancel} />
    );

    expect(screen.getByText('確認')).toBeInTheDocument();
    expect(screen.getByText('削除しますか？')).toBeInTheDocument();
  });

  it('isOpen=falseでモーダルが非表示になる', () => {
    render(
      <ConfirmModal isOpen={false} message="削除しますか？" onConfirm={mockOnConfirm} onCancel={mockOnCancel} />
    );

    expect(screen.queryByText('削除しますか？')).not.toBeInTheDocument();
  });

  it('確認ボタンクリックでonConfirmが呼ばれる', () => {
    render(
      <ConfirmModal isOpen={true} message="削除しますか？" onConfirm={mockOnConfirm} onCancel={mockOnCancel} />
    );

    fireEvent.click(screen.getByText('削除'));
    expect(mockOnConfirm).toHaveBeenCalled();
  });

  it('キャンセルボタンクリックでonCancelが呼ばれる', () => {
    render(
      <ConfirmModal isOpen={true} message="削除しますか？" onConfirm={mockOnConfirm} onCancel={mockOnCancel} />
    );

    fireEvent.click(screen.getByText('キャンセル'));
    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('カスタムタイトルとボタンテキストが表示される', () => {
    render(
      <ConfirmModal
        isOpen={true}
        title="注意"
        message="本当に実行しますか？"
        confirmText="実行"
        cancelText="戻る"
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByText('注意')).toBeInTheDocument();
    expect(screen.getByText('実行')).toBeInTheDocument();
    expect(screen.getByText('戻る')).toBeInTheDocument();
  });

  it('ESCキーでonCancelが呼ばれる', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmModal isOpen={true} message="削除しますか？" onConfirm={mockOnConfirm} onCancel={mockOnCancel} />
    );

    await user.keyboard('{Escape}');
    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('isDanger=falseで確認ボタンがブランド(青)スタイルになる', () => {
    render(
      <ConfirmModal isOpen={true} message="実行しますか？" isDanger={false} onConfirm={mockOnConfirm} onCancel={mockOnCancel} />
    );
    const confirmBtn = screen.getByText('削除');
    expect(confirmBtn.className).toContain('bg-brand-600');
  });

  it('isDanger=trueで確認ボタンがredスタイルになる', () => {
    render(
      <ConfirmModal isOpen={true} message="削除しますか？" isDanger={true} onConfirm={mockOnConfirm} onCancel={mockOnCancel} />
    );
    const confirmBtn = screen.getByText('削除');
    expect(confirmBtn.className).toContain('bg-red-600');
  });

  it('オーバーレイクリックでonCancelが呼ばれる', () => {
    render(
      <ConfirmModal isOpen={true} message="削除しますか？" onConfirm={mockOnConfirm} onCancel={mockOnCancel} />
    );
    // モーダルは document.body へポータルされるので、render の container には無い。
    const overlay = document.querySelector('.bg-black\\/50');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);
    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('呼び出し元の DOM ではなく document.body へ出す（親のイベントを巻き込まない）', () => {
    // 行アクションのような「触れている間だけ濃くなる」入れ物の中に描くと、
    // オーバーレイ上の右クリックやドラッグが親のハンドラへ伝わり、
    // 背後でメニューが開く・ドラッグが始まる、といった取り違えが起きる。
    const onParentContextMenu = vi.fn();
    const { container } = render(
      <div onContextMenu={onParentContextMenu}>
        <ConfirmModal isOpen={true} message="削除しますか？" onConfirm={mockOnConfirm} onCancel={mockOnCancel} />
      </div>
    );

    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    fireEvent.contextMenu(dialog);
    expect(onParentContextMenu).not.toHaveBeenCalled();
  });

  it('モーダル表示時にキャンセルボタンが自動フォーカスされる', async () => {
    render(
      <ConfirmModal isOpen={true} message="削除しますか？" onConfirm={mockOnConfirm} onCancel={mockOnCancel} />
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('キャンセル')));
  });

  it('Tabキーで確認ボタンからキャンセルボタンへ循環移動する', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmModal isOpen={true} message="削除しますか？" onConfirm={mockOnConfirm} onCancel={mockOnCancel} />
    );
    const confirmBtn = screen.getByText('削除');
    confirmBtn.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByText('キャンセル'));
  });

  it('Shift+Tabでキャンセルボタンから確認ボタンへ循環移動する', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmModal isOpen={true} message="削除しますか？" onConfirm={mockOnConfirm} onCancel={mockOnCancel} />
    );
    const cancelBtn = screen.getByText('キャンセル');
    cancelBtn.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByText('削除'));
  });

  it('role=dialogとaria-modal=trueが設定される', () => {
    render(
      <ConfirmModal isOpen={true} message="削除しますか？" onConfirm={mockOnConfirm} onCancel={mockOnCancel} />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('aria-labelledbyがタイトルを参照する', () => {
    render(
      <ConfirmModal isOpen={true} message="削除しますか？" onConfirm={mockOnConfirm} onCancel={mockOnCancel} />
    );
    const dialog = screen.getByRole('dialog');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    const title = document.getElementById(labelId!);
    expect(title).toHaveTextContent('確認');
  });

  it('isDanger未指定時のデフォルトがtrueである', () => {
    render(
      <ConfirmModal isOpen={true} message="削除しますか？" onConfirm={mockOnConfirm} onCancel={mockOnCancel} />
    );
    const confirmBtn = screen.getByText('削除');
    expect(confirmBtn.className).toContain('bg-red-600');
  });
});
