import { useNavigate, useParams } from 'react-router-dom';
import { ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { EmptyState } from '@/shared/ui';
import { useToast } from '@/shared/lib/hooks/useToast';
import { getApiError } from '@/shared/lib/classifyApiError';
import Loading from '@/shared/ui/Loading';
import { useTicketPage } from '../model/useTicketPage';
import { useTicketMasters } from '../model/useTicketMasters';
import { useTicketLabels } from '../model/useTicketLabels';
import { usePrincipalNames } from '../model/usePrincipalNames';
import { useTicketDetail } from '../model/useTicketDetail';
import TicketFullView from './TicketFullView';

/**
 * KbTicketPage は `/tickets/:ticketId`（ワークスペースを URL に持たない口）の受け皿で、
 * チケット 1 件を全画面で開く。
 *
 * 通知・本文中の参照・ブックマークからの再訪はワークスペースを知らないまま来るので、
 * ID だけで開ける必要がある。アーカイブ済みでも普通に開ける（一覧の現役タブには
 * 現れないので、こちらが唯一の入口になる）。
 */
export default function KbTicketPage() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const page = useTicketPage(ticketId);
  const masters = useTicketMasters(page.workspaceSlug ?? undefined, page.ticket?.projectId);
  const labels = useTicketLabels(page.workspaceSlug ?? undefined);
  const { principals } = usePrincipalNames(page.workspaceSlug ?? undefined);
  const history = useTicketDetail(page.workspaceSlug ?? undefined, page.ticket ? (ticketId ?? null) : null);

  const withToastOnFailure = async (action: () => Promise<unknown>, failureMessage: string) => {
    try {
      await action();
    } catch (cause) {
      showToast('error', getApiError(cause).status === 403 ? 'この操作を行う権限がありません。' : failureMessage);
      throw cause;
    }
  };

  if (page.error) {
    return (
      <EmptyState headingLevel={1} icon={ExclamationCircleIcon} title="チケットを開けません" description={page.error} action={{ label: 'バックログへ戻る', onClick: () => navigate('/backlog') }} />
    );
  }

  if (page.loading || !page.ticket || !page.permission) {
    return <Loading className="min-h-56" message="チケットを読み込んでいます" />;
  }

  return (
    <TicketFullView
      key={page.ticket.id}
      ticket={page.ticket}
      ancestors={page.ancestors}
      projectKey={page.project?.key ?? ''}
      workspaceSlug={page.workspaceSlug ?? ''}
      statuses={masters.statuses}
      types={masters.types}
      principals={principals}
      history={history.history}
      historyLoading={history.loading}
      historyError={history.error}
      canEdit={page.permission.canEdit}
      busy={page.busy}
      allLabels={labels.labels}
      onUpdate={(input) => page.updateTicket(input)}
      onChangeStatus={(statusId) =>
        void withToastOnFailure(() => page.changeStatus({ statusId }), '状態を変更できませんでした。')
      }
      onAssign={(principalId) =>
        void withToastOnFailure(() => page.assign(principalId), '担当を設定できませんでした。')
      }
      onUnassign={() => void withToastOnFailure(() => page.unassign(), '担当を外せませんでした。')}
      onArchive={() => void withToastOnFailure(() => page.archive(), 'アーカイブできませんでした。')}
      onRestore={() => void withToastOnFailure(() => page.restore(), '現役に戻せませんでした。')}
      onToggleLabel={(label) => {
        const attached = page.ticket?.labels.some((l) => l.id === label.id) ?? false;
        void withToastOnFailure(
          () => (attached ? page.removeLabel(label.id) : page.addLabel(label)),
          attached ? 'ラベルを外せませんでした。' : 'ラベルを付けられませんでした。',
        );
      }}
      onCreateLabel={(name, color) => labels.createLabel({ name, color })}
      onChangeParent={(parentId) =>
        page.changeParent(parentId).catch((cause) => {
          const info = getApiError(cause);
          showToast(
            'error',
            info.status === 403
              ? 'この操作を行う権限がありません。'
              : info.serverCode === 'ticket_hierarchy_rejected'
                ? 'その親には移せません（循環になる、または階層の深さの上限を超えます）。'
                : '親を変更できませんでした。',
          );
        })
      }
    />
  );
}
