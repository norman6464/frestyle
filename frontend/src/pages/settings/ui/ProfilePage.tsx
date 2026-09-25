import { useEffect, useRef, useState } from 'react';
import InputField from '@/shared/ui/InputField';
import TextareaField from '@/shared/ui/TextareaField';
import Button from '@/shared/ui/Button';
import FormMessage from '@/shared/ui/FormMessage';
import Avatar from '@/shared/ui/Avatar';
import Loading from '@/shared/ui/Loading';
import { useProfileEdit } from '../model/useProfileEdit';
import { useProfileImageUpload } from '../model/useProfileImageUpload';
import { FsIcon } from '@/shared/ui';

type AvatarResult = { tone: 'saved' | 'error'; text: string } | null;

/**
 * プロフィールの編集。
 *
 * - 画像は選んだ時点で保存する（アップロードだけ済んで保存されないまま離れる、を無くす）。
 *   結果は画像のそばに出す
 * - 文字の欄は「プロフィールを保存」で保存する。保存していない変更があることはボタンのそばに出し、
 *   タブを閉じる・再読み込みのときは確認を出す
 * - 氏名が空のときは氏名の欄のそばに出す
 */
export default function ProfilePage() {
  const { form, message, nameError, loading, submitting, justSaved, dirty, updateField, handleUpdate, saveAvatar } =
    useProfileEdit();
  const { upload, uploading } = useProfileImageUpload();
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [avatarResult, setAvatarResult] = useState<AvatarResult>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 保存していない変更があるまま、タブを閉じる・再読み込みしようとしたら確認を出す。
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    setAvatarResult(null);
    const imageUrl = await upload(file);
    if (!imageUrl) {
      setAvatarResult({ tone: 'error', text: '画像のアップロードに失敗しました。' });
      return;
    }
    setSavingAvatar(true);
    const ok = await saveAvatar(imageUrl);
    setSavingAvatar(false);
    setAvatarResult(
      ok
        ? { tone: 'saved', text: '画像を保存しました。' }
        : { tone: 'error', text: '画像を保存できませんでした。もう一度お試しください。' },
    );
  };

  if (loading) {
    return <Loading className="h-full" message="プロフィールを読み込んでいます" />;
  }

  const avatarBusy = uploading || savingAvatar;

  return (
    <div className="space-y-6">
      <FormMessage message={message} />

      <section aria-labelledby="profile-heading" className="rounded-2xl border border-surface-3 bg-surface-1 p-4 sm:p-6">
        <h2 id="profile-heading" className="text-lg font-bold text-[var(--color-text-primary)]">
          プロフィール
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">チームに表示される名前・画像・ひとことです。</p>

        <div className="mt-6 flex flex-wrap items-center gap-4 border-b border-surface-3 pb-6">
          <Avatar name={form.displayName || 'U'} src={form.avatarUrl || undefined} size="xl" />
          <div className="flex flex-col items-start gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarBusy || submitting}
              loading={avatarBusy}
              className="min-h-11"
              aria-label="プロフィール画像を変更"
            >
              <FsIcon name="camera" className="h-4 w-4" />
              画像を変更
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={handleImageSelect}
              className="hidden"
              data-testid="profile-image-input"
            />
            {/* 画像の結果は画像のそばに出す。選んだ時点で保存するので、ほかの欄の保存とは別。 */}
            <p role="status" className="text-sm text-[var(--color-text-muted)]">
              {avatarBusy
                ? '画像を保存しています...'
                : avatarResult?.tone === 'saved'
                  ? avatarResult.text
                  : '画像は選ぶとすぐに保存されます。'}
            </p>
            {avatarResult?.tone === 'error' && (
              <p role="alert" className="flex items-center gap-1.5 text-sm text-danger-ink">
                <FsIcon name="alert-circle" className="h-4 w-4 shrink-0" />
                {avatarResult.text}
              </p>
            )}
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleUpdate();
          }}
          className="mt-6 space-y-4"
          noValidate
        >
          <InputField
            label="氏名"
            name="displayName"
            autoComplete="name"
            value={form.displayName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('displayName', e.target.value)}
            error={nameError ?? undefined}
          />
          <TextareaField
            label="自己紹介"
            name="bio"
            value={form.bio}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => updateField('bio', e.target.value)}
            placeholder="あなたについて教えてください..."
            rows={4}
            maxLength={200}
          />
          <InputField
            label="ステータス"
            name="status"
            hint="今の状況を、チームに短く伝えられます。"
            value={form.status}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('status', e.target.value)}
            placeholder="例: 取り込み中、午後は会議が続きます"
            maxLength={100}
          />
          <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
            <p role="status" className="text-sm text-[var(--color-text-muted)] sm:text-right">
              {justSaved ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <FsIcon name="check" className="h-4 w-4" />
                  保存しました
                </span>
              ) : dirty ? (
                '保存していない変更があります'
              ) : (
                ''
              )}
            </p>
            <Button variant="primary" className="min-h-11" type="submit" disabled={submitting || avatarBusy}>
              {submitting ? '保存しています...' : 'プロフィールを保存'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
