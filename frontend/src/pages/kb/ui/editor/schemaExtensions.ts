import { getSchema, mergeAttributes, Node } from '@tiptap/core';
import type { AnyExtension, Extensions } from '@tiptap/core';
import type { NodeType } from '@tiptap/pm/model';
import Blockquote from '@tiptap/extension-blockquote';
import Code from '@tiptap/extension-code';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Heading from '@tiptap/extension-heading';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import Image from '@tiptap/extension-image';
import { Link } from '@tiptap/extension-link';
import { BulletList, ListItem, OrderedList, TaskItem, TaskList } from '@tiptap/extension-list';
import Paragraph from '@tiptap/extension-paragraph';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { sanitizeCodeBlockLanguage } from './codeBlockLanguages';
import { HighlightMark, TextColorMark } from './colorMarks';
import { isAllowedLinkHref, isInternalPageLinkHref, sanitizeLinkHref } from '@/shared/lib/linkSafety';
/**
 * withBlockId は「blocks テーブルの1行になるノード」に安定した id attribute を足す。
 *
 * サーバー（backend/internal/usecase/kb/page_usecase.go の parseBlockNode）は保存のたびに
 * attrs.id を読み、有効な UUID ならそのまま使い、無ければ新規採番する。id を保つことで、
 * 同じブロックを編集して保存し直しても DB 上の行（と将来のコメントの紐付け）が保たれる。
 * DOM 上には data-block-id として出す（style/表示に影響しない、id 抽出専用の属性）。
 */
function withBlockId<T extends AnyExtension>(ext: T): T {
  // Extendable（AnyExtension の実体）の extend() は Options/Storage/Config を汎用のまま持つため、
  // 素の T のままだと addAttributes() の this に parent が現れない（Node/Mark/Extension の
  // どれかに絞られていれば NodeConfig 等が this.parent を提供するが、T は汎用のまま）。
  // 対象は常に Node 系拡張（見出し・段落・表など）なので Node として extend() を呼び、
  // 戻り値だけ T へ戻す（withImageView と同じ「型がうまく収まらない箇所だけ丸める」前例）。
  return (ext as unknown as Node).extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        id: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute('data-block-id'),
          renderHTML: (attributes: Record<string, unknown>) =>
            typeof attributes.id === 'string' && attributes.id
              ? { 'data-block-id': attributes.id }
              : {},
        },
      };
    },
  }) as unknown as T;
}

/**
 * withSafeCodeLanguage は codeBlock の language 属性を許可リストで検査してから使う。
 *
 * 素の CodeBlockLowlight（実体は @tiptap/extension-code-block）は language をそのまま
 * class 名（"language-" + language）に埋め込む箇所を 3 つ持ち、そのどれも NodeView
 * （CodeBlockView.tsx。編集画面の実際の描画）を経由しない:
 *
 *   1. parseHTML（属性単位）— 貼り付けた HTML の <pre> の子要素の classList から読む
 *   2. renderHTML（属性単位）— 1 の値を <pre> 自身の class として書き戻す
 *   3. renderHTML（ノード単位。extension-code-block の toDOM 相当）— node.attrs.language を
 *      直接読み、内側の <code class="language-…"> を組み立てる。属性単位の 2 とは別経路で、
 *      2 をいくら直しても素通しされる（実際に検証済み: 2 だけ直した状態では、貼り付け直後の
 *      正規化は効くが editor.getHTML() の <code> 側にだけ生の値が残った）
 *
 * CodeBlockView.tsx は編集画面の描画だけをカバーするので、ここで 1〜3 を塞ぎ、貼り付け・
 * コピー・将来の HTML 書き出し（editor.getHTML() 等、NodeView を経由しない経路）でも
 * 同じ許可リストが効くようにする（エディタの状態そのものに不正な language 値を持たせない）。
 *
 * 「見つからなかった／未設定」はそのまま通す。既定のハイライト無しの扱いは
 * CodeBlockLowlight 自身の defaultLanguage オプションに任せ、ここでは
 * 「値がある場合にだけ許可リストへ通す」ことに徹する。
 */
