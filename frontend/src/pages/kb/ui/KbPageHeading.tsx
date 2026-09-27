import { memo } from 'react';
import type { KbIcon } from '@/entities/kb';
import KbPageIconButton from './KbPageIconButton';
import KbPageTitle from './KbPageTitle';

export interface KbPageHeadingProps {
  icon: KbIcon | null | undefined;
  title: string;
  canEdit: boolean;
  onRename: (title: string) => Promise<void>;
  onChangeIcon: (icon: KbIcon | null) => Promise<void>;
  /** 題名で Enter を押した（本文の先頭へ移る）。 */
  onEnter: () => void;
}

/**
 * ページの見出し（アイコンと題名）。
 *
 * memo で包み、渡すものが変わらない限り描き直さない。ページの中の小さな操作（保存状態の変化・
 * 右の欄のタブ・星）はページの部品（KbPage）を描き直すが、題名はそのどれにも関わらない。
 * 渡す関数は KbPage が useCallback で固定しておくこと。
 */
function KbPageHeading({ icon, title, canEdit, onRename, onChangeIcon, onEnter }: KbPageHeadingProps) {
  return (
    <>
      {icon && <KbPageIconButton icon={icon} canEdit={false} onChange={onChangeIcon} />}
      <KbPageTitle title={title} canEdit={canEdit} onRename={onRename} onEnter={onEnter} />
    </>
  );
}

export default memo(KbPageHeading);
