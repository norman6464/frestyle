import { useCallback, useEffect, useState } from 'react';
import { TicketRepository } from '@/entities/ticket';
import { FsIcon } from '@/shared/ui';
import { useToast } from '@/shared/lib/hooks/useToast';

export interface TicketWatchButtonProps {
  workspaceSlug: string;
  ticketId: string;
}

/**
 * 監視の付け外し。押した人自身の分だけを動かす。
 *
 * 「担当」とは別物で、担当は 1 人（責任の所在）、監視は何人でも（気にしている人）。
 * 編集できない人でも押せる —— 進み具合を追うだけなら書き換えの権限は要らないため。
 *
 * 送るのは「切り替え」ではなく「どちらにしたいか」。二重に押されたときに意図せず
 * 外れるのを防ぐ（backend の PUT も同じ形で受ける）。
 */
export default function TicketWatchButton({ workspaceSlug, ticketId }: TicketWatchButtonProps) {
  const [watching, setWatching] = useState(false);
  const [count, setCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    let alive = true;
    setReady(false);
    TicketRepository.fetchTicketWatchState(workspaceSlug, ticketId)
      .then((state) => {
        if (!alive) return;
        setWatching(state.watching);
        setCount(state.count);
        setReady(true);
      })
      .catch(() => {
        // 取れなくてもチケットは読める。押せないまま黙って畳む（fail-open）。
        if (alive) setReady(false);
      });
    return () => {
      alive = false;
    };
  }, [workspaceSlug, ticketId]);

  const toggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await TicketRepository.setTicketWatching(workspaceSlug, ticketId, !watching);
      setWatching(next.watching);
      setCount(next.count);
    } catch {
      // 失敗したら見た目を変えない（押す前の状態のまま）。黙っていると押せなかったことに
      // 気づけないので、失敗は知らせる。
      showToast('error', watching ? 'ウォッチを外せませんでした。' : 'ウォッチできませんでした。');
    } finally {
      setBusy(false);
    }
  }, [busy, ticketId, watching, workspaceSlug, showToast]);

  if (!ready) return null;


  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={watching}
      // 見えているのは人数だけなので、読み上げの名前にも人数を含める（見た目の文字が名前に入って
      // いないと、音声で「0 を押す」と言っても押せない）。
      aria-label={`${watching ? '監視をやめる' : '監視する'}（監視 ${count} 人）`}
      title={watching ? '監視をやめる' : '監視する'}
      className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50 ${
        watching
          ? 'border-brand-600 bg-brand-100 text-brand-700'
          : 'border-surface-3 text-[var(--color-text-secondary)] hover:bg-surface-2'
      }`}
    >
      <FsIcon name={watching ? 'eye' : 'eye-off'} className="h-3.5 w-3.5" />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}
