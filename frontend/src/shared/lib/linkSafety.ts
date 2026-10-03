import type { JSONContent } from '@tiptap/core';

/**
 * linkSafety は「リンクの href として安全か」を判定・修復する純関数だけを置くモジュール。
 *
 * ここに DOM / React / tiptap のランタイム依存を持ち込まないこと。判定そのものを
 * 「エディタが動いていること」に依存させないため。保存前・読み込み後といったエディタの外側でも、
 * 同じ関数で同じ結論を出せるようにしておく。
 *
 * ナレッジの本文エディタ（pages/kb）とバックログの本文エディタ（pages/backlog）は別物だが、
 * リンクの安全判定だけはこの 1 か所を共有する。検査を 2 か所に分けると、片方だけ直し忘れて
 * 穴が開くため。
 */

/**
 * href に許可するスキーム（プロトコル）の明示リスト。
 *
 * なぜ tiptap の既定に頼らず自分で列挙するのか:
 * - tiptap の既定 isAllowedUri は http/https/ftp/ftps/mailto/tel/callto/sms/cid/xmpp に加えて
 *   「スキームが無い文字列」も通す。つまり「何を許すか」がライブラリの都合で決まっていて、
 *   版が上がったときに黙って広がりうる。防御の広さがこちらの意思と無関係に動くのは危険。
 * - 逆に「危ないものを拒否する」書き方（javascript: を弾く等）は、新しい危険スキームや
 *   表記ゆれ（大文字・制御文字混じり）が出るたびに漏れる。許可リストなら、知らないスキームは
 *   自動的に不許可側へ倒れる。
 *
 * ここに無いスキーム（javascript: / data: / vbscript: など）は例外なく不許可。
 * 相対パスは原則不許可で、唯一の例外がページ間リンク（下の INTERNAL_PAGE_LINK_PATTERN）。
 */
export const ALLOWED_LINK_PROTOCOLS: readonly string[] = ['http', 'https', 'mailto', 'tel'];

/**
 * ページ間リンク（/kb/{ページID}）の形。ナレッジのページを指す内部リンクで、
 * 相対パスの中では**この形だけ**を許す。任意の相対パスを開けると、利用者入力から
 * 任意の画面へ踏ませる経路（ログアウトの踏み台や、将来できるかもしれない
 * 副作用つき URL への誘導）になるため、ID は UUID の字面に固定し、
 * クエリ・フラグメント・大文字も認めない。広げる理由が出るまで最小で持つ。
 */
export const INTERNAL_PAGE_LINK_PATTERN =
  /^\/kb\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** isInternalPageLinkHref は「同じアプリ内のページを指すリンクか」を判定する述語。 */
export function isInternalPageLinkHref(href: unknown): boolean {
  return typeof href === 'string' && INTERNAL_PAGE_LINK_PATTERN.test(foldAsUrlParserWould(href));
}

/** doc JSON 上のリンクマーク名（ProseMirror のマーク名。tiptap の Link 拡張と一致させる）。 */
export const LINK_MARK_NAME = 'link';

/**
 * URL パーサ（WHATWG）は href を読むとき、タブ・改行・復帰を「無かったもの」として捨て、
 * 前後の C0 制御文字と空白も落とす。攻撃者はここを突いて `java<TAB>script:alert(1)` のように
 * スキーム名を割り、素朴な文字列一致の検査を素通りさせようとする。
 * 判定前に同じ規則で畳んでおけば、「ブラウザが最終的に見る文字列」で判断できる。
 */
function foldAsUrlParserWould(href: string): string {
  // 正規表現で制御文字の範囲を書くと、リテラルが不可視になり lint（no-control-regex）にも触れる。
  // 文字コードで明示的に判定する。0x09/0x0A/0x0D = タブ・改行・復帰、0x20 以下 = C0 制御文字と空白。
  let stripped = '';
  for (let i = 0; i < href.length; i += 1) {
    const code = href.charCodeAt(i);
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    stripped += href[i];
  }
  let start = 0;
  let end = stripped.length;
  while (start < end && stripped.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && stripped.charCodeAt(end - 1) <= 0x20) end -= 1;
  return stripped.slice(start, end);
}

