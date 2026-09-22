import type { ComponentType } from 'react';
import FsIcon, { type FsIconProps } from './FsIcon';
import type { FsIconName } from './fsIconParts';

/** fsIcon が返す部品の props。名前は固定済みなので受け取らない。それ以外（className・title・style・aria-*）は FsIcon にそのまま渡る。 */
export type FsIconBoundProps = Omit<FsIconProps, 'name'>;

// 同じ名前には同じ部品を返す。描画のたびに新しい関数を作ると React には「別の部品」に見え、
// 親が描き直すたびに svg を捨てて作り直す。`icon={fsIcon('bell')}` と JSX の中に書いても
// 安全なように、名前ごとに 1 回だけ作って持っておく。
const bound = new Map<FsIconName, ComponentType<FsIconBoundProps>>();

/**
 * 名前を固定した部品を返す。`EmptyState` や `Toast` の表のように
 * 「部品を受け取る」場所へアイコンを渡すためのもの。
 *
 * ファイル名を FsIcon と大文字小文字だけ違う名前にしてはいけない —— macOS のファイル名は
 * 区別しないので、片方がもう片方を上書きする（実際に起きた）。
 */
export function fsIcon(name: FsIconName): ComponentType<FsIconBoundProps> {
  const hit = bound.get(name);
  if (hit) return hit;
  const Bound = (props: FsIconBoundProps) => <FsIcon name={name} {...props} />;
  Bound.displayName = `FsIcon(${name})`;
  bound.set(name, Bound);
  return Bound;
}