function withSafeCodeLanguage<T extends AnyExtension>(ext: T): T {
  return (ext as unknown as Node).extend({
    addAttributes() {
      const parentAttrs = this.parent?.() as
        | Record<string, { parseHTML?: (element: HTMLElement) => unknown }>
        | undefined;
      const parseLanguageFromHTML = parentAttrs?.language?.parseHTML;
      return {
        ...parentAttrs,
        language: {
          default: null,
          parseHTML: (element: HTMLElement) => {
            const raw = parseLanguageFromHTML?.(element);
            return typeof raw === 'string' ? sanitizeCodeBlockLanguage(raw) : raw;
          },
          renderHTML: (attributes: Record<string, unknown>) =>
            attributes.language
              ? { class: `language-${sanitizeCodeBlockLanguage(attributes.language)}` }
              : {},
        },
      };
    },
    // ノード単位の renderHTML（上のコメントの 3）。親（extension-code-block）の実装を
    // そのまま写し、node.attrs.language を渡す直前にだけ許可リストへ通す
    // （options.languageClassPrefix・HTMLAttributes のマージ方は親と同じに保つ）。
    renderHTML({ node, HTMLAttributes }) {
      const language = node.attrs.language ? sanitizeCodeBlockLanguage(node.attrs.language) : null;
      return [
        'pre',
        mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
        ['code', language ? { class: `${this.options.languageClassPrefix}${language}` } : {}, 0],
      ];
    },
  }) as unknown as T;
}

/**
 * lowlight のインスタンス（highlight.js の common 言語 37 種を登録）。
 * codeBlock スキーマを configure する本モジュールが所有する。エディタ側では
 * トークンの配色に app 全体へ import 済みの Atom One Light テーマ（.hljs-*）が当たる。
 */
export const lowlight = createLowlight(common);

/**
 * CombinableCode は他のマークと共存できるインラインコード。
 *
 * 既定の Code は `excludes: '_'`（＝他の全マークを排他）で、コードを掛けると
 * 太字・斜体・下線・打ち消しがすべて外れてしまう。ナレッジでは「コード＋太字」等を
 * 重ねたい場面があるため、排他指定を解いて併用できるようにする。マーク名は 'code' のまま。
 */
const CombinableCode = Code.extend({ excludes: '' });

/**
 * リンクを描画するときに必ず付ける固定属性。
 *
 * - `target="_blank"`: 書きかけの本文があるタブを潰さないよう、別タブで開く。
 * - `rel="noopener"`: 開いた先から `window.opener` 越しに元のタブを別ページへ差し替えられる
 *   （reverse tabnabbing ＝ 偽のログイン画面へのすり替え）のを防ぐ。
 * - `rel="noreferrer"`: 遷移先に Referer（＝社内ページの URL）を渡さない。
 * - `rel="nofollow"`: 利用者が自由に書ける外部リンクへ検索評価を渡さない（スパム対策）。
 *
 * 要点は、これらを **doc の attrs に持たせず、描画のたびに固定で付ける**こと。
 * tiptap の既定は target / rel を「マークの属性」として doc に保存するため、
 * `<a href="…" rel="" target="_self">` を貼り付けるだけでその値が保存され、
 * たった 1 行の細工で上の防御が外れてしまう。描画時に固定すれば、保存内容が何であれ必ず付く。
 */
const LINK_RENDER_ATTRIBUTES: Record<string, string> = {
  target: '_blank',
  rel: 'noopener noreferrer nofollow',
};

/**
 * SafeLink はリンクマーク（`link`）。href に許可スキームを明示した形で固めてある。
 *
 * リンクの href は利用者が自由に書けるので、そのまま通すと `javascript:alert(1)` のような
 * 「押すとスクリプトが走る URL」を仕込めてしまう（XSS）。塞ぐべき経路は 3 つあり、
 * 1 つでも空いていれば残りを固めても意味がない。
 *
 *   1. 入力（打ち込み・autolink）    → `isAllowedUri` を差し替えて Link 拡張の全判定を自前にする
 *   2. 貼り付け（HTML の取り込み）   → `href` の `parseHTML` でも同じ関数を通す
 *   3. 保存・再読込の往復             → doc JSON 側を `sanitizeDocLinks`（shared/lib/linkSafety）で洗う。
 *                                       これは RichTextEditor が担当する
 *
 * ここで押さえるのは 1 と 2、そして「表示の最後の砦」としての `renderHTML`。
 * 3 は doc JSON が API 経由で丸ごと差し込めるため、エディタの入力経路だけを見ても塞げない。
 */
