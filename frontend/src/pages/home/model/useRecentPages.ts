import { KbRepository, type KbRecentPage } from '@/entities/kb';
import { useHomeResource } from './useHomeResource';

const EMPTY: KbRecentPage[] = [];

/**
 * 最近開いたページ（全ワークスペース横断・新しい順・サーバーが最大 10 件）。本文は取らず、
 * 題名や場所は一覧の応答だけで描く（ページを解決すると閲覧の記録が書き換わるので、開くとき以外は
 * 解決しない）。
 */
export function useRecentPages() {
  return useHomeResource('recent', (signal) => KbRepository.fetchRecentPages(signal), EMPTY);
}
