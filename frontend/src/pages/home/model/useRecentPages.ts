import { useEffect, useState } from 'react';
import { KbRepository, type KbRecentPage } from '@/entities/kb';

type RecentPagesStatus = 'loading' | 'ready' | 'error';

/** ホーム専用。最新リクエストだけを反映し、失敗時に前の履歴を残さない。 */
export function useRecentPages() {
  const [pages, setPages] = useState<KbRecentPage[]>([]);
  const [status, setStatus] = useState<RecentPagesStatus>('loading');
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setPages([]);
    setStatus('loading');

    KbRepository.fetchRecentPages(controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return;
        setPages(list);
        setStatus('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setPages([]);
        setStatus('error');
      });

    return () => controller.abort();
  }, [requestVersion]);

  return { pages, status, retry: () => setRequestVersion((version) => version + 1) };
}
