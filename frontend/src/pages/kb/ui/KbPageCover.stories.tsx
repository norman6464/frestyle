import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import KbPageCover from './KbPageCover';

/**
 * ページ頭部のカバー画像の表示だけを担う部品。設定・変更・解除の操作は
 * KbPageCoverButton が別に持つ（この部品は表示専用）。
 */
const meta = {
  title: 'pages/kb/KbPageCover',
  component: KbPageCover,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof KbPageCover>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 設定済み。解決済みの URL をそのまま <img src> に使う。装飾画像なので alt は空。 */
export const 設定済み: Story = {
  args: { cover: { type: 'file', url: 'https://picsum.photos/seed/frestyle-kb/1200/300' } },
  play: async ({ canvasElement }) => {
    const img = canvasElement.querySelector('img');
    await expect(img).toHaveAttribute('src', 'https://picsum.photos/seed/frestyle-kb/1200/300');
    await expect(img).toHaveAttribute('alt', '');
  },
};

/** 未設定。何も出さない。 */
export const 未設定: Story = {
  args: { cover: null },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('img')).toBeNull();
  },
};

