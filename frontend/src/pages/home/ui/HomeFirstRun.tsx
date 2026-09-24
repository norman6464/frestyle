import { Link } from 'react-router-dom';
import { FsIcon, PageFrame } from '@/shared/ui';
import { homePrimaryLink, homeSecondaryLink, homeTextLink } from '../lib/homeStyles';

/**
 * 初回ホーム（どのワークスペースにも所属していない人）。担当 0 件・履歴 0 件とは別の状態として
 * 出す。使えない作成先の選択や見本のページは並べず、始め方の入口を 3 つだけ置く。
 *
 * - ナレッジをひらく（ここでワークスペースを作れる）
 * - バックログをひらく
 * - あなたへの招待を確認（招待を待つことだけを始め方にしない）
 */
export default function HomeFirstRun() {
  return (
    <PageFrame className="pb-24">
      <header className="lg:mt-4">
        <p aria-hidden="true" className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-brand-700">
          Make this space yours
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-[var(--color-text-primary)] sm:text-4xl">
          FreStyle へようこそ。
        </h1>
        <p className="mt-3 text-base text-[var(--color-text-muted)]">まずは、いま考えていることから。</p>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="home-first-knowledge" className="rounded-3xl bg-brand-100 p-6 sm:p-12">
          <FsIcon name="knowledge" className="h-10 w-10 text-brand-700" />
          <p aria-hidden="true" className="mt-8 font-mono text-xs font-medium uppercase tracking-[0.14em] text-brand-800">
            Start with a thought
          </p>
          <h2
            id="home-first-knowledge"
            className="mt-4 text-3xl font-bold leading-snug tracking-tight text-[var(--color-text-primary)] sm:text-4xl"
          >
            ひとつのメモから、
            <br />
            チームの知識へ。
          </h2>
          <p className="mt-6 text-base leading-relaxed text-[var(--color-text-secondary)]">
            メモも、決まったことも。
            <br />
            ナレッジに残して、必要なときに振り返れます。
          </p>
          <Link to="/kb" className={`${homePrimaryLink} mt-8`}>
            ナレッジをひらく <FsIcon name="arrow-up-right" className="h-5 w-5" />
          </Link>
        </section>

        <div className="flex flex-col gap-8">
          <section aria-labelledby="home-first-backlog">
            <h2 id="home-first-backlog" className="text-xl font-bold text-[var(--color-text-primary)]">
              やることが決まったら
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              チケットで作業を並べ、優先度と期限を確認。次に進めることを、チームで見つけます。
            </p>
            <Link to="/backlog" className={`${homeSecondaryLink} mt-5`}>
              バックログをひらく <FsIcon name="arrow-right" className="h-4 w-4" />
            </Link>
          </section>
          <hr className="border-surface-3" />
          <section aria-labelledby="home-first-invitations">
            <h2 id="home-first-invitations" className="text-lg font-bold text-[var(--color-text-primary)]">
              ワークスペースへの招待
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
              チームから招待されている場合は、「あなたへの招待」から参加できます。
            </p>
            <Link to="/invitations" className={`${homeTextLink} mt-3`}>
              あなたへの招待を確認 <FsIcon name="arrow-right" className="h-4 w-4" />
            </Link>
          </section>
        </div>
      </div>

      <p className="mt-10 text-sm text-[var(--color-text-muted)]">
        自分の担当とナレッジ。必要な場所はいつでも上部ナビゲーションから。
      </p>
    </PageFrame>
  );
}
