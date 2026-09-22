import type { SVGProps } from 'react';

/**
 * 空状態・失敗の小さな絵。
 *
 * 一覧が空のときに丸い灰色の中に 32px のアイコンを置くだけだと、画面の真ん中が「無い」
 * ことしか言わない。何が無くて次に何をすればいいかは文言が担うが、絵は
 * 「ここはバックログで、まだ何も積まれていない」という場面を一目で伝える役目を持つ。
 *
 * 描き方は線アイコンと同じ流儀（線幅 1.75・丸い端）で、面だけを製品の淡い青
 * （--fs-action-soft）で塗る二色刷り。差し色（--fs-action）は 1 か所だけ。
 * 色はすべてトークンなので、配色が変わればここも追随する。
 */
export type FsIllustrationName = 'empty-backlog' | 'empty-archive' | 'no-results' | 'load-error';

export interface FsIllustrationProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: FsIllustrationName;
}

const SOFT = 'var(--fs-action-soft)';
const ACCENT = 'var(--fs-action)';
const PAPER = 'var(--fs-raised)';

export default function FsIllustration({ name, className = 'h-24 w-24', ...rest }: FsIllustrationProps) {
  return (
    <svg
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      data-illustration={name}
      aria-hidden="true"
      {...rest}
    >
      {name === 'empty-backlog' && (
        <>
          {/* 奥の 2 枚は淡く、手前の 1 枚だけ紙の色。積まれていく方向が上へ向くように少しずつずらす。 */}
          <rect x="22" y="40" width="52" height="34" rx="4" fill={SOFT} />
          <rect x="18" y="32" width="52" height="34" rx="4" fill={SOFT} />
          <rect x="14" y="24" width="52" height="34" rx="4" fill={PAPER} />
          <path d="M22 34h20" />
          <path d="M22 41h30" />
          <path d="M22 48h14" />
          {/* 差し色は「足せる」印だけ。 */}
          <circle cx="70" cy="26" r="11" fill={ACCENT} stroke="none" />
          <path d="M70 20.5v11M64.5 26h11" stroke={PAPER} strokeWidth={2.25} />
        </>
      )}
      {name === 'empty-archive' && (
        <>
          {/* 蓋の開いた箱。中の紙が 1 枚だけ顔を出していて、「しまってあるが取り出せる」。 */}
          <path d="M20 44h56v30a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4Z" fill={SOFT} />
          <path d="M16 36h64v8H16z" fill={PAPER} />
          <path d="m20 36 6-12h44l6 12" fill={PAPER} />
          <rect x="36" y="18" width="24" height="26" rx="2" fill={PAPER} />
          <path d="M42 26h12" />
          <path d="M42 32h8" />
          <path d="M40 54h16" />
        </>
      )}
      {name === 'no-results' && (
        <>
          {/* 大きな虫めがね。中は空で、外れた印を小さく添える。 */}
          <circle cx="42" cy="42" r="24" fill={SOFT} />
          <circle cx="42" cy="42" r="24" />
          <path d="m60 60 16 16" strokeWidth={3} />
          <path d="m35 35 14 14M49 35 35 49" stroke={ACCENT} strokeWidth={2.25} />
          <circle cx="76" cy="26" r="2" fill="currentColor" stroke="none" opacity=".35" />
          <circle cx="18" cy="70" r="1.5" fill="currentColor" stroke="none" opacity=".35" />
        </>
      )}
      {name === 'load-error' && (
        <>
          {/* 雲と、届かなかった印。雲は「向こう側」、印は手前。 */}
          <path d="M30 70h38a14 14 0 0 0 2.5-27.8A20 20 0 0 0 32 36.5 16 16 0 0 0 30 70Z" fill={SOFT} />
          <path d="M30 70h38a14 14 0 0 0 2.5-27.8A20 20 0 0 0 32 36.5 16 16 0 0 0 30 70Z" />
          <path d="M48 46v12" stroke={ACCENT} strokeWidth={2.5} />
          <circle cx="48" cy="63" r="1.75" fill={ACCENT} stroke="none" />
        </>
      )}
    </svg>
  );
}
