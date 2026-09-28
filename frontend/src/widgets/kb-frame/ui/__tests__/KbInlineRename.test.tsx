import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import KbInlineRename from '../KbInlineRename';

describe('KbInlineRename', () => {
  it('書き換えて Enter で確定すると onCommit が呼ばれる', async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(<KbInlineRename initialTitle="無題" onCommit={onCommit} onCancel={vi.fn()} />);

    const input = screen.getByRole('textbox', { name: 'ページの題名' });
    fireEvent.change(input, { target: { value: '設計メモ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('設計メモ'));
  });

  it('日本語入力の変換確定 Enter では確定しない（isComposing を見る）', () => {
    const onCommit = vi.fn();
    render(<KbInlineRename initialTitle="無題" onCommit={onCommit} onCancel={vi.fn()} />);

    const input = screen.getByRole('textbox', { name: 'ページの題名' });
    fireEvent.change(input, { target: { value: 'あいう' } });
    // 変換確定の Enter（isComposing=true）。ここで確定すると打ちかけの題名でリネームが飛ぶ。
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    expect(onCommit).not.toHaveBeenCalled();
    // 入力欄は開いたまま・打ちかけの文字も残る。
    expect(input).toHaveValue('あいう');
  });

  it('変換中の Enter は keyCode だけでも確定にしない（isComposing を持たない環境）', () => {
    // Safari は変換中に isComposing を立てず keyCode 229 だけを送る。
    const onCommit = vi.fn();
    render(<KbInlineRename initialTitle="無題" onCommit={onCommit} onCancel={vi.fn()} />);

    const input = screen.getByRole('textbox', { name: 'ページの題名' });
    fireEvent.change(input, { target: { value: 'あいう' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: false, keyCode: 229 });

    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue('あいう');
  });

  it('変換を終えたあとの本当の Enter では確定する', async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(<KbInlineRename initialTitle="無題" onCommit={onCommit} onCancel={vi.fn()} />);

    const input = screen.getByRole('textbox', { name: 'ページの題名' });
    fireEvent.change(input, { target: { value: 'あいう' } });
    // 変換確定（無視される）→ 変換が終わってからの本当の Enter（確定する）。
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('あいう'));
  });

  it('Escape では確定しない（変換中かどうかに関わらず）', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(<KbInlineRename initialTitle="無題" onCommit={onCommit} onCancel={onCancel} />);

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'ページの題名' }), { key: 'Escape' });

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});
