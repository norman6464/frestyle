import { describe, expect, it } from 'vitest';
import { sprintConfirmText } from '../sprintConfirm';

describe('sprintConfirmText', () => {
  it('削除は中のチケットが消えずバックログへ戻ることと、件数を言う', () => {
    const text = sprintConfirmText('delete', 'スプリント 12', 3);
    expect(text.title).toBe('スプリントを削除しますか？');
    expect(text.message).toContain('「スプリント 12」を削除します');
    expect(text.message).toContain('中の 3 件のチケットは消えず、バックログへ戻ります');
    expect(text.confirmText).toBe('削除');
  });

  it('空のスプリントの削除では件数を言わない', () => {
    expect(sprintConfirmText('delete', 'スプリント 12', 0).message).not.toContain('件');
  });

  it('完了は開始し直せないことを言う', () => {
    const text = sprintConfirmText('complete', 'スプリント 12', 5);
    expect(text.title).toBe('スプリントを完了しますか？');
    expect(text.message).toContain('（5 件のチケット）');
    expect(text.message).toContain('開始し直せず');
    expect(text.confirmText).toBe('完了する');
  });

  it('名前が空なら「このスプリント」と呼ぶ', () => {
    expect(sprintConfirmText('complete', '  ', 0).message).toContain('このスプリントを完了します');
  });
});
