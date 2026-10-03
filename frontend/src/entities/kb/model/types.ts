import type { GrantRole } from '@/entities/workspace/@x/kb';

/**
 * ナレッジの型。backend の `kb*Response`（`backend/internal/handler/kb_*_handler.go`）と 1:1。
 *
 * 3 つの入れ子で出来ている。
 *
 *   ワークスペース  会社の境界。同時に 2 つ見る場面が無いので UI では「切り替え」で表す
 *     └ スペース    部署や個人の区画。同時に見たいので UI では「見出し」で並べる
 *         └ ページ  木。親を持ち、兄弟の並び順は配列の順序で表される
 */

/** スペース 1 件。key はワークスペース内で一意の短い識別子。 */
export interface KbSpace {
  id: string;
  key: string;
  name: string;
  /** サイドバーの節分け。workspace = チーム（全員） / private = プライベート（付与された人だけ）。 */
  visibility: 'workspace' | 'private';
  createdAt: string;
}

/**
 * スペースの所在（/kb/spaces/:spaceId の応答）。URL にワークスペースを出さないスペースの画面が、
 * どのワークスペースのスペースかを知るために引く。スペースがワークスペースをまたいで動くことは無い。
 */
export interface KbSpaceLocation {
  workspaceSlug: string;
  workspaceName: string;
  space: KbSpace;
}

/**
 * ページのアイコン。いまは絵文字だけ（`type` を持たせておくのは、いつか他の種類
 * （アップロード画像など）が増えたときに判別できるようにするため）。
 */
export interface KbIcon {
  type: 'emoji';
  value: string;
}

/**
 * 「最終編集者」の参照 1 件。
 *
 * name は表示名で、**引けなければ空文字**（backend が行を落とさずそう返す）。
 */
export interface KbEditorRef {
  userId: number;
  name: string;
}

/**
 * ページ 1 件（本文は含まない）。
 *
 * **並び順のキー（position）は入っていない。** backend が意図的に返していない。
 * 分数インデックスの整数部は末尾追加のたびに 1 ずつ増えるので、a0 と a3 が見えて
 * a1 a2 が見えなければ、その間に 2 枚あることがそのまま読めてしまうため。
 *
 * 並び順は**配列の順序そのもの**が持っている。ここで並べ替えないこと。
 */
export interface KbPage {
  id: string;
  spaceId: string;
  parentId: string | null;
  title: string;
  createdByUserId: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 絵文字の見出し。未設定は null。 */
  icon: KbIcon | null;
  lastEditedByUserId: number | null;
  /** 公開範囲バッジの元（段 13）。'public' | 'space'（既定） | 'private'。 */
  visibility: 'public' | 'space' | 'private';
}

/**
 * 検索結果 1 件（KbPage に一致箇所の情報を足したもの）。
 *
 * matchField が "title" なら題名の一致（従来の検索と同じ）。"body" なら本文中の一致で、
 * このときだけ excerpt（一致箇所の前後 30 文字程度の抜粋）・matchStart・matchLen が付く。
 * matchStart / matchLen は **excerpt 文字列内での**一致開始位置と長さ（ページ本文全体での
 * 位置ではない）— 抜粋の中の一致箇所を `<mark>` 等で強調するために使う。
 */
export type KbSearchResult = KbPage &
  ({ matchField: 'title' } | { matchField: 'body'; excerpt: string; matchStart: number; matchLen: number });

/**
 * ツリーの 1 ノード。
 *
 * hasHiddenChildren は「この段の直下に、自分には見えないページが在るか」。
 * **枚数も題名も返ってこない。**
 *
 * 見えないページをただ消すと、木に穴が空いた理由が分からず「壊れている」と読まれるので、
 * 居ることだけを示す。枚数を出さないのは、利用者にとって「2 枚」と「7 枚」の差が行動を
 * 何も変えないのに、伏せた量に比例して漏れる情報が増えるため。
 *
 * なお**見えない親の配下は印にも出ない**（backend 側で見ていない。見ると
 * 「見えない枝の中にも何かある」ことまで漏れるため）。
 */
