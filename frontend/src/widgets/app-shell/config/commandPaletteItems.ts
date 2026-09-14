import { HomeIcon, ChartBarIcon, DocumentTextIcon, UserCircleIcon } from '@heroicons/react/24/outline';
import type { ComponentType, SVGProps } from 'react';

export type CommandAction = { type: 'navigate'; path: string };

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  category: 'ページ移動';
  action: CommandAction;
  keywords?: string[];
}

export const COMMAND_ITEMS: CommandItem[] = [
  // ページ移動
  {
    id: 'nav-home',
    label: 'ホーム',
    description: 'ホーム画面に移動',
    icon: HomeIcon,
    category: 'ページ移動',
    action: { type: 'navigate', path: '/' },
    keywords: ['home', 'メニュー', 'トップ'],
  },
  {
    id: 'nav-kb',
    label: 'ナレッジ',
    description: 'ナレッジに移動',
    icon: DocumentTextIcon,
    category: 'ページ移動',
    action: { type: 'navigate', path: '/kb' },
    keywords: ['kb', 'knowledge', 'ナレッジ', 'メモ', 'wiki', '共有'],
  },
  {
    id: 'nav-backlog',
    label: 'バックログ',
    description: 'バックログに移動',
    icon: ChartBarIcon,
    category: 'ページ移動',
    action: { type: 'navigate', path: '/backlog' },
    keywords: ['backlog', 'ticket', 'チケット', 'バックログ', '課題'],
  },
  {
    id: 'nav-profile',
    label: 'プロフィール',
    description: 'プロフィールに移動',
    icon: UserCircleIcon,
    category: 'ページ移動',
    action: { type: 'navigate', path: '/profile/me' },
    keywords: ['profile', 'プロフィール', '設定'],
  },
];
