import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type { EmailVerification } from '@/features/auth';
import EmailVerificationPanel from './EmailVerificationPanel';

function verification(over: Partial<Extract<EmailVerification, { available: true }>> = {}): EmailVerification {
  return {
    available: true,
    email: 'taro@example.com',
    sending: false,
    checking: false,
    send: fn(async () => true),
    confirm: fn(async () => false),
    message: null,
    ...over,
  };
}

const meta = {
  title: 'pages/invitations/EmailVerificationPanel',
  component: EmailVerificationPanel,
  parameters: { layout: 'padded' },
  args: { verification: verification(), onVerified: fn() },
} satisfies Meta<typeof EmailVerificationPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 確認メールを送り直せる。アドレスを見せ、送る・確認を済ませた の 2 つを置く（設定へは送らない）。 */
export const 確認が済んでいない: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('taro@example.com')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: '確認メールを送る' }));
    const v = args.verification as Extract<EmailVerification, { available: true }>;
    await expect(v.send).toHaveBeenCalledTimes(1);
  },
};

/** 送ったあと。結果は押した操作のすぐ下に出る。 */
export const 送った: Story = {
  args: {
    verification: verification({
      message: { tone: 'info', text: 'taro@example.com に確認メールを送りました。届いたリンクを開いてから「確認を済ませた」を押してください。' },
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('確認メールを送りました');
  },
};

/** 確認が取り込めたら一覧を読み直す。 */
export const 確認を済ませた: Story = {
  args: { verification: verification({ confirm: fn(async () => true) }) },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '確認を済ませた' }));
    await waitFor(() => expect(args.onVerified).toHaveBeenCalledTimes(1));
  },
};

/** まだ確認されていなければ、一覧は読み直さず理由を出す。 */
export const まだ確認されていない: Story = {
  args: {
    verification: verification({
      confirm: fn(async () => false),
      message: { tone: 'info', text: 'まだ確認が済んでいません。メールのリンクを開いてから、もう一度押してください。' },
    }),
  },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '確認を済ませた' }));
    await expect(args.onVerified).not.toHaveBeenCalled();
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('まだ確認が済んでいません');
  },
};

/** 再送できない発行者（ローカルの Dex）。案内だけを出す。 */
export const 再送できない発行者: Story = {
  args: { verification: { available: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'メールアドレスの確認が必要です' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: '確認メールを送る' })).toBeNull();
  },
};
