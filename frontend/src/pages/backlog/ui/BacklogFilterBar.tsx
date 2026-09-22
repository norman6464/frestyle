import { useEffect, useId, useState } from 'react';
import type { Label, TicketStatus, TicketType } from '@/entities/ticket';
import { Button, FieldSelect, FsIcon } from '@/shared/ui';
import type { BacklogQuickFilter } from '../model/useBacklogUrlState';

export interface BacklogFilterBarProps {
  statuses: TicketStatus[];
  types: TicketType[];
  labels: Label[];
  statusId: string | null;
  typeId: string | null;
  labelId: string | null;
  q: string;
  /** 「保存した絞り込み」のタブで選ばれているもの。適用中の条件のチップとして出す。 */
  quick: BacklogQuickFilter | null;
  onChangeStatusId: (value: string | null) => void;
  onChangeTypeId: (value: string | null) => void;
  onChangeLabelId: (value: string | null) => void;
  onChangeQuery: (value: string) => void;
  onClearQuick: () => void;
  /** 題名検索・タブ・詳細条件をまとめて外す。 */
  onClearFilters: () => void;
  /** 「課題をつくる」。渡されなければ出さない（アーカイブの面・読むだけの人）。 */
  onCreate?: () => void;
}

const QUERY_DEBOUNCE_MS = 300;

const QUICK_LABEL: Record<BacklogQuickFilter, string> = {
  assignedToMe: '自分の担当',
  overdue: '期限切れ',
  unassigned: '未割り当て',
};

/**
 * 一覧の操作列。題名検索・「フィルター」・「課題をつくる」を 1 行に置き、
 * 状態／種別／ラベルの選択は「フィルター」を押したときだけ開く（設計ボード ST08 / ST09）。
 *
 * 3 つの選択欄を常に出していた頃は、条件を 1 つも使わない日でも操作列が 5 つ並んでいた。
 * 開く手間が 1 回増える代わりに、いま効いている条件はチップで常に見える
 * （閉じていても消えない）ので、隠したことで見失う条件は無い。
 *
 * 題名検索だけは入力のたびに URL を書き換えない —— 1 文字ごとに一覧を取り直すのは無駄が
 * 大きく、`replace` の連打で IME 変換途中の状態が URL に残ることも避けたい。
 * ローカルの入力値を持ち 300ms 止まったら親（URL）へ反映する。
 */
