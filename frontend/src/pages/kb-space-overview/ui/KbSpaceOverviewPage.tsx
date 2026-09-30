import { KbSpaceHeading, useKbSpaceOutlet } from '@/widgets/kb-frame';
import { grantRoleLabel } from '@/entities/workspace';

/**
 * KbSpaceOverviewPage はスペースの「概要」画面（段14）。
 *
 * スペースの説明と自分の役割を出す。画面の行き来（すべてのページ・お気に入り・メンバー）は
 * 左の列と文脈バーが持つので、ここに入口を並べ直さない。未取得の件数などは表示しない。
 */
export default function KbSpaceOverviewPage() {
  const { space } = useKbSpaceOutlet();

  return (
    <>
      <KbSpaceHeading space={space} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-4 sm:px-6 sm:pb-8">
        <div className="mx-auto max-w-3xl">
          {/* 画面の行き来（すべてのページ・お気に入り・メンバー）は左の列と文脈バーが持つ。
              ここに同じ入口を並べ直さない。 */}
          <p className="mt-8 border-t border-surface-3 pt-4 text-sm text-[var(--color-text-tertiary)]">
            このスペースでの自分の役割: {grantRoleLabel(space.role)}
          </p>
        </div>
      </div>
    </>
  );
}
