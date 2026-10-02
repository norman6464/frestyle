import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import RichTextEditor from './RichTextEditor';
import type { TicketRefCandidate } from './ticketRefSuggestion';
import type { RichDocContent } from '@/shared/lib/richDoc';

/**
 * `#` に続けて鍵か題名を打つと、チケットの候補が出る。Enter（またはクリック）で選ぶと、
 * 打ちかけの `#語` が消えてチケット参照の札（鍵・題名・状態）が入る。候補が出ている間の
 * Enter は確定で、改行にならない。
 *
 * 札の鍵・題名・状態はサーバーが読み出しのたびに解決する写しで、保存はしない。
 * **版のプレビューと提案の表示では解決されない**（pageRef と同じ）ので、そこでは
 * 「チケット」とだけ出る（下の「解決されていない札」の見本）。
 */
const meta: Meta<typeof RichTextEditor> = {
  title: 'pages/kb/editor/TicketRefSuggestion',
  component: RichTextEditor,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof RichTextEditor>;

const TICKETS: TicketRefCandidate[] = [
  { id: 'a1b2c3d4-0000-4000-8000-000000000001', key: 'ENG-12', title: 'ログインが落ちる', statusName: '進行中', statusCategory: 'in_progress' },
  { id: 'a1b2c3d4-0000-4000-8000-000000000002', key: 'ENG-13', title: 'ログインの表示を直す', statusName: 'To Do', statusCategory: 'todo' },
  { id: 'a1b2c3d4-0000-4000-8000-000000000003', key: 'OPS-1', title: '監視を足す', statusName: '完了', statusCategory: 'done' },
];

const searchTickets = async (query: string) =>
  TICKETS.filter((t) => t.title.includes(query) || t.key.toUpperCase().startsWith(query.toUpperCase()));

function Harness() {
  // 空の本文から始める（押した場所にカーソルが入り、そこから打てる）。
  const [value, setValue] = useState<RichDocContent>({ type: 'doc', content: [{ type: 'paragraph' }] });
  return (
    <div className="max-w-2xl">
      <RichTextEditor value={value} editable onChange={setValue} ariaLabel="本文" searchTickets={searchTickets} />
    </div>
  );
}

/** `#ログイン` と打つと候補が 2 件、鍵・題名・状態つきで出る。 */
export const 候補が出る: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = await canvas.findByRole('textbox', { name: '本文' });
    await userEvent.click(textbox);
    await userEvent.keyboard('#ログイン');
    const listbox = await within(document.body).findByRole('listbox', { name: 'チケットの候補' });
    await expect(listbox).toHaveTextContent('ENG-12');
    await expect(listbox).toHaveTextContent('ログインが落ちる');
    await expect(listbox).toHaveTextContent('進行中');
    await expect(listbox).toHaveTextContent('ENG-13');
  },
};

/** 候補が出ているときの Enter は改行ではなく確定。札が入り、打ちかけは消える。 */
export const Enterで選ぶ: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = await canvas.findByRole('textbox', { name: '本文' });
    await userEvent.click(textbox);
    await userEvent.keyboard('#ログインが');
    await within(document.body).findByRole('option', { name: /ログインが落ちる/ });
    await userEvent.keyboard('{Enter}');
    await waitFor(async () => {
      const ref = canvasElement.querySelector('a[data-ticket-ref]');
      await expect(ref).toHaveTextContent('ENG-12');
      await expect(ref).toHaveTextContent('ログインが落ちる');
      await expect(ref).toHaveTextContent('進行中');
    });
    await expect(textbox).not.toHaveTextContent('#');
    // 段落は 1 つのまま（Enter が改行にならない）。
    await expect(canvasElement.querySelectorAll('.ProseMirror > p')).toHaveLength(1);
  },
};

const resolvedDoc: RichDocContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '原因は ' },
        {
          type: 'ticketRef',
          attrs: { ticketId: TICKETS[0].id, key: 'ENG-12', title: 'ログインが落ちる', statusName: '進行中', statusCategory: 'in_progress' },
        },
        { type: 'text', text: ' と ' },
        {
          type: 'ticketRef',
          attrs: { ticketId: TICKETS[2].id, key: 'OPS-1', title: '監視を足す', statusName: '完了', statusCategory: 'done' },
        },
        { type: 'text', text: ' を見る。' },
      ],
    },
  ],
};

/** 読み出し時に解決された札。状態の枠ごとに印が変わる（未着手＝空の輪・進行中＝点・完了＝印）。 */
export const 解決された札: Story = {
  render: () => (
    <div className="max-w-2xl">
      <RichTextEditor value={resolvedDoc} editable={false} onChange={() => {}} ariaLabel="本文" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const refs = canvasElement.querySelectorAll('a[data-ticket-ref]');
    await expect(refs).toHaveLength(2);
    await expect(refs[0]).toHaveAttribute('href', `/tickets/${TICKETS[0].id}`);
    await expect(refs[1]).toHaveTextContent('完了');
  },
};

const unresolvedDoc: RichDocContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '版のプレビュー・提案の表示・バックログを見られない読み手には ' },
        { type: 'ticketRef', attrs: { ticketId: TICKETS[0].id } },
        { type: 'text', text: ' とだけ出る（押せない）。' },
      ],
    },
  ],
};

/** 写しが無い（解決されていない）札。「チケット」とだけ出し、どこへも行かない。 */
export const 解決されていない札: Story = {
  render: () => (
    <div className="max-w-2xl">
      <RichTextEditor value={unresolvedDoc} editable={false} onChange={() => {}} ariaLabel="本文" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('a[data-ticket-ref]')).toBeNull();
    const ref = canvasElement.querySelector('span[data-ticket-ref]');
    await expect(ref).toHaveTextContent('チケット');
  },
};
