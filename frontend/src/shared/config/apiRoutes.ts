/**
 * API ルート定義の単一ソース。
 *
 * 設計方針:
 * - フロント側 repository から呼び出す Go backend のエンドポイント URL を
 *   1 ファイルに集約する（旧実装は 25 repository に 166 箇所ハードコード）
 * - パラメータを取るルートは pure な関数 (`(id: number) => string`) として export
 * - パラメータ無しのルートは `as const` の string literal
 * - prefix `/api/v2` は `API_V2` として共通化し、Go backend 移行に伴う
 *   v2 → v3 のような大規模変更があった場合に 1 行で切り替え可能にする
 *
 * 追加ルール:
 * - 新規エンドポイントは backend `routes_*.go` への追加と同時にここに足す
 * - フロント実装は repository 経由で参照し、page / hook / component から
 *   直接 API パスを書かない
 *
 * Go backend 側との対応は `backend/internal/handler/router.go` 系を参照。
 */

const API_V2 = '/api/v2' as const;

/**
 * 認証（Bearer の ID トークン検証）
 *
 * backend はセッション用の Cookie を発行しない。login は Authorization: Bearer で
 * 渡した ID トークンを検証して users 行と個人ワークスペースを作る（自己サインアップ、
 * 既存ユーザーなら実質 no-op）。ログアウト・更新はどちらも発行者
 * （GCIP のクライアント SDK / ローカルの Dex）側だけで完結し、backend には対応する
 * エンドポイントが無い。
 */
export const AUTH = {
  login: `${API_V2}/auth/login`,
  me: `${API_V2}/auth/me`,
} as const;

/** プロフィール / アイコン画像 / 統計 */
export const PROFILE = {
  me: `${API_V2}/profile/me`,
  meUpdate: `${API_V2}/profile/me/update`,
  meImagePresignedUrl: `${API_V2}/profile/me/image/presigned-url`,
  /** GET /users/me/stats — 自分の使い方統計 */
  meStats: `${API_V2}/users/me/stats`,
} as const;

/** 画像アップロード（current user 名義の S3 PUT 署名 URL。リッチテキストエディタ全般で共有）*/
export const IMAGES = {
  /** POST /api/v2/rich-text/images/upload-url — {contentType} → {url, key, publicUrl} */
  uploadUrl: `${API_V2}/rich-text/images/upload-url`,
} as const;

/** 通知 */
export const NOTIFICATIONS = {
  list: `${API_V2}/notifications`,
  unreadCount: `${API_V2}/notifications/unread-count`,
  read: (notificationId: number | string) =>
    `${API_V2}/notifications/${encodeURIComponent(notificationId)}/read`,
  readAll: `${API_V2}/notifications/read-all`,
} as const;

/** 管理者ダッシュボード（会社 / 招待） */
export const ADMIN = {
  members: `${API_V2}/admin/members`,
  /** PATCH /api/v2/admin/members/:userId/active — 従業員アカウントの有効/無効 */
  memberActive: (userId: number | string) => `${API_V2}/admin/members/${encodeURIComponent(userId)}/active`,
  /** DELETE /api/v2/admin/members/:userId — 従業員の論理削除 */
  member: (userId: number | string) => `${API_V2}/admin/members/${encodeURIComponent(userId)}`,
  invitations: `${API_V2}/admin/invitations`,
  invitationById: (id: number | string) => `${API_V2}/admin/invitations/${encodeURIComponent(id)}`,
} as const;

/** 招待マジックリンク受諾フロー（認証不要） */
export const INVITATIONS = {
  validateToken: (token: string) =>
    `${API_V2}/invitations/accept/${encodeURIComponent(token)}`,
} as const;

/** 外部 URL の OGP / oEmbed メタ情報を取得するプロキシ */
export const EMBEDS = {
  oembed: `${API_V2}/embeds/oembed`,
} as const;

/**
 * ナレッジ（workspaces → spaces → pages の木）。付与（grant）だけで解決する木
 * （打ち消す層は持たない）。
 *
 * ワークスペースは URL の slug で指す（内部 UUID は外に出さない）。slug から所属を確定する
 * middleware を backend 側の group が通しているので、slug を含まないパスは一覧と作成だけ。
 */