/**
 * sanitizeLinkHref は href を「保存してよい形」に正規化する。許可できないものは null を返す。
 *
 * 戻り値は正規化後の文字列（＝タブ・改行を抜いたもの）で、元の表記はできるだけ残す。
 * URL パーサの出力（parsed.href）で置き換えないのは、`https://example.com` が
 * `https://example.com/` に化けるなど、利用者が書いた文字列を必要以上に書き換えないため。
 */
export function sanitizeLinkHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const folded = foldAsUrlParserWould(href);
  if (folded === '') return null;

  // ページ間リンクだけは相対パスのまま許す（形は正規表現で固定）。
  if (INTERNAL_PAGE_LINK_PATTERN.test(folded)) return folded;

  let parsed: URL;
  try {
    parsed = new URL(folded);
  } catch {
    // それ以外の絶対 URL として読めないもの（相対パス・スキーム無し）は許可しない。
    // 「スキームが無いから安全」ではなく「安全と判断できる形になっていない」ので落とす。
    return null;
  }
  // parsed.protocol は URL パーサが小文字化した `https:` の形。末尾のコロンを外して比べる。
  const protocol = parsed.protocol.slice(0, -1);
  if (!ALLOWED_LINK_PROTOCOLS.includes(protocol)) return null;
  return folded;
}

/** isAllowedLinkHref は sanitizeLinkHref が値を返すか（＝許可できるか）だけを見る述語。 */
export function isAllowedLinkHref(href: unknown): boolean {
  return sanitizeLinkHref(href) !== null;
}

/**
 * normalizeLinkInput は「人がリンク入力欄に打った文字列」を href へ変換する。許可できなければ null。
 *
 * `example.com/a` のようにスキームを省いた入力には https:// を補う（毎回 https:// と打たせない）。
 * ただし補うのは **コロンを 1 つも含まない入力に限る**。`javascript:alert(1)` の頭に https:// を
 * 足して `https://javascript:alert(1)` として通してしまう、という補完由来の抜け道を作らないため。
 * コロンを含む入力は「スキームを自分で書いた」とみなし、許可リストに無ければそのまま不許可にする。
 */
export function normalizeLinkInput(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (trimmed === '') return null;
  // ページ間リンクは https:// を補う前に判定する。補ってしまうと
  // `https:///kb/{ID}` がホスト名 `kb` の外部 URL として読まれ、壊れた絶対 URL が保存される。
  if (isInternalPageLinkHref(trimmed)) return sanitizeLinkHref(trimmed);
  if (trimmed.includes(':')) return sanitizeLinkHref(trimmed);
  return sanitizeLinkHref(`https://${trimmed}`);
}

type DocMark = NonNullable<JSONContent['marks']>[number];

/**
 * 画像ノード（type: 'image'）の attrs.src に唯一許すオブジェクトキーの接頭辞。
 * backend の kbInlineImageKeyPrefix（page_usecase.go）と同じ文字列で、保存時にサーバーが
 * 最終的な関門になる。ここではページ ID を知らない汎用関数なので接頭辞までしか見ない
 * （どのページの key かの一致は、ダウンロード URL 発行時にサーバー側で確かめる）。
 */
const KB_IMAGE_KEY_PREFIX = 'kb/';

/**
 * doc JSON を歩くときの入れ子の上限。content/marks を相互再帰で辿るため、上限が無いと
 * 極端に深い doc（数千段）で JS のコールスタックを使い切って例外になる。
 * エディタが実際に作れる深さ（数十段）よりずっと大きく取り、通常の文書には一切影響しない。
 *
 * 上限を超えた先は歩くのをやめ、その部分木をそのまま返す（サニタイズを諦める）。
 * その深さの doc は敵対的な入力以外で作られる見込みが無く、この関数がクラッシュしないことの
 * ほうが「深いところまで洗う」ことより優先度が高い。backend（page_usecase.go）側は保存時に
 * もっと厳しい上限（30 段）でそもそも保存を拒否するため、通常の経路ではここまで到達しない。
 */
const MAX_DOC_WALK_DEPTH = 300;

/** isPlainObject は「JSON のオブジェクトとして扱える値か」を返す（配列・null は除く）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 埋め込み画像の data: URI（"data:image/…"）の接頭辞。ImageView.tsx が最初から
 * サポートしている形（story・既存データとの互換）なので、image の src としてだけ許す。
 *
 * href の許可リスト（ALLOWED_LINK_PROTOCOLS）には data: を含めない ——
 * `data:text/html,…` はナビゲートするとページ全体を差し替えられるが、
 * `<img src>` の文脈では埋め込みスクリプト（SVG を含む）はブラウザの仕様上実行されないため、
 * image に限れば同じ危険は無い。MIME を image/* に絞り、それ以外（text/html 等）は弾く。
 */
