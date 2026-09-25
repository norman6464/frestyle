import type { ReactNode } from 'react';
import { FsIcon } from '@/shared/ui';

/**
 * 認証の画面のフォームの上に出す知らせ。失敗は危険の色と role="alert"（すぐ読み上げる）、
 * 済んだことの知らせは成功の色と role="status"。色だけに頼らず印も添える。
 */
export default function AuthNotice({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const error = tone === 'error';
  return (
    <p
      role={error ? 'alert' : 'status'}
      className={`mb-6 flex items-start gap-2 rounded-lg border p-3 text-sm font-medium ${
        error ? 'border-danger-border bg-danger-soft text-danger-ink' : 'border-success-border bg-success-soft text-success'
      }`}
    >
      <FsIcon name={error ? 'alert-circle' : 'check-circle'} className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** フォームとほかの入口の間の「または」。 */
export function AuthDivider() {
  return (
    <div className="relative my-6" aria-hidden="true">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-surface-3" />
      </div>
      <div className="relative flex justify-center text-sm">
        <span className="bg-surface px-3 text-[var(--color-text-muted)]">または</span>
      </div>
    </div>
  );
}
