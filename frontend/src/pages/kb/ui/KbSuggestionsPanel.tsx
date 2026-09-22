import { useState } from 'react';
import type { KbPageSuggestion } from '@/entities/kb';
import Button from '@/shared/ui/Button';
import { formatHourMinute, formatMonthDay } from '@/shared/lib/formatters';
import { computeSuggestionDiff } from '../lib/suggestionDiff';
import KbSuggestionDiffView from './KbSuggestionDiffView';

export interface KbSuggestionsPanelProps {
  suggestions: KbPageSuggestion[];
  loading: boolean;
  error: string | null;
  /** 採用・却下ボタンは編集権限が要る。読むことは canView だけで誰でもできる。 */
  canEdit: boolean;
  /** 採用する。**失敗は投げてくる**（呼び出し側 KbPage がトーストで知らせたうえで再送する）。 */
  onAccept: (suggestionId: string) => Promise<void>;
  /** 却下する。**失敗は投げてくる**（onAccept と同じ約束）。 */
  onReject: (suggestionId: string) => Promise<void>;
}

/**
 * KbSuggestionsPanel は履歴パネル（KbVersionsPanel）と同じ流儀の右パネルの中身。
 *
 * 状態は受け取るだけで、自分では取りに行かない（取得は useKbPageSuggestions が持つ）。
 * 一覧は open な提案だけ（backend が既に絞って返す）。差分は doc と baseDoc をこちら側で
 * 突き合わせて計算する（computeSuggestionDiff）。
 *
 * 採用・却下は確認ダイアログを持たない — backend が 409（suggestion_already_resolved）で
 * 二重解決を守るので、フロントは楽観的に呼んで失敗したら知らせるだけでよい。busyId は
 * この部品だけが持つ見た目の状態（押した行だけボタンを効かなくする）。
 */
export default function KbSuggestionsPanel({
  suggestions,
  loading,
  error,
  canEdit,
  onAccept,
  onReject,
}: KbSuggestionsPanelProps) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = async (suggestionId: string, action: (id: string) => Promise<void>) => {
    setBusyId(suggestionId);
    try {
      await action(suggestionId);
    } catch {
      // 呼び出し側（KbPage）が既にトーストで知らせている。ここでは押し直せる状態に戻すだけ。
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      {loading && (
        <div className="flex flex-col gap-1.5" role="status" aria-label="提案を読み込み中">
          <div className="h-16 animate-skeleton rounded bg-surface-2" />
          <div className="h-16 animate-skeleton rounded bg-surface-2" />
        </div>
      )}

      {!loading && error && (
        <p role="alert" className="text-sm leading-relaxed text-danger-ink">
          {error}
        </p>
      )}

      {!loading && !error && suggestions.length === 0 && (
        <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
          まだ提案はありません。
        </p>
      )}

      {!loading && !error && suggestions.length > 0 && (
        <ul className="flex flex-col gap-3">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id} className="rounded-lg border border-surface-3 bg-surface-1 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                  {suggestion.author.name || '不明なユーザー'}
                </span>
                <span className="text-[0.6875rem] text-[var(--color-text-muted)]">
                  {formatMonthDay(suggestion.createdAt)} {formatHourMinute(suggestion.createdAt)}
                </span>
              </div>
              <KbSuggestionDiffView lines={computeSuggestionDiff(suggestion.baseDoc, suggestion.doc)} />
              {canEdit && (
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busyId !== null}
                    onClick={() => void run(suggestion.id, onReject)}
                  >
                    却下
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busyId !== null && busyId !== suggestion.id}
                    loading={busyId === suggestion.id}
                    onClick={() => void run(suggestion.id, onAccept)}
                  >
                    採用
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