const DATA_IMAGE_URI_PATTERN = /^data:image\//i;

/**
 * sanitizeImageSrc は画像の attrs.src を「使ってよい形」に正規化する。許可できないものは null。
 *
 * 保管庫の key（"kb/" 接頭辞）と埋め込み画像（data:image/…）はそのまま許す。それ以外は
 * href と同じ許可リスト（sanitizeLinkHref）を通す — 外部 URL の画像を tiptap の既定スキーマ・
 * story・既存データとの互換のために許すが、リンクと同じ危険スキームは同様に弾く。
 *
 * sanitizeDocLinks（doc JSON を洗う）に加え、ImageView.tsx（描画直前の保険）・
 * imageInsertion.ts（アップロード戻り値の検査）からも呼ぶ共有ロジックなのでここに置く。
 */
export function sanitizeImageSrc(src: unknown): string | null {
  if (typeof src !== 'string') return null;
  if (src.startsWith(KB_IMAGE_KEY_PREFIX)) return src;
  const folded = foldAsUrlParserWould(src);
  if (DATA_IMAGE_URI_PATTERN.test(folded)) return folded;
  return sanitizeLinkHref(src);
}

/**
 * sanitizeDocLinks は doc JSON を歩いて、許可できない href のリンクマークを取り除き
 * （マークだけを外して文字は残す。読み手から本文が消えないようにするため）、
 * 許可できない画像 src を持つノードを取り除く。許可できる値は正規化した形へ書き直す。
 *
 * なぜ「描画時に無害化する」だけでは足りないのか:
 * 入力・貼り付けの経路をエディタ側でいくら塞いでも、doc JSON は API から丸ごと差し込める。
 * 既に汚染された doc が DB にあれば、それを読み込んで保存し直すたびに危険な値が生き延びる。
 * 表示だけを直すやり方は「見えないところに攻撃文字列が残り続ける」状態を許すので、
 * 読み込み時と保存時の両方でこの関数を通し、doc そのものを綺麗にしておく。
 *
 * depth は呼び出し側が渡す必要はない（内部の再帰でだけ使う）。
 * 変更が無ければ入力と同じ参照を返す（無用なコピーを避ける）。
 */
export function sanitizeDocLinks<T extends JSONContent>(node: T, depth = 0): T {
  const nextMarks = sanitizeMarks(node.marks);
  const nextContent = depth >= MAX_DOC_WALK_DEPTH ? node.content : sanitizeContent(node.content, depth + 1);
  if (nextMarks === node.marks && nextContent === node.content) return node;

  const next: JSONContent = { ...node };
  if (nextMarks === undefined) delete next.marks;
  else next.marks = nextMarks;
  if (nextContent === undefined) delete next.content;
  else next.content = nextContent;
  return next as T;
}

/**
 * sanitizeContent は content 配列を歩く。3 つの仕事をする:
 * 1. object でない要素（null・数値など。壊れた doc や敵対的な入力が混じりうる）を落とす
 * 2. 画像ノードで許可できない src を持つものをノードごと落とす
 * 3. 残りを再帰的に sanitizeDocLinks へ通す
 */
function sanitizeContent(content: JSONContent[] | undefined, depth: number): JSONContent[] | undefined {
  if (!Array.isArray(content)) return content;
  let changed = false;
  const next: JSONContent[] = [];
  for (const child of content) {
    if (!isPlainObject(child)) {
      changed = true;
      continue;
    }
    if (child.type === 'image') {
      const src = sanitizeImageSrc((child as JSONContent).attrs?.src);
      if (src === null) {
        changed = true;
        continue;
      }
      const fixed =
        src === (child as JSONContent).attrs?.src
          ? (child as JSONContent)
          : { ...(child as JSONContent), attrs: { ...(child as JSONContent).attrs, src } };
      const sanitized = sanitizeDocLinks(fixed, depth);
      if (sanitized !== child) changed = true;
      next.push(sanitized);
      continue;
    }
    const sanitized = sanitizeDocLinks(sanitizeKnownNodeAttrs(child as JSONContent), depth);
    if (sanitized !== child) changed = true;
    next.push(sanitized);
  }
  return changed ? next : content;
}

