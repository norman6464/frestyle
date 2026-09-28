import { EmptyState, FsIllustration, Loading } from '@/shared/ui';
import { useToast } from '@/shared/lib/hooks/useToast';
import { useBacklogOutlet } from '../model/backlogOutlet';
import { useTicketList } from '../model/useTicketList';
import { useTicketMasters } from '../model/useTicketMasters';
import { useSprints } from '../model/useSprints';
import BacklogFrame from './BacklogFrame';
import SprintBoard from './SprintBoard';
import TicketStatusAdmin from './TicketStatusAdmin';
import TicketTypeAdmin from './TicketTypeAdmin';

/**
 * BacklogSettingsPage はバックログの設定の面。状態・種別・スプリントの決まりごとを整える。
 *
 * 一覧の面の絞り込み・選択・件数・保存した絞り込みは持たない（この面では取りに行かない）。
 * チケットの一覧は、スプリントの中身を名前で出すためだけに現役を取る。
 */
export default function BacklogSettingsPage() {
  const { workspaceSlug, project } = useBacklogOutlet();
  const { showToast } = useToast();
  const masters = useTicketMasters(workspaceSlug, project.id);
  const sprints = useSprints(workspaceSlug, project.id);
  const list = useTicketList(workspaceSlug, project.id, { archived: false });

  return (
    <BacklogFrame view="settings" workspaceSlug={workspaceSlug} project={project}>
      <div className="min-h-0 flex-1">
        {masters.loading && <Loading className="min-h-56" message="チケットの設定を読み込んでいます" />}
        {!masters.loading && masters.error && (
          <EmptyState
            headingLevel={2}
            illustration={<FsIllustration name="load-error" />}
            title="チケットの設定を読み込めませんでした"
            description={masters.error}
            action={{ label: '再読み込み', onClick: masters.refresh }}
          />
        )}

        {/* 見出しは h1（面の名前）→ h2（節）の順に落とす。節の名前を付けないと
            管理の面が 3 つ続けて並ぶだけになり、中の EmptyState の h3 まで段が飛ぶ。 */}
        {!masters.loading && !masters.error && (
          <div className="h-full overflow-y-auto px-4 py-6 sm:px-6">
            {/* 左端は見出しの塊（px-4 sm:px-6）にそろえる。中央に寄せると見出しと本文の左端がずれる。 */}
            <div className="max-w-4xl space-y-10 [&_button]:min-h-11 [&_input]:min-h-11 [&_select]:min-h-11">
              <section>
                <h2 className="mb-2 text-lg font-semibold text-[var(--color-text-primary)]">状態</h2>
                <p className="mb-4 text-sm leading-relaxed text-[var(--color-text-muted)]">作業がどこまで進んだかを表す流れです。新しいチケットの開始状態もここで選べます。</p>
                <TicketStatusAdmin
                  statuses={masters.statuses}
                  onCreate={masters.createStatus}
                  onSetInitial={masters.setInitialStatus}
                  onArchive={masters.archiveStatus}
                />
              </section>
              <section>
                <h2 className="mb-2 text-lg font-semibold text-[var(--color-text-primary)]">種別</h2>
                <p className="mb-4 text-sm leading-relaxed text-[var(--color-text-muted)]">チームの仕事に合わせて分類と雛形を整えます。</p>
                <TicketTypeAdmin
                  types={masters.types}
                  onCreate={masters.createType}
                  onSetDefault={masters.setDefaultType}
                  onArchive={masters.archiveType}
                />
              </section>
              <section>
                <h2 className="mb-2 text-lg font-semibold text-[var(--color-text-primary)]">スプリント</h2>
                <p className="mb-4 text-sm leading-relaxed text-[var(--color-text-muted)]">取り組む期間を管理します。作業の割り当てはバックログで行えます。</p>
                {/* 改名・期間・削除はここ。バックログの面では「作る・開始する・完了する・
                    中身を入れ替える」だけを段の見出しで受ける。 */}
                <SprintBoard
                  sprints={sprints}
                  canEdit
                  workspaceSlug={workspaceSlug}
                  projectKey={project.key}
                  tickets={list.tickets}
                  onError={(message) => showToast('error', message)}
                />
              </section>
            </div>
          </div>
        )}
      </div>
    </BacklogFrame>
  );
}
