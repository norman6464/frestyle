import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import InputField from './InputField';

/**
 * ラベル・エラー・消すボタンまで込みの 1 行入力欄。
 *
 * ラベルは飾りではなく、押すと入力欄に移る（`htmlFor` と `id` で結んである）。
 * エラーがあるときは枠が赤くなるだけでなく `aria-invalid` が付き、読み上げソフトにも伝わる。
 */
const meta = {
  title: 'shared/InputField',
  component: InputField,
  parameters: { layout: 'centered' },
  args: { onChange: fn() },
  render: function ControlledField(args) {
    const [value, setValue] = useState(args.value);
    return <InputField {...args} value={value} onChange={(event) => { setValue(event.target.value); args.onChange(event); }} />;
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InputField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 空のとき。案内文（placeholder）だけが見える。 */
export const 空: Story = {
  args: { label: 'メールアドレス', name: 'email', value: '', placeholder: 'you@example.com' },
};

/** 何か入っているとき。右端に × が出て、1 回で消せる。 */
export const 入力済み: Story = {
  args: { label: 'メールアドレス', name: 'email', value: 'takuma@example.com' },
};

/** 間違っているとき。枠が赤くなり、下に理由が出る。 */
export const エラー: Story = {
  args: {
    label: 'メールアドレス',
    name: 'email',
    value: 'takuma',
    error: 'メールアドレスの形式が正しくありません',
  },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByLabelText('メールアドレス');
    // 見た目の赤だけでは色が見えない人に伝わらない。属性でも伝わっていることを確かめる。
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      'メールアドレスの形式が正しくありません',
    );
  },
};

/** パスワード。伏せ字と、目のボタンでの切り替え。 */
export const パスワード: Story = {
  args: { label: 'パスワード', name: 'password', type: 'password', value: 'himitsu' },
};

/** 目のボタンを押すと中身が見える。 */
export const パスワードを表示: Story = {
  args: { label: 'パスワード', name: 'password', type: 'password', value: 'himitsu' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'パスワードを表示' }));
    await expect(canvas.getByLabelText('パスワード')).toHaveAttribute('type', 'text');
  },
};

/** 触れないとき。薄くなり、× も目のボタンも出ない。 */
export const 押せない: Story = {
  args: { label: 'メールアドレス', name: 'email', value: 'takuma@example.com', disabled: true },
};

/** × を押すと空になり、呼び出し側にも空が伝わる。 */
export const 消すボタン: Story = {
  args: { label: '検索', name: 'q', value: 'ナレッジ' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '入力をクリア' }));
    await expect(canvas.getByLabelText('検索')).toHaveValue('');
    await expect(args.onChange).toHaveBeenCalled();
  },
};
