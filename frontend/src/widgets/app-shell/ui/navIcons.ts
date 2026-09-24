import type { FsIconName } from '@/shared/ui';
import type { GlobalNavItem } from '../model/globalNav';

/** 行き先の鍵と絵の対応。下部ナビ（GlobalBottomNav）と ⌘K の窓が同じ絵を出す。 */
export const NAV_ICON: Record<GlobalNavItem['icon'], FsIconName> = {
  home: 'home',
  assigned: 'assigned',
  kb: 'knowledge',
  backlog: 'backlog',
};
