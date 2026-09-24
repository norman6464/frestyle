import { useState, type ReactNode } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { formatTicketKey, type Label, type Ticket, type TicketPriority } from '@/entities/ticket';
import type { ProjectVersion } from '@/entities/project-version';
import type { Team } from '@/entities/team';
import type { Sprint } from '@/entities/sprint';
import type { KbGrantablePrincipal } from '@/entities/kb';
import { FieldSelect, FsIcon } from '@/shared/ui';
import { useTicketParentCandidates } from '../model/useTicketParentCandidates';
import { useWorkspaceMembers } from '../model/useWorkspaceMembers';
import TicketParentPicker from './TicketParentPicker';
import TicketLabelBar from './TicketLabelBar';
import BlankableField from './BlankableField';
import { formatDateLong } from '../lib/dueDate';

const PRIORITY_LABEL: Record<TicketPriority, string> = { 1: '高', 2: '中', 3: '低' };

/** 補助側にある項目の数。見出し「その他 N 項目」に出す。項目を足したらここも変える。 */
const SECONDARY_COUNT = 7;

/**
 * 属性欄の選択コントロールの見た目。値の欄なので枠は控えめにし、項目名と競わせない。
 */
const ATTRIBUTE_SELECT_CLASS = 'w-full rounded-md border-surface-3 bg-surface-1 px-2 text-sm font-normal';

export interface TicketAttributePanelProps {
  /**
   * 項目を何列で並べるか。詳細パネル（幅 400px 前後）は 2 列、全画面の副列（18rem）は 1 列。
   * 画面幅ではなく置き場所の幅で決まるので、呼び出し側が指定する。
   */
  columns?: 1 | 2;
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
  /** プロジェクトの語彙（版・チーム）と、このチケットに付いている分。 */
  versions: ProjectVersion[];
  teams: Team[];
  fixVersions: ProjectVersion[];
  sprint: Sprint | null;
  /** 担当チーム。ticket ではなく呼び出し側の手元の値を見る（差し替えを即座に映すため）。 */
  teamId: string | null;
  onSetFixVersion: (versionId: string, attach: boolean) => void;
  onChangeTeam: (teamId: string) => void;
  /** ラベルの付け外し。形は TicketLabelBar に揃える。 */
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
  /**
   * 項目ごとの変更の結果（設計ボード PX04）。項目のすぐ下に出す。渡さなければ何も出さない。
   * 中身は呼び出し側が FieldFeedback で組む（結果の持ち方は詳細パネルと全画面の票で同じ）。
   */
  feedback?: Partial<Record<TicketAttributeKey, ReactNode>>;
}

/** 結果を出せる項目。 */
export type TicketAttributeKey = 'assignee' | 'priority' | 'dueDate' | 'labels' | 'parent' | 'startDate' | 'storyPoints';

/**
 * 項目名の上に値、の 1 升。表のように項目名を左列に揃えるより、狭い幅でも値が折れない。
 * 変更の結果（feedback）は値のすぐ下に置く（操作した場所で結果が分かる）。
 */
