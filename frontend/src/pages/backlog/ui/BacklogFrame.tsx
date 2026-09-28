import { useRef, type ReactNode } from 'react';
import type { Project } from '@/entities/project';
import type { BacklogView } from '../model/backlogView';
import { projectInitials } from '../lib/projectInitials';
import BacklogProjectSwitcher from './BacklogProjectSwitcher';
import BacklogTabs from './BacklogTabs';

/**
 * 面ごとの見出し。小さな見出しは設計ボード ST08 の文言（バックログ）と、面の名前（ほか）。
 * 一文は「この面で何をするか」を一言で。
 */
const HEADING: Record<BacklogView, { eyebrow: string; title: string; lede: (projectName: string) => string }> = {
  backlog: {
    eyebrow: 'Make room for the next thing',
    title: 'バックログ',
    lede: (name) => `${name} の次の一歩。いま動かす課題を選びましょう。`,
  },
  archive: {
    eyebrow: 'Archive',
    title: 'アーカイブ',
    lede: () => 'アーカイブしたチケット。必要なときに現役へ戻せます。',
  },
  settings: {
    eyebrow: 'Settings',
    title: '設定',
    lede: () => '状態・種別・スプリントの決まりごと。バックログの動き方をここで整えます。',
  },
};

export interface BacklogFrameProps {
  view: BacklogView;
  workspaceSlug: string;
  project: Project;
  /** 見出しの塊の下端（区切り線の上）に足すもの。一覧の面の絞り込みのタブなど。 */
  headerExtra?: ReactNode;
  /** 一覧の列の右に並べるもの。広い画面の詳細の列・狭い画面の全画面の詳細・確認の窓。 */
  aside?: ReactNode;
  /** 一覧の列（見出しを含む）を操作できなくする。狭い画面で全画面の詳細を重ねている間。 */
  inert?: boolean;
  children: ReactNode;
}

/**
 * BacklogFrame はバックログの面に共通の枠（設計ボード ST08）。文脈の行（印・プロジェクト名 /
 * プロジェクト KEY ▾ と、右端に面のタブ）→ 小さな見出し → 大きな面の名前 → 一文、の見出しの塊と、
 * その下の本文の列を持つ。
 *
 * 左の列は持たない（バックログは全幅）。詳細の列は見出しの横まで全高で並ぶ（ST10）ので、
 * 見出しを親ルートに置かず、各面がこの枠で包む。
 */
export default function BacklogFrame({ view, workspaceSlug, project, headerExtra, aside, inert, children }: BacklogFrameProps) {
  const heading = HEADING[view];
  // タブから面を移ったとき、今いるタブが畳まれていればここへフォーカスを移す（BacklogTabs）。
  const headingRef = useRef<HTMLHeadingElement>(null);
  return (
    <div className="flex h-full overflow-hidden">
      {/*
        一覧の側。本文のランドマーク（main）は枠（AppShell）が持つので、ここは div にする
        （main の中に main を置かない）。狭い画面で全画面の詳細を重ねている間は inert にして、
        Tab が裏の一覧へ抜けないようにする（一覧は描いたまま重ねるので、戻ればスクロール位置も残る）。
      */}
      <div inert={inert} className="mx-auto flex w-full min-w-0 max-w-7xl flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-surface-3 px-4 pb-3 pt-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            {/* 狭い画面では印と名前を畳み、切替（「プロジェクト KEY ▾」）だけを残す（設計ボード ST12）。
                面のタブと 1 行に収めて、一覧の 1 行目を上へ上げる。 */}
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span
                aria-hidden="true"
                className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md bg-taupe-600 text-xs font-bold text-white sm:flex"
              >
                {projectInitials(project.key)}
              </span>
              <span className="hidden min-w-0 truncate font-semibold text-[var(--color-text-primary)] sm:inline">{project.name}</span>
              <span aria-hidden="true" className="hidden text-[var(--color-text-faint)] sm:inline">/</span>
              <BacklogProjectSwitcher workspaceSlug={workspaceSlug} project={project} />
            </div>
            <BacklogTabs projectId={project.id} current={view} fallbackFocusRef={headingRef} />
          </div>

          <p className="mt-3 font-mono text-xs font-medium uppercase tracking-[0.14em] text-brand-700 sm:mt-4" aria-hidden="true">
            {heading.eyebrow}
          </p>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="mt-1 text-3xl font-bold leading-tight tracking-tight text-[var(--color-text-primary)] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 sm:text-4xl"
          >
            {heading.title}
          </h1>
          {/* 一文は狭い画面では出さない（ST12）。見出しで面は分かり、縦の場所は一覧に回す。 */}
          <p className="mt-2 hidden max-w-[44em] text-sm text-[var(--color-text-muted)] sm:block">{heading.lede(project.name)}</p>

          {headerExtra}
        </div>

        {children}
      </div>

      {aside}
    </div>
  );
}