export const KB_API = {
  /** GET — /api/v2/kb/me/recent-pages。本人が閲覧できる最近のページ（最大10件）。 */
  recentPages: `${API_V2}/kb/me/recent-pages`,
  /** GET(所属一覧) / POST(作成) — /api/v2/kb/workspaces */
  workspaces: `${API_V2}/kb/workspaces`,
  /** DELETE(削除) — /api/v2/kb/workspaces/:slug。配下ごと消える。会社のものは消せない */
  workspace: (workspaceSlug: string) => `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}`,
  /** GET — /api/v2/kb/workspaces/:slug/members。所属していれば誰でも叩ける（裸の配列で返る） */
  members: (workspaceSlug: string) => `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/members`,
  /**
   * GET — /api/v2/kb/workspaces/:slug/admin/members
   *
   * メンバー管理画面（段 7）向け。members と違い admin だけが叩ける。停止中のアカウントも
   * 含み、ワークスペース全体の役割も一緒に返す。
   */
  adminMembers: (workspaceSlug: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/admin/members`,
  /**
   * GET(一覧) / POST(email 宛に発行) — /api/v2/kb/workspaces/:slug/invitations（admin だけ）。
   * 同じ宛先に未決の招待があれば POST は再送になる。応答の token はこのときしか返らない。
   */
  invitations: (workspaceSlug: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/invitations`,
  /** DELETE(取消・冪等) — /api/v2/kb/workspaces/:slug/invitations/:invitationId（admin だけ） */
  invitation: (workspaceSlug: string, invitationId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/invitations/${encodeURIComponent(invitationId)}`,
  /** POST(再送) — .../invitations/:invitationId/resend。トークンが差し替わり、前のリンクは使えなくなる */
  invitationResend: (workspaceSlug: string, invitationId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/invitations/${encodeURIComponent(invitationId)}/resend`,
  /**
   * POST — /api/v2/kb/invitations/preview。**未認証で叩く**。{token} を本文で送り、案内
   * （誰から・どこへ・どの役割で・どの宛先へ）が返る。使えない招待は 200 の {status:"unavailable"}
   */
  invitationPreview: `${API_V2}/kb/invitations/preview`,
  /** GET — /api/v2/kb/invitations。自分宛（確認済み email 宛）の未決。email が無ければ 403 */
  myInvitations: `${API_V2}/kb/invitations`,
  /** POST — /api/v2/kb/invitations/:invitationId/accept。承諾すると所属と役割ができる */
  myInvitationAccept: (invitationId: string) =>
    `${API_V2}/kb/invitations/${encodeURIComponent(invitationId)}/accept`,
  /** POST — /api/v2/kb/invitations/:invitationId/decline */
  myInvitationDecline: (invitationId: string) =>
    `${API_V2}/kb/invitations/${encodeURIComponent(invitationId)}/decline`,
  /** DELETE(削除) — /api/v2/kb/workspaces/:slug/members/:userId。冪等 */
  member: (workspaceSlug: string, userId: number) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/members/${encodeURIComponent(userId)}`,
  /** PUT — /api/v2/kb/workspaces/:slug/members/:userId/suspend（段 7・admin だけ） */
  memberSuspend: (workspaceSlug: string, userId: number) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/members/${encodeURIComponent(userId)}/suspend`,
  /** PUT — /api/v2/kb/workspaces/:slug/members/:userId/restore（段 7・admin だけ） */
  memberRestore: (workspaceSlug: string, userId: number) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/members/${encodeURIComponent(userId)}/restore`,
  /** PUT(付与) / DELETE(取り消し) — /api/v2/kb/workspaces/:slug/grants/:principalId */
  workspaceGrant: (workspaceSlug: string, principalId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/grants/${encodeURIComponent(principalId)}`,
  /** GET(一覧) / POST(作成) — /api/v2/kb/workspaces/:slug/spaces。一覧は見えるものだけ返る */
  spaces: (workspaceSlug: string) => `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/spaces`,
  /**
   * GET(ツリー) / POST(作成) — /api/v2/kb/workspaces/:slug/spaces/:spaceId/pages
   *
   * ツリーは閲覧できるページだけを返し、見えない親の配下は現れない。
   * 代わりに各段の hasHiddenChildren に「見えないページが在るか」の有無だけが入る
   * （枚数も題名も返らない）。
   */
  pages: (workspaceSlug: string, spaceId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/spaces/${encodeURIComponent(spaceId)}/pages`,
  /** GET(本文込み) / PATCH(改名) — /api/v2/kb/workspaces/:slug/pages/:pageId */
  page: (workspaceSlug: string, pageId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}`,
  /** PUT(設定) / DELETE(解除) — /api/v2/kb/workspaces/:slug/pages/:pageId/icon */
  pageIcon: (workspaceSlug: string, pageId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/icon`,
  /**
   * POST — /api/v2/kb/workspaces/:slug/pages/:pageId/images/upload-url
   *
   * ページ本文・カバー画像向けの S3 PUT 署名 URL を発行する（current user 名義）。
   * body は {contentType, size}。durable な保存形式は応答の key そのもの
   * （"kb/<workspaceId>/<pageId>/<epochNs>.bin"）で、doc にはこの key を保存する
   * （presigned URL は期限があるので doc に書き込まない）。
   */
  pageImageUploadUrl: (workspaceSlug: string, pageId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/images/upload-url`,
  /**
   * GET — /api/v2/kb/workspaces/:slug/pages/:pageId/images/download-url?key=…
   *
   * doc に保存された key を表示用の期限付き URL へ解決する。存在しない/参照されていない
   * key は 404 になり得る。
   */
  pageImageDownloadUrl: (workspaceSlug: string, pageId: string, key: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/images/download-url?key=${encodeURIComponent(key)}`,
  /** PUT(設定) / DELETE(解除) — /api/v2/kb/workspaces/:slug/pages/:pageId/cover */
  pageCover: (workspaceSlug: string, pageId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/cover`,
  /**
   * GET — /api/v2/kb/pages/:pageId
   *
   * /kb/{pageId} の URL からの解決。URL にワークスペースを出さないための口で、
   * 応答の workspaceSlug を以降の呼び出し（木・保存）に使う。
   */
  resolvePage: (pageId: string) => `${API_V2}/kb/pages/${encodeURIComponent(pageId)}`,
  /** PUT(本文の置き換え) — /api/v2/kb/workspaces/:slug/pages/:pageId/content */
  pageContent: (workspaceSlug: string, pageId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/content`,
  /** PATCH(表示名の変更) — /api/v2/kb/workspaces/:slug/spaces/:spaceId。key は変えられない */
  space: (workspaceSlug: string, spaceId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/spaces/${encodeURIComponent(spaceId)}`,
  /**
   * GET — /api/v2/kb/workspaces/:slug/me/spaces（段 14）
   *
   * 自分がアクセスできるスペースの一覧（id・name・role）。spaces と違い役割も返す。
   * サイドバーのスペース切替・入口解決に使う。
   */
  mySpaces: (workspaceSlug: string) => `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/me/spaces`,
  /**
   * GET — /api/v2/kb/workspaces/:slug/spaces/:spaceId/members（段 9）
   *
   * そのスペースに届いている権限を人に解決して返す（読み取り専用。停止・招待などの
   * admin 操作は無い — ワークスペース単位の members/adminMembers とは別物）。
   */
  spaceMembers: (workspaceSlug: string, spaceId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/spaces/${encodeURIComponent(spaceId)}/members`,
  /** GET(一覧) — /api/v2/kb/workspaces/:slug/favorites（段 7。自分のお気に入りページ） */
  favorites: (workspaceSlug: string) => `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/favorites`,
  /** PUT(追加) / DELETE(解除) — /api/v2/kb/workspaces/:slug/pages/:pageId/favorite */
  favorite: (workspaceSlug: string, pageId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/favorite`,
  /**
   * GET — /api/v2/kb/workspaces/:slug/search?q=
   *
   * ワークスペース全体の題名検索。返るのは閲覧できる現役ページだけで、
   * 判定はツリーと同じ規則をサーバーが持つ（検索だけ別の判定にしない）。
   */
  search: (workspaceSlug: string) => `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/search`,
  /**
   * GET — /api/v2/kb/workspaces/:slug/pages/:pageId/backlinks
   *
   * このページを参照しているページの一覧（逆リンク）。応答は KbPage[] と同じ形
   * （追加フィールドなし）。見える範囲の判定は木・検索と同じ規則をサーバーが持つ。
   */
  pageBacklinks: (workspaceSlug: string, pageId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/backlinks`,
  /**
   * GET(一覧) — /api/v2/kb/workspaces/:slug/pages/:pageId/grants
   *
   * **返るのはそのページ自身に張った行だけ**で、上の段（ワークスペース / スペース /
   * 祖先のページ）から届いている相手は含まない。空 = 誰も見られない、ではない。
   */
  pageGrants: (workspaceSlug: string, pageId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/grants`,
  /** PUT(付与) / DELETE(取り消し) — 同じ 1 行を指す（DB の主キーと同じ形） */
  pageGrant: (workspaceSlug: string, pageId: string, principalId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/grants/${encodeURIComponent(principalId)}`,
  /**
   * GET — /api/v2/kb/workspaces/:slug/pages/:pageId/principals
   *
   * 権限を張れる相手を表示名つきで返す（相手選び用）。中身はワークスペース全体だが、
   * 呼べるかはページ単位で決まる。
   */
  pagePrincipals: (workspaceSlug: string, pageId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/principals`,
  /**
   * GET(一覧) / POST(作成) — /api/v2/kb/workspaces/:slug/pages/:pageId/comment-threads
   *
   * 一覧は作成日時昇順で、各スレッドは comments 配列を持つ。作成（POST）の応答も
   * 同じ形（comments に作った最初の 1 件が入ったスレッド 1 件）。
   */
  commentThreads: (workspaceSlug: string, pageId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/comment-threads`,
  /** POST(返信の追加) — /api/v2/kb/workspaces/:slug/pages/:pageId/comment-threads/:threadId/comments */
  comments: (workspaceSlug: string, pageId: string, threadId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/comment-threads/${encodeURIComponent(threadId)}/comments`,
  /** POST(解決) — .../comment-threads/:threadId/resolve。更新後のスレッドを返す */
  resolveCommentThread: (workspaceSlug: string, pageId: string, threadId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/comment-threads/${encodeURIComponent(threadId)}/resolve`,
  /** POST(再開) — .../comment-threads/:threadId/reopen。更新後のスレッドを返す */
  reopenCommentThread: (workspaceSlug: string, pageId: string, threadId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/comment-threads/${encodeURIComponent(threadId)}/reopen`,
  /**
   * GET(一覧・新しい順) / POST(明示的な版の作成) — /api/v2/kb/workspaces/:slug/pages/:pageId/versions
   *
   * 一覧・単体取得は閲覧できれば誰でもできる（canView）。作成（版を残す）は編集権限が要る。
   */
  pageVersions: (workspaceSlug: string, pageId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/versions`,
  /** GET(1件・doc込み) — /api/v2/kb/workspaces/:slug/pages/:pageId/versions/:seq */
  pageVersion: (workspaceSlug: string, pageId: string, seq: number) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/versions/${encodeURIComponent(seq)}`,
  /**
   * POST(復元・body無し) — .../versions/:seq/restore。編集権限が要る。
   * 応答は本文保存（PUT .../content）と同じ形（KbPageContentSaveResult）。
   */
  restorePageVersion: (workspaceSlug: string, pageId: string, seq: number) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/versions/${encodeURIComponent(seq)}/restore`,
  /**
   * GET(一覧・?spaceId= は任意) — /api/v2/kb/workspaces/:slug/templates
   *
   * 一覧・使用はワークスペース所属者なら誰でもできる。spaceId を渡すと、そのスペース専用の
   * テンプレート + ワークスペース全体のテンプレートの両方が返る想定（backend 未実装の段階の
   * 想定であり確定ではない — 要すり合わせ）。
   */
  templates: (workspaceSlug: string) => `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/templates`,
  /**
   * POST(作成) — /api/v2/kb/workspaces/:slug/pages/:pageId/templates
   *
   * 今のページの内容からテンプレートを作る。ワークスペースの編集者（editor）以上が要る。
   */
  pageTemplates: (workspaceSlug: string, pageId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/templates`,
  /** DELETE(削除) — /api/v2/kb/workspaces/:slug/templates/:templateId。編集者以上が要る。 */
  template: (workspaceSlug: string, templateId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/templates/${encodeURIComponent(templateId)}`,
  /**
   * POST(テンプレートからページを作成) — /api/v2/kb/workspaces/:slug/spaces/:spaceId/pages/from-template
   *
   * 応答は通常のページ作成（POST .../pages）と同じ形（KbPage）。
   */
  pageFromTemplate: (workspaceSlug: string, spaceId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/spaces/${encodeURIComponent(spaceId)}/pages/from-template`,
  /**
   * GET(openな一覧) / POST(作成) — /api/v2/kb/workspaces/:slug/pages/:pageId/suggestions
   *
   * 作成は CanComment、一覧の閲覧は CanView。一覧は open な提案だけを返す
   * （採用・却下が済んだものは含まない）。
   */
  pageSuggestions: (workspaceSlug: string, pageId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/suggestions`,
  /**
   * POST(採用・body無し) — .../suggestions/:suggestionId/accept。CanEdit が要る。
   * 本文へ反映し版を1つ切る。応答は反映後の提案そのもの（doc が反映後の本文と同じ）。
   */
  acceptPageSuggestion: (workspaceSlug: string, pageId: string, suggestionId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/suggestions/${encodeURIComponent(suggestionId)}/accept`,
  /** POST(却下・body無し) — .../suggestions/:suggestionId/reject。CanEdit が要る。本文は一切変えない。 */
  rejectPageSuggestion: (workspaceSlug: string, pageId: string, suggestionId: string) =>
    `${API_V2}/kb/workspaces/${encodeURIComponent(workspaceSlug)}/pages/${encodeURIComponent(pageId)}/suggestions/${encodeURIComponent(suggestionId)}/reject`,
} as const;

/**
 * プロジェクト（バックログの入れ物）。routes_project.go 参照。
 *
 * URL は `/kb` の下に置かない。バックログはナレッジと別の製品で、projects はワークスペース
 * しか参照しない（spaces への FK を持たない）。URL の階層もそれを表す。
 */
export const PROJECT_API = {
  /** GET(一覧) / POST(作成) — /api/v2/workspaces/:slug/projects */
  projects: (workspaceSlug: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects`,
  /** GET(取得) / PATCH(改名) — /api/v2/workspaces/:slug/projects/:projectId */
  project: (workspaceSlug: string, projectId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}`,
} as const;

/**
 * スプリント（バックログの仕事を「いつやるか」でまとめる区切り。routes_sprint.go 参照）。
 *
 * 一覧と作成だけがプロジェクトの下。個々のスプリントへの操作は sprintId で一意に引けるので
 * projectId を取らない（チケットの個票と同じ形）。
 */
/**
 * PROJECT_VOCABULARY_API はプロジェクトの語彙（リリース版・チーム）と、
 * 1 件のチケットへの付け外し。
 *
 * 版とチームは**プロジェクトの下**、付け外しは**チケットの下**に置く。
 * 語彙を増やすのはプロジェクト全体に効く操作、付け外しは 1 件の記録、と役目が違うため。
 */
export const PROJECT_VOCABULARY_API = {
  /** GET(一覧。?archived=1 で畳んだもの) / POST(作成) */
  versions: (workspaceSlug: string, projectId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/versions`,
  /** PATCH — 名前とリリース日。 */
  version: (workspaceSlug: string, projectId: string, versionId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}`,
  versionArchive: (workspaceSlug: string, projectId: string, versionId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}/archive`,
  versionRestore: (workspaceSlug: string, projectId: string, versionId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}/restore`,
  /** GET(付いている版) / PUT(付け外し。attach で「どちらにしたいか」を送る) */
  ticketFixVersions: (workspaceSlug: string, ticketId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/fix-versions`,

  /** GET(一覧。所属つき) / POST(作成) */
  teams: (workspaceSlug: string, projectId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/teams`,
  /** PATCH(改名) / DELETE(削除。付いていたチケットからは外れる) */
  team: (workspaceSlug: string, projectId: string, teamId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/teams/${encodeURIComponent(teamId)}`,
  /** PUT — 所属の付け外し（member で「どちらにしたいか」）。 */
  teamMembers: (workspaceSlug: string, projectId: string, teamId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/teams/${encodeURIComponent(teamId)}/members`,
  /** PUT — チケットの担当チーム（空文字で外す）。 */
  ticketTeam: (workspaceSlug: string, ticketId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/team`,
} as const;

export const SPRINT_API = {
  /** GET(一覧・件数つき) / POST(作成。必ず planned から) */
  sprints: (workspaceSlug: string, projectId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/sprints`,
  /** PATCH(名前・期間) / DELETE(削除。中のチケットはバックログへ戻る) */
  sprint: (workspaceSlug: string, sprintId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/sprints/${encodeURIComponent(sprintId)}`,
  /** PUT — 開始（active）・完了（completed）。戻す向きは 409。 */
  sprintState: (workspaceSlug: string, sprintId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/sprints/${encodeURIComponent(sprintId)}/state`,
  /** GET(中のチケット ID・並び順) / POST(入れる。別スプリントからなら移動) */
  sprintTickets: (workspaceSlug: string, sprintId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/sprints/${encodeURIComponent(sprintId)}/tickets`,
  /** DELETE — チケットをスプリントから外す（どのスプリントかは呼び出し側が知らなくてよい）。 */
  ticketSprint: (workspaceSlug: string, ticketId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/sprint`,
  /**
   * PUT — スプリント内の並べ替え。どのスプリントかは URL に取らない
   * （1 件のチケットは同時に 1 つのスプリントにしか入らないため）。
   */
  ticketSprintPosition: (workspaceSlug: string, ticketId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/sprint/position`,
} as const;

/**
 * チケット・バックログ（projects に属する。routes_ticket.go 参照）。
 *
 * PROJECT_API と同じく `/kb` の下に置かない。ワークスペースは URL の slug で指す。
 * チケットはページのような個票の grant を持たず、実効権限は常にワークスペース単位なので、
 * grants / principals 系のルートは無い（担当者候補の名前解決は KB_API.pagePrincipals を流用する）。
 */
export const TICKET_API = {
  /**
   * GET — /api/v2/workspaces/:slug/tickets/assigned
   *
   * 「自分の担当」。プロジェクトを横断するので URL にプロジェクトを取らない。誰の担当かは
   * 常に呼び出した本人（他人の担当は取れない）。並びは状態の枠 → 状態 → 期限の順で返る。
   */
  assignedTickets: (workspaceSlug: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/assigned`,
  /** POST — /api/v2/workspaces/:slug/projects/:projectId/tickets/enable。body は省略可 */
  enable: (workspaceSlug: string, projectId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/tickets/enable`,
  /**
   * GET(一覧) / POST(作成) — /api/v2/workspaces/:slug/projects/:projectId/tickets
   *
   * 一覧のクエリは statusId / typeId / assigneePrincipalId / label / q（いずれも省略可）と
   * archived（'true' でアーカイブだけを返す。省略時は現役だけ。「込み」は取れない）。
   * unassigned / assignedToMe / assigneePrincipalId は互いに排他（同時指定は 400）。
   */
  tickets: (workspaceSlug: string, projectId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/tickets`,
  /**
   * GET — /api/v2/workspaces/:slug/projects/:projectId/tickets/counts
   *
   * サイドバー「保存した絞り込み」の件数バッジ（total / assignedToMe / overdue / unassigned）。
   * フロントエンドでは計算しない（自分の principal 解決・全件走査が要るため）。
   */
  ticketCounts: (workspaceSlug: string, projectId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/tickets/counts`,
  /**
   * GET(一覧) / POST(作成) — /api/v2/workspaces/:slug/projects/:projectId/saved-filters
   *
   * 利用者が名前を付けて保存した絞り込み（本人 × プロジェクト）。一覧は作った順・件数付き。
   * 条件の項目名は tickets のクエリと同じ語彙（statusId / typeId / labelId / assigneePrincipalId /
   * unassigned / assignedToMe / overdue / q）。
   */
  savedFilters: (workspaceSlug: string, projectId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/saved-filters`,
  /** PUT(名前と条件を丸ごと差し替え) / DELETE — .../saved-filters/:filterId */
  savedFilter: (workspaceSlug: string, projectId: string, filterId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/saved-filters/${encodeURIComponent(filterId)}`,
  /** GET — /api/v2/workspaces/:slug/tickets/by-key/:key（例 FRESTYLE-12） */
  ticketByKey: (workspaceSlug: string, key: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/by-key/${encodeURIComponent(key)}`,
  /** GET(取得) / PUT(全置換) — /api/v2/workspaces/:slug/tickets/:ticketId */
  ticket: (workspaceSlug: string, ticketId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}`,
  /**
   * GET — /api/v2/tickets/:ticketId
   *
   * /tickets/{ticketId} の URL からの解決。ワークスペースを出さないための口で、
   * 応答の workspaceSlug を以降の呼び出しに使う（KB_API.resolvePage と同じ役割）。
   */
  resolveTicket: (ticketId: string) => `${API_V2}/tickets/${encodeURIComponent(ticketId)}`,
  /** POST(並び替え・204) — .../tickets/:ticketId/move。anchorTicketId 省略で末尾へ */
  moveTicket: (workspaceSlug: string, ticketId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/move`,
  /** POST(アーカイブ) — .../tickets/:ticketId/archive */
  archiveTicket: (workspaceSlug: string, ticketId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/archive`,
  /** POST(復元) — .../tickets/:ticketId/restore */
  restoreTicket: (workspaceSlug: string, ticketId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/restore`,
  /** POST — .../tickets/:ticketId/status。resolution は category=done のときだけ意味を持つ */
  changeTicketStatus: (workspaceSlug: string, ticketId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/status`,
  /** PUT — .../tickets/:ticketId/parent。parentId 省略でトップレベルへ */
  changeTicketParent: (workspaceSlug: string, ticketId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/parent`,
  /** PUT(設定) / DELETE(解除・204) — .../tickets/:ticketId/assignee */
  ticketAssignee: (workspaceSlug: string, ticketId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/assignee`,
  /** GET — .../tickets/:ticketId/history（変更履歴・新しい順） */
  /**
   * GET(状態) / PUT(付け外し) — .../tickets/:ticketId/watch
   *
   * 監視は「担当」とは別物（担当は 1 人、監視は何人でも）。自分の分しか動かせない。
   * 見る権限があれば足りる（編集できない人でも進み具合は追える）。
   */
  ticketWatch: (workspaceSlug: string, ticketId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/watch`,
  ticketHistory: (workspaceSlug: string, ticketId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/history`,
  /** GET — .../tickets/:ticketId/children（直下の子・並び順。孫は含まない） */
  ticketChildren: (workspaceSlug: string, ticketId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/children`,
  /** GET(一覧・古い順) / POST(投稿) — .../tickets/:ticketId/comments */
  ticketComments: (workspaceSlug: string, ticketId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/comments`,
  /** PUT(本文の置換) / DELETE(削除・204) — .../comments/:commentId。投稿者本人以外は 403 */
  ticketComment: (workspaceSlug: string, ticketId: string, commentId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/comments/${encodeURIComponent(commentId)}`,
  /** GET — .../comments/:commentId/edits（編集前の本文・新しい順） */
  ticketCommentEdits: (workspaceSlug: string, ticketId: string, commentId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/comments/${encodeURIComponent(commentId)}/edits`,
  /**
   * PUT(付ける) / DELETE(外す) — .../comments/:commentId/reactions/:emoji。どちらも 204・冪等。
   *
   * 絵文字は URL の一部なので必ず encodeURIComponent を通す（生のままだと多バイト文字で経路が壊れる）。
   */
  ticketCommentReaction: (workspaceSlug: string, ticketId: string, commentId: string, emoji: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/comments/${encodeURIComponent(commentId)}/reactions/${encodeURIComponent(emoji)}`,
  /**
   * GET(一覧) / POST(作成) — /api/v2/workspaces/:slug/projects/:projectId/ticket-statuses
   *
   * 一覧の各行は activeTicketCount（現役チケットでの使用数）を持つ（管理画面の「使用中 N 件」）。
   */
  /**
   * GET(一覧) / POST(作成) — /api/v2/workspaces/:slug/labels
   *
   * ラベルの語彙は**ワークスペース単位**（プロジェクトの下ではない）。ページとチケットが
   * 同じ行を引くため、どちらか一方の入れ物に属させられない。
   */
  labels: (workspaceSlug: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/labels`,
  /** PUT(更新) / DELETE(削除・204) — .../labels/:labelId。名前の重複は 409 label_name_taken */
  label: (workspaceSlug: string, labelId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/labels/${encodeURIComponent(labelId)}`,
  /** PUT(付ける) / DELETE(外す) — .../tickets/:ticketId/labels/:labelId。どちらも 204・冪等 */
  ticketLabel: (workspaceSlug: string, ticketId: string, labelId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/labels/${encodeURIComponent(labelId)}`,
  /** GET(一覧) / POST(確定) — .../tickets/:ticketId/attachments */
  ticketAttachments: (workspaceSlug: string, ticketId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/attachments`,
  /** POST — .../attachments/upload-url。{contentType, size} → {url, key, expiresIn} */
  ticketAttachmentUploadUrl: (workspaceSlug: string, ticketId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/attachments/upload-url`,
  /** GET — .../attachments/:attachmentId/download-url。期限付き URL を都度発行する（保存しない） */
  ticketAttachmentDownloadUrl: (workspaceSlug: string, ticketId: string, attachmentId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}/download-url`,
  /** DELETE — .../attachments/:attachmentId（204。Cloud Storage の実ファイルは消えない） */
  ticketAttachment: (workspaceSlug: string, ticketId: string, attachmentId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}`,
  ticketStatuses: (workspaceSlug: string, projectId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/ticket-statuses`,
  /** PUT — .../ticket-statuses/:statusId（name / color / category をまとめて置換） */
  ticketStatus: (workspaceSlug: string, projectId: string, statusId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/ticket-statuses/${encodeURIComponent(statusId)}`,
  /** POST(body 無し) — .../ticket-statuses/:statusId/set-initial */
  setInitialTicketStatus: (workspaceSlug: string, projectId: string, statusId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/ticket-statuses/${encodeURIComponent(statusId)}/set-initial`,
  /** POST(body 無し) — .../ticket-statuses/:statusId/archive。使用中は 409 status_in_use */
  archiveTicketStatus: (workspaceSlug: string, projectId: string, statusId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/ticket-statuses/${encodeURIComponent(statusId)}/archive`,
  /** POST(body 無し) — .../ticket-statuses/:statusId/restore */
  restoreTicketStatus: (workspaceSlug: string, projectId: string, statusId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/ticket-statuses/${encodeURIComponent(statusId)}/restore`,
  /** GET(一覧) / POST(作成) — /api/v2/workspaces/:slug/projects/:projectId/ticket-types */
  ticketTypes: (workspaceSlug: string, projectId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/ticket-types`,
  /** PUT — .../ticket-types/:typeId */
  ticketType: (workspaceSlug: string, projectId: string, typeId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/ticket-types/${encodeURIComponent(typeId)}`,
  /** POST(body 無し) — .../ticket-types/:typeId/set-default */
  setDefaultTicketType: (workspaceSlug: string, projectId: string, typeId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/ticket-types/${encodeURIComponent(typeId)}/set-default`,
  /** POST(body 無し) — .../ticket-types/:typeId/archive。使用中は 409 type_in_use */
  archiveTicketType: (workspaceSlug: string, projectId: string, typeId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/ticket-types/${encodeURIComponent(typeId)}/archive`,
  /** POST(body 無し) — .../ticket-types/:typeId/restore */
  restoreTicketType: (workspaceSlug: string, projectId: string, typeId: string) =>
    `${API_V2}/workspaces/${encodeURIComponent(workspaceSlug)}/projects/${encodeURIComponent(projectId)}/ticket-types/${encodeURIComponent(typeId)}/restore`,
} as const;
