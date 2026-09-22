import { useRef } from 'react';
import InputField from '@/shared/ui/InputField';
import TextareaField from '@/shared/ui/TextareaField';
import Button from '@/shared/ui/Button';
import FormMessage from '@/shared/ui/FormMessage';
import Avatar from '@/shared/ui/Avatar';
import Loading from '@/shared/ui/Loading';
import { useProfileEdit } from '../model/useProfileEdit';
import { useProfileImageUpload } from '../model/useProfileImageUpload';
import { CameraIcon } from '@heroicons/react/24/outline';

export default function ProfilePage() {
  const { form, message, setMessage, loading, submitting, updateField, handleUpdate } = useProfileEdit();
  const { upload, uploading } = useProfileImageUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const imageUrl = await upload(file);
    if (imageUrl) {
      updateField('avatarUrl', imageUrl);
    } else {
      setMessage({ type: 'error', text: '画像のアップロードに失敗しました。' });
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (loading) {
    return <Loading className="h-full" />;
  }

  return (
    // 縦長コンテンツの最終要素が viewport 下端で見切れないよう pb-24 で余白確保
    <div className="space-y-6">
      <FormMessage message={message} />

      {/* セクション1: 基本情報 */}
      <div className="rounded-2xl border border-surface-3 bg-surface-1 p-4 sm:p-6">
        <div className="mb-6 flex flex-wrap items-center gap-4 border-b border-surface-3 pb-6">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar name={form.displayName || 'U'} src={form.avatarUrl || undefined} size="xl" />
            <Button
              variant="secondary"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || submitting}
              className="min-h-11"
              aria-label="プロフィール画像を変更"
            >
              <CameraIcon aria-hidden="true" className="w-4 h-4" />
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
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">プロフィールを編集</h2>
            <p role="status" className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
              {uploading ? '画像をアップロード中...' : '画像や入力内容は「基本情報を保存」で反映されます。'}
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleUpdate();
          }}
          className="space-y-4"
        >
          <InputField
            label="氏名"
            name="displayName"
            autoComplete="name"
            value={form.displayName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField('displayName', e.target.value)}
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
            placeholder="例: 学習中、チャット可能、取り込み中..."
            maxLength={100}
          />
          <Button variant="primary" className="min-h-11 w-full sm:ml-auto sm:w-auto" type="submit" disabled={submitting || uploading}>
            {submitting ? '更新中...' : '基本情報を保存'}
          </Button>
        </form>
      </div>
    </div>
  );
}
