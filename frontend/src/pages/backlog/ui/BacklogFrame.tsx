import { useRef, type ReactNode } from 'react';
import type { Project } from '@/entities/project';
import type { BacklogView } from '../model/backlogView';
import { projectInitials } from '../lib/projectInitials';
import BacklogProjectSwitcher from './BacklogProjectSwitcher';
import BacklogTabs from './BacklogTabs';

/** 面ごとの大きな名前。設計ボード ST08 の文言（バックログ）と、面の名前（ほか）。 */
const HEADING: Record<BacklogView, { title: string }> = {
  backlog: { title: 'バックログ' },
  archive: { title: 'アーカイブ' },
  settings: { title: '設定' },
};

export interface BacklogFrameProps {
  view: BacklogView;
  workspaceSlug: string;
  project: Project;
  /** 見出しの塊の下端（区切り線の上）に足すもの。一覧の面の絞り込みのタブなど。 */
  headerExtra?: ReactNode;
  /** 一覧の列の右に並べるもの（確認の窓など）。詳細は独立した票（/tickets/:id）なので、
   * ここには置かない。 */
  aside?: ReactNode;
  children: ReactNode;
}

/**
 * BacklogFrame はバックログの面に共通の枠（設計ボード ST08）。文脈の行（印・プロジェクト名 /
 * プロジェクト KEY ▾ と、右端に面のタブ）→ 面の名前、の見出しの塊と、その下の本文の列を持つ。
 *
 * 見出しは面の名前だけにする。「この面で何をするか」の一文や小さな飾りの見出しは持たない —
 * どの面もタブと表の見出し行で用途が読めるので、言葉で重ねて説明しない（単純な画面にする）。
 *
 * 文字の大きさは報道系サイトの記事面に合わせる（題は 24px・狭い画面 20px で行送り 1.35）。
 * 色は付けない —— 今いる面は太字と下の線で示す（バックログの画面では色を混ぜない。
 * 青は押す物と選んだ行にだけ使う）。
 *
 * 左の列は持たない（バックログは全幅）。見出しを親ルートに置かず、各面がこの枠で包む。
 */
export default function BacklogFrame({ view, workspaceSlug, project, headerExtra, aside, children }: BacklogFrameProps) {
  const heading = HEADING[view];
  // タブから面を移ったとき、今いるタブが畳まれていればここへフォーカスを移す（BacklogTabs）。
  const headingRef = useRef<HTMLHeadingElement>(null);
  return (
    <div className="flex h-full overflow-hidden">
      {/* 一覧の側。本文のランドマーク（main）は枠（AppShell）が持つので、ここは div にする
          （main の中に main を置かない）。 */}
      <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-surface-3 px-4 pb-4 pt-4 sm:px-6 sm:pb-5">
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

          <h1
            ref={headingRef}
            tabIndex={-1}
            className="mt-5 text-xl font-bold leading-[1.35] text-[var(--color-text-primary)] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 sm:mt-6 md:text-2xl"
          >
            {heading.title}
          </h1>

          {headerExtra}
        </div>

        {children}
      </div>

      {aside}
    </div>
  );
}
