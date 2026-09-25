import { Link } from 'react-router-dom';
import { FsIcon } from '@/shared/ui';

/**
 * ログインの戻り（受け渡し中）の見た目。ふだんは一瞬で次の画面へ移る。
 *
 * 時間がかかっているとき（slow）は、回るだけの画面に置き去りにしないよう、理由と
 * 「ログイン画面へ戻る」を出す（受け渡しは続けているので、そのまま待ってもよい）。
 */
export default function LoginCallbackView({ slow }: { slow: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-surface-1 p-6 text-center">
      <div
        role="status"
        aria-label="ログイン中"
        className="h-10 w-10 animate-spin rounded-full border-4 border-surface-3 border-t-brand-600 motion-reduce:animate-none"
      />
      <p className="text-base font-medium text-[var(--color-text-primary)]">ログイン中...</p>
      {/* 知らせの器は初めから置き、中身だけを後から入れる（器ごと後から足すと、読み上げが
          その中身を拾わないことがある）。 */}
      <div role="status" className="max-w-sm text-sm leading-relaxed text-[var(--color-text-muted)]">
        {slow && (
          <>
            <p>ログインに時間がかかっています。通信の状態を確かめて、もう一度お試しください。</p>
            <Link
              to="/login"
              className="mt-3 inline-flex min-h-11 items-center gap-1 rounded-md font-medium text-brand-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              <FsIcon name="chevron-left" className="h-4 w-4" />
              ログイン画面へ戻る
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
