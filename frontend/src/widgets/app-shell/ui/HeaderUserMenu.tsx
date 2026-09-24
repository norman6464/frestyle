import { useNavigate } from 'react-router-dom';
import { FsIcon } from '@/shared/ui';
import { Menu } from '@base-ui/react/menu';
import Avatar from '@/shared/ui/Avatar';

interface HeaderUserMenuProps {
  displayName: string;
  avatarUrl?: string | null;
  email?: string;
  subText?: string | null;
  onLogout: () => void;
  onNavigate?: () => void;
}

/** ユーザー操作。キーボード移動・外側クリック・フォーカス復帰は Base UI が扱う。 */
export default function HeaderUserMenu({
  displayName,
  avatarUrl,
  email,
  subText,
  onLogout,
  onNavigate,
}: HeaderUserMenuProps) {
  const navigate = useNavigate();

  return (
    <Menu.Root>
      <Menu.Trigger
        // 名前だけだと、押すと何が開くのか読み上げでは分からない。
        aria-label={`${displayName || 'ユーザー'} のアカウント`}
        // 見た目は顔だけ（設計ボード ST02）。名前は開いた先の先頭に出す。
        className="flex min-h-11 items-center justify-center rounded-full p-1 transition-colors hover:bg-[var(--color-nav-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <span aria-hidden="true">
          <Avatar name={displayName || 'U'} src={avatarUrl ?? undefined} size="sm" />
        </span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="end" className="z-50">
          <Menu.Popup className="w-56 overflow-hidden rounded-lg border border-[var(--fs-menu-border)] bg-[var(--fs-menu-surface)] p-1 shadow-lg focus:outline-none">
            {/* 誰のアカウントかを先頭に出す。引き金は顔だけなので、名前はここでしか読めない。 */}
            <Menu.Group>
              <Menu.GroupLabel className="block px-2 py-2">
                <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">
                  {displayName || 'ユーザー'}
                </span>
                {subText && <span className="block text-xs text-[var(--color-text-muted)]">{subText}</span>}
                {email && <span className="block truncate text-xs text-[var(--color-text-secondary)]" title={email}>{email}</span>}
              </Menu.GroupLabel>
            </Menu.Group>
            <Menu.Separator className="my-1 h-px bg-[var(--fs-menu-border)]" />
            {/* 自分宛の招待の入口。招待リンクを失くしても、ここからいつでも一覧へ戻れる。 */}
            <Menu.Item
              onClick={() => { onNavigate?.(); navigate('/invitations'); }}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-[var(--color-text-primary)] outline-none data-[highlighted]:bg-surface-2 data-[highlighted]:shadow-[inset_3px_0_0_var(--color-nav-selected-rule)]"
            >
              <FsIcon name="inbox" className="h-4 w-4 shrink-0" />
              あなたへの招待
            </Menu.Item>
            <Menu.Item
              onClick={() => { onNavigate?.(); navigate('/settings'); }}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-[var(--color-text-primary)] outline-none data-[highlighted]:bg-surface-2 data-[highlighted]:shadow-[inset_3px_0_0_var(--color-nav-selected-rule)]"
            >
              <FsIcon name="settings" className="h-4 w-4 shrink-0" />
              設定
            </Menu.Item>
            <Menu.Separator className="my-1 h-px bg-[var(--fs-menu-border)]" />
            <Menu.Item
              onClick={onLogout}
              // ログアウトは何も失わない（入り直せば戻る）ので、削除と同じ赤にはしない。
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-[var(--color-text-primary)] outline-none data-[highlighted]:bg-surface-2 data-[highlighted]:shadow-[inset_3px_0_0_var(--color-nav-selected-rule)]"
            >
              <FsIcon name="logout" className="h-4 w-4 shrink-0" />
              ログアウト
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
