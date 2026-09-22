import { useEffect } from 'react';
import FsIcon from './icons/FsIcon';

/**
 * フォームの通知メッセージ。
 * 特定の業務ドメインに属さない汎用の表示用型なので、描画する本コンポーネントと同居させる。
 */
export interface FormMessage {
  type: 'success' | 'error';
  text: string;
}

interface FormMessageProps {
  message: FormMessage | null;
  onDismiss?: () => void;
}

export default function FormMessage({ message, onDismiss }: FormMessageProps) {
  useEffect(() => {
    if (!message || !onDismiss) return;
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  const isError = message.type === 'error';

  return (
    <div
      role="alert"
      className={`mb-4 p-3 rounded-lg text-sm font-medium flex items-start gap-2 ${
        isError
          ? 'bg-danger-soft text-danger-ink border border-danger-border'
          : 'bg-success-soft text-success border border-success-border'
      }`}
    >
      {isError ? (
        <FsIcon name="alert-circle" className="w-5 h-5 flex-shrink-0 mt-0.5" />
      ) : (
        <FsIcon name="check-circle" className="w-5 h-5 flex-shrink-0 mt-0.5" />
      )}
      <span className="flex-1">{message.text}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="閉じる"
          className="flex-shrink-0 mt-0.5 hover:opacity-70 transition-opacity"
        >
          <FsIcon name="x" className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
