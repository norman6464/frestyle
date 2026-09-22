import { useState } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { ChevronDownIcon } from '@heroicons/react/20/solid';
import { formatTicketKey, type Label, type Ticket, type TicketPriority } from '@/entities/ticket';
import type { ProjectVersion } from '@/entities/project-version';
import type { Team } from '@/entities/team';
import type { Sprint } from '@/entities/sprint';
import type { KbGrantablePrincipal } from '@/entities/kb';
import { useTicketParentCandidates } from '../model/useTicketParentCandidates';
import { useWorkspaceMembers } from '../model/useWorkspaceMembers';
import TicketParentPicker from './TicketParentPicker';
import TicketLabelBar from './TicketLabelBar';
import BlankableField from './BlankableField';

const PRIORITY_LABEL: Record<TicketPriority, string> = { 1: '高', 2: '中', 3: '低' };

export interface TicketAttributePanelProps {
  /** 全画面では作業に直結する項目を先に見せ、計画項目は必要時に開く。 */
  progressive?: boolean;
  ticket: Ticket;
  workspaceSlug: string;
  projectKey: string;
  principals: KbGrantablePrincipal[];
  parentTicket: Ticket | undefined;
  canEdit: boolean;
  /** アーカイブ済みは全置換の編集を止める（状態と担当は専用の口なので止めない）。 */
  archived: boolean;
  busy: boolean;
  /** 全置換の下書きが持っている値（保存前の見た目をここに映す）。 */
  priority: TicketPriority;
  /** 見積り（下書きの値）。未見積りは null。 */
  storyPoints: number | null;
  startDate: string | null;
  dueDate: string | null;
  /** プロジェクトの語彙（版・チーム）と、このチケットに付いている分。見本の「詳細」に並ぶ。 */
  versions: ProjectVersion[];
  teams: Team[];
  fixVersions: ProjectVersion[];
  sprint: Sprint | null;
  /** 担当チーム。ticket ではなく呼び出し側の手元の値を見る（差し替えを即座に映すため）。 */
  teamId: string | null;
  onSetFixVersion: (versionId: string, attach: boolean) => void;
  onChangeTeam: (teamId: string) => void;
  /** ラベルの付け外し（見本では「詳細」の 1 項目）。形は TicketLabelBar に揃える。 */
  allLabels: Label[];
  onToggleLabel: (label: Label) => void;
  onCreateLabel: (name: string, color: string) => Promise<Label>;
  onAssign: (principalId: string) => void;
  onUnassign: () => void;
  onChangePriority: (value: TicketPriority) => void;
  onChangeStoryPoints: (value: number | null) => void;
  onChangeStartDate: (value: string | null) => void;
  onChangeDueDate: (value: string | null) => void;
  onChangeParent: (parentId: string | null) => void;
}

/**
 * チケットの素性（状態・担当・優先度・期限・親）。
 *
 * 一覧の右のパネルと、チケットを開いた全画面の両方が同じものを出すので、部品として
 * 切り出してある。状態と担当は専用の口があるので即座に送るが、優先度と期限は
 * 全置換に載るため下書きを経由する（値は呼び出し側の下書きから渡ってくる）。
 */