const SafeLink = Link.configure({
  // 入力経路: URL を打って空白などで区切ると自動でリンクになる。
  autolink: true,
  // `[文字](URL)` という Markdown 記法も入力・貼り付けから拾う（href の可否は isAllowedUri が見る）。
  markdownLinks: true,
  // スキームを省いて `example.com` と書かれたときに補うスキーム。既定は 'http' なので https にする。
  defaultProtocol: 'https',
  // protocols は linkify に「これも URL として認識してよい」と教える口であって、安全判定ではない。
  // 判定は下の isAllowedUri（＝ ALLOWED_LINK_PROTOCOLS）へ一本化したいのでここは空のままにする。
  protocols: [],
  // 【安全判定の一本化】tiptap の既定判定を丸ごと差し替える。
  // 既定は ftp/ftps/callto/sms/cid/xmpp なども、さらに「スキームが無い文字列」も通す。
  // つまり許可範囲がライブラリの都合で決まり、版が上がると黙って広がりうる。
  // Link 拡張は入力・貼り付け・setLink/toggleLink・HTML 解析・描画のすべてでこの関数を呼ぶので、
  // ここを自前の許可リストに差し替えれば、経路ごとの取りこぼしが起きにくくなる。
  isAllowedUri: (uri) => isAllowedLinkHref(uri),
  // 編集中にリンクを踏んで画面が飛ぶのを防ぐ（クリックはキャレット移動として扱う）。
  // 読み取り専用（editable=false）では tiptap のクリックハンドラが降りるので、素の <a> として開く。
  openOnClick: false,
}).extend({
  addAttributes() {
    // 既定の Link は href / target / rel / class / title を doc に保存する。
    // target / rel / class は保存せず描画時に固定する（LINK_RENDER_ATTRIBUTES のコメント参照）ので、
    // doc に残すのは href と title だけにする。保存する値が減るほど、細工できる余地も減る。
    return {
      href: {
        default: null,
        // 貼り付けた HTML から href を読む経路。ここでも同じ関数を通し、
        // 通らない値は null にして「href の無いリンク」に落とす（マーク自体は
        // 親の parseHTML ルールが isAllowedUri で弾くので、実際には二重の壁になる）。
        parseHTML: (element) => sanitizeLinkHref(element.getAttribute('href')),
      },
      title: { default: null },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const href = sanitizeLinkHref(HTMLAttributes.href);
    if (href === null) {
      // 表示経路の最後の砦。万一 doc に許可できない href が残っていても <a> にはしない。
      // href="" の <a> にすると「押せるのにどこへも行かない要素」が残るため、span で出す。
      return ['span', {}, 0];
    }
    // ページ間リンク（/kb/…）は同じタブで開く。_blank と rel の束は外部サイト向けの防御
    // （tabnabbing・Referer 漏れ・スパム評価）で、同一アプリ内の遷移には当てはまらない。
    const attributes: Record<string, string> = isInternalPageLinkHref(href)
      ? { href }
      : { ...LINK_RENDER_ATTRIBUTES, href };
    if (typeof HTMLAttributes.title === 'string' && HTMLAttributes.title !== '') {
      attributes.title = HTMLAttributes.title;
    }
    return ['a', attributes, 0];
  },
});

/**
 * PageRef は「ページ参照」— ナレッジのページを指すインラインの 1 要素（atom）。
 *
 * 文字を持たず、表示は attrs.title（**表示のための写し**）。題名の正本はページ側にあり、
 * サーバーが読み出しのたびに「読み手が閲覧できる参照だけ」現在の題名へ差し替える。
 * atom なので文字は編集できない（編集できると「題名に追従する」約束が壊れる）し、
 * Backspace で 1 要素として消える。
 *
 * href は pageId から組み立てる。pageId は貼り付けや API 由来の doc からも入るので、
 * UUID の字面（INTERNAL_PAGE_LINK_PATTERN と同じ形）を検証し、通らなければ
 * リンクにしない（押せるのにどこへも行かない要素を作らないため span で出す）。
 */
const PAGE_REF_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const PageRef = Node.create({
  name: 'pageRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      pageId: { default: null },
      title: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-page-ref]',
        // SafeLink の a[href] 規則より先に効かせる（同じ <a> に両方が一致し、
        // 既定の優先度だとリンクマークが勝って、コピー＆ペーストで参照が
        // ただのリンクに劣化する）。
        priority: 100,
        getAttrs: (element) => {
          const pageId = element.getAttribute('data-page-id');
          // ID の形をここでも検証する。貼り付けは外部の HTML からも来るので、
          // 通らないものは参照として取り込まない（この規則ごと不一致にし、
          // 後続の規則＝リンクや素の文字に落とす）。
          if (pageId === null || !PAGE_REF_UUID_PATTERN.test(pageId)) return false;
          return { pageId, title: element.textContent || null };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const pageId = typeof node.attrs.pageId === 'string' ? node.attrs.pageId : '';
    const title = typeof node.attrs.title === 'string' && node.attrs.title !== ''
      ? node.attrs.title
      : 'ページ';
    if (!PAGE_REF_UUID_PATTERN.test(pageId)) {
      return ['span', { 'data-page-ref': 'true' }, title];
    }
    // 同一アプリ内の遷移なので _blank や rel の束は付けない（SafeLink の内部リンクと同じ扱い）。
    return [
      'a',
      { 'data-page-ref': 'true', 'data-page-id': pageId, href: `/kb/${pageId}`, class: 'rte-page-ref' },
      title,
    ];
  },

  // editor.getText() やプレーンテキスト化で参照が消えないよう、題名を文字として出す。
  renderText({ node }) {
    return typeof node.attrs.title === 'string' && node.attrs.title !== ''
      ? node.attrs.title
      : 'ページ';
  },
});

