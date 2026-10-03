import { diffLines } from 'diff';

/**
 * doc JSON を歩くときの入れ子の上限。RichTextEditor/linkSafety.ts の MAX_DOC_WALK_DEPTH と
 * 同じ理由（JS のコールスタックを守る）で持つが、あちらより小さく取る — こちらは提案の
 * baseDoc/doc の**両方**を毎描画ごとに歩くため、上限そのものを低めに抑えて描画のたびの
 * コストも頭打ちにする。通常のエディタが作れる深さ（数十段）よりは十分大きい。
 */
const MAX_WALK_DEPTH = 80;

/**
 * baseText/newText を diffLines へ渡す前に切り詰める上限（文字数）。バックエンド側の
 * 本文サイズ上限（1 MiB + 64 KiB）をそのまま平文へ持ち込むと、jsdiff の
 * 計算量 O((N+M)・D) がその桁のまま効いてしまうため、ここで別途絞る。
 * 切り詰めた事実は末尾に追記して分かるようにする（無言で一部だけ比べたと誤解させない）。
 */
const MAX_DIFF_INPUT_CHARS = 200_000;
const TRUNCATION_NOTE = '\n[以降は長すぎるため比較していません]';

/** jsdiff 自身の防御（計算量上限・タイムアウト）。両方超えたら diffLines は undefined を返す。 */
const MAX_DIFF_EDIT_LENGTH = 20_000;
const DIFF_TIMEOUT_MS = 2_000;

/**
 * ProseMirror doc から差分用の平文を作る。
 *
 * トップレベルの各ブロック（paragraph・heading 等）ごとに、そのブロック配下の text ノードを
 * 連結した行を作り、ブロックを改行で繋ぐ。容器（注意書き・折りたたみ・段組み・リスト）の中の
 * ブロックも 1 つずつ行にする（1 行に連結しない）。backend の extractPageBodyText
 * （Go 実装）と同じ発想の抜き出しだが、あちらは流用できないためフロント側に別実装として持つ。
 *
 * 文字だけを拾うと、リンクの href・画像の src・pageRef の参照先・コードブロックの言語は
 * 差分に一切現れず、コメント権限しか持たない投稿者がそこだけ差し替えても採用者に気づかれない
 * （コメント権限で本文以外を実質書き換えられてしまう）。そのため、これらは本文の文字列へ
 * 疑似テキストとして埋め込む — リンクは「本文 (href)」、画像は「[image: src]」、
 * ページ参照は「[page: pageId]」、チケット参照は「[ticket: ticketId]」、名指しは「[mention: userId]」、
 * 数式は「[math: latex]」、コードブロックは「[code: language]」、添付は「[file: ファイル名 (attachmentId)]」、
 * 埋め込みは「[embed: 提供元 動画の ID]」（題名は書いた人の飾りなので添えるだけ）の
 * 形にする（図は本文の文字がそのまま出る）。添付に ID を添えるのは、同じ名前の別の添付（版を上げて
 * 送り直したファイルなど）へ差し替えても差分に出るようにするため。
 *
 * ブロックが object でない・type を持たない等パースできない形は `[変更あり]` という
 * プレースホルダ行にする（何が起きたか分かる程度の情報は残しつつ、例外は投げない）。
 */
export function extractPlainText(doc: unknown): string {
  if (!isPlainObject(doc) || !Array.isArray(doc.content)) return '';
  return doc.content.map((block) => extractBlockLine(block)).join('\n');
}

function extractBlockLine(block: unknown): string {
  if (!isPlainObject(block) || typeof block.type !== 'string') return '[変更あり]';
  return collectText(block, 0);
}

function collectText(node: unknown, depth: number): string {
  if (!isPlainObject(node)) return '';
  // 深すぎる部分木はスタックを守るためにここで打ち切る。何か変わったことだけ伝える。
  if (depth > MAX_WALK_DEPTH) return '[変更あり]';

  const type = typeof node.type === 'string' ? node.type : '';
  let text = '';
  if (type === 'text' && typeof node.text === 'string') {
    text = node.text;
    const href = linkHrefOf(node);
    if (href !== null) text += ` (${href})`;
    // 文字色・蛍光ペンは名前を添える。色だけを差し替える提案も差分に現れるようにする。
    const color = markColorOf(node, 'textStyle');
    if (color !== null) text += ` [色: ${color}]`;
    const highlight = markColorOf(node, 'highlight');
    if (highlight !== null) text += ` [蛍光ペン: ${highlight}]`;
  } else if (type === 'image') {
    text = `[image: ${imageSrcOf(node)}]`;
  } else if (type === 'pageRef') {
    text = `[page: ${pageRefIdOf(node)}]`;
  } else if (type === 'ticketRef') {
    text = `[ticket: ${attrStringOf(node, 'ticketId')}]`;
  } else if (type === 'blockMath' || type === 'inlineMath') {
    text = `[math: ${attrStringOf(node, 'latex')}]`;
  } else if (type === 'mention') {
    text = `[mention: ${attrStringOf(node, 'userId')}]`;
  } else if (type === 'codeBlock') {
    text = `[code: ${codeBlockLanguageOf(node)}]`;
  } else if (type === 'attachment') {
    text = `[file: ${attrStringOf(node, 'filename')} (${attrStringOf(node, 'attachmentId')})]`;
  } else if (type === 'embed') {
    const title = attrStringOf(node, 'title');
    text = `[embed: ${attrStringOf(node, 'provider')} ${attrStringOf(node, 'videoId')}]${title === '' ? '' : ` ${title}`}`;
  }

  if (Array.isArray(node.content)) {
    node.content.forEach((child, index) => {
      // 容器（注意書き・折りたたみ・列・リストの項目）の子は、ブロックごとに改行で区切る。
      // 1 行に連結すると、どのブロックが変わったか差分で読めない。
      if (index > 0 && isBlockNode(child)) text += '\n';
      text += collectText(child, depth + 1);
    });
  }
  return text;
}

