import { useEffect, useState } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import type { Label, TicketStatus, TicketType } from '@/entities/ticket';
import { FieldSelect } from '@/shared/ui';

/** 3 つの絞り込みは同じ幅の振る舞いにする。狭幅では 2 列、広くなったら内容なりの幅。 */
const FILTER_SELECT_CLASS =
  'flex-1 basis-[calc(50%-0.5rem)] rounded-md border-surface-3 bg-surface-1 text-sm font-normal sm:flex-none sm:basis-auto';

export interface BacklogFilterBarProps {
  statuses: TicketStatus[];
  types: TicketType[];
  labels: Label[];
  statusId: string | null;
  typeId: string | null;
  labelId: string | null;
  assignedToMe: boolean;
  q: string;
  extraFilters?: string[];
  onClearFilters?: () => void;
  onChangeStatusId: (value: string | null) => void;
  onChangeTypeId: (value: string | null) => void;
  onChangeLabelId: (value: string | null) => void;
  onToggleAssignedToMe: (value: boolean) => void;
  onChangeQuery: (value: string) => void;
}

const QUERY_DEBOUNCE_MS = 300;

/**
 * BacklogFilterBar はバックログ「チケット」タブの絞り込み（題名検索・状態・種別・担当:自分）。
 * 状態は useBacklogUrlState が URL に持つ（KbBacklogPage 参照。チケットを開いて戻っても
 * 絞り込みが消えない）。
 *
 * 題名検索だけは入力のたびに URL を書き換えない — 1 文字ごとに一覧を取り直すのは無駄が
 * 大きく、`replace` の連打で IME 変換途中の状態が URL に残ることも避けたい。KbSearchDialog
 * と同じ考え方で、ローカルの入力値を持ち 300ms 止まったら親（URL）へ反映する。
 */
export default function BacklogFilterBar({
  statuses,
  types,
  labels,
  statusId,
  typeId,
  labelId,
  assignedToMe,
  q,
  extraFilters = [],
  onClearFilters,
  onChangeStatusId,
  onChangeTypeId,
  onChangeLabelId,
  onToggleAssignedToMe,
  onChangeQuery,
}: BacklogFilterBarProps) {
  const [queryInput, setQueryInput] = useState(q);

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

  return (
    <div role="group" aria-label="チケットの絞り込み" className="flex flex-wrap items-center gap-2 border-b border-surface-3 px-4 py-3">
      <div className="relative w-full sm:w-60">
        <MagnifyingGlassIcon
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-faint)]"
          aria-hidden="true"
        />
        <input
          type="search"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          placeholder="題名で絞り込む"
          aria-label="題名で絞り込む"
          className="min-h-11 w-full rounded-md border border-surface-3 bg-surface-1 py-2 pl-7 pr-2 text-base text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600 sm:text-sm"
        />
      </div>

      {/*
        絞り込みの 3 つは同じ形で横に並ぶので、選んだ値だけだと何の項目か分からなくなる。
        トリガーの中に項目名を残す（prefix）。値は URL に載るので、空文字 = 「すべて」。
      */}
      <FieldSelect
        label="状態で絞り込む"
        prefix="状態"
        value={statusId ?? ''}
        onChange={(value) => onChangeStatusId(value || null)}
        options={[{ value: '', label: 'すべて' }, ...statuses.map((s) => ({ value: s.id, label: s.name }))]}
        className={FILTER_SELECT_CLASS}
      />

      <FieldSelect
        label="種別で絞り込む"
        prefix="種別"
        value={typeId ?? ''}
        onChange={(value) => onChangeTypeId(value || null)}
        options={[{ value: '', label: 'すべて' }, ...types.map((t) => ({ value: t.id, label: t.name }))]}
        className={FILTER_SELECT_CLASS}
      />

      <FieldSelect
        label="ラベルで絞り込む"
        prefix="ラベル"
        value={labelId ?? ''}
        onChange={(value) => onChangeLabelId(value || null)}
        options={[{ value: '', label: 'すべて' }, ...labels.map((l) => ({ value: l.id, label: l.name }))]}
        className={FILTER_SELECT_CLASS}
      />

      <button
        type="button"
        aria-pressed={assignedToMe}
        onClick={() => onToggleAssignedToMe(!assignedToMe)}
        className={`min-h-11 flex-1 basis-[calc(50%-0.5rem)] rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 sm:flex-none sm:basis-auto ${
          assignedToMe
            ? 'bg-brand-600 text-white'
            : 'bg-surface-2 text-[var(--color-text-muted)] hover:bg-surface-3'
        }`}
      >
        担当: 自分
      </button>
      {extraFilters.map((label) => <span key={label} className="rounded-md bg-surface-2 px-3 py-2 text-sm text-[var(--color-text-secondary)]">{label}</span>)}
      {onClearFilters && (statusId || typeId || labelId || assignedToMe || queryInput || extraFilters.length > 0) && (
        <button type="button" onClick={() => { setQueryInput(''); onClearFilters(); }} className="min-h-11 rounded-md px-3 text-sm text-[var(--color-text-muted)] underline underline-offset-4 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">絞り込みを解除</button>
      )}
    </div>
  );
}