/** ticketRef の状態の枠（domain.TicketStatusCategory と同じ 3 値）。 */
export const TICKET_REF_STATUS_CATEGORIES = ['todo', 'in_progress', 'done'] as const;
export type TicketRefStatusCategory = (typeof TICKET_REF_STATUS_CATEGORIES)[number];

function ticketRefStatusCategory(value: unknown): TicketRefStatusCategory | null {
  return (TICKET_REF_STATUS_CATEGORIES as readonly string[]).includes(value as string)
    ? (value as TicketRefStatusCategory)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * TicketRef は「チケット参照」— バックログのチケットを指すインラインの 1 要素（atom）。
 *
 * 文字を持たず、表示は attrs の key・title・statusName・statusCategory（**表示のための写し**）。
 * 正本はチケット側にあり、サーバーが読み出しのたびに「読み手がバックログを見られるときだけ」
 * 現在の値へ差し替え、保存時には剥がす。写しが無い参照（見られない読み手・版のプレビュー・
 * 提案の表示）は「チケット」とだけ出し、押しても 404 になる先へは誘わない（リンクにしない）。
 *
 * href は ticketId から組み立てる。pageRef と同じく UUID の字面を検証し、通らなければ
 * リンクにしない。
 */
export const TicketRef = Node.create({
  name: 'ticketRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      ticketId: { default: null },
      key: { default: null },
      title: { default: null },
      statusName: { default: null },
      statusCategory: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-ticket-ref]',
        // SafeLink の a[href] 規則より先に効かせる（PageRef と同じ理由）。
        priority: 100,
        getAttrs: (element) => {
          const ticketId = element.getAttribute('data-ticket-id');
          if (ticketId === null || !PAGE_REF_UUID_PATTERN.test(ticketId)) return false;
          return {
            ticketId,
            key: nonEmptyString(element.getAttribute('data-ticket-key')),
            title: nonEmptyString(element.getAttribute('data-ticket-title')),
            statusName: nonEmptyString(element.getAttribute('data-ticket-status')),
            statusCategory: ticketRefStatusCategory(element.getAttribute('data-ticket-category')),
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const ticketId = typeof node.attrs.ticketId === 'string' ? node.attrs.ticketId : '';
    const key = nonEmptyString(node.attrs.key);
    const title = nonEmptyString(node.attrs.title);
    const statusName = nonEmptyString(node.attrs.statusName);
    const category = ticketRefStatusCategory(node.attrs.statusCategory);
    const resolved = key !== null && title !== null;
    if (!resolved) {
      return ['span', { 'data-ticket-ref': 'true', class: 'rte-ticket-ref is-unresolved' }, 'チケット'];
    }
    const children: Array<string | unknown[]> = [
      ['span', { class: 'rte-ticket-ref-key' }, key],
      ['span', { class: 'rte-ticket-ref-title' }, title],
    ];
    if (statusName !== null) {
      children.push([
        'span',
        { class: `rte-ticket-ref-status${category ? ` is-${category}` : ''}` },
        statusName,
      ]);
    }
    const dataAttributes = {
      'data-ticket-ref': 'true',
      'data-ticket-key': key,
      'data-ticket-title': title,
      'data-ticket-status': statusName ?? undefined,
      'data-ticket-category': category ?? undefined,
    };
    if (!PAGE_REF_UUID_PATTERN.test(ticketId)) {
      return ['span', { ...dataAttributes, class: 'rte-ticket-ref' }, ...children];
    }
    // 同一アプリ内の遷移なので _blank や rel の束は付けない（PageRef と同じ扱い）。
    return [
      'a',
      { ...dataAttributes, 'data-ticket-id': ticketId, href: `/tickets/${ticketId}`, class: 'rte-ticket-ref' },
      ...children,
    ];
  },

  // editor.getText() やプレーンテキスト化で参照が消えないよう、鍵と題名を文字として出す。
  renderText({ node }) {
    const key = nonEmptyString(node.attrs.key);
    const title = nonEmptyString(node.attrs.title);
    return key !== null && title !== null ? `${key} ${title}` : 'チケット';
  },
});

/** mention の userId は users.id の 10 進文字列（サーバー・チケットの発言と同じ形）。 */
const MENTION_USER_ID_PATTERN = /^[1-9][0-9]{0,19}$/;

/**
 * KbMention は「@名指し」— ワークスペースの一員を指すインラインの 1 要素（atom）。
 *
 * 文字を持たず、表示は attrs.name（**表示のための写し**）。正本は users にあり、サーバーが
 * 読み出しのたびに現在の表示名へ差し替え、保存時には剥がす。写しが無い名指し（版のプレビュー・
 * 提案の表示・無い人）は「@ユーザー」とだけ出す。押せる先は無いので常に span。
 *
 * 通知は保存（公開）のときにサーバーが決める（前の本文に無かった人のうち、ページを見られる
 * 一員へだけ）。画面側は何も送らない。
 */
export const KbMention = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      userId: { default: null },
      name: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-mention]',
        getAttrs: (element) => {
          const userId = element.getAttribute('data-user-id');
          // 整数の字面でない値は名指しとして取り込まない（貼り付けは外部の HTML からも来る）。
          if (userId === null || !MENTION_USER_ID_PATTERN.test(userId)) return false;
          return { userId, name: nonEmptyString(element.getAttribute('data-name')) };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const userId = typeof node.attrs.userId === 'string' ? node.attrs.userId : null;
    const name = nonEmptyString(node.attrs.name);
    return [
      'span',
      {
        'data-mention': 'true',
        'data-user-id': userId ?? undefined,
        'data-name': name ?? undefined,
        class: `rte-mention${name === null ? ' is-unresolved' : ''}`,
      },
      name !== null ? `@${name}` : '@ユーザー',
    ];
  },

  // editor.getText() やプレーンテキスト化で名指しが消えないよう、@名前 を文字として出す。
  renderText({ node }) {
    const name = nonEmptyString(node.attrs.name);
    return name !== null ? `@${name}` : '@ユーザー';
  },
});