export interface KbPageTreeNode {
  page: KbPage;
  children: KbPageTreeNode[];
  hasHiddenChildren: boolean;
  /**
   * 親がアーカイブ済みか。**アーカイブ済みの一覧でだけ意味を持つ**（現役では常に false）。
   *
   * これは事実であって判断ではない。復帰できるかの規則は「親がアーカイブ中なら断る」で、
   * backend の usecase が持っている。ここで canRestore という名前にすると、
   * 同じ規則がフロントにも写り、必ずずれる。
   */
  parentArchived: boolean;
}

/**
 * ツリー取得の応答全体。
 *
 * hasHiddenChildren はスペース直下に見えないページが在るか。
 * **1 件も見えないスペースでは必ず false** になる（存在しないスペースと撃ち分けると、
 * 応答の差からスペース ID の実在を数え上げられてしまうため）。
 */
export interface KbPageTree {
  pages: KbPageTreeNode[];
  hasHiddenChildren: boolean;
}

/**
 * ページのメタ情報と本文（ProseMirror の doc JSON）の組。
 *
 * doc の中身は tiptap のスキーマそのもの。型は shared/lib/richDoc の RichDocContent と
 * 同じものを指すが、API の応答は unknown で受け、描画する画面側で検証する（isRichDoc）。
 */
export interface KbPageDoc {
  page: KbPage;
  doc: unknown;
}

/**
 * CommentAnchor は、コメントが本文のどこを指しているかの写し（錨）。
 *
 * 位置の計算は本文エディタ（pages/kb）が行い、ここは API と画面が受け渡す形だけを決める。
 * ブロックの id はエディタが各ブロックに振る安定した id（保存のたびに同じ id を送り続ける
 * 限り、サーバー側の行が保たれる）。
 */
export interface CommentAnchor {
  /** 錨を張ったブロックの安定 id（attrs.id）。 */
  blockId: string;
  /** ブロックの内容開始位置からの相対オフセット（開始側）。 */
  anchorFrom: number;
  /** ブロックの内容開始位置からの相対オフセット（終了側）。 */
  anchorTo: number;
  /** 選択していた文字列（前後の空白を trim 済み）。人が読める手がかり。 */
  quote: string;
}

/**
 * /kb/{pageId} の解決結果。URL はページ ID しか持たないので、
 * 所属ワークスペースの slug と編集可否をサーバーが一緒に返す。
 */
export interface KbResolvedPage {
  workspaceSlug: string;
  /** ワークスペースの表示名（パンくず用）。 */
  workspaceName: string;
  page: KbPage;
  doc: unknown;
  canEdit: boolean;
  /**
   * このページではなく**ワークスペース全体**への書き込み資格。雛形の作成・削除は
   * ワークスペース全体の編集者(editor)以上で判定するため、こちらで出し分ける。
   *
   * canEdit はページ単位の実効権限（付与の合成）なので、ページ/スペース限定の編集権限しか
   * 持たない人には true でも、workspaceCanEdit は false になり得る（雛形関連のボタンを
   * 「押せるが403になる」状態で出さないための旗）。
   */
  workspaceCanEdit: boolean;
  /**
   * 閲覧できる祖先だけが根から順に入る（パンくず用）。
   * 見えない祖先は行ごと無い — 木と同じ規則で、穴があき得る。
   */
  ancestors: KbAncestorRef[];
  /** 本文を最後に保存した人。まだ保存の記録が無ければ null、不明なユーザーでは名前が空文字。 */
  lastEditedBy: KbEditorRef | null;
  /** 最終編集の日時（= page_snapshots.built_at）。lastEditedBy と対になる。 */
  lastEditedAt: string | null;
  /**
   * カバー画像。未設定は null。**一覧・木の KbPage には出てこない**（N+1 回避のため、
   * backend は一覧応答では解決しない — このページ単体の解決応答でだけ入る）。
   */
  cover: KbResolvedCover | null;
  /**
   * このページにコメントできるか（新規スレッド作成・返信・解決・再開）。
   *
   * canEdit とは別の軸 — 編集はできないが読める・コメントできる相手が居る想定
   * （既定の役割 commenter はコメントだけできて本文は編集できない）。
   * false でもコメントパネル自体（読むこと）は誰でも見られる。書き込み系の UI だけを隠す。
   */
  canComment: boolean;
  /**
   * ページに付いたラベル（段 8。チケットの labels をスペース単位で共有する）。0 件なら空の配列。
   */
  labels: KbLabel[];
  /** このページを見たことのある人数（段 2。延べ回数ではない）。 */
  viewCount: number;
  /** 自分がこのページをお気に入りに入れているか。 */
  isFavorite: boolean;
}

