import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ticket, TicketPriority, UpdateTicketInput } from '@/entities/ticket';
import type { SaveStatus } from '@/shared/ui/RichTextEditor';
import { classifyWriteFailure, type WriteOutcome } from '../lib/writeOutcome';

interface Draft {
  title: string;
  doc: unknown;
  priority: TicketPriority;
  storyPoints: number | null;
  startDate: string | null;
  dueDate: string | null;
}

/** 即時保存する項目。結果（PX04）はこの単位で項目のすぐ下に出す。 */
export type TicketEditorField = 'title' | 'priority' | 'storyPoints' | 'startDate' | 'dueDate';

type Confirmed = Omit<Draft, 'doc'>;

function confirmedOf(ticket: Ticket): Confirmed {
  return {
    title: ticket.title,
    priority: ticket.priority,
    storyPoints: ticket.storyPoints,
    startDate: ticket.startDate,
    dueDate: ticket.dueDate,
  };
}

/** 成功の知らせを消すまでの時間。失敗は次の操作まで消さない。 */
const SAVED_VISIBLE_MS = 4000;

/**
 * useTicketEditor は詳細パネルでのチケット編集（title / doc / priority / 日付 / 見積り）を持つ。
 *
 * `PUT .../tickets/:id` は全置換（設計 Ⅳ-D）— 1 項目だけ変えても他の項目を送り返す
 * 必要がある。呼び出し側は `key={ticket.id}` でこの hook ごとマウントし直す前提で書いてある
 * （チケットを切り替えるたびに下書きを作り直す）。
 *
 * 保存の撃ち方は項目で分かれる。**本文だけが明示保存**（saveDoc）で、題名・優先度・日付・
 * 見積りは即時保存。即時保存の結果は項目ごとに `outcomeOf` で返し、項目のすぐ下に出す
 * （設計ボード PX04）。失敗したら、その項目の見た目を最後に保存が確かめられた値へ戻す
 * （新しい値を残すと、保存されたと読めてしまう）。結果が分からない失敗（通信の切断・時間切れ）も
 * 戻す —— 本当はどうなったかは「最新を確認」で取り直した値で決まる。
 *
 * 一覧の取り直しなどで `ticket` が新しくなったら、手で書きかけていない項目だけを追従させる。
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
  const [outcomes, setOutcomes] = useState<Partial<Record<TicketEditorField, WriteOutcome>>>({});

  const draftRef = useRef<Draft>({ title, doc, priority, storyPoints, startDate, dueDate });
  useEffect(() => {
    draftRef.current = { title, doc, priority, storyPoints, startDate, dueDate };
  });
  // 最後に保存が確かめられた値。失敗したときの戻し先。
  const confirmedRef = useRef<Confirmed>(confirmedOf(ticket));
  const clearTimers = useRef<Partial<Record<TicketEditorField, ReturnType<typeof setTimeout>>>>({});

  useEffect(
    () => () => {
      for (const timer of Object.values(clearTimers.current)) clearTimeout(timer);
    },
    [],
  );

  const setOutcome = useCallback((field: TicketEditorField, outcome: WriteOutcome | null) => {
    const pending = clearTimers.current[field];
    if (pending) clearTimeout(pending);
    setOutcomes((prev) => {
      const next = { ...prev };
      if (outcome) next[field] = outcome;
      else delete next[field];
      return next;
    });
    if (outcome?.kind === 'saved') {
      clearTimers.current[field] = setTimeout(() => {
        setOutcomes((prev) => {
          if (prev[field] !== outcome) return prev;
          const next = { ...prev };
          delete next[field];
          return next;
        });
      }, SAVED_VISIBLE_MS);
    }
  }, []);

  // 一覧の取り直し（「最新を確認」・ほかの操作の応答）で ticket が新しくなったら、書きかけていない
  // 項目だけを追従させる。題名を打っている最中に別の項目の保存が返ってきても、題名は上書きしない。
  useEffect(() => {
    const confirmed = confirmedRef.current;
    const latest = confirmedOf(ticket);
    const draft = draftRef.current;
    if (draft.title === confirmed.title && latest.title !== draft.title) setTitle(latest.title);
    if (draft.priority === confirmed.priority && latest.priority !== draft.priority) setPriority(latest.priority);
    if (draft.storyPoints === confirmed.storyPoints && latest.storyPoints !== draft.storyPoints) {
      setStoryPoints(latest.storyPoints);
    }
    if (draft.startDate === confirmed.startDate && latest.startDate !== draft.startDate) setStartDate(latest.startDate);
    if (draft.dueDate === confirmed.dueDate && latest.dueDate !== draft.dueDate) setDueDate(latest.dueDate);
    confirmedRef.current = latest;
  }, [ticket]);

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
          confirmedRef.current = confirmedOf(updated);
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

  /** 項目を最後に保存が確かめられた値へ戻す。 */
  const revert = useCallback((field: TicketEditorField) => {
    const confirmed = confirmedRef.current;
    switch (field) {
      case 'title':
        setTitle(confirmed.title);
        break;
      case 'priority':
        setPriority(confirmed.priority);
        break;
      case 'storyPoints':
        setStoryPoints(confirmed.storyPoints);
        break;
      case 'startDate':
        setStartDate(confirmed.startDate);
        break;
      case 'dueDate':
        setDueDate(confirmed.dueDate);
        break;
    }
  }, []);

  // commit は即時保存。結果は項目ごとに outcomes へ置く（投げ返さない —— 項目の下に出したので、
  // 呼び出し側が重ねて知らせる必要が無い）。
  const commit = useCallback(
    (field: TicketEditorField, override?: Partial<Draft>) => {
      if (!canEdit) return;
      setOutcome(field, { kind: 'saving', message: '保存しています…' });
      send(override)
        .then(() => setOutcome(field, { kind: 'saved', message: '保存しました' }))
        .catch((cause: unknown) => {
          revert(field);
          // 値を戻したので、書きかけの物は残っていない。「未保存」を出したままにしない
          // （失敗の理由は項目の下に出ている）。
          setSaveStatus('idle');
          const failure = classifyWriteFailure(cause, '保存できませんでした。');
          setOutcome(field, {
            ...failure,
            message: failure.kind === 'rejected' ? `${failure.message}元の値に戻しました。` : failure.message,
          });
        });
    },
    [canEdit, send, revert, setOutcome],
  );

  const changeTitle = useCallback((value: string) => setTitle(value), []);
  const commitTitle = useCallback(() => {
    if (title !== confirmedRef.current.title) commit('title');
  }, [title, commit]);

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
      commit('storyPoints', { storyPoints: value });
    },
    [commit],
  );

  const changePriority = useCallback(
    (value: TicketPriority) => {
      setPriority(value);
      commit('priority', { priority: value });
    },
    [commit],
  );

  const changeStartDate = useCallback(
    (value: string | null) => {
      setStartDate(value);
      commit('startDate', { startDate: value });
    },
    [commit],
  );

  const changeDueDate = useCallback(
    (value: string | null) => {
      setDueDate(value);
      commit('dueDate', { dueDate: value });
    },
    [commit],
  );

  const outcomeOf = useCallback((field: TicketEditorField): WriteOutcome | null => outcomes[field] ?? null, [outcomes]);

  return {
    title,
    doc,
    priority,
    storyPoints,
    startDate,
    dueDate,
    saveStatus,
    outcomeOf,
    changeTitle,
    commitTitle,
    saveDoc,
    changePriority,
    changeStoryPoints,
    changeStartDate,
    changeDueDate,
  };
}
