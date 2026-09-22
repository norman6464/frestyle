import type { HTMLAttributes } from 'react';

const WIDTH = { workspace: 'max-w-7xl', reading: 'max-w-4xl', form: 'max-w-3xl' };

/** 画面の目的に応じた幅。スクロールの所有権は呼び出し側に残す。 */
export default function PageFrame({ width = 'workspace', className = '', ...props }: HTMLAttributes<HTMLDivElement> & { width?: keyof typeof WIDTH }) {
  return <div {...props} className={`mx-auto w-full min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 ${WIDTH[width]} ${className}`} />;
}
