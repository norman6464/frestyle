import type { JSONContent } from '@tiptap/react';
import { Extension } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Mapping } from '@tiptap/pm/transform';
import { blockRowNodeTypeNames, isBlockRowNodeType } from './schemaExtensions';

// どの種類が blocks テーブルの行になるか（＝ id を振る対象か）は、ここに一覧を持たず
// スキーマ側の印（withBlockId）から判定する。pageRef（インラインの atom）や text・マークは
// id を持たないので対象外。backend の表との一致は契約ファイルのテストが確かめる。

/** hasStableId は attrs.id に空でない文字列が入っているかを返す（ProseMirror Node / JSON 共通）。 */
function hasStableId(id: unknown): boolean {
  return typeof id === 'string' && id.length > 0;
}

/**
 * fillMissingBlockIds は doc 内の対象ノードのうち id を持たないものへ、それぞれ別々の
 * crypto.randomUUID() を振った transaction を組み立てて返す。埋める必要が無ければ null。
 *
 * id の正当性（UUID かどうか）はサーバー（parseBlockNode）が保存のたびに検証し、
 * 通らなければ新規採番へ回す最終防衛線を持つ。ここでの役目は「保存の瞬間には
 * 各ブロックが id を持っている」ことだけを保証すること。
 */
function fillMissingBlockIds(
  doc: ProseMirrorNode,
  tr: Transaction,
  recoverLostIds: (missing: ReadonlySet<number>) => ReadonlyMap<number, string> = () => new Map(),
): Transaction | null {
  const missing = new Set<number>();
  doc.descendants((node, pos) => {
    if (isBlockRowNodeType(node.type) && !hasStableId(node.attrs.id)) missing.add(pos);
  });
  if (missing.size === 0) return null;
  const recovered = recoverLostIds(missing);
  for (const pos of missing) {
    const node = doc.nodeAt(pos);
    if (!node) continue;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: recovered.get(pos) ?? crypto.randomUUID() });
  }
  return tr;
}

/**
 * lostIdRecoverer は「属性だけを置き換えて id を落とした」ブロックに、元の id を戻すための
 * 対応表を作る関数を返す（id の無いブロックが見つかったときだけ呼ばれる）。
 *
 * 公式の拡張には、attrs を丸ごと渡し直して既存の属性を消すものがある（折りたたみの開閉は
 * setNodeMarkup(pos, undefined, { open }) で、id を渡さない）。そのまま新しい id を振ると、
 * 開閉のたびにブロックの行が作り直され、コメントの紐付けが外れる。
 *
 * 戻すのは、直前の文書の同じ種類のノードが位置の対応（mapping）で同じ場所にあり、中身が
 * 完全に同じときだけ — 中身ごと別のブロックに置き換えた（貼り付けで上書きした等）ときに、
 * 消えたブロックのコメントを新しいブロックへ移さないため。今の文書のどこかで既に使われている
 * id も戻さない（同じ id が 2 つになる）。
 */
function lostIdRecoverer(transactions: readonly Transaction[], oldDoc: ProseMirrorNode, newDoc: ProseMirrorNode) {
  return (missing: ReadonlySet<number>): ReadonlyMap<number, string> => {
    const mapping = new Mapping();
    for (const transaction of transactions) mapping.appendMapping(transaction.mapping);
    const used = new Set<string>();
    newDoc.descendants((node) => {
      if (hasStableId(node.attrs.id)) used.add(node.attrs.id as string);
    });
    const recovered = new Map<number, string>();
    oldDoc.descendants((oldNode, oldPos) => {
      if (!isBlockRowNodeType(oldNode.type) || !hasStableId(oldNode.attrs.id)) return;
      const id = oldNode.attrs.id as string;
      if (used.has(id)) return;
      // -1: ノードの開始位置を、置き換えられた開きタグの手前へ寄せて写す（setNodeMarkup の
      // 置き換えは開きタグ 1 つ分なので、開始位置は同じ値のまま残る）。
      const newPos = mapping.map(oldPos, -1);
      if (!missing.has(newPos) || recovered.has(newPos)) return;
      const newNode = newDoc.nodeAt(newPos);
      if (!newNode || newNode.type !== oldNode.type || !newNode.content.eq(oldNode.content)) return;
      recovered.set(newPos, id);
      used.add(id);
    });
    return recovered;
  };
}

