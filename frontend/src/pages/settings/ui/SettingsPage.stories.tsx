import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { withApi, withRouter, withToast } from '../../../../.storybook/decorators';
import SettingsPage from './SettingsPage';

/**
 * 設定は現在プロフィールのみ。単一項目のサブメニューを置かず、そのまま編集できる。
 */
const meta = {
  title: 'pages/settings/SettingsPage',
  component: SettingsPage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    withRouter,
    withToast,
    withApi({
      '/profile/me': {
        displayName: '川野 拓馬',
        email: 'takuma@example.com',
        avatarUrl: null,
        bio: 'Go と React を勉強しています。',
      },
    }),
    (Story) => (
      <div className="bg-surface">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SettingsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 既定。 */
export const 既定: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading', { level: 1 })).toBeVisible();
  },
};

/** 狭い画面。 */
export const 狭い画面: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