export default function BacklogFilterBar({
  statuses,
  types,
  labels,
  statusId,
  typeId,
  labelId,
  q,
  quick,
  onChangeStatusId,
  onChangeTypeId,
  onChangeLabelId,
  onChangeQuery,
  onClearQuick,
  onClearFilters,
  onCreate,
}: BacklogFilterBarProps) {
  const [queryInput, setQueryInput] = useState(q);
  const detailCount = [statusId, typeId, labelId].filter(Boolean).length;
  // 条件付きの URL で開いたときは、その条件が見える状態で始める（畳まれていると探す）。
  const [open, setOpen] = useState(detailCount > 0);
  const panelId = useId();

  // URL 側が変わった(絞り込みリンクからの遷移・ブラウザの戻る)ときは入力欄も追従する。
  useEffect(() => {
    setQueryInput(q);
  }, [q]);

  useEffect(() => {
    if (queryInput === q) return undefined;
    const timer = setTimeout(() => onChangeQuery(queryInput), QUERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // q・onChangeQuery を依存に含めると、親から渡されるたびに再セットされて
    // デバウンスが効かなくなる（KbSearchDialog の workspaceSlug 依存と同じ理由で q は含めない）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryInput]);

  const nameOf = <T extends { id: string; name: string }>(list: T[], id: string | null) =>
    id ? list.find((item) => item.id === id)?.name ?? null : null;

  // 適用中の条件。押すとその 1 つだけ外れる。
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  const statusName = nameOf(statuses, statusId);
  const typeName = nameOf(types, typeId);
  const labelName = nameOf(labels, labelId);
  if (statusName) chips.push({ key: 'status', label: `状態: ${statusName}`, onRemove: () => onChangeStatusId(null) });
  if (typeName) chips.push({ key: 'type', label: `種別: ${typeName}`, onRemove: () => onChangeTypeId(null) });
  if (labelName) chips.push({ key: 'label', label: `ラベル: ${labelName}`, onRemove: () => onChangeLabelId(null) });
  if (quick) chips.push({ key: 'quick', label: QUICK_LABEL[quick], onRemove: onClearQuick });
  if (q) chips.push({ key: 'q', label: `題名: ${q}`, onRemove: () => { setQueryInput(''); onChangeQuery(''); } });

  const selectClass = 'w-full rounded-lg border-surface-3 bg-surface-1 font-normal';

  return (
    <div role="group" aria-label="チケットの絞り込み" className="border-b border-surface-3 px-4 pb-3 pt-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <FsIcon name="search"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]"
          />
          <input
            type="search"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="題名で絞り込む"
            aria-label="題名で絞り込む"
            className="min-h-11 w-full rounded-lg border border-surface-3 bg-surface-1 py-2 pl-9 pr-3 text-base text-[var(--color-text-primary)] transition-colors duration-fast placeholder:text-[var(--color-text-muted)] hover:border-[var(--color-border-hover)] focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600 sm:text-sm"
          />
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${
            detailCount > 0
              ? 'border-brand-200 bg-action-soft text-brand-800 hover:bg-brand-100'
              : 'border-surface-3 bg-surface-1 text-[var(--color-text-secondary)] hover:bg-surface-2'
          }`}
        >
          <FsIcon name="filter" className="h-4 w-4" />
          フィルター
          {detailCount > 0 && (
            <span className="tabular-nums" aria-label={`${detailCount} 件の条件を適用中`}>
              {detailCount}
            </span>
          )}
        </button>

        {onCreate && (
          <Button onClick={onCreate} className="shrink-0">
            課題をつくる
          </Button>
        )}
      </div>

      {/*
        開いている間だけ描く（畳んでも条件は URL に残るので、消えるものは無い）。
        aria-controls の先が無いときは hidden の空要素を置き、参照先を切らない。
      */}
      <div id={panelId} hidden={!open} className={open ? 'mt-3 rounded-lg border border-surface-3 bg-surface-2/60 p-3 sm:p-4' : undefined}>
        {open && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">状態</span>
                <FieldSelect
                  label="状態で絞り込む"
                  value={statusId ?? ''}
                  onChange={(value) => onChangeStatusId(value || null)}
                  options={[{ value: '', label: 'すべて' }, ...statuses.map((s) => ({ value: s.id, label: s.name }))]}
                  className={selectClass}
                />
              </div>
              <div>
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">種別</span>
                <FieldSelect
                  label="種別で絞り込む"
                  value={typeId ?? ''}
                  onChange={(value) => onChangeTypeId(value || null)}
                  options={[{ value: '', label: 'すべて' }, ...types.map((t) => ({ value: t.id, label: t.name }))]}
                  className={selectClass}
                />
              </div>
              <div>
                <span className="mb-1 block text-xs text-[var(--color-text-muted)]">ラベル</span>
                <FieldSelect
                  label="ラベルで絞り込む"
                  value={labelId ?? ''}
                  onChange={(value) => onChangeLabelId(value || null)}
                  options={[{ value: '', label: 'すべて' }, ...labels.map((l) => ({ value: l.id, label: l.name }))]}
                  className={selectClass}
                />
              </div>
            </div>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">変更はすぐに反映されます</p>
          </>
        )}
      </div>

      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onRemove}
              aria-label={`${chip.label} の絞り込みを解除`}
              className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-md bg-action-soft px-2.5 text-xs font-medium text-brand-800 transition-colors duration-fast hover:bg-brand-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              <span className="max-w-[16rem] truncate">{chip.label}</span>
              <FsIcon name="x" className="h-3.5 w-3.5 shrink-0" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setQueryInput('');
              onClearFilters();
            }}
            className="ml-auto min-h-9 rounded-md px-2 text-xs text-[var(--color-text-muted)] underline underline-offset-4 hover:bg-surface-2 hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            すべて解除
          </button>
        </div>
      )}
    </div>
  );
}
