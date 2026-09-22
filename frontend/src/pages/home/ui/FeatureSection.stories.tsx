import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { withRouter } from '../../../../.storybook/decorators';
import FeatureCard from './FeatureCard';
import FeatureSection from './FeatureSection';
import { fsIcon } from '@/shared/ui';

/**
 * ホームのカードを「学習」「ツール」のような塊にまとめる見出しつきの区画。
 *
 * カードは 2 列で並び、狭い画面では 1 列になる。区画そのものは中身を選ばないので、
 * 何を入れるかは呼び出し側が決める。
 */
const meta = {
  title: 'pages/home/FeatureSection',
  component: FeatureSection,
  parameters: { layout: 'padded' },
  decorators: [
    withRouter,
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FeatureSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** カードを 2 枚入れたところ。 */
export const 既定: Story = {
  args: {
    title: 'ツール',
    children: (
      <>
        <FeatureCard
          to="/kb"
          icon={fsIcon('document-text')}
          title="ナレッジ"
          description="学習メモを書き留め、いつでも振り返れます。"
          color="taupe"
        />
        <FeatureCard
          to="/backlog"
          icon={fsIcon('chart')}
          title="バックログ"
          description="チームのチケットを一覧で追えます。"
          color="emerald"
        />
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading', { name: 'ツール' })).toBeVisible();
  },
};

/** 1 枚だけのとき。 */
export const 一枚だけ: Story = {
  args: {
    title: 'ツール',
    children: (
      <FeatureCard
        to="/kb"
        icon={fsIcon('document-text')}
        title="ナレッジ"
        description="学習メモを書き留め、いつでも振り返れます。"
        color="taupe"
      />
    ),
  },
};
