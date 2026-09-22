import { useEffect, useState } from 'react';
import { KbRepository } from '@/entities/kb';
import { TicketRepository, type AssignedTicket } from '@/entities/ticket';

/** 履歴とは独立して読み込む。一部のワークスペースの失敗で他の担当を隠さない。 */
export function useHomeWork() {
  const [tickets, setTickets] = useState<AssignedTicket[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'partial' | 'error'>('loading');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    setStatus('loading');
    setTickets([]);
    const load = async () => {
      try {
        const workspaces = await KbRepository.fetchWorkspaces();
        if (!current) return;
        const results = await Promise.allSettled(workspaces.map((w) => TicketRepository.fetchAssignedTickets(w.slug)));
        if (!current) return;
        const failed = results.filter((result) => result.status === 'rejected').length;
        setTickets(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []));
        setStatus(failed === 0 ? 'ready' : failed === results.length ? 'error' : 'partial');
      } catch {
        if (current) setStatus('error');
      }
    };
    void load();
    return () => { current = false; };
  }, [version]);
  return { tickets, status, retry: () => setVersion((v) => v + 1) };
}
