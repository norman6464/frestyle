import type { SVGProps } from 'react';

/**
 * KbPageGroupOpenIcon は**開いている**親ページの印。
 *
 * 閉じているときのフォルダ（KbPageGroupIcon）と対で、開閉の三角だけでなく
 * アイコンの形でも「いま中が見えている」ことを示す。三角は段の折り畳み、
 * アイコンは行そのものの性質、と役割が分かれているが、両方が同じ状態を指すことで
 * 一目で読めるようにする。
 *
 * 本文行はこの族の約束（親も中身を持つページである）どおり 2 本入れてある。
 * 開いた前面の板に載るぶん、閉じた形より少し下に寄せてある。
 *
 * 図形の正本は同じディレクトリの kb-page-group-open.svg（png/ はそこから描き出したもの）。
 */
export default function KbPageGroupOpenIcon(props: SVGProps<SVGSVGElement>) {
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
      data-icon="page-group-open"
      {...props}
    >
      <path d="M3 18.25V6.75a1.5 1.5 0 0 1 1.5-1.5h4.69a1.5 1.5 0 0 1 1.2.6l1.32 1.76a1.5 1.5 0 0 0 1.2.6h5.59A1.5 1.5 0 0 1 21 9.71v1.29" />
      <path d="M3 18.25l2.03-5.42a1.5 1.5 0 0 1 1.41-1.03h13.9a1 1 0 0 1 .95 1.32l-1.7 5.11a1.5 1.5 0 0 1-1.42 1.02H4.5A1.5 1.5 0 0 1 3 18.25Z" />
      <path d="M8.1 15.4h8" />
      <path d="M7.4 17.4h5.5" />
    </svg>
  );
}
