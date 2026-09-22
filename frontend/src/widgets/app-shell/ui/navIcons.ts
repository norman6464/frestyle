import type { FsIconName } from '@/shared/ui';
import type { GlobalNavItem } from '../model/globalNav';

/** 行き先の鍵と絵の対応。柱（GlobalSidebar）と下部ナビ（GlobalBottomNav）が同じ表を読む。 */
export const NAV_ICON: Record<GlobalNavItem['icon'], FsIconName> = {
  home: 'home',
  assigned: 'assigned',
  kb: 'knowledge',
  backlog: 'backlog',
};