/** createSchemaExtensions の組み立てオプション。 */
export interface CreateSchemaExtensionsOptions {
  /** 画像ノードをスキーマに含めるか（既定 true）。 */
  image?: boolean;
}

/**
 * createSchemaExtensions は「ドキュメントのスキーマ（ノード/マーク名・attrs・content 式）を
 * 決める」拡張だけを組み立てる factory。
 *
 * NodeView・input rule・プレースホルダ等の表示/入力の挙動は editorExtensions.ts 側で上掛けし、
 * スキーマそのものはここ 1 か所で決める（上掛けでスキーマが変わらないことは
 * __tests__/schemaExtensions.test.ts が確かめる）。React・CSS・DOM への依存はここに置かない。
 * スキーマは保存される doc の形そのものなので、テストや契約の突き合わせから、描画の仕組み無しに
 * 組み立てられる必要がある。
 *
 * ノード/マークを足すときは必ずこの factory に足し、blocks の行になるものは withBlockId で包む。
 * 行になる種類の一覧は別に持たず、withBlockId を付けたことを唯一の印にする（isBlockRowNodeType）。
 * backend の表との一致は contracts/kb-block-types.json を介して
 * __tests__/blockTypesContract.test.ts が確かめる。
 */
export function createSchemaExtensions(
  options: CreateSchemaExtensionsOptions = {},
): Extensions {
  const { image = true } = options;

  const extensions: Extensions = [
    // StarterKit の code は排他指定、heading は levels 無制限、codeBlock はハイライトなし、
    // link は許可スキームが tiptap 既定任せのため、それぞれ無効化してこちらの拡張へ差し替える。
    // paragraph/blockquote/bulletList/orderedList/listItem/horizontalRule は StarterKit に
    // バンドルされていて addAttributes() で id を上書きできないため、個別 import を
    // withBlockId でラップしたものに差し替える（下の各行）。
    StarterKit.configure({
      heading: false,
      code: false,
      codeBlock: false,
      link: false,
      paragraph: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      horizontalRule: false,
    }),
    CombinableCode,
    // リンク。href の許可スキームを明示した SafeLink。
    SafeLink,
    // 文字色・蛍光ペン。値は色の名前だけ（colorMarks.ts）。
    TextColorMark,
    HighlightMark,
    // 見出しは 1〜3 のみ（エディタ UI・教材の章構造とも 3 段で揃える）。
    withBlockId(Heading).configure({ levels: [1, 2, 3] }),
    // 構文ハイライト付きコードブロック。ノード名は 'codeBlock' のまま既存 doc と互換。
    withBlockId(withSafeCodeLanguage(CodeBlockLowlight)).configure({ lowlight, defaultLanguage: 'plaintext' }),
    // StarterKit から切り離した基本ブロック。configure オプションは既定のまま、id だけ足す。
    withBlockId(Paragraph),
    withBlockId(Blockquote),
    withBlockId(BulletList),
    withBlockId(OrderedList),
    withBlockId(ListItem),
    withBlockId(HorizontalRule),
    // 表（GFM テーブル相当）。教材の本文とナレッジの両方で使う。
    // resizable は列幅ドラッグ UI が必要になるため、まずは固定幅で表現力を優先する。
    // TableKit ではなく個別 import: table/tableRow/tableHeader/tableCell それぞれに
    // withBlockId を適用する必要があるため。
    withBlockId(Table).configure({ resizable: false }),
    withBlockId(TableRow),
    withBlockId(TableHeader),
    withBlockId(TableCell),
    // タスクリスト（チェックボックス）。教材のチェックリスト章とナレッジの TODO で使う。
    withBlockId(TaskList),
    withBlockId(TaskItem).configure({ nested: true }),
    // ページ参照・チケット参照（インラインの atom）。題名はサーバーが読み出し時に解決する。
    // id は不要（blocks テーブルの行にならない）。
    PageRef,
    TicketRef,
    // @名指し（インラインの atom）。表示名はサーバーが読み出し時に解決する。
    KbMention,
  ];

  if (image) {
    extensions.push(withBlockId(Image).configure({ inline: false, allowBase64: false }));
  }

  return extensions;
}

