import type { KbDropTarget } from '@/entities/kb';

/** 行の上下どちらの端を「兄弟として置く」に使うかの割合。残りの中央が「子として置く」。 */
export const KB_EDGE_RATIO = 0.3;

/** 落下先の種類。行のどこに落としたかで決まる。 */
export type KbDropZone = 'before' | 'after' | 'into';

/**
 * dropZoneAt は、行の上端からの位置（0〜1）を落下先の種類に読み替える。
 *
 * 上の端なら手前、下の端なら直後、その間なら子として。3 つに分けるのは、
 * **「並べ替え」と「入れ子にする」が別の操作**だから。1 つの行に 2 つの意味を持たせる以上、
 * どこを指しているかは目で分かる幅が要る（端が狭すぎると狙って落とせない）。
 *
 * 端を 30% ずつにしてあるのは、行の高さが 28px 前後で、端が 8px ほど取れる値だから。
 * これより狭いと外しやすく、これより広いと中央（子として）が狙いにくくなる。
 */
export function dropZoneAt(ratio: number): KbDropZone {
  if (ratio < KB_EDGE_RATIO) return 'before';
  if (ratio > 1 - KB_EDGE_RATIO) return 'after';
  return 'into';
}

/** dropZoneFromEvent は行の矩形と縦位置から落下先を決める。 */
export function dropZoneFromEvent(rect: { top: number; height: number }, clientY: number): KbDropZone {
  if (rect.height <= 0) return 'into';
  return dropZoneAt((clientY - rect.top) / rect.height);
}

/** toDropTarget は落下先の種類と行のページ ID を、木を動かす指定に変える。 */
export function toDropTarget(zone: KbDropZone, pageId: string): KbDropTarget {
  return { kind: zone, pageId };
}