/**
 * fillMissingBlockIdsInDoc は doc(JSON) を直接（transaction を経由せず）走査し、id を
 * 持たない対象ノードへ crypto.randomUUID() を振った**新しい** doc を返す（変更が無ければ
 * 同じ参照をそのまま返す — sanitizeDocLinks と同じ「構造共有」の流儀）。
 *
 * RichTextEditor が useEditor の content オプション・setContent に渡す**前**の doc を
 * ここで整えるために使う。ProseMirror の transaction を経由しないので "transaction" /
 * "update" イベントを一切発生させない（＝呼び出し元の onChange は絶対に鳴らない）。
 *
 * なぜ appendTransaction 任せにしないか: 初回ロード（useEditor の content オプション）は
 * tiptap が transaction を経由せず直接 doc を組み立てるため、appendTransaction はそもそも
 * 発火しない。エディタ生成直後に別途 transaction を dispatch して埋める案も検討したが、
 * その dispatch は React の act() の外（tiptap 内部の setTimeout 経由）で起き、
 * useEditorState が購読する 'transaction' イベント（"update" と違い preventUpdate で
 * 止められない）が act() の外で再レンダーを誘発し、テスト環境で
 * 「マウント直後の描画がまだ済んでいないタイミングと衝突する」実測の不具合を起こした。
 * doc を渡す前に埋めてしまえば transaction は 1 つも発生せず、この経路の不具合が構造的に無くなる。
 */
/**
 * MAX_FILL_DEPTH は fillMissingBlockIdsInDoc ⇄ fillContentIds の相互再帰が辿る入れ子の上限。
 * linkSafety.ts の MAX_DOC_WALK_DEPTH と同じ理由・同じ値（上限が無いと極端に深い doc で
 * コールスタックを使い切る）。上限を超えた先は歩くのをやめ、その部分木をそのまま返す
 * （id を埋めるのを諦める）。その深さの doc は敵対的な入力以外で作られる見込みが無く、
 * backend 側は保存時にもっと厳しい上限（30 段）でそもそも保存を拒否する。
 */
const MAX_FILL_DEPTH = 300;

export function fillMissingBlockIdsInDoc<T extends JSONContent>(node: T, depth = 0): T {
  const nextContent = depth >= MAX_FILL_DEPTH ? node.content : fillContentIds(node.content, depth + 1);
  const needsId =
    typeof node.type === 'string' && blockRowNodeTypeNames().has(node.type) && !hasStableId(node.attrs?.id);
  if (!needsId && nextContent === node.content) return node;

  const next: JSONContent = { ...node };
  if (nextContent !== undefined) next.content = nextContent;
  if (needsId) next.attrs = { ...(node.attrs ?? {}), id: crypto.randomUUID() };
  return next as T;
}

function fillContentIds(content: JSONContent[] | undefined, depth: number): JSONContent[] | undefined {
  if (!Array.isArray(content)) return content;
  let changed = false;
  const next = content.map((child) => {
    const filled = fillMissingBlockIdsInDoc(child, depth);
    if (filled !== child) changed = true;
    return filled;
  });
  return changed ? next : content;
}

/**
 * StableBlockId は編集中に各ブロックノードへ安定した id attribute を保証する ProseMirror
 * プラグイン。初回ロードの穴埋めは fillMissingBlockIdsInDoc（doc(JSON) を editor へ渡す前に
 * 整える）が担うので、ここは編集経路（appendTransaction）だけを持つ。
 *
 * サーバー（backend/internal/usecase/kb/page_usecase.go の parseBlockNode）は保存のたびに
 * attrs.id を読み、有効な UUID ならそのまま使い、無ければ新規採番する。同じ id を送り続ける
 * 限り DB 上の行（と将来のコメントの紐付け）が保たれるので、フロント側は「保存される瞬間には
 * 各ブロックが id を持っている」ことだけ保証すればよい（id の中身自体を厳密に管理する必要は無い）。
 *
 * 属性だけを置き換えて id を落とす変更（公式の折りたたみの開閉など）では、新しい id ではなく
 * 元の id を戻す（lostIdRecoverer 参照）。
 *
 * doc が変わるトランザクションでだけ動く（tr.docChanged のチェックで無駄な処理を避ける。
 * selection-only の変更で doc が変わらずスキップしても、id の無いノードは次に doc が
 * 変わるトランザクションで拾われるので放置される心配は無い）。
 */
export const StableBlockId = Extension.create({
  name: 'stableBlockId',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('stableBlockId'),
        appendTransaction: (transactions, oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          return fillMissingBlockIds(
            newState.doc,
            newState.tr,
            lostIdRecoverer(transactions, oldState.doc, newState.doc),
          );
        },
      }),
    ];
  },
});