/**
 * isBlockRowNodeType は、その種類のノードが blocks テーブルの 1 行になる（＝ withBlockId で
 * id 属性を持たせた）種類かを返す。
 *
 * 「どの種類が行になるか」の一覧をここ以外に持たない。withBlockId を付けたことが唯一の印なので、
 * 一覧を別に書いて同期を取る必要が無い（stableBlockId.ts と commentAnchor.ts がこれを引く）。
 * pageRef・text・hardBreak・マークは id を持たないので行にならない。
 */
export function isBlockRowNodeType(type: NodeType): boolean {
  return 'id' in (type.spec.attrs ?? {});
}

let blockRowNodeTypeNamesCache: ReadonlySet<string> | null = null;

/**
 * blockRowNodeTypeNames は行になる種類の名前の集合。ProseMirror のノードではなく doc(JSON) を
 * 歩くとき（fillMissingBlockIdsInDoc）に使う。判定は isBlockRowNodeType と同じで、スキーマを
 * 1 度だけ組み立てて控える。
 */
export function blockRowNodeTypeNames(): ReadonlySet<string> {
  if (blockRowNodeTypeNamesCache === null) {
    const schema = getSchema(createSchemaExtensions());
    blockRowNodeTypeNamesCache = new Set(
      Object.values(schema.nodes)
        .filter(isBlockRowNodeType)
        .map((type) => type.name),
    );
  }
  return blockRowNodeTypeNamesCache;
}
