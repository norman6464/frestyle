/**
 * ナレッジの型。backend の `kb*Response`（`backend/internal/handler/kb_*_handler.go`）と 1:1。
 *
 * 3 つの入れ子で出来ている。
 *
 *   ワークスペース  会社の境界。同時に 2 つ見る場面が無いので UI では「切り替え」で表す
 *     └ スペース    部署や個人の区画。同時に見たいので UI では「見出し」で並べる
 *         └ ページ  木。親を持ち、兄弟の並び順は配列の順序で表される
 */

/** ワークスペース 1 件。内部 UUID は外に出さず、URL も API も slug で指す。 */
export interface KbWorkspace {
  slug: string;
  name: string;
  createdAt: string;
  /** 自分がこのワークスペースの admin か。削除操作を出してよいかの判定に使う。 */
  canManage: boolean;
}

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
 * name は表示名で、**引けなければ空文字**（backend が行を落とさずそう返す。
 * KbGrantablePrincipal と同じ約束）。
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
  parentId?: string;
  title: string;
  createdByUserId: number;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  /** 未設定は null（明示的に外した）と undefined（旧応答）の両方であり得る。 */
  icon?: KbIcon | null;
  lastEditedByUserId?: number;
  /**
   * 公開範囲バッジの元（段 13）。'public' | 'space'（既定） | 'private'。
   * backend は常に返すが、旧応答（デプロイ順）を踏まえ optional にしておく — 無ければ
   * 既定の 'space' として扱う。
   */
  visibility?: 'public' | 'space' | 'private';
}

/**
 * 検索結果 1 件（KbPage に一致箇所の情報を足したもの）。
 *
 * matchField が "title" なら題名の一致（従来の検索と同じ）。"body" なら本文中の一致で、
 * このときだけ excerpt（一致箇所の前後 30 文字程度の抜粋）・matchStart・matchLen が付く。
 * matchStart / matchLen は **excerpt 文字列内での**一致開始位置と長さ（ページ本文全体での
 * 位置ではない）— 抜粋の中の一致箇所を `<mark>` 等で強調するために使う。
 *
 * 4 つとも任意（omitempty 相当）。バックエンドの実装がまだ揺れている段階のフィールドで、
 * 旧応答（4 つとも無い）でも画面が落ちないようにする。
 */
export interface KbSearchResult extends KbPage {
  matchField?: 'title' | 'body';
  excerpt?: string;
  matchStart?: number;
  matchLen?: number;
}

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
 * doc の中身は tiptap のスキーマそのもの。型は shared/ui/RichTextEditor の RichDocContent と
 * 同じものを指すが、entities から shared/ui の部品型に依存させたくないので unknown で受け、
 * 描画する画面側で検証する（isRichDoc）。
 */
