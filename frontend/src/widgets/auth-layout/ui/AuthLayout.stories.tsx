import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { withRouter } from '../../../../.storybook/decorators';
import AuthLayout from './AuthLayout';
import { Button, InputField, LinkText, PublicHeader } from '@/shared/ui';

/**
 * ログイン前の画面（ログイン・アカウント作成）の外枠。
 *
 * 印・題名・白いカードの並びを 1 か所に持たせて、どの画面でも同じ位置に同じものが出るようにする。
 *
 * これらの画面は検索結果に出す価値が無いので、`noindex` を自分で付ける。
 * 短い中身なら縦の中央に、長ければ自分でスクロールする（本体側は縦スクロールを止めてあるため）。
 */
const meta = {
  title: 'widgets/auth-layout/AuthLayout',
  component: AuthLayout,
  parameters: { layout: 'fullscreen' },
  decorators: [
    withRouter,
    (Story) => (
      // 本体は高さ 100% の中で使う。story でも同じ条件を作る。
      <div className="h-[640px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AuthLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 題名と中身だけ。 */
export const 既定: Story = {
  args: {
    title: 'ログイン',
    children: (
      <div>
        <InputField label="メールアドレス" name="email" value="" onChange={() => {}} />
        <Button fullWidth>ログイン</Button>
      </div>
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading', { level: 1 })).toHaveTextContent(
      'ログイン',
    );
  },
};

/** 下に補足の枠を足したところ。 */
export const 補足つき: Story = {
  args: {
    title: 'ログイン',
    children: <Button fullWidth>ログイン</Button>,
    footer: (
      <p className="text-sm text-[var(--color-text-secondary)]">
        はじめての方は <LinkText to="/signup">アカウントを作成</LinkText>
      </p>
    ),
  },
};

/** 上に公開ページの帯を足したところ（招待の画面の形）。 */
export const 帯つき: Story = {
  args: {
    header: <PublicHeader />,
    title: 'ログイン',
    children: <Button fullWidth>ログイン</Button>,
  },
};

/** 中身が長いとき。枠の中でスクロールする。 */
export const 中身が長い: Story = {
  args: {
    title: 'アカウントを作成',
    children: (
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <InputField key={i} label={`項目 ${i + 1}`} name={`f${i}`} value="" onChange={() => {}} />
        ))}
        <Button fullWidth>作成する</Button>
      </div>
    ),
  },
};

/** 題名を出さない使い方。 */
export const 題名なし: Story = {
  args: { children: <p className="text-sm">読み込んでいます…</p> },
};
