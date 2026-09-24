import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyWriteFailure, type WriteOutcome } from '../lib/writeOutcome';

export interface WriteMessages {
  /** 送っている間の文言（例「完了に変更しています…」）。 */
  saving: string;
  /** 成功が確かめられたときの文言（例「状態を保存しました」）。 */
  saved: string;
  /** 断られたが理由が分からないときの文言。 */
  fallback: string;
  /** backend の機械可読コード → 断られた理由の文言。 */
  reasons?: Record<string, string>;
}

/** 成功の知らせを消すまでの時間。失敗は次の操作まで消さない。 */
const SAVED_VISIBLE_MS = 4000;

/**
 * useWriteOutcomes は「どの操作の結果か」（鍵）ごとに、変更の結果（PX04）を持つ。
 *
 * `run` は送っている間 saving、成功で saved、失敗で rejected / unknown を立てる。失敗は
 * 投げ返さない（結果は場所に出したので、呼び出し側が重ねてトーストを出さない）。
 * 戻り値は成功したかどうか。楽観更新をしていないので、失敗しても見た目は変更前のまま。
 *
 * 成功の知らせは少しして消す（成功は穏やかに）。失敗は同じ鍵で次の操作を始めるまで残す。
 */
export function useWriteOutcomes<K extends string>() {
  const [outcomes, setOutcomes] = useState<Partial<Record<K, WriteOutcome>>>({});
  const timers = useRef(new Map<K, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, []);

  const set = useCallback((key: K, outcome: WriteOutcome | null) => {
    const pending = timers.current.get(key);
    if (pending) clearTimeout(pending);
    timers.current.delete(key);
    setOutcomes((prev) => {
      const next = { ...prev };
      if (outcome) next[key] = outcome;
      else delete next[key];
      return next;
    });
    if (outcome?.kind === 'saved') {
      timers.current.set(
        key,
        setTimeout(() => {
          setOutcomes((prev) => {
            if (prev[key] !== outcome) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
          });
        }, SAVED_VISIBLE_MS),
      );
    }
  }, []);

  const run = useCallback(
    async (key: K, action: () => Promise<unknown>, messages: WriteMessages): Promise<boolean> => {
      set(key, { kind: 'saving', message: messages.saving });
      try {
        await action();
        set(key, { kind: 'saved', message: messages.saved });
        return true;
      } catch (cause) {
        set(key, classifyWriteFailure(cause, messages.fallback, messages.reasons));
        return false;
      }
    },
    [set],
  );

  const outcomeOf = useCallback((key: K): WriteOutcome | null => outcomes[key] ?? null, [outcomes]);
  const clear = useCallback((key: K) => set(key, null), [set]);

  return { run, outcomeOf, clear };
}