export default function TicketAttributePanel({
  progressive = false,
  ticket,
  workspaceSlug,
  projectKey,
  principals,
  parentTicket,
  canEdit,
  archived,
  busy,
  priority,
  storyPoints,
  startDate,
  dueDate,
  versions,
  teams,
  fixVersions,
  sprint,
  teamId,
  onSetFixVersion,
  onChangeTeam,
  allLabels,
  onToggleLabel,
  onCreateLabel,
  onAssign,
  onUnassign,
  onChangePriority,
  onChangeStoryPoints,
  onChangeStartDate,
  onChangeDueDate,
  onChangeParent,
}: TicketAttributePanelProps) {
  const assigneeUsers = principals.filter((p) => p.kind === 'user');
  // 報告者の名前。チケットが持つのは作成者の id だけなので、ワークスペースの人から引く。
  const { members } = useWorkspaceMembers(workspaceSlug);
  const reporterName = members.find((m) => m.userId === ticket.createdByUserId)?.name ?? '';
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  // 開くまで問い合わせない（親を触らないチケットのほうが多く、毎回プロジェクト全件を
  // 引くのは無駄なため）。
  const parentCandidatesQuery = useTicketParentCandidates(
    parentPickerOpen ? workspaceSlug : undefined,
    parentPickerOpen ? ticket.projectId : undefined,
  );

  const handleSelectParent = (parentId: string | null) => {
    onChangeParent(parentId);
    setParentPickerOpen(false);
  };

  const fieldListClass = "grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-sm [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere] [&_select]:min-h-9 [&_select]:max-w-full [&_input]:min-h-9 [&_input]:max-w-full [&_button]:min-h-9 [&_button]:min-w-11 [@media(pointer:coarse)]:[&_button]:min-h-11 [@media(pointer:coarse)]:[&_select]:min-h-11 [@media(pointer:coarse)]:[&_input]:min-h-11 [&_button]:focus-visible:outline [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-brand-600";

  return (
    <div className="space-y-4">
    {/* 状態は題名の下の TicketStatusSelect に置き、属性はここでまとめる。 */}
    <dl className={fieldListClass}>
      <dt className="text-[var(--color-text-muted)]">担当者</dt>
      <dd>
        {canEdit ? (
          <select
            value={ticket.assigneePrincipalId ?? ''}
            disabled={busy}
            onChange={(e) => {
              const value = e.target.value;
              if (value) onAssign(value);
              else onUnassign();
            }}
            aria-label="担当"
            className="rounded border border-surface-3 bg-surface-1 px-1.5 py-0.5 text-sm"
          >
            <option value="">未割り当て</option>
            {assigneeUsers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </select>
        ) : (
          assigneeUsers.find((p) => p.id === ticket.assigneePrincipalId)?.name || '未割り当て'
        )}
      </dd>

      <dt className="text-[var(--color-text-muted)]">優先度</dt>
      <dd>
        {canEdit && !archived ? (
          <select
            value={priority}
            onChange={(e) => onChangePriority(Number(e.target.value) as TicketPriority)}
            aria-label="優先度"
            className="rounded border border-surface-3 bg-surface-1 px-1.5 py-0.5 text-sm"
          >
            <option value={1}>高</option>
            <option value={2}>中</option>
            <option value={3}>低</option>
          </select>
        ) : (
          <span className={ticket.priority === 1 ? 'font-bold text-brand-700' : undefined}>
            {PRIORITY_LABEL[ticket.priority]}
          </span>
        )}
      </dd>

      <dt className="text-[var(--color-text-muted)]">期限</dt>
      <dd>
        <BlankableField
          value={dueDate}
          placeholder="期限を設定"
          editable={canEdit && !archived}
          render={(autoFocus, done) => (
            <input
              type="date"
              value={dueDate ?? ''}
              autoFocus={autoFocus}
              onBlur={done}
              onChange={(e) => onChangeDueDate(e.target.value || null)}
              aria-label="期限"
              className="rounded border border-surface-3 bg-surface-1 px-1.5 py-0.5 text-sm"
            />
          )}
        />
      </dd>

    </dl>
    <Collapsible.Root defaultOpen={!progressive}>
      {progressive && (
        <Collapsible.Trigger className="group flex min-h-11 w-full items-center justify-between rounded-md border-t border-surface-3 px-1 pt-3 text-left text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
          計画と整理
          <ChevronDownIcon aria-hidden="true" className="h-4 w-4 transition-transform group-data-[open]:rotate-180" />
        </Collapsible.Trigger>
      )}
      <Collapsible.Panel className={progressive ? 'pt-3' : undefined}>
      <dl className={fieldListClass}>

      <dt className="text-[var(--color-text-muted)]">ラベル</dt>
      <dd>
        <TicketLabelBar
          attached={ticket.labels}
          allLabels={allLabels}
          canEdit={canEdit && !archived}
          onToggle={onToggleLabel}
          onCreate={onCreateLabel}
        />
      </dd>

      <dt className="text-[var(--color-text-muted)]">見積り</dt>
      <dd>
        <BlankableField
          value={storyPoints === null ? null : String(storyPoints)}
          placeholder="見積りを設定"
          editable={canEdit && !archived}
          render={(autoFocus, done) => (
            <input
              type="number"
              min={0}
              max={1000}
              // 空欄は「未見積り」。0 を打てば「0 ポイント」で、別の意味になる。
              value={storyPoints ?? ''}
              autoFocus={autoFocus}
              onBlur={done}
              onChange={(e) => onChangeStoryPoints(e.target.value === '' ? null : Number(e.target.value))}
              aria-label="見積り"
              className="w-20 rounded border border-surface-3 bg-surface-1 px-1.5 py-0.5 text-sm"
            />
          )}
        />
      </dd>

      <dt className="text-[var(--color-text-muted)]">スプリント</dt>
      <dd>
        {/* 入れる・外すはバックログの並べ替えバーが持つ（どのスプリントへ送るかは
            一覧の文脈で決める操作）。ここは今どこに入っているかを読むだけ。 */}
        {sprint ? (
          <span>{sprint.name}</span>
        ) : (
          <span className="text-[var(--color-text-muted)]">未設定</span>
        )}
      </dd>

      <dt className="text-[var(--color-text-muted)]">開始日</dt>
      <dd>
        <BlankableField
          value={startDate}
          placeholder="開始日を設定"
          editable={canEdit && !archived}
          render={(autoFocus, done) => (
            <input
              type="date"
              value={startDate ?? ''}
              autoFocus={autoFocus}
              onBlur={done}
              onChange={(e) => onChangeStartDate(e.target.value || null)}
              aria-label="開始日"
              className="rounded border border-surface-3 bg-surface-1 px-1.5 py-0.5 text-sm"
            />
          )}
        />
      </dd>

      <dt className="text-[var(--color-text-muted)]">チーム</dt>
      <dd>
        {canEdit && !archived && teams.length > 0 ? (
          <select
            value={teamId ?? ''}
            aria-label="Team"
            onChange={(e) => onChangeTeam(e.target.value)}
            className="rounded border border-surface-3 bg-surface-1 px-1.5 py-0.5 text-sm"
          >
            <option value="">未設定</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          teams.find((t) => t.id === teamId)?.name ?? (
            <span className="text-[var(--color-text-muted)]">未設定</span>
          )
        )}
      </dd>

      <dt className="text-[var(--color-text-muted)]">修正バージョン</dt>
      <dd>
        {/* 1 件とは限らない（同じ修正を複数の系統へ入れることがある）ので、
            付いている分をチップで並べ、選ぶ口を下に置く。 */}
        {fixVersions.length === 0 ? (
          <span className="text-[var(--color-text-muted)]">なし</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {fixVersions.map((v) => (
              <button
                key={v.id}
                type="button"
                disabled={!canEdit || archived}
                onClick={() => onSetFixVersion(v.id, false)}
                title={canEdit && !archived ? `${v.name} を外す` : undefined}
                className="rounded border border-surface-3 px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)] hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent"
              >
                {v.name}
              </button>
            ))}
          </span>
        )}
        {canEdit && !archived && versions.length > 0 && (
          <select
            value=""
            aria-label="修正バージョンを追加"
            onChange={(e) => {
              if (!e.target.value) return;
              onSetFixVersion(e.target.value, true);
              e.target.value = '';
            }}
            className="mt-1 block rounded border border-surface-3 bg-surface-1 px-1.5 py-0.5 text-sm"
          >
            <option value="">バージョンを追加…</option>
            {versions
              .filter((v) => !fixVersions.some((f) => f.id === v.id))
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
          </select>
        )}
      </dd>

      <dt className="text-[var(--color-text-muted)]">親</dt>
      <dd>
        {canEdit && !archived ? (
          <>
            <button
              type="button"
              onClick={() => setParentPickerOpen((v) => !v)}
              disabled={busy}
              aria-expanded={parentPickerOpen}
              aria-label="親を変更"
              className="rounded border border-surface-3 bg-surface-1 px-1.5 py-0.5 text-sm hover:bg-surface-2 disabled:opacity-50"
            >
              {parentTicket ? formatTicketKey(projectKey, parentTicket.number) : 'なし'}
            </button>
            {parentPickerOpen && (
              <TicketParentPicker
                candidates={parentCandidatesQuery.candidates.filter((c) => c.id !== ticket.id)}
                loading={parentCandidatesQuery.loading}
                error={parentCandidatesQuery.error}
                projectKey={projectKey}
                currentParentId={ticket.parentId}
                onSelect={handleSelectParent}
              />
            )}
          </>
        ) : parentTicket ? (
          formatTicketKey(projectKey, parentTicket.number)
        ) : (
          <span className="text-[var(--color-text-muted)]">なし</span>
        )}
      </dd>
      <dt className="text-[var(--color-text-muted)]">報告者</dt>
      <dd>
        {/* 作った人は後から変えられない（tickets.created_by_user_id は書き換えない）ので読むだけ。
            名前はワークスペースの人から引く —— チケットが持つのは id だけのため。 */}
        {reporterName ? (
          <span>{reporterName}</span>
        ) : (
          <span className="text-[var(--color-text-muted)]">不明なユーザー</span>
        )}
      </dd>
      </dl>
      </Collapsible.Panel>
    </Collapsible.Root>
    </div>
  );
}
