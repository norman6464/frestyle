import { useRef, useState, type ChangeEvent } from 'react';
import { PhotoIcon } from '@heroicons/react/24/outline';
import type { KbResolvedCover } from '@/entities/kb';
import {
  ACCEPTED_IMAGE_ACCEPT_ATTR,
  MAX_IMAGE_UPLOAD_BYTES,
  isAcceptedImageMimeType,
} from '@/shared/config/imageUpload';

export interface KbPageCoverButtonProps {
  /** 未設定は null（明示的に外した）と undefined（旧応答）のどちらもあり得る。 */
  cover?: KbResolvedCover | null;
  canEdit: boolean;
  /**
   * 設定（ファイルを選ぶとアップロードして設定）・解除をまとめて担う（null が解除）。
   * **失敗は投げてくる**前提（呼び出し側がトーストで知らせる。この部品では知らせを出さない）。
   */
  onChange: (file: File | null) => Promise<void>;
}

/**
 * KbPageCoverButton はページ頭部のカバー画像の設定・変更・解除口。
 *
 * 4 状態:
 *   読むだけ + 未設定 / 設定済み → 何も出さない（画像そのものは KbPageCover が別に出す。
 *                                  読む人には操作を見せない）
 *   書ける + 未設定    → 「カバー画像を追加」の 1 個だけ
 *   書ける + 設定済み   → 「カバー画像を変更」＋「カバー画像を外す」の 2 個
 *
 * アイコンのピッカーと違い、選ぶ相手は絵文字の一覧ではなくファイルなので、ダイアログは
 * 持たない — ボタンは隠しファイル入力を開くだけ。バリデーション（MIME・サイズ）は
 * ここで先に弾き、通ったものだけ onChange（アップロード → 設定）へ渡す。
 */
export default function KbPageCoverButton({ cover, canEdit, onChange }: KbPageCoverButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!canEdit) return null;

  const openPicker = () => inputRef.current?.click();

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // 同じファイルを選び直しても change が発火するようリセットする。
    event.target.value = '';
    if (!file) return;

    if (!isAcceptedImageMimeType(file.type)) {
      setValidationError('対応していない画像形式です（PNG・JPEG・GIF・WebP のみ）');
      return;
    }
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      setValidationError('画像が大きすぎます（10MB まで）');
      return;
    }
    setValidationError(null);
    setSaving(true);
    try {
      await onChange(file);
    } catch {
      // 知らせ（トースト）は呼び出し側の責務。ここでは何もしない。
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (saving) return;
    // 不正なファイルを選んだ後に「外す」を押した場合に備え、古い検証エラーを消す
    // （外す操作自体は検証を経ないので、cover が更新されても消えずに残ってしまう）。
    setValidationError(null);
    setSaving(true);
    try {
      await onChange(null);
    } catch {
      // 知らせは呼び出し側。
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-1 flex flex-wrap items-center gap-2 [&_button]:min-h-11 [&_button]:focus-visible:outline [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-brand-600">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_ACCEPT_ATTR}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => void handleFileChange(event)}
      />
      <button
        type="button"
        disabled={saving}
        onClick={openPicker}
        aria-label={cover ? 'カバー画像を変更' : 'カバー画像を追加'}
        className="flex items-center gap-1 rounded px-1.5 py-1 text-sm text-[var(--color-text-muted)] hover:bg-surface-2 disabled:opacity-50"
      >
        <PhotoIcon className="h-4 w-4" aria-hidden="true" />
        {cover ? 'カバー画像を変更' : 'カバー画像を追加'}
      </button>
      {cover && (
        <button
          type="button"
          disabled={saving}
          onClick={() => void clear()}
          aria-label="カバー画像を外す"
          className="rounded px-1.5 py-1 text-sm text-[var(--color-text-muted)] hover:bg-surface-2 disabled:opacity-50"
        >
          外す
        </button>
      )}
      {validationError && (
        <p role="alert" className="w-full text-sm text-danger-ink">
          {validationError}
        </p>
      )}
    </div>
  );
}