function Field({ label, feedback, children }: { label: string; feedback?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-0.5 flex min-h-9 min-w-0 flex-wrap items-center gap-1 text-sm text-[var(--color-text-primary)] [overflow-wrap:anywhere] [@media(pointer:coarse)]:min-h-11">
        {children}
      </dd>
      {feedback && <dd className="mt-1">{feedback}</dd>}
    </div>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <span className="text-[var(--color-text-muted)]">{children}</span>;

/**
 * チケットの素性。「基本」と「その他」の 2 段に分ける（設計ボード ST11）。
 *
 * 基本 = 担当者・優先度・期限・ラベル。作業を判断するのに毎回見る 4 つ。
 * その他 = 修正バージョン・親・Team・開始日・見積り・Sprint・報告者。計画や整理のときに見る 7 つ。
 * 11 項目を同じ強さで縦に並べると、いちばん見る項目がいちばん探しにくくなる。
 *
 * 「その他」は畳んでも中身を降ろさない（keepMounted）。編集中の値・開いたピッカーを
 * 開閉で失わないため。畳んだ状態でも、値が入っている項目の名前と値を要約として見出しの下に出す
 * —— 親やスプリントの所属を単に隠すと、それが「無い」のか「見えていない」のか分からない。
 */
export default function TicketAttributePanel({
  columns = 2,
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
  feedback = {},
}: TicketAttributePanelProps) {
  const assigneeUsers = principals.filter((p) => p.kind === 'user');
  // 報告者の名前。チケットが持つのは作成者の id だけなので、ワークスペースの人から引く。
  const { members } = useWorkspaceMembers(workspaceSlug);
  const reporterName = members.find((m) => m.userId === ticket.createdByUserId)?.name ?? '';
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  const [secondaryOpen, setSecondaryOpen] = useState(false);
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

  const editable = canEdit && !archived;
  const gridClass = `grid gap-x-4 gap-y-3 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`;
  const teamName = teams.find((t) => t.id === teamId)?.name ?? null;

  // 畳んだときの要約。値が入っている項目だけを「名前 値」で並べる。0 ポイントも値のうち。
  const summary: string[] = [];
  if (parentTicket) summary.push(`親 ${formatTicketKey(projectKey, parentTicket.number)}`);
  if (sprint) summary.push(`Sprint ${sprint.name}`);
  if (storyPoints !== null) summary.push(`見積り ${storyPoints} pt`);
  if (startDate) summary.push(`開始日 ${formatDateLong(startDate)}`);
  if (teamName) summary.push(`Team ${teamName}`);
  if (fixVersions.length > 0) summary.push(`修正バージョン ${fixVersions.map((v) => v.name).join(', ')}`);

  return (
    <div className="space-y-4">
      {/* 状態は題名の下の TicketStatusSelect に置き、ここには入れない（いちばん押す物を埋めない）。 */}
      <dl className={gridClass}>
        <Field label="担当者" feedback={feedback.assignee}>
          {canEdit ? (
            <FieldSelect
              label="担当者"
              value={ticket.assigneePrincipalId ?? ''}
              disabled={busy}
              onChange={(value) => {
                if (value) onAssign(value);
                else onUnassign();
              }}
              options={[
                { value: '', label: '未割り当て' },
                ...assigneeUsers.map((p) => ({ value: p.id, label: p.name || p.id })),
              ]}
              className={ATTRIBUTE_SELECT_CLASS}
            />
          ) : (
            assigneeUsers.find((p) => p.id === ticket.assigneePrincipalId)?.name || <Muted>未割り当て</Muted>
          )}
        </Field>

        <Field label="優先度" feedback={feedback.priority}>
          {editable ? (
            <FieldSelect
              label="優先度"
              value={String(priority)}
              onChange={(value) => onChangePriority(Number(value) as TicketPriority)}
              options={[
                { value: '1', label: '高' },
                { value: '2', label: '中' },
                { value: '3', label: '低' },
              ]}
              className={ATTRIBUTE_SELECT_CLASS}
            />
          ) : (
            <span className={ticket.priority === 1 ? 'font-semibold text-brand-800' : undefined}>
              {PRIORITY_LABEL[ticket.priority]}
            </span>
          )}
        </Field>

        <Field label="期限" feedback={feedback.dueDate}>
          <BlankableField
            value={dueDate}
            placeholder="期限を設定"
            editable={editable}
            render={(autoFocus, done) => (
              <input
                type="date"
                value={dueDate ?? ''}
                autoFocus={autoFocus}
                onBlur={done}
                onChange={(e) => onChangeDueDate(e.target.value || null)}
                aria-label="期限"
                className="min-h-9 rounded-md border border-surface-3 bg-surface-1 px-2 text-sm"
              />
            )}
          />
        </Field>

        <Field label="ラベル" feedback={feedback.labels}>
          <TicketLabelBar
            attached={ticket.labels}
            allLabels={allLabels}
            canEdit={editable}
            onToggle={onToggleLabel}
            onCreate={onCreateLabel}
          />
        </Field>
      </dl>

      <Collapsible.Root open={secondaryOpen} onOpenChange={setSecondaryOpen}>
        <Collapsible.Trigger className="group flex min-h-11 w-full items-start justify-between gap-3 rounded-md border-t border-surface-3 pt-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-[var(--color-text-primary)]">その他 {SECONDARY_COUNT} 項目</span>
            {/* 畳んでいるときだけ要約。開いていれば本体が見えているので二重に出さない。 */}
            {!secondaryOpen && summary.length > 0 && (
              <span className="mt-0.5 block text-xs text-[var(--color-text-muted)] [overflow-wrap:anywhere]">{summary.join('・')}</span>
            )}
          </span>
          <FsIcon name="chevron-down"
            className="mt-1 h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform duration-fast group-data-[open]:rotate-180"
          />
        </Collapsible.Trigger>
        <Collapsible.Panel keepMounted className="pt-3">
          <dl className={gridClass}>
            <Field label="修正バージョン">
              {/* 1 件とは限らない（同じ修正を複数の系統へ入れることがある）ので、
                  付いている分をチップで並べ、選ぶ口を下に置く。 */}
              {fixVersions.length === 0 ? (
                <Muted>なし</Muted>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {/* 値の表示と「外す」操作を分ける。値に見えるチップ全体を外すボタンにすると、
                      押すと外れることが見た目からも読み上げからも分からない。 */}
                  {fixVersions.map((v) =>
                    editable ? (
                      <span
                        key={v.id}
                        className="inline-flex items-center gap-0.5 rounded-md border border-surface-3 py-0.5 pl-1.5 pr-0.5 text-xs text-[var(--color-text-secondary)]"
                      >
                        {v.name}
                        <button
                          type="button"
                          onClick={() => onSetFixVersion(v.id, false)}
                          aria-label={`修正バージョン ${v.name} を外す`}
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-danger-soft hover:text-danger-ink [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9"
                        >
                          <FsIcon name="x" className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ) : (
                      <span
                        key={v.id}
                        className="rounded-md border border-surface-3 px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)]"
                      >
                        {v.name}
                      </span>
                    ),
                  )}
                </span>
              )}
              {/* 選んだ値は保持しない（追加が操作の中身で、この欄自体に現在値は無い）。
                  value を空のままにしておけば、追加のたびに「バージョンを追加…」へ戻る。 */}
              {editable && versions.length > 0 && (
                <FieldSelect
                  label="修正バージョンを追加"
                  value=""
                  onChange={(value) => {
                    if (value) onSetFixVersion(value, true);
                  }}
                  options={[
                    { value: '', label: 'バージョンを追加…' },
                    ...versions
                      .filter((v) => !fixVersions.some((f) => f.id === v.id))
                      .map((v) => ({ value: v.id, label: v.name })),
                  ]}
                  className={ATTRIBUTE_SELECT_CLASS}
                />
              )}
            </Field>

            <Field label="親" feedback={feedback.parent}>
              {editable ? (
                <>
                  <button
                    type="button"
                    onClick={() => setParentPickerOpen((v) => !v)}
                    disabled={busy}
                    aria-expanded={parentPickerOpen}
                    // 見えている値（キーか「なし」）を名前に含め、押すと何が起きるかを足す。
                    aria-label={`親 ${parentTicket ? formatTicketKey(projectKey, parentTicket.number) : 'なし'} を変更`}
                    className="min-h-9 rounded-md border border-surface-3 bg-surface-1 px-2 text-sm hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50"
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
                <Muted>なし</Muted>
              )}
            </Field>

            <Field label="Team">
              {editable && teams.length > 0 ? (
                <FieldSelect
                  label="Team"
                  value={teamId ?? ''}
                  onChange={onChangeTeam}
                  options={[{ value: '', label: '未設定' }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
                  className={ATTRIBUTE_SELECT_CLASS}
                />
              ) : (
                teamName ?? <Muted>未設定</Muted>
              )}
            </Field>

            <Field label="開始日" feedback={feedback.startDate}>
              <BlankableField
                value={startDate}
                placeholder="開始日を設定"
                editable={editable}
                render={(autoFocus, done) => (
                  <input
                    type="date"
                    value={startDate ?? ''}
                    autoFocus={autoFocus}
                    onBlur={done}
                    onChange={(e) => onChangeStartDate(e.target.value || null)}
                    aria-label="開始日"
                    className="min-h-9 rounded-md border border-surface-3 bg-surface-1 px-2 text-sm"
                  />
                )}
              />
            </Field>

            <Field label="見積り" feedback={feedback.storyPoints}>
              <BlankableField
                value={storyPoints === null ? null : `${storyPoints} pt`}
                placeholder="見積りを設定"
                editable={editable}
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
                    className="min-h-9 w-24 rounded-md border border-surface-3 bg-surface-1 px-2 text-sm"
                  />
                )}
              />
            </Field>

            <Field label="Sprint">
              {/* 入れる・外すはバックログの並べ替えバーが持つ（どのスプリントへ送るかは
                  一覧の文脈で決める操作）。ここは今どこに入っているかを読むだけ。 */}
              {sprint ? <span>{sprint.name}</span> : <Muted>未所属</Muted>}
            </Field>

            <Field label="報告者">
              {/* 作った人は後から変えられない（tickets.created_by_user_id は書き換えない）ので読むだけ。
                  名前はワークスペースの人から引く —— チケットが持つのは id だけのため。 */}
              {reporterName ? <span>{reporterName}</span> : <Muted>不明なユーザー</Muted>}
            </Field>
          </dl>
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            スプリントへの出し入れは、バックログで行を選んだときの選択中の帯から
          </p>
        </Collapsible.Panel>
      </Collapsible.Root>
    </div>
  );
}
