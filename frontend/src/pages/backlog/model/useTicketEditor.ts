import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ticket, TicketPriority, UpdateTicketInput } from '@/entities/ticket';
import type { SaveStatus } from '@/shared/ui/RichTextEditor';

interface Draft {
  title: string;
  doc: unknown;
  priority: TicketPriority;
  storyPoints: number | null;
  startDate: string | null;
  dueDate: string | null;
}

/**
 * useTicketEditor は詳細パネルでのチケット編集（title / doc / priority / 日付）を持つ。
 *
 * `PUT .../tickets/:id` は全置換（設計 Ⅳ-D）— 1 項目だけ変えても他の項目を送り返す
 * 必要がある。呼び出し側（TicketDetailPanel）は `key={ticket.id}` でこの hook ごと
 * マウントし直す前提で書いてある（チケットを切り替えるたびに下書きを作り直す）。
 *
 * 保存の撃ち方は項目で分かれる。**本文だけが明示保存**（saveDoc）で、題名・優先度・日付は
 * 即時保存。本文は「保存」を押すまで確定しない作りなので、打鍵を溜める保留キューは持たない
 * （下書きはエディタ側が持つ）。
 */
export function useTicketEditor(
  ticket: Ticket,
  canEdit: boolean,
  onUpdate: (input: UpdateTicketInput) => Promise<Ticket>,
) {
  const [title, setTitle] = useState(ticket.title);
  const [doc, setDoc] = useState(ticket.doc);
  const [priority, setPriority] = useState(ticket.priority);
  const [storyPoints, setStoryPoints] = useState(ticket.storyPoints);
  const [startDate, setStartDate] = useState(ticket.startDate);
  const [dueDate, setDueDate] = useState(ticket.dueDate);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const draftRef = useRef<Draft>({ title, doc, priority, storyPoints, startDate, dueDate });
  useEffect(() => {
    draftRef.current = { title, doc, priority, storyPoints, startDate, dueDate };
  });

  // send は全置換 PUT を 1 回撃つ。失敗はそのまま投げ返す（保存状態の表示だけで握り潰すと、
  // 明示保存の呼び出し側が「保存できなかった」ことを知れない）。
  const send = useCallback(
    (override?: Partial<Draft>) => {
      const snapshot = { ...draftRef.current, ...override };
      setSaveStatus('saving');
      return onUpdate({
        title: snapshot.title,
        doc: snapshot.doc,
        typeId: ticket.typeId,
        priority: snapshot.priority,
        storyPoints: snapshot.storyPoints,
        startDate: snapshot.startDate ?? undefined,
        dueDate: snapshot.dueDate ?? undefined,
      })
        .then((updated) => {
          setSaveStatus('saved');
          return updated;
        })
        .catch((e: unknown) => {
          setSaveStatus('unsaved');
          throw e;
        });
    },
    [onUpdate, ticket.typeId],
  );

  // commit は題名・優先度・日付の即時保存用。失敗は saveStatus だけで伝える（入力欄の横に
  // 出るため、投げても受け手がいない）。
  const commit = useCallback(
    (override?: Partial<Draft>) => {
      if (!canEdit) return;
      send(override).catch(() => {});
    },
    [canEdit, send],
  );



  const changeTitle = useCallback((value: string) => setTitle(value), []);
  const commitTitle = useCallback(() => {
    if (title !== ticket.title) commit();
  }, [title, ticket.title, commit]);

  /**
   * saveDoc は本文の**明示保存**（「保存」を押したとき）。ナレッジ本文と違い打鍵ごとには
   * 保存しない（TicketDescriptionEditor のコメント参照）。失敗はそのまま投げ返し、
   * エディタ側が編集状態を保ったまま知らせる。
   */
  const saveDoc = useCallback(
    async (value: unknown) => {
      if (!canEdit) return;
      setDoc(value);
      await send({ doc: value });
    },
    [canEdit, send],
  );

  const changeStoryPoints = useCallback(
    (value: number | null) => {
      setStoryPoints(value);
      commit({ storyPoints: value });
    },
    [commit],
  );

  const changePriority = useCallback(
    (value: TicketPriority) => {
      setPriority(value);
      commit({ priority: value });
    },
    [commit],
  );

  const changeStartDate = useCallback(
    (value: string | null) => {
      setStartDate(value);
      commit({ startDate: value });
    },
    [commit],
  );

  const changeDueDate = useCallback(
    (value: string | null) => {
      setDueDate(value);
      commit({ dueDate: value });
    },
    [commit],
  );

  return {
    title,
    doc,
    priority,
    storyPoints,
    startDate,
    dueDate,
    saveStatus,
    changeTitle,
    commitTitle,
    saveDoc,
    changePriority,
    changeStoryPoints,
    changeStartDate,
    changeDueDate,
  };
}
