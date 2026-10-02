import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import RichTextEditor from './RichTextEditor';
import type { MentionCandidate } from './mentionSuggestion';
import type { RichDocContent } from '@/shared/lib/richDoc';

/**
 * `@` に続けて名前を打つと、ワークスペースの一員の候補が出る。Enter（またはクリック）で選ぶと、
 * 打ちかけの `@名前` が消えて名指しの札（@名前）が入る。候補が出ている間の Enter は確定で、
 * 改行にならない。
 *
 * 札の表示名はサーバーが読み出しのたびに解決する写しで、保存はしない。**版のプレビューと
 * 提案の表示では解決されない**（pageRef と同じ）ので、そこでは「@ユーザー」とだけ出る。
 * 通知（ページで名指し）は保存のときにサーバーが決める — 前の本文に無かった人のうち、
 * ページを見られる一員へだけ届く。
 */
const meta: Meta<typeof RichTextEditor> = {
  title: 'pages/kb/editor/MentionSuggestion',
  component: RichTextEditor,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof RichTextEditor>;

const MEMBERS: MentionCandidate[] = [
  { userId: 1, name: '田中 太郎' },
  { userId: 2, name: '田村 花子' },
  { userId: 3, name: '鈴木 一郎' },
];

const searchMembers = async (query: string) => MEMBERS.filter((m) => m.name.includes(query));

function Harness() {
  // 空の本文から始める（押した場所にカーソルが入り、そこから打てる）。
  const [value, setValue] = useState<RichDocContent>({ type: 'doc', content: [{ type: 'paragraph' }] });
  return (
    <div className="max-w-2xl">
      <RichTextEditor value={value} editable onChange={setValue} ariaLabel="本文" searchMembers={searchMembers} />
    </div>
  );
}

/** `@田` と打つと候補が 2 件出る。 */
export const 候補が出る: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = await canvas.findByRole('textbox', { name: '本文' });
    await userEvent.click(textbox);
    await userEvent.keyboard('@田');
    const listbox = await within(document.body).findByRole('listbox', { name: '名指しする相手' });
    await expect(listbox).toHaveTextContent('田中 太郎');
    await expect(listbox).toHaveTextContent('田村 花子');
  },
};

/** 候補が出ているときの Enter は改行ではなく確定。札が入り、打ちかけは消える。 */
export const Enterで選ぶ: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = await canvas.findByRole('textbox', { name: '本文' });
    await userEvent.click(textbox);
    await userEvent.keyboard('@田中');
    await within(document.body).findByRole('option', { name: /田中 太郎/ });
    await userEvent.keyboard('{Enter}');
    await waitFor(async () => {
      const ref = canvasElement.querySelector('span[data-mention]');
      await expect(ref).toHaveTextContent('@田中 太郎');
    });
    // 段落は 1 つのまま（Enter が改行にならない）。中身は札と続けて打つための空白だけで、
    // 打ちかけの「@田中」は残らない。
    const paragraphs = canvasElement.querySelectorAll('.ProseMirror > p');
    await expect(paragraphs).toHaveLength(1);
    // 末尾の空白はブラウザが別の空白文字で描くことがあるので、空白の種類は揃えて比べる。
    await expect(paragraphs[0].textContent?.replace(/\s/g, ' ')).toBe('@田中 太郎 ');
  },
};

const readOnlyDoc: RichDocContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '確認は ' },
        { type: 'mention', attrs: { userId: '1', name: '田中 太郎' } },
        { type: 'text', text: ' にお願いします。版のプレビューや提案の表示では ' },
        { type: 'mention', attrs: { userId: '2' } },
        { type: 'text', text: ' のように名前が出ません。' },
      ],
    },
  ],
};

/** 読み出し時に解決された札と、写しが無い札。 */
export const 名指しの札: Story = {
  render: () => (
    <div className="max-w-2xl">
      <RichTextEditor value={readOnlyDoc} editable={false} onChange={() => {}} ariaLabel="本文" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const refs = canvasElement.querySelectorAll('span[data-mention]');
    await expect(refs).toHaveLength(2);
    await expect(refs[0]).toHaveTextContent('@田中 太郎');
    await expect(refs[1]).toHaveTextContent('@ユーザー');
  },
};
