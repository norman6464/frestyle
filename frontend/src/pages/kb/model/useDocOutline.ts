import { useCallback, useEffect, useRef, useState } from 'react';
import { isRichDoc } from '@/shared/lib/richDoc';
import { extractPlainText } from '../lib/docPlainText';
import { extractHeadings, type DocHeading } from '../lib/docOutline';

/** 読了時間の見積りに使う速さ（600 字/分・端数切り上げ）。API は無く手元で計算する。 */
const READING_CHARS_PER_MINUTE = 600;

/** 打つ手が止まってから目次と読了時間を作り直すまでの間合い。 */
const OUTLINE_DEBOUNCE_MS = 300;

export interface DocOutline {
  headings: DocHeading[];
  /** 空の本文では null（0 分は意味を持たない）。 */
  readMinutes: number | null;
}

/** outlineOf は本文から目次（見出し）と読了時間を作る。 */
export function outlineOf(doc: unknown): DocOutline {
  const headings = extractHeadings(doc);
  if (!isRichDoc(doc)) return { headings, readMinutes: null };
  const charCount = extractPlainText(doc).length;
  return { headings, readMinutes: charCount > 0 ? Math.max(1, Math.ceil(charCount / READING_CHARS_PER_MINUTE)) : null };
}

function sameOutline(a: DocOutline, b: DocOutline): boolean {
  if (a.readMinutes !== b.readMinutes || a.headings.length !== b.headings.length) return false;
  return a.headings.every((heading, i) => {
    const other = b.headings[i];
    return heading.id === other.id && heading.level === other.level && heading.text === other.text;
  });
}

/**
 * useDocOutline は、本文の目次（見出し）と読了時間を**書きながら**保つ。
 *
 * 読み込んだ本文（doc: 応答の本文。ページを移る・版を戻すと変わる）から作り、打つたびに
 * update(いまの本文) を呼ぶ。作り直すのは打つ手が止まってから 1 回だけで、見出しと読了時間が
 * 前と同じなら state を変えない —— 1 文字ごとにページ全体を描き直さないため。
 *
 * state には「どの本文から作ったか（source）」も持つ。ページを移ったあとに前のページの
 * 作り直しが遅れて着地しても、source が違うので捨てる。
 */
export function useDocOutline(doc: unknown) {
  const [state, setState] = useState(() => ({ source: doc, outline: outlineOf(doc) }));
  // 読み込んだ本文が変わったら（ページを移った・版を戻した）、描いている途中で作り直す。
  if (state.source !== doc) {
    setState({ source: doc, outline: outlineOf(doc) });
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const update = useCallback(
    (next: unknown) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        const outline = outlineOf(next);
        setState((prev) => {
          if (prev.source !== doc) return prev;
          return sameOutline(prev.outline, outline) ? prev : { source: doc, outline };
        });
      }, OUTLINE_DEBOUNCE_MS);
    },
    [doc],
  );

  return { headings: state.outline.headings, readMinutes: state.outline.readMinutes, update };
}
