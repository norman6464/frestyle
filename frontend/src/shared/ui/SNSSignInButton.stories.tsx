import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import SNSSignInButton from './SNSSignInButton';

/**
 * 外部の発行者（いまは Google だけ）でサインインするボタン。印は同梱の絵で、外部の画像を
 * 読まない。文言は画面ごとに渡す（ログインは「Google でログイン」、登録は「Google で登録」）。
 */
const meta = {
  title: 'shared/ui/SNSSignInButton',
  component: SNSSignInButton,
  parameters: { layout: 'padded' },
  args: { provider: 'google', label: 'Google でログイン', onClick: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SNSSignInButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ログイン: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Google でログイン' }));
    await expect(args.onClick).toHaveBeenCalledTimes(1);
    await expect(canvasElement.querySelector('img')).toBeNull();
  },
};

export const 登録: Story = {
  args: { label: 'Google で登録' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Google で登録' })).toBeVisible();
  },
};

export const 無効: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Google でログイン' })).toBeDisabled();
  },
};
