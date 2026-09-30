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

/**
 * フォームとほかの入口の間の「または」。両脇の線は文字の左右に並べて引く（線の上に地の色の
 * 帯を重ねて文字を抜く作りだと、置く面の色が変わるたびに帯の色を合わせ直すことになる）。
 */
export function AuthDivider() {
  return (
    <div className="my-6 flex items-center gap-3 text-sm text-[var(--color-text-muted)]" aria-hidden="true">
      <span className="h-px flex-1 bg-surface-3" />
      または
      <span className="h-px flex-1 bg-surface-3" />
    </div>
  );
}
