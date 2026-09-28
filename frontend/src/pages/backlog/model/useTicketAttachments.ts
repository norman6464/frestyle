import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { reflectWrite } from '@/shared/api/queryCache';
import { queryShownState } from '@/shared/api/queryState';
import { TicketRepository, ticketAttachmentsQuery, type TicketAttachment } from '@/entities/ticket';
import { isAcceptedAttachmentContentType, MAX_ATTACHMENT_UPLOAD_BYTES } from '../config/attachmentUpload';

const LOAD_FAILED = '添付を読み込めませんでした。時間をおいて開き直すと最新の状態が出ます。';
const REJECTED_TYPE = '対応していない形式のファイルです。';
const REJECTED_SIZE = 'ファイルが大きすぎます（上限 25 MB）。';
const UPLOAD_FAILED = 'アップロードに失敗しました。';

const NO_ATTACHMENTS: TicketAttachment[] = [];
const NO_PENDING: PendingAttachment[] = [];

const countOf = (attachments: TicketAttachment[]) => attachments.length;

/** アップロード中・失敗の 1 件。成功すると消え、`attachments` 側に移る。 */
export interface PendingAttachment {
  /** 手元だけの ID（サーバーはまだ何も知らない）。 */
  clientId: string;
  file: File;
  status: 'uploading' | 'failed';
  error: string | null;
}

/**
 * useTicketAttachments はチケット 1 件の添付（一覧・追加・削除）を読み書きする。
 *
 * 追加は 3 段（presign 発行 → Cloud Storage へ直接 PUT → メタデータの記録）で、
 * 手元では `pending` に「アップロード中/失敗」の行として持ち、成功した分だけ
 * 確定済みの一覧へ移す。一覧の取得し直しを待たずに進捗を見せるため、
 * ラベルのような素朴な CRUD 一覧より 1 段複雑な形になっている。
 *
 * 確定済みの一覧は共有の問い合わせ（ticketAttachmentsQuery）から読み、書き込みの応答を
 * reflectWrite で映す（楽観更新はしない）。アップロードの途中で別のチケットへ移っても、
 * 終わった添付はそのチケットの一覧へ入る。`pending` は手元だけのものなので、どのチケットの
 * ものかと組で持ち、別のチケットへ移ったら出さない。失敗した pending 行は消さずに残し、
 * `retry` でファイルを持ち回したまま再送できるようにする。
 */
