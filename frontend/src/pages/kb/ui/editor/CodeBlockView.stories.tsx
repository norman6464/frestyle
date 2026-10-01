import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import RichTextEditor from './RichTextEditor';
import type { RichDocContent } from '@/shared/lib/richDoc';
import CodeBlockView from './CodeBlockView';

/**
 * 本文の中のコードの囲み。右上に「言語名 ▾」とコピーが出る。
 *
 * この部品は**エディタの中でしか存在できない**（tiptap がコードのノードを描くときに差し込む）。
 * 単体では置けないので、見本ではコードを 1 つ含む本文をエディタに読ませて見ている。
 *
 * 言語を変えると色分けもその場で変わる。言語の一覧は検索できる — 200 近くあるので、
 * 目で探させると見つからない。
 */
/*
 * この部品は単体では立てられない（エディタ本体が要る）。args ではなく render の中で
 * 作るので、meta も satisfies ではなく注釈で受けて args を任意にする。
 */
const meta: Meta<typeof CodeBlockView> = {
  title: 'pages/kb/editor/CodeBlockView',
  component: CodeBlockView,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof CodeBlockView>;

const docWithCode = (language: string, code: string): RichDocContent => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '次のように書きます。' }] },
    {
      type: 'codeBlock',
      attrs: { language },
      content: [{ type: 'text', text: code }],
    },
  ],
});

const GO_CODE = `package main

import "fmt"

func main() {
	fmt.Println("こんにちは")
}`;

/** 言語を指定したコード。 */
export const 言語つき: Story = {
  render: () => (
    <div className="max-w-2xl">
      <RichTextEditor value={docWithCode('go', GO_CODE)} editable />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const languageButton = await canvas.findByRole('button', { name: /コードの言語を選択/ });
    // 右上の操作は普段は透明で、コードに触れているあいだだけ現れる（本文の邪魔をしない）。
    await expect(languageButton).not.toBeVisible();
    // CSS の :hover は JS から起こせない（本物のマウスが要る）。同じ条件に入っている
    // :focus-within を使い、フォーカスを当てて「現れた状態」を作る。
    languageButton.focus();
    await waitFor(async () => {
      await expect(languageButton).toBeVisible();
    });
  },
};

/** 言語を指定していないコード。 */
export const 言語なし: Story = {
  render: () => (
    <div className="max-w-2xl">
      <RichTextEditor value={docWithCode('plaintext', 'ここは ただの文字列です')} editable />
    </div>
  ),
};

/** 言語の一覧を開いたところ。検索して選べる。 */
export const 言語を選ぶ: Story = {
  render: () => (
    <div className="max-w-2xl pb-64">
      <RichTextEditor value={docWithCode('go', GO_CODE)} editable />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const languageButton = await canvas.findByRole('button', { name: /コードの言語を選択/ });
    // :hover は起こせないので、フォーカスで操作を出してから押す。
    languageButton.focus();
    await userEvent.click(languageButton);
    await waitFor(async () => {
      await expect(canvas.getByRole('listbox', { name: 'コードの言語' })).toBeVisible();
    });
    await userEvent.type(canvas.getByRole('textbox', { name: '言語を検索' }), 'type');
    await expect(await canvas.findByRole('option', { name: /TypeScript/ })).toBeVisible();
  },
};

/** 読み取り専用のとき。 */
export const 読み取り専用: Story = {
  render: () => (
    <div className="max-w-2xl">
      <RichTextEditor value={docWithCode('go', GO_CODE)} editable={false} />
    </div>
  ),
};
