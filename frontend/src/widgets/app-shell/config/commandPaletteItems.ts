import type { FsIconName } from '@/shared/ui';

export type CommandAction = { type: 'navigate'; path: string };

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  /** 自作アイコンの名前（shared/ui/icons）。柱・下部ナビと同じ絵を出す。 */
  icon: FsIconName;
  category: 'ページ移動';
  action: CommandAction;
  keywords?: string[];
}

/**
 * ⌘K で開く「行き先を探す窓」の中身。
 *
 * アプリの常設の行き先をすべて載せる —— 柱・下部ナビの 4 つに加えて、ヘッダーからしか
 * 行けない通知と設定も。窓は「どこからでも 1 手で行ける」ための物なので、
 * 柱に無いからといって落とすと、通知と設定だけキーボードで辿れなくなる。
 * 並びは柱と同じ順、通知・設定はその後ろ。
 */
export const COMMAND_ITEMS: CommandItem[] = [
  {
    id: 'nav-home',
    label: 'ホーム',
    description: 'ホーム画面に移動',
    icon: 'home',
    category: 'ページ移動',
    action: { type: 'navigate', path: '/' },
    keywords: ['home', 'メニュー', 'トップ'],
  },
  {
    id: 'nav-assigned',
    label: '自分の担当',
    description: '自分が担当している課題の一覧に移動',
    icon: 'assigned',
    category: 'ページ移動',
    action: { type: 'navigate', path: '/assigned' },
    keywords: ['assigned', 'mine', '担当', '自分', 'マイタスク'],
  },
  {
    id: 'nav-kb',
    label: 'ナレッジ',
    description: 'ナレッジに移動',
    icon: 'knowledge',
    category: 'ページ移動',
    action: { type: 'navigate', path: '/kb' },
    keywords: ['kb', 'knowledge', 'ナレッジ', 'メモ', 'wiki', '共有'],
  },
  {
    id: 'nav-backlog',
    label: 'バックログ',
    description: 'バックログに移動',
    icon: 'backlog',
    category: 'ページ移動',
    action: { type: 'navigate', path: '/backlog' },
    keywords: ['backlog', 'ticket', 'チケット', 'バックログ', '課題'],
  },
  {
    id: 'nav-notifications',
    label: '通知',
    description: '通知の一覧に移動',
    icon: 'bell',
    category: 'ページ移動',
    action: { type: 'navigate', path: '/notifications' },
    keywords: ['notifications', 'bell', '通知', 'お知らせ'],
  },
  {
    id: 'nav-settings',
    label: '設定',
    description: 'アカウントと表示の設定に移動',
    icon: 'settings',
    category: 'ページ移動',
    action: { type: 'navigate', path: '/settings' },
    keywords: ['settings', 'preferences', '設定', 'プロフィール', 'profile', 'アカウント'],
  },
];