export function useTicketAttachments(workspaceSlug: string | undefined, ticketId: string | undefined) {
  const queryClient = useQueryClient();
  const active = workspaceSlug !== undefined && ticketId !== undefined;
  const key = active ? `${workspaceSlug} ${ticketId}` : null;
  const result = useQuery({ ...ticketAttachmentsQuery(workspaceSlug ?? '', ticketId ?? ''), enabled: active });
  const { data, loading, failed } = queryShownState(result, active);

  const [pendingState, setPendingState] = useState<{ key: string | null; rows: PendingAttachment[] }>({
    key,
    rows: NO_PENDING,
  });
  const pending = pendingState.key === key ? pendingState.rows : NO_PENDING;
  /** 今のチケットの pending 行を書き換える（別のチケットの行は捨てる）。 */
  const updatePending = useCallback(
    (update: (rows: PendingAttachment[]) => PendingAttachment[]) =>
      setPendingState((prev) => ({ key, rows: update(prev.key === key ? prev.rows : NO_PENDING) })),
    [key],
  );
  /** アップロードの結果で pending 行を直す（その間に別のチケットへ移っていたら何もしない）。 */
  const settlePending = useCallback(
    (forKey: string, update: (rows: PendingAttachment[]) => PendingAttachment[]) =>
      setPendingState((prev) => (prev.key === forKey ? { key: forKey, rows: update(prev.rows) } : prev)),
    [],
  );

  const [busy, setBusy] = useState<{ key: string; attachmentId: string } | null>(null);
  const busyId = busy !== null && busy.key === key ? busy.attachmentId : null;

  const { refetch } = result;
  const refresh = useCallback(() => {
    if (active) void refetch();
  }, [active, refetch]);

  const runUpload = useCallback(
    async (clientId: string, slug: string, id: string, file: File) => {
      const forKey = `${slug} ${id}`;
      try {
        const issued = await TicketRepository.issueTicketAttachmentUploadUrl(slug, id, file.type, file.size);
        await TicketRepository.putTicketAttachmentFile(issued.url, file);
        const created = await TicketRepository.createTicketAttachment(slug, id, {
          key: issued.key,
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        });
        await reflectWrite(queryClient, ticketAttachmentsQuery(slug, id).queryKey, (prev) =>
          prev.some((a) => a.id === created.id) ? prev : [...prev, created],
        );
        settlePending(forKey, (rows) => rows.filter((p) => p.clientId !== clientId));
      } catch {
        settlePending(forKey, (rows) =>
          rows.map((p) => (p.clientId === clientId ? { ...p, status: 'failed', error: UPLOAD_FAILED } : p)),
        );
      }
    },
    [queryClient, settlePending],
  );

  /** ファイル 1 件を選ぶたびに呼ぶ（複数選択は呼び出し側が 1 つずつ回す）。 */
  const upload = useCallback(
    (file: File) => {
      if (!workspaceSlug || !ticketId) return;
      const clientId = crypto.randomUUID();
      if (!isAcceptedAttachmentContentType(file.type)) {
        updatePending((rows) => [...rows, { clientId, file, status: 'failed', error: REJECTED_TYPE }]);
        return;
      }
      if (file.size <= 0 || file.size > MAX_ATTACHMENT_UPLOAD_BYTES) {
        updatePending((rows) => [...rows, { clientId, file, status: 'failed', error: REJECTED_SIZE }]);
        return;
      }
      updatePending((rows) => [...rows, { clientId, file, status: 'uploading', error: null }]);
      void runUpload(clientId, workspaceSlug, ticketId, file);
    },
    [workspaceSlug, ticketId, updatePending, runUpload],
  );

  const retry = useCallback(
    (clientId: string) => {
      if (!workspaceSlug || !ticketId) return;
      // 送り直すファイルは描いた時点の行から取る（state を書き換える関数の中で送ると、
      // 開発時の StrictMode がその関数を 2 回呼び、同じファイルを 2 回送る）。
      const target = pending.find((p) => p.clientId === clientId);
      if (!target) return;
      updatePending((rows) => rows.map((p) => (p.clientId === clientId ? { ...p, status: 'uploading', error: null } : p)));
      void runUpload(clientId, workspaceSlug, ticketId, target.file);
    },
    [workspaceSlug, ticketId, pending, updatePending, runUpload],
  );

  const dismiss = useCallback(
    (clientId: string) => updatePending((rows) => rows.filter((p) => p.clientId !== clientId)),
    [updatePending],
  );

  /** 確定済みの添付を削除する。失敗は投げる（呼び出し側がトーストで知らせる）。 */
  const remove = useCallback(
    async (attachmentId: string) => {
      if (!workspaceSlug || !ticketId || key === null) throw new Error('ticket attachments: no active scope');
      setBusy({ key, attachmentId });
      try {
        await TicketRepository.deleteTicketAttachment(workspaceSlug, ticketId, attachmentId);
        await reflectWrite(queryClient, ticketAttachmentsQuery(workspaceSlug, ticketId).queryKey, (prev) =>
          prev.filter((a) => a.id !== attachmentId),
        );
      } finally {
        setBusy((prev) => (prev !== null && prev.key === key && prev.attachmentId === attachmentId ? null : prev));
      }
    },
    [workspaceSlug, ticketId, key, queryClient],
  );

  return {
    attachments: data ?? NO_ATTACHMENTS,
    pending,
    loading,
    error: failed ? LOAD_FAILED : null,
    busyId,
    refresh,
    upload,
    retry,
    dismiss,
    remove,
  };
}

/**
 * useTicketAttachmentCount は見出しに出す添付の件数（確定済みのもの）。節の中身
 * （useTicketAttachments）と同じ結果を使うので取り直さない。まだ読めていない・読めなかった間は
 * undefined（0 と取り違えない）。
 */
export function useTicketAttachmentCount(workspaceSlug: string, ticketId: string): number | undefined {
  const result = useQuery({ ...ticketAttachmentsQuery(workspaceSlug, ticketId), select: countOf });
  return queryShownState(result).data;
}
