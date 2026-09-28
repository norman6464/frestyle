import type { SVGProps } from 'react';

/**
 * KbPageGroupIcon は子を持つページの印。
 *
 * フォルダの形をしているが、**中に本文行が入っている**。ここが素のフォルダとの違いで、
 * このシステムでは親は「入れ物」ではなく **自分も中身を持つページ** だから。
 * 空のフォルダにすると「クリックしても本文が無い」と読まれてしまう。
 *
 * 本文行は KbPageIcon と同じ 2 本。並べたときに同じ族に見えることを優先している。
 *
 * 線は currentColor なので、置いた場所の文字色をそのまま継ぐ（heroicons と同じ流儀）。
 * 図形の正本は同じディレクトリの kb-page-group.svg（png/ は そこから描き出したもの）。
 */
export default function KbPageGroupIcon(props: SVGProps<SVGSVGElement>) {
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
      data-icon="page-group"
      {...props}
    >
      <path d="M3 18.25V6.75a1.5 1.5 0 0 1 1.5-1.5h4.69a1.5 1.5 0 0 1 1.2.6l1.32 1.76a1.5 1.5 0 0 0 1.2.6h5.59A1.5 1.5 0 0 1 21 9.71v8.54a1.5 1.5 0 0 1-1.5 1.5h-15a1.5 1.5 0 0 1-1.5-1.5Z" />
      <path d="M7.25 13.25h9.5" />
      <path d="M7.25 16.25h6" />
    </svg>
  );
}
