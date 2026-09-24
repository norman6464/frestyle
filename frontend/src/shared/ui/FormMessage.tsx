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

/** 成功の知らせが自動で消えるまでの時間（onDismiss を渡したときだけ）。失敗は自動では消さない。 */
export const FORM_MESSAGE_AUTO_DISMISS_MS = 5000;

/**
 * FormMessage はフォームの上に出す成功・失敗の知らせ。
 *
 * - 失敗は `role="alert"`（割り込んで読む）で、**自動では消さない**。読み逃すと何を直せば
 *   よいか分からなくなる。閉じるのは本人が閉じるボタンを押したときだけ
 * - 成功は `role="status"`（手が空いたときに読む）。onDismiss を渡すと一定時間で消える
 */
export default function FormMessage({ message, onDismiss }: FormMessageProps) {
  const isError = message?.type === 'error';

  useEffect(() => {
    if (!message || !onDismiss || isError) return;
    const timer = setTimeout(onDismiss, FORM_MESSAGE_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss, isError]);

  if (!message) return null;

  return (
    <div
      role={isError ? 'alert' : 'status'}
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
          // 押せる範囲は 28px（アイコンは 16px のまま、余白で広げる）。粗いポインタでは 44px。
          className="-my-1 -mr-1 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded transition-opacity hover:opacity-70 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
        >
          <FsIcon name="x" className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
