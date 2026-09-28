import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';
import type { KbPageTemplate } from '@/entities/kb';
import KbTemplatePickerModal from './KbTemplatePickerModal';

/**
 * 「雛形からページを作る」の共通ピッカー。サイドバーの「雛形から作る」と、本文の
 * /template コマンドの両方から開かれる。
 *
 * 2 段階: テンプレートを選ぶ一覧 → 題名を決める入力欄（初期値はテンプレート名、変更可）。
 * 削除ボタンは canManageTemplates（ワークスペースの編集者以上）のときだけ出る
 * （一覧を見る・テンプレートから作ることは所属者なら誰でもできる）。
 */
const meta = {
  title: 'features/kb-page-templates/KbTemplatePickerModal',
  component: KbTemplatePickerModal,
  parameters: { layout: 'fullscreen' },
  args: {
    isOpen: true,
    templates: [],
    loading: false,
    error: null,
    canManageTemplates: true,
    onConfirm: fn(async () => {}),
    onDelete: fn(async () => {}),
    onClose: fn(),
  },
} satisfies Meta<typeof KbTemplatePickerModal>;

export default meta;
type Story = StoryObj<typeof meta>;

const template = (id: string, name: string): KbPageTemplate => ({
  id,
  name,
  createdAt: '2026-09-01T00:00:00Z',
});

const templates: KbPageTemplate[] = [
  template('t-1', '議事録'),
  { ...template('t-2', '週次レポート'), icon: { type: 'emoji', value: '📊' } },
];

/** 読み込み中。 */
export const 読み込み中: Story = {
  args: { loading: true },
  play: async () => {
    await expect(screen.getByRole('status', { name: 'テンプレートを読み込み中' })).toBeVisible();
  },
};

/** 取得に失敗。 */
export const 取得に失敗: Story = {
  args: { error: 'テンプレートを読み込めませんでした。' },
  play: async () => {
    await expect(screen.getByRole('alert')).toHaveTextContent('テンプレートを読み込めませんでした');
  },
};

/** まだ 1 件も無い。 */
export const テンプレートが無い: Story = {
  args: { templates: [] },
  play: async () => {
    await expect(screen.getByText('まだテンプレートがありません。')).toBeVisible();
  },
};

/** 一覧が並ぶ。絵文字アイコンを設定したものは併記する。 */
export const 一覧: Story = {
  args: { templates },
  play: async () => {
    await expect(screen.getByRole('button', { name: '議事録' })).toBeVisible();
    await expect(screen.getByRole('button', { name: '📊 週次レポート' })).toBeVisible();
  },
};

/** 編集権限が無い人には削除ボタンが出ない（一覧自体は見える）。 */
export const 編集権限が無い人には削除ボタンが出ない: Story = {
  args: { templates, canManageTemplates: false },
  play: async () => {
    await expect(screen.getByRole('button', { name: '議事録' })).toBeVisible();
    await expect(screen.queryByRole('button', { name: '議事録 を削除' })).not.toBeInTheDocument();
  },
};

/** テンプレートを選ぶと題名入力（初期値はテンプレート名）に進む。 */
export const テンプレートを選ぶと題名入力に進む: Story = {
  args: { templates },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: '議事録' }));
    const input = await screen.findByRole('textbox', { name: '新しいページの題名' });
    await expect(input).toHaveValue('議事録');
    await expect(screen.getByRole('heading', { name: '題名を決める' })).toBeVisible();
  },
};

/** 題名を変えて作成すると、選んだテンプレートIDと編集後の題名で確定する。 */
export const 題名を変えて作成: Story = {
  args: { templates },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: '議事録' }));
    const input = await screen.findByRole('textbox', { name: '新しいページの題名' });
    await userEvent.clear(input);
    await userEvent.type(input, '9月の議事録');
    await userEvent.click(screen.getByRole('button', { name: '作成' }));

    await waitFor(() => expect(args.onConfirm).toHaveBeenCalledWith('t-1', '9月の議事録'));
  },
};

/** 「戻る」で一覧に戻れる。 */
export const 戻るで一覧に戻る: Story = {
  args: { templates },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: '議事録' }));
    await screen.findByRole('textbox', { name: '新しいページの題名' });
    await userEvent.click(screen.getByRole('button', { name: '戻る' }));

    await expect(screen.getByRole('heading', { name: '雛形を選ぶ' })).toBeVisible();
    await expect(screen.getByRole('button', { name: '議事録' })).toBeVisible();
  },
};

/** 作成に失敗したら、フォームは開いたままエラーを出す。 */
export const 作成に失敗: Story = {
  args: {
    templates,
    onConfirm: fn(async () => {
      throw new Error('boom');
    }),
  },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: '議事録' }));
    const input = await screen.findByRole('textbox', { name: '新しいページの題名' });
    await userEvent.click(screen.getByRole('button', { name: '作成' }));

    await expect(await screen.findByRole('alert')).toHaveTextContent('ページを作成できませんでした');
    // フォームは閉じない（入力も消えない）。
    await expect(input).toHaveValue('議事録');
  },
};

/** 削除ボタンは確認を経る（KbRowActions と同じ流儀）。確定すると onDelete が呼ばれる。 */
export const 削除は確認を経る: Story = {
  args: { templates },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: '議事録 を削除' }));
    const dialog = await screen.findByRole('dialog', { name: 'テンプレートを削除' });
    // 開いた直後は ConfirmModal 自身のフェードインアニメーション中で、実ブラウザでは
    // 一瞬 opacity が 0 の描画フレームがあり得る（toBeVisible は誤って揺れる）。
    // ここで確かめたいのは「正しい名前が本文にある」ことなので、存在だけを見る。
    await expect(within(dialog).getByText(/議事録/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: '削除' }));
    await waitFor(() => expect(args.onDelete).toHaveBeenCalledWith('t-1'));
  },
};

/** 削除に失敗したら、一覧の下にエラーを出す。 */
export const 削除に失敗: Story = {
  args: {
    templates,
    onDelete: fn(async () => {
      throw new Error('forbidden');
    }),
  },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: '議事録 を削除' }));
    const dialog = await screen.findByRole('dialog', { name: 'テンプレートを削除' });
    await userEvent.click(within(dialog).getByRole('button', { name: '削除' }));

    await expect(await screen.findByRole('alert')).toHaveTextContent('削除できませんでした');
  },
};

/** 閉じるボタンで onClose が呼ばれる。 */
export const 閉じる: Story = {
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};

/** オーバーレイクリックでも onClose が呼ばれる。 */
export const オーバーレイクリックで閉じる: Story = {
  play: async ({ args }) => {
    await userEvent.click(screen.getByTestId('kb-template-picker-overlay'));
    await expect(args.onClose).toHaveBeenCalled();
  },
};

/** 削除の確認モーダルが出ている間にEscapeを押しても、確認モーダルだけが閉じ、
 * ピッカー全体（onClose）は閉じない。 */
export const 削除確認中のEscapeはピッカーを閉じない: Story = {
  args: { templates },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: '議事録 を削除' }));
    await screen.findByRole('dialog', { name: 'テンプレートを削除' });

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'テンプレートを削除' })).not.toBeInTheDocument());
    await expect(args.onClose).not.toHaveBeenCalled();
    await expect(screen.getByRole('heading', { name: '雛形を選ぶ' })).toBeVisible();
  },
};

/** 閉じているときは何も描画しない。 */
export const 閉じているとき: Story = {
  args: { isOpen: false },
  play: async () => {
    await expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  },
};
