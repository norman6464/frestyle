import type { FsIconName } from '@/shared/ui';
import type { TicketStatusCategory } from '../model/types';

/**
 * 状態の枠ごとの形。未着手＝空の輪、進行中＝輪の中に点、完了＝輪の中に印。
 * 色は利用者が選ぶので、色が分からなくても形で読めるようにする（設計ボード PX00）。
 */
export const STATUS_ICON: Record<TicketStatusCategory, FsIconName> = {
  todo: 'status-todo',
  in_progress: 'status-progress',
  done: 'status-done',
};
