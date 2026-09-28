import type { SVGProps } from 'react';

/**
 * KbPageIcon は子を持たないページ（＝これ以上たどれない末端）の印。
 *
 * 折れた角と 2 本の本文行を持つ紙。**同じ 2 本の行を KbPageGroupIcon も持っている**のが要点で、
 * 「どちらもページである」ことを形で揃えている。
 *
 * 線は currentColor なので、置いた場所の文字色をそのまま継ぐ（heroicons と同じ流儀）。
 * 太さ 1.5 / 角丸は 16px でも潰れないことを実際に描いて確かめた値。
 * 図形の正本は同じディレクトリの kb-page.svg（png/ は そこから描き出したもの）。
 */
export default function KbPageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // どちらの印が出ているかをテストから確かめられるようにする
      // （aria-hidden なので role でも名前でも引けない）。
      data-icon="page"
      {...props}
    >
      <path d="M13.75 2.75H7.25A1.5 1.5 0 0 0 5.75 4.25v15.5a1.5 1.5 0 0 0 1.5 1.5h9.5a1.5 1.5 0 0 0 1.5-1.5V7.25Z" />
      <path d="M13.75 2.75v3a1.5 1.5 0 0 0 1.5 1.5h3" />
      <path d="M8.75 12.75h6.5" />
      <path d="M8.75 16.25h4" />
    </svg>
  );
}