/**
 * ページに付いたラベル 1 件（段 8）。チケットの `labels`（`entities/ticket` の `Label`）と
 * 同じ表（スペースごとに定義）を参照する — ページ専用の別テーブルは無い。
 */
export interface KbLabel {
  id: string;
  spaceId: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

/** パンくず 1 段分（ページ ID と現在の題名）。 */
export interface KbAncestorRef {
  id: string;
  title: string;
}

/**
 * 解決済みのカバー画像。durable な保存形式は S3 の key（"kb/…"）だが、ここに来るのは
 * サーバーが既に署名して解決した後の一時 URL — そのまま `<img src>` に使ってよい。
 */
export interface KbResolvedCover {
  type: 'file';
  url: string;
}

/**
 * ページ本文の添付ファイル 1 件（POST .../attachments の応答）。本文の attachment ノードは id を
 * attachmentId に持ち、ほかの値はサーバーが保存のたびに同じ行から書き直す表示の写し。
 * 保管庫の key は持たない（ダウンロードは押すたびに期限付き URL を取り直す）。
 */
export interface KbPageAttachment {
  id: string;
  pageId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

/**
 * 自分がアクセスできるスペース 1 件（段 14。GET /me/spaces）。
 * KbSpace と違い visibility を持たず、代わりに自分の役割を持つ。
 */
export interface KbMySpace {
  id: string;
  name: string;
  role: GrantRole;
}

/**
 * スペースに届いている権限を人に解決した 1 件（段 9。読み取り専用）。
 * via はその役割がどの経路で届いたか（direct=本人への直接付与・group=所属グループ/
 * スペース全員経由・workspace=ワークスペース全体からの継承）。
 */
export interface KbSpaceMember {
  userId: number;
  name: string;
  avatarUrl: string;
  role: GrantRole;
  via: 'direct' | 'group' | 'workspace';
}

/** お気に入りに入れたページ 1 件（段 7）。 */
export interface KbFavoritePage {
  pageId: string;
  title: string;
  icon: KbIcon | null;
  spaceId: string;
  spaceName: string;
  createdAt: string;
}

/** 本人が最近開いた、現在も閲覧できるページ。本文は含まない。 */
export interface KbRecentPage {
  pageId: string;
  workspaceSlug: string;
  title: string;
  icon: KbIcon | null;
  spaceId: string;
  spaceName: string;
  viewedAt: string;
}

/**
 * コメントの投稿者・解決者などの参照 1 件。
 *
 * name は表示名で、**引けなければ空文字**（KbEditorRef と同じ約束）。
 */
export interface KbCommentAuthorRef {
  userId: number;
  name: string;
}

/**
 * コメント 1 件。
 *
 * body は ProseMirror のインラインノードの配列（本文の RichDocContent とは別の、
 * 段落 1 つぶんの中身だけを持つ軽い形）。装飾込みの描画は今回のスコープ外で、
 * 各ノードの text フィールドだけを繋げてプレーンテキストとして表示すればよい。
 */
export interface KbComment {
  id: string;
  author: KbCommentAuthorRef;
  body: unknown[];
  createdAt: string;
  updatedAt: string;
}

/**
 * コメントスレッド 1 件。comments は作成した最初の 1 件を含む（POST 直後の応答も
 * GET 一覧の各要素も、この形で comments 配列を持つ）。
 *
 * resolvedAt が null なら未解決。解決済みでも resolvedBy が null なことはあり得る
 * （解決した本人が引けなくなった場合。行は落とさず ID 側の情報が空で来る想定）。
 *
 * blockId / anchorFrom / anchorTo / quote は「錨付きコメント」（本文の特定ブロック・
 * 文字範囲を指すコメント）だけが持つ。4 つとも省略されている（キー自体が応答に無い）
 * スレッドは page-level（ページ全体へのコメント）。backend は 4 つとも揃うかどれも
 * 無いかのどちらかでしか返さない（片方だけ、という中間状態は無い）。
 */
export interface KbCommentThread {
  id: string;
  createdBy: KbCommentAuthorRef;
  resolvedAt: string | null;
  resolvedBy: KbCommentAuthorRef | null;
  createdAt: string;
  comments: KbComment[];
  /** 錨が指すブロックの安定 id（stableBlockId.ts が保証する attrs.id）。page-level には無い。 */
  blockId?: string;
  /** ブロックの内容開始位置からの相対オフセット（開始側）。commentAnchor.ts 参照。 */
  anchorFrom?: number;
  /** ブロックの内容開始位置からの相対オフセット（終了側）。 */
  anchorTo?: number;
  /** 錨を張った時点で選択されていた文字列。編集で錨がずれても人が読める手がかりとして残る。 */
  quote?: string;
}

/**
 * 本文の保存の応答形。PUT .../content（置き換え）と POST .../versions/:seq/restore（過去の版を
 * 今の本文として復元）の両方がこの形で返す — restore は「本文を丸ごと入れ替える」という
 * 意味では置き換えと同じ操作で、backend 側も応答を共通の形にしている。
 *
 * page（題名・アイコン等）は含まない。**この操作では変わらない情報だからではなく**、
 * 呼び出し側（useKbPageDoc）が既に持っている page をそのまま使い続ける設計のため
 * （置き換え時からそうなっている。restore もその前提を崩さない）。
 */
export interface KbPageContentSaveResult {
  doc: unknown;
  builtAt: string;
  lastEditedBy: KbEditorRef | null;
  lastEditedAt: string | null;
}

/**
 * 版（バージョン）1 件（一覧要素。doc は含まない）。
 *
 * seq はページ内で作られた順に振られる番号（大小関係だけを使い、1 始まり・連番であることには
 * 依存しない — backend の採番方針が変わっても壊れないように）。note は「版を残す」で明示的に
 * 書いたメモで、空でもよい（backend が null で返す）。author は KbEditorRef と同じ形
 * （id が引けない・名前が空文字はここでも起こり得る）。
 */
export interface KbPageVersion {
  seq: number;
  author: KbEditorRef;
  note: string | null;
  createdAt: string;
}

/** 版 1 件 + その時点の本文（doc）。一覧では返らず、単体取得（GET .../versions/:seq）でだけ付く。 */
export interface KbPageVersionDetail extends KbPageVersion {
  doc: unknown;
}

/**
 * 提案 1 件。commenter（閲覧+コメントはできるが編集はできない役割）が本文を書き換えたときに、
 * blocks を直接更新する代わりに積まれる。editor 以上が採用すれば本文へ反映され、
 * 却下すれば本文は一切変わらない。
 *
 * baseSeq は提案した時点のそのページの最新版（page_versions.seq）。まだ版が 1 つも無い
 * ページへの提案では省略される。baseDoc は baseSeq が指す版の本文全体（差分表示用の
 * 付随情報 — その版が引けなければ省略されるが、それだけで提案自体の表示は止めない）。
 *
 * doc は提案後の本文全体（ProseMirror doc）。**差分は計算済みでは来ない** —
 * baseDoc と doc をこちら側で突き合わせて計算する（backend は差分を持たない設計）。
 */
export interface KbPageSuggestion {
  id: string;
  baseSeq?: number;
  doc: unknown;
  status: 'open' | 'accepted' | 'rejected';
  author: KbEditorRef;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: KbEditorRef;
  baseDoc?: unknown;
}

/**
 * テンプレート 1 件（一覧用の軽い形。doc は含まない）。
 *
 * spaceId が null ならワークスペース全体で使えるテンプレート、値があれば
 * そのスペース専用。一覧 GET（?spaceId=）は「そのスペース専用」+「ワークスペース全体」の
 * 両方を返す想定 — backend 未実装の段階での想定であり確定ではない（要すり合わせ）。
 */
export interface KbPageTemplate {
  id: string;
  name: string;
  icon: KbIcon | null;
  spaceId: string | null;
  createdAt: string;
}