/**
 * sanitizeMarks は marks 配列を歩く。object でない要素を落としたうえで、
 * link マークだけ href を検査する（他のマークは素通し）。
 */
function sanitizeMarks(marks: DocMark[] | undefined): DocMark[] | undefined {
  if (!Array.isArray(marks)) return marks;
  let changed = false;
  const next: DocMark[] = [];
  for (const mark of marks) {
    if (!isPlainObject(mark)) {
      changed = true;
      continue;
    }
    if (mark.type !== LINK_MARK_NAME) {
      next.push(mark as DocMark);
      continue;
    }
    const href = sanitizeLinkHref((mark as DocMark).attrs?.href);
    if (href === null) {
      // 許可できないリンクはマークごと落とす（テキストは content 側に残る）。
      changed = true;
      continue;
    }
    if (href === (mark as DocMark).attrs?.href) {
      next.push(mark as DocMark);
      continue;
    }
    changed = true;
    next.push({ ...(mark as DocMark), attrs: { ...(mark as DocMark).attrs, href } });
  }
  if (!changed) return marks;
  // マークが 1 つも残らなかったら marks 自体を落とす。tiptap の getJSON も空の marks は書かないので、
  // 空配列を残すと「同じ内容なのに JSON が違う」状態になり、保存の差分検出や往復比較が濁る。
  return next.length > 0 ? next : undefined;
}

/** 図の書式の許可リスト（backend の domain.ValidDiagramEngines と同じ）。 */
const DIAGRAM_ENGINES: readonly string[] = ['mermaid'];

/** 注意書きの種類の許可リスト（backend の domain.ValidCalloutKinds と同じ）。 */
const CALLOUT_KINDS: readonly string[] = ['info', 'warning', 'danger', 'success'];
/** 段組みの列数の範囲（backend の ColumnsMinCount / ColumnsMaxCount と同じ）。 */
const COLUMNS_COUNT_RANGE = { min: 2, max: 3 };

/**
 * sanitizeKnownNodeAttrs は容器（注意書き・折りたたみ・段組み）と数式・図の attrs を許した形に直す。
 * 保存側（normalizeBlockAttrs）と同じ規則 — kind は許可リスト（知らない値は info）、open は
 * 真偽だけ、count は 2〜3 の整数だけ、数式の latex は文字列（でなければ空の式）、図の engine は
 * 許可リスト（知らない値は mermaid）。見た目の手がかりなので落とす理由にはせず、直して通す。
 * 数式の長さはここでは切らない（黙って切ると式が壊れる。上限超えは保存側が断り、入力欄は
 * maxLength で、貼り付けは parseHTML で止める）。変更が無ければ入力と同じ参照を返す。
 */
function sanitizeKnownNodeAttrs(node: JSONContent): JSONContent {
  if (node.type === 'blockMath' || node.type === 'inlineMath') {
    if (typeof node.attrs?.latex === 'string') return node;
    return { ...node, attrs: { ...node.attrs, latex: '' } };
  }
  if (node.type === 'diagram') {
    const engine = node.attrs?.engine;
    if (typeof engine === 'string' && DIAGRAM_ENGINES.includes(engine)) return node;
    return { ...node, attrs: { ...node.attrs, engine: 'mermaid' } };
  }
  if (node.type === 'callout') {
    const kind = node.attrs?.kind;
    if (typeof kind === 'string' && CALLOUT_KINDS.includes(kind)) return node;
    return { ...node, attrs: { ...node.attrs, kind: 'info' } };
  }
  if (node.type === 'details') {
    const open = node.attrs?.open;
    if (open === undefined || typeof open === 'boolean') return node;
    const attrs = { ...node.attrs };
    delete attrs.open;
    return { ...node, attrs };
  }
  if (node.type === 'columns') {
    const count = node.attrs?.count;
    if (
      count === undefined ||
      (typeof count === 'number' && Number.isInteger(count) && count >= COLUMNS_COUNT_RANGE.min && count <= COLUMNS_COUNT_RANGE.max)
    ) {
      return node;
    }
    const attrs = { ...node.attrs };
    delete attrs.count;
    return { ...node, attrs };
  }
  return node;
}
