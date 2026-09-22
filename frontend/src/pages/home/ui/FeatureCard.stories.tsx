import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { withRouter } from '../../../../.storybook/decorators';
import FeatureCard from './FeatureCard';
import { fsIcon } from '@/shared/ui';

/**
 * ホームに並ぶ、機能への入口カード 1 枚。
 *
 * 色は「どの系統の機能か」を見分けるためのもので、優先度ではない。同じ系統には同じ色を使う。
 */
const meta = {
  title: 'pages/home/FeatureCard',
  component: FeatureCard,
  parameters: { layout: 'padded' },
  decorators: [
    withRouter,
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FeatureCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** いちばん短い形。 */
export const 既定: Story = {
  args: {
    to: '/kb',
    icon: fsIcon('document-text'),
    title: 'ナレッジ',
    description: '学習メモを書き留め、いつでも振り返れます。',
    color: 'taupe',
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: /ナレッジ/ })).toHaveAttribute(
      'href',
      '/kb',
    );
  },
};

/** 右上に小さな札を付ける。 */
export const 札つき: Story = {
  args: {
    to: '/kb',
    icon: fsIcon('document-text'),
    title: 'ナレッジ',
    description: '学習メモを書き留め、いつでも振り返れます。',
    color: 'taupe',
    badge: 'NEW',
  },
};

/** 4 つの色を並べて見分けを確かめる。 */
export const 色ぜんぶ: Story = {
  args: {
    to: '/kb',
    icon: fsIcon('document-text'),
    title: 'ナレッジ',
    description: '学習メモを書き留め、いつでも振り返れます。',
    color: 'taupe',
  },
  render: (args) => (
    <div className="grid max-w-2xl grid-cols-2 gap-3">
      <FeatureCard {...args} color="brand" title="ブランド" />
      <FeatureCard {...args} color="emerald" title="エメラルド" icon={fsIcon('chart')} />
      <FeatureCard {...args} color="taupe" title="トープ" icon={fsIcon('chat')} />
      <FeatureCard {...args} color="blue" title="ブルー" />
    </div>
  ),
};

/** 説明が長いとき。カードの高さは揃ったままにする。 */
export const 説明が長い: Story = {
  args: {
    to: '/kb',
    icon: fsIcon('document-text'),
    title: 'ナレッジ',
    description:
      'スペースの中にページを作り、木構造で整理します。検索・お気に入り・共有リンクで、必要な情報にすぐ戻れます。',
    color: 'taupe',
  },
};
