import { useId, useState } from 'react';
import { KbRepository } from '@/entities/kb';
import { getApiError } from '@/shared/lib/classifyApiError';
import { useToast } from '@/shared/lib/hooks/useToast';
import Button from '@/shared/ui/Button';

export interface KbSaveAsTemplateButtonProps {
  workspaceSlug: string;
  pageId: string;
  /** 「このスペースだけ」を選んだときに送る spaceId（今のページの所属スペース）。 */
  spaceId: string;
}

/**
 * KbSaveAsTemplateButton は「テンプレートとして保存」の入口。
 *
 * コメント・履歴・共有の各ボタンと同じ流儀（トグル + 絶対配置パネル）で KbPage.tsx の
 * ヘッダーに並ぶ。呼び出し側（KbPage）が data.canEdit のときだけ描画する
 * （共有ボタンが data.canManage のときだけ出るのと同じ形 — 編集権限が無い人には
 * ボタンごと見せない）。
 *
 * 名前の重複（409）だけは「同じ名前のテンプレートが既にあります」と言い換える。
 * それ以外の失敗は一般的な文言にする。**どちらもフォームは閉じない**
 * （消すと書き直しになるうえ、何が悪かったのか分からない — KbVersionSaveForm と同じ約束）。
 */
export default function KbSaveAsTemplateButton({
  workspaceSlug,
  pageId,
  spaceId,
}: KbSaveAsTemplateButtonProps) {
  const { showToast } = useToast();
  const nameId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'space' | 'workspace'>('space');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setName('');
    setScope('space');
    setError(null);
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await KbRepository.createPageTemplate(workspaceSlug, pageId, {
        name: trimmed,
        spaceId: scope === 'space' ? spaceId : null,
      });
      showToast('success', 'テンプレートとして保存しました');
      close();
    } catch (cause) {
      setError(
        getApiError(cause).status === 409
          ? '同じ名前のテンプレートが既にあります。'
          : 'テンプレートとして保存できませんでした。',
      );
      setSaving(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="rounded border border-surface-3 px-2 py-1 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2"
      >
        テンプレートとして保存
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-surface-3 bg-surface-1 p-3 shadow-lg">
          <div className="flex flex-col gap-2">
            <div>
              <label htmlFor={nameId} className="mb-1 block text-xs text-[var(--color-text-muted)]">
                テンプレート名
              </label>
              <input
                id={nameId}
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={saving}
                className="w-full rounded border border-surface-3 bg-surface-1 px-2 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-brand-600 focus:outline-none disabled:opacity-60"
              />
            </div>
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-xs text-[var(--color-text-muted)]">保存先</legend>
              <label className="flex items-center gap-1.5 text-sm text-[var(--color-text-primary)]">
                <input
                  type="radio"
                  name="kb-save-as-template-scope"
                  checked={scope === 'space'}
                  onChange={() => setScope('space')}
                  disabled={saving}
                />
                このスペースだけ
              </label>
              <label className="flex items-center gap-1.5 text-sm text-[var(--color-text-primary)]">
                <input
                  type="radio"
                  name="kb-save-as-template-scope"
                  checked={scope === 'workspace'}
                  onChange={() => setScope('workspace')}
                  disabled={saving}
                />
                ワークスペース全体
              </label>
            </fieldset>
            {error && (
              <p role="alert" className="text-sm leading-relaxed text-danger-ink">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={close}>
                キャンセル
              </Button>
              <Button
                type="button"
                size="sm"
                loading={saving}
                disabled={!name.trim()}
                onClick={() => void handleSubmit()}
              >
                保存
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
