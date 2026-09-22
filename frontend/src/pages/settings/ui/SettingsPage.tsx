import { PageHeader } from '@/shared/ui';
import ProfilePage from './ProfilePage';

/**
 * SettingsPage — `/settings` 配下の設定ページ。
 *
 * 現在の設定対象はプロフィールのみ。単一項目のナビゲーションは置かない。
 */
export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8 sm:px-6 lg:pt-12">
      <PageHeader title="設定" description="チームに表示するプロフィールを管理します。" />
      <ProfilePage />
    </div>
  );
}
