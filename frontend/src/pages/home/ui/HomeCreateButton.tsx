import { useState } from 'react';
import type { Workspace } from '@/entities/workspace';
import { Button, FsIcon } from '@/shared/ui';
import HomeCreateDialog from './HomeCreateDialog';

export interface HomeCreateButtonProps {
  workspaces: Workspace[];
  /** 初めに選んでおくワークスペース（ホームのお気に入りで選んでいるもの）。 */
  initialWorkspaceSlug: string | null;
  wide: boolean;
}

/**
 * 「新しくつくる」のボタンとダイアログ。開閉の状態はここだけで持ち、開け閉めでホームの
 * ほかの欄（続き・担当・お気に入り）を描き直さない。ダイアログは画面の上に重ねて出す
 * （Portal）ので、ボタンの隣で描いても見た目の位置は変わらない。
 */
export default function HomeCreateButton({ workspaces, initialWorkspaceSlug, wide }: HomeCreateButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* 狭い画面は「＋ つくる」と短く見せる。読み上げは常に「新しくつくる」（見える文字を含む名前）。 */}
      <Button
        variant="secondary"
        size="lg"
        aria-label="新しくつくる"
        onClick={() => setOpen(true)}
        className="shrink-0 font-semibold"
      >
        <FsIcon name="plus" className="h-5 w-5" />
        {wide ? '新しくつくる' : 'つくる'}
      </Button>
      {open && (
        <HomeCreateDialog
          workspaces={workspaces}
          initialWorkspaceSlug={initialWorkspaceSlug}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
