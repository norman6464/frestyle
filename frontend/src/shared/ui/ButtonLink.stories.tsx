import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { withRouter } from '../../../.storybook/decorators';
import ButtonLink from './ButtonLink';

/**
 * ボタンの見た目をした、アプリ内の別の画面へのリンク。
 *
 * 見た目の種類（variant）と大きさ（size）は Button と同じ決まりを使う。押すとその場で何かが
 * 起きるものは Button、別の画面へ移るだけのものはこちら（読み上げでは「リンク」になる）。
 */
const meta = {
  title: 'shared/ButtonLink',
  component: ButtonLink,
  parameters: { layout: 'centered' },
  decorators: [withRouter],
  args: { to: '/signup', children: '新規登録' },
} satisfies Meta<typeof ButtonLink>;

export default meta;
type Story = StoryObj<typeof meta>;

/** ボタンの形でも、読み上げと行き先はリンク。 */
export const 既定: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: '新規登録' })).toHaveAttribute('href', '/signup');
    await expect(canvas.queryByRole('button')).toBeNull();
  },
};

/** 枠だけの形を、置き場所の幅いっぱいに（ログイン画面の下段）。 */
export const 枠だけで幅いっぱい: Story = {
  args: { variant: 'secondary', size: 'lg', fullWidth: true },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
};
