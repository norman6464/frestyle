import { Extension } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { canJoin } from '@tiptap/pm/transform';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

// 結合対象のリストノード。段落等を挟まず直接隣接した同種リストだけを 1 つにする。
const JOINABLE_LIST_TYPES = new Set(['orderedList', 'bulletList']);

/**
 * findAdjacentListBoundaries は「同種リストが直接隣接している境界位置」を doc 全体
 * （ネスト含む）から集める。返す位置は ProseMirror の join 位置（2 つのノードの間）。
 */
export function findAdjacentListBoundaries(doc: ProseMirrorNode): number[] {
  const boundaries: number[] = [];
  const scan = (node: ProseMirrorNode, base: number) => {
    let prev: ProseMirrorNode | null = null;
    let offset = 0;
    node.forEach((child) => {
      if (
        prev !== null &&
        JOINABLE_LIST_TYPES.has(child.type.name) &&
        prev.type.name === child.type.name
      ) {
        boundaries.push(base + offset);
      }
      // 子コンテンツはノード開始タグの内側（+1）から始まる。
      scan(child, base + offset + 1);
      prev = child;
      offset += child.nodeSize;
    });
  };
  scan(doc, 0);
  return boundaries;
}

/**
 * ListNormalization は隣接する同種リストを自動で 1 つに結合する正規化拡張。
 *
 * 項目をまたぐ削除・貼り付け・undo などの組合せで orderedList が 2 つに分裂したまま
 * 隣接することがあり（スキーマ上は合法）、ブラウザは <ol> ごとに番号を振るため
 * 「1,2 → 1,2,3」のように番号がリセットされて見える。発生経路を個別に塞ぐのではなく、
 * ドキュメントが変わるたびに隣接同種リストを結合して番号を連番へ戻す。
 * 段落などを挟んだ独立リストは隣接していないので結合しない。
 */
export const ListNormalization = Extension.create({
  name: 'listNormalization',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('listNormalization'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          const boundaries = findAdjacentListBoundaries(newState.doc);
          if (boundaries.length === 0) return null;

          const tr = newState.tr;
          // 後ろの境界から結合すれば、手前の境界位置がずれない。
          for (const boundary of boundaries.sort((a, b) => b - a)) {
            if (canJoin(tr.doc, boundary)) tr.join(boundary);
          }
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
