/**
 * スプリントの取り消せない操作（削除・完了）の確認文言。
 *
 * 文言は backend の実際の振る舞いに合わせる（推測で書かない）:
 * - 削除: スプリントの行が消え、中のチケットの順位の行は外部キーで一緒に消える。チケット自体は
 *   消えず、バックログへ戻る（queries/sprint.sql の DeleteSprint）
 * - 完了: 進む向きにしか動かない（planned → active → completed）。完了したスプリントは開始し
 *   直せず、中身も変えられない（domain/sprint.go・ErrSprintClosed）
 */
export type SprintConfirmKind = 'delete' | 'complete';

export interface SprintConfirmText {
  title: string;
  message: string;
  confirmText: string;
}

export function sprintConfirmText(kind: SprintConfirmKind, name: string, ticketCount: number): SprintConfirmText {
  const label = name.trim() === '' ? 'このスプリント' : `「${name}」`;
  if (kind === 'delete') {
    return {
      title: 'スプリントを削除しますか？',
      message:
        ticketCount > 0
          ? `${label}を削除します。中の ${ticketCount} 件のチケットは消えず、バックログへ戻ります。スプリントは元に戻せません。`
          : `${label}を削除します。スプリントは元に戻せません。`,
      confirmText: '削除',
    };
  }
  return {
    title: 'スプリントを完了しますか？',
    message: `${label}を完了します${ticketCount > 0 ? `（${ticketCount} 件のチケット）` : ''}。完了したスプリントは開始し直せず、中身も変えられなくなります。`,
    confirmText: '完了する',
  };
}