/** 文字の並びを作るインラインのノード。これ以外の子はブロックとして行を分ける。 */
const INLINE_NODE_TYPES = new Set(['text', 'hardBreak', 'pageRef', 'ticketRef', 'mention', 'inlineMath']);

function isBlockNode(node: unknown): boolean {
  return isPlainObject(node) && typeof node.type === 'string' && !INLINE_NODE_TYPES.has(node.type);
}

/** linkHrefOf は text ノードの marks から link マークの href を拾う。無ければ null。 */
function linkHrefOf(node: Record<string, unknown>): string | null {
  if (!Array.isArray(node.marks)) return null;
  for (const mark of node.marks) {
    if (!isPlainObject(mark) || mark.type !== 'link') continue;
    const attrs = isPlainObject(mark.attrs) ? mark.attrs : null;
    if (attrs && typeof attrs.href === 'string') return attrs.href;
  }
  return null;
}

/** markColorOf は text ノードの marks から、種類 markType の color を拾う。無ければ null。 */
function markColorOf(node: Record<string, unknown>, markType: string): string | null {
  if (!Array.isArray(node.marks)) return null;
  for (const mark of node.marks) {
    if (!isPlainObject(mark) || mark.type !== markType) continue;
    const attrs = isPlainObject(mark.attrs) ? mark.attrs : null;
    return attrs && typeof attrs.color === 'string' ? attrs.color : '';
  }
  return null;
}

function imageSrcOf(node: Record<string, unknown>): string {
  const attrs = isPlainObject(node.attrs) ? node.attrs : null;
  return attrs && typeof attrs.src === 'string' ? attrs.src : '';
}

function pageRefIdOf(node: Record<string, unknown>): string {
  const attrs = isPlainObject(node.attrs) ? node.attrs : null;
  return attrs && typeof attrs.pageId === 'string' ? attrs.pageId : '';
}

function attrStringOf(node: Record<string, unknown>, name: string): string {
  const attrs = isPlainObject(node.attrs) ? node.attrs : null;
  const value = attrs ? attrs[name] : undefined;
  return typeof value === 'string' ? value : '';
}

function codeBlockLanguageOf(node: Record<string, unknown>): string {
  const attrs = isPlainObject(node.attrs) ? node.attrs : null;
  return attrs && typeof attrs.language === 'string' ? attrs.language : '';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 差分の 1 行。unchanged は前後を確かめるための地の文で、色は付けない。 */
export interface SuggestionDiffLine {
  type: 'added' | 'removed' | 'unchanged' | 'note';
  text: string;
}

function truncateForDiff(text: string): string {
  if (text.length <= MAX_DIFF_INPUT_CHARS) return text;
  return text.slice(0, MAX_DIFF_INPUT_CHARS) + TRUNCATION_NOTE;
}

/**
 * computeSuggestionDiff は baseDoc（提案時点の本文全体）と doc（提案後の本文全体）を
 * 行単位で突き合わせる。baseDoc が無ければ空文字列として扱い、追加行だけの差分になる
 * （baseSeq を持たない = まだ版が 1 つも無いページへの提案）。
 *
 * 差分計算そのものに 2 段の防御を持つ — コメント権限しか持たない投稿者は、この計算結果を
 * 編集者に描画させる入力（doc/baseDoc）を実質自由に作れるため。
 *   1. 比較する前に平文を一定の文字数へ切り詰める（メインスレッドを固まらせる巨大な入力を
 *      そのまま jsdiff へ渡さない）。
 *   2. diffLines 自体にも計算量上限（maxEditLength）とタイムアウトを渡し、それでも
 *      対応しきれない組み合わせ（同じ短さでも行数が膨大、等）では諦めて 1 行の注記を返す
 *      （「変更なし」に見せかけて実は比較できていない、という状態を作らない）。
 */
export function computeSuggestionDiff(baseDoc: unknown, doc: unknown): SuggestionDiffLine[] {
  const baseText = truncateForDiff(baseDoc === undefined ? '' : extractPlainText(baseDoc));
  const newText = truncateForDiff(extractPlainText(doc));

  const parts = diffLines(baseText, newText, { maxEditLength: MAX_DIFF_EDIT_LENGTH, timeout: DIFF_TIMEOUT_MS });
  if (!parts) {
    return [
      {
        type: 'note',
        text: '差分が大きすぎるため計算できませんでした。採用する前に内容を直接確認してください。',
      },
    ];
  }

  const lines: SuggestionDiffLine[] = [];
  for (const part of parts) {
    const type: SuggestionDiffLine['type'] = part.added ? 'added' : part.removed ? 'removed' : 'unchanged';
    // diffLines は同種の行をまとめて1つの value（内部に \n を含む）に詰めてくる。
    // 行ごとに色分けして表示するため、ここで1行ずつへ割り戻す。
    // 末尾の \n が作る最後の空文字列要素だけは実在する行ではないため落とす。
    const segments = part.value.split('\n');
    if (segments[segments.length - 1] === '') segments.pop();
    for (const text of segments) lines.push({ type, text });
  }
  return lines;
}
