import { PageFrame, PageHeader } from '@/shared/ui';
import ProfilePage from './ProfilePage';

/**
 * SettingsPage — `/settings` 配下の設定ページ。
 *
 * 現在の設定対象はプロフィールのみ。単一項目のナビゲーションは置かない。外枠と見出しは
 * ほかの画面と同じ共通の PageFrame・PageHeader にそろえる。
 */
export default function SettingsPage() {
  return (
    <PageFrame width="form" className="pb-24">
      <PageHeader title="設定" description="チームに表示するプロフィールを管理します。" />
      <ProfilePage />
    </PageFrame>
  );
}
