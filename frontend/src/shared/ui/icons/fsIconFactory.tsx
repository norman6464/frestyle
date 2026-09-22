import type { ComponentType } from 'react';
import FsIcon from './FsIcon';
import type { FsIconName } from './fsIconParts';

/**
 * 名前を固定した部品を返す。`EmptyState` や全体ナビのように
 * 「`className` を受け取る部品」としてアイコンを求める場所へ渡すためのもの。
 *
 * ファイル名を FsIcon と大文字小文字だけ違う名前にしてはいけない —— macOS のファイル名は
 * 区別しないので、片方がもう片方を上書きする（実際に起きた）。
 */
export function fsIcon(name: FsIconName): ComponentType<{ className?: string }> {
  const Bound = ({ className }: { className?: string }) => <FsIcon name={name} className={className} />;
  Bound.displayName = `FsIcon(${name})`;
  return Bound;
}
