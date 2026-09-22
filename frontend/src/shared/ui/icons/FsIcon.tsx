import type { SVGProps } from 'react';
import { PARTS, type FsIconName } from './fsIconParts';

/**
 * FreStyle の線アイコン。形の定義と設計の理由は fsIconParts.ts にある。
 * ここは描くだけ —— 部品以外を一緒に export すると開発時の差し替え（Fast Refresh）が
 * 効かなくなるので、形・名前は fsIconParts.ts、名前固定の工場は fsIconFactory.tsx に置いてある。
 *
 * 飾りとして置くことが圧倒的に多いので既定は aria-hidden。意味を持たせるときは `title` を渡す
 * （role="img" と名前が付く）。テストからは `data-icon` で引ける（aria-hidden だと role で引けない）。
 */
export interface FsIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: FsIconName;
  /** 意味を持たせるときの名前。渡すと role="img" になり読み上げられる。渡さなければ飾り（aria-hidden）。 */
  title?: string;
}

export default function FsIcon({ name, title, className = 'h-5 w-5', ...rest }: FsIconProps) {
  const parts = PARTS[name];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      data-icon={name}
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
      {...rest}
    >
      {title && <title>{title}</title>}
      {parts.map((part, i) =>
        typeof part === 'string' ? (
          <path key={i} d={part} />
        ) : (
          <path key={i} d={part.d} fill="currentColor" stroke="none" />
        ),
      )}
    </svg>
  );
}
