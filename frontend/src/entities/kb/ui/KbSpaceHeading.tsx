import type { KbMySpace } from '../model/types';

export interface KbSpaceHeadingProps {
  space: KbMySpace;
  /** 画面の名前（「すべてのページ」など）。省くとスペースの名前そのものを見出しにする（概要）。 */
  title?: string;
}

/**
 * KbSpaceHeading はスペース単位の画面（概要・すべてのページ・お気に入り・メンバー）の見出し。
 *
 * 画面の行き来は文脈バー（概要・メンバー）と左の列（お気に入り・すべてのページ）が持つので、
 * ここは「今どの画面か」を名乗るだけにする（同じ入口をタブとしてもう 1 組並べない）。
 * 本文と同じ幅・同じ左端に置き、見出しと本文の左がずれないようにする。
 */
export default function KbSpaceHeading({ space, title }: KbSpaceHeadingProps) {
  return (
    <header className="shrink-0 px-4 pt-6 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <p className="text-xs font-medium text-[var(--color-text-muted)] [overflow-wrap:anywhere]">
          {title ? space.name : 'スペース'}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-[var(--color-text-primary)] [overflow-wrap:anywhere]">
          {title ?? space.name}
        </h1>
      </div>
    </header>
  );
}