export interface KbPageDoc {
  page: KbPage;
  doc: unknown;
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
   * このページの権限を変えられるか（共有ボタンを出すかの判定に使う）。
   *
   * ナレッジは付与（grant）だけで解決する木で、打ち消す層を持たない。したがって
   * canEdit を弱める例外も無く、canManage は上位から届く権限をそのまま見る値になる。
   */
  canManage: boolean;
  /**
   * このページではなく**ワークスペース全体**への書き込み資格。雛形の作成・削除は
   * ワークスペース全体の編集者(editor)以上で判定するため、こちらで出し分ける。
   *
   * canEdit はページ単位の実効権限（付与の合成）なので、ページ/スペース限定の編集権限しか
   * 持たない人には true でも、workspaceCanEdit は false になり得る（雛形関連のボタンを
   * 「押せるが403になる」状態で出さないための旗。旧応答（デプロイ順）では undefined）。
   */
  workspaceCanEdit?: boolean;
  /**
   * 閲覧できる祖先だけが根から順に入る（パンくず用）。
   * 見えない祖先は行ごと無い — 木と同じ規則で、穴があき得る。
   */
  ancestors: KbAncestorRef[];
  /** 本文を最後に保存した人。旧応答（デプロイ順）や不明なユーザーでは無い/空文字。 */
  lastEditedBy?: KbEditorRef | null;
  /** 最終編集の日時（= page_snapshots.built_at）。lastEditedBy と対になる。 */
  lastEditedAt?: string | null;
  /**
   * カバー画像。未設定は null（明示的に外した）と undefined（旧応答）の両方があり得る
   * （KbIcon と同じ約束）。**一覧・木の KbPage には出てこない**（N+1 回避のため、
   * backend は一覧応答では解決しない — このページ単体の解決応答でだけ入る）。
   */
  cover?: KbResolvedCover | null;
  /**
   * このページにコメントできるか（新規スレッド作成・返信・解決・再開）。
   *
   * canEdit とは別の軸 — 編集はできないが読める・コメントできる相手が居る想定
   * （既定の役割 commenter はコメントだけできて本文は編集できない）。
   * false でもコメントパネル自体（読むこと）は誰でも見られる。書き込み系の UI だけを隠す。
   */
  canComment: boolean;
  /**
   * ページに付いたラベル（段 8。チケットの labels をスペース単位で共有する）。
   * 0 件でも配列（旧応答（デプロイ順）だけ undefined になり得る）。
   */
  labels?: KbLabel[];
  /**
   * このページを見たことのある人数（段 2。延べ回数ではない）。
   * 旧応答（デプロイ順）では undefined。
   */
  viewCount?: number;
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

/** 既定の役割。強い順に admin > editor > commenter > viewer。 */
export type KbGrantRole = 'admin' | 'editor' | 'commenter' | 'viewer';

/**
 * 自分がアクセスできるスペース 1 件（段 14。GET /me/spaces）。
 * KbSpace と違い visibility を持たず、代わりに自分の役割を持つ。
 */
export interface KbMySpace {
  id: string;
  name: string;
  role: KbGrantRole;
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
  role: KbGrantRole;
  via: 'direct' | 'group' | 'workspace';
}

/** お気に入りに入れたページ 1 件（段 7）。 */
export interface KbFavoritePage {
  pageId: string;
  title: string;
  icon?: KbIcon | null;
  spaceId: string;
  spaceName: string;
  createdAt: string;
}

/**
 * ページ自身に張られた既定の役割 1 件。
 *
 * **「このページを見られる人」ではない。** 返るのはこの段で足した行だけで、
 * ワークスペース / スペース / 祖先のページから届いている相手は含まれない。
 * 空でも「誰も見られない」ではなく「この段では何も足していない」の意味になる。
 */
export interface KbPageGrant {
  pageId: string;
  principalId: string;
  role: KbGrantRole;
  createdAt: string;
  updatedAt: string;
}

/**
 * 権限を張れる相手 1 件。
 *
 * name は表示名で、**引けなかった場合は空文字**（backend が行を落とさずそう返す）。
 * 画面もそれに合わせて行を消さない — 消すと、その相手に張った権限が一覧に出たまま
 * 選べなくなる。
 */
export interface KbGrantablePrincipal {
  id: string;
  kind: 'user' | 'group' | 'space_all';
  name: string;
}

/**
 * ワークスペースに属する人 1 件（発言での名指し用）。
 *
 * `KbGrantablePrincipal` とは別の口から来る — あちらは権限を張る相手（グループ・
 * スペース全体も含む）を返すページ管理権限つきの口、こちらは所属していれば誰でも
 * 引ける「人」だけの口（担当の表示名解決と、発言の名指しの両方がここを使う）。
 * userId は名指し（TicketCommentSegment の mention）が指す ID、principalId は
 * 担当の割り当て先が指す ID で、用途が違うので両方持つ。
 */
export interface KbWorkspaceMember {
  principalId: string;
  userId: number;
  /** 表示名。引けなかった場合は空文字（行は落とさない）。 */
  name: string;
}

/**
 * メンバー管理画面（段 7）向けの 1 件。KbWorkspaceMember と違い admin だけが読める口から来る。
 *
 * `KbWorkspaceMember` を単純に拡張しない — あちらは「停止中は含まない」契約の一覧で、
 * こちらは逆に停止中こそ復帰させる対象として出す必要があるため、由来の異なる別の型として持つ。
 */
export interface KbAdminWorkspaceMember {
  principalId: string;
  userId: number;
  name: string;
  accountStatus: 'active' | 'suspended';
  avatarUrl: string;
  statusMessage: string;
  /**
   * ワークスペース全体の既定役割。backend は role を持たない相手ではキー自体を返さない
   * （omitempty）ので、無い = undefined として扱う（null ではない）。
   */
  role?: KbGrantRole;
}

/**
 * コメントの投稿者・解決者などの参照 1 件。
 *
 * name は表示名で、**引けなければ空文字**（KbEditorRef / KbGrantablePrincipal と同じ約束）。
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
  lastEditedBy?: KbEditorRef | null;
  lastEditedAt?: string | null;
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
 * spaceId が無い（null/undefined）ならワークスペース全体で使えるテンプレート、値があれば
 * そのスペース専用。一覧 GET（?spaceId=）は「そのスペース専用」+「ワークスペース全体」の
 * 両方を返す想定 — backend 未実装の段階での想定であり確定ではない（要すり合わせ）。
 */
export interface KbPageTemplate {
  id: string;
  name: string;
  icon?: KbIcon | null;
  spaceId?: string | null;
  createdAt: string;
}
