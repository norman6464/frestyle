import type { Meta, StoryObj } from '@storybook/react-vite';
import { AxiosError, AxiosHeaders } from 'axios';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import { withApi, withToast } from '../../../../.storybook/decorators';
import KbSaveAsTemplateButton from './KbSaveAsTemplateButton';

/**
 * withApi の見本関数から投げるのは**本物の AxiosError インスタンス**にすること。
 * カスタム adapter を素通りする値は axios 自身が包み直さない（プレーンな
 * `{isAxiosError:true}` は `instanceof AxiosError` を満たさず、getApiError の
 * ステータス判定が効かない）。KbPage.test.tsx の blockIdConflictError と同じ形。
 */
function conflictError(): AxiosError {
  return new AxiosError('Conflict', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 409,
    statusText: 'Conflict',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { error: 'duplicate_name' },
  });
}

/**
 * 「テンプレートとして保存」の入口。コメント・履歴・共有の各ボタンと同じ流儀
 * （トグル + 絶対配置パネル）。編集権限が無い人には呼び出し側（KbPage）が丸ごと出さない
 * ので、この部品自体には canEdit の分岐は無い。
 *
 * 名前の重複（409）だけ「同じ名前のテンプレートが既にあります」と言い換える。
 * どちらの失敗でもフォームは閉じない（入力を保つ）。
 */
const meta = {
  title: 'features/kb-page-templates/KbSaveAsTemplateButton',
  component: KbSaveAsTemplateButton,
  parameters: { layout: 'padded' },
  args: { workspaceSlug: 'w-3f2a9c', pageId: 'p-1', spaceId: 's-1' },
  decorators: [withToast],
} satisfies Meta<typeof KbSaveAsTemplateButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 閉じている状態。 */
export const 閉じている: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'テンプレートとして保存' }),
    ).toBeVisible();
    await expect(within(canvasElement).queryByLabelText('テンプレート名')).not.toBeInTheDocument();
  },
};

/** 押すとフォームが開く。既定は「このスペースだけ」。 */
export const 押すとフォームが開く: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'テンプレートとして保存' }));

    await expect(canvas.getByLabelText('テンプレート名')).toBeVisible();
    await expect(canvas.getByRole('radio', { name: 'このスペースだけ' })).toBeChecked();
    await expect(canvas.getByRole('radio', { name: 'ワークスペース全体' })).not.toBeChecked();
  },
};

/** 送信に成功すると、テンプレートを作る API が呼ばれてフォームが閉じる。 */
export const 送信に成功: Story = {
  decorators: [withApi({ '/templates': { id: 't-1', name: '議事録', spaceId: 's-1', createdAt: '2026-09-01T00:00:00Z' } })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'テンプレートとして保存' }));
    await userEvent.type(canvas.getByLabelText('テンプレート名'), '議事録');
    await userEvent.click(canvas.getByRole('button', { name: '保存' }));

    await waitFor(async () => {
      await expect(canvas.queryByLabelText('テンプレート名')).not.toBeInTheDocument();
    });
    // 成功のトースト。フェードインの途中はDOMに存在してもtoBeVisibleを満たさないことが
    // CI環境（実ブラウザ）でだけ起きるため、アニメーションが収まるまでwaitForで待つ。
    await waitFor(async () => {
      await expect(screen.getByText('テンプレートとして保存しました')).toBeVisible();
    });
  },
};

// 「ワークスペース全体を選んで送信」の見本で、実際に送った本文を確かめるために使う。
// withApi のデコレータは story オブジェクト生成時（モジュール評価時）に配線されるので、
// play の中の変数ではなくモジュール直下の入れ物へ書く（play 側は毎回リセットしてから読む）。
const capturedCreateTemplateBody: { current: unknown } = { current: undefined };

/** 「ワークスペース全体」を選んで送信すると、spaceId を送らない（null）。 */
export const ワークスペース全体を選んで送信: Story = {
  decorators: [
    withApi({
      '/templates': (config: { data?: unknown }) => {
        capturedCreateTemplateBody.current =
          typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
        return { id: 't-1', name: '議事録', createdAt: '2026-09-01T00:00:00Z' };
      },
    }),
  ],
  play: async ({ canvasElement }) => {
    capturedCreateTemplateBody.current = undefined;
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'テンプレートとして保存' }));
    await userEvent.type(canvas.getByLabelText('テンプレート名'), '議事録');
    await userEvent.click(canvas.getByRole('radio', { name: 'ワークスペース全体' }));
    await userEvent.click(canvas.getByRole('button', { name: '保存' }));

    await waitFor(async () => {
      await expect(canvas.queryByLabelText('テンプレート名')).not.toBeInTheDocument();
    });
    await expect(capturedCreateTemplateBody.current).toMatchObject({ spaceId: null });
  },
};

/** 名前が重複（409）していたら、フォーム内にその旨を出す。フォームは閉じない。 */
export const 名前が重複: Story = {
  decorators: [
    withApi({
      '/templates': () => {
        throw conflictError();
      },
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'テンプレートとして保存' }));
    await userEvent.type(canvas.getByLabelText('テンプレート名'), '議事録');
    await userEvent.click(canvas.getByRole('button', { name: '保存' }));

    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      '同じ名前のテンプレートが既にあります',
    );
    // フォームは閉じず、入力も残る。
    await expect(canvas.getByLabelText('テンプレート名')).toHaveValue('議事録');
  },
};

/** それ以外の失敗は一般的な文言にする。 */
export const 保存に失敗: Story = {
  // 見本に無い宛先は 404 を返すので、失敗の道筋がそのまま通る。
  decorators: [withApi({})],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'テンプレートとして保存' }));
    await userEvent.type(canvas.getByLabelText('テンプレート名'), '議事録');
    await userEvent.click(canvas.getByRole('button', { name: '保存' }));

    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'テンプレートとして保存できませんでした',
    );
    await expect(canvas.getByLabelText('テンプレート名')).toHaveValue('議事録');
  },
};

/** キャンセルすると入力が消え、フォームが閉じる。 */
export const キャンセル: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'テンプレートとして保存' }));
    await userEvent.type(canvas.getByLabelText('テンプレート名'), '書きかけ');
    await userEvent.click(canvas.getByRole('button', { name: 'キャンセル' }));

    await expect(canvas.queryByLabelText('テンプレート名')).not.toBeInTheDocument();
  },
};
