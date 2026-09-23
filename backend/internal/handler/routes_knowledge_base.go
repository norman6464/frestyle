package handler

import (
	"context"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	infraGCS "github.com/norman6464/frestyle/backend/internal/infra/gcs"
	"github.com/norman6464/frestyle/backend/internal/infra/ratelimit"
	"github.com/norman6464/frestyle/backend/internal/usecase/comment"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
	"github.com/norman6464/frestyle/backend/internal/usecase/user"
)

// 共有リンクの検証・招待の発行・ワークスペース/スペース作成・本文解釈系エンドポイントに
// 掛けるレート上限。共有リンクの検証は総当たりの速度を、招待の発行はユーザーを鍵に宛先の
// 連打（1 日の上限は usecase 側が別に持つ）を、ワークスペース作成はユーザーを鍵に slug の
// 先取り連打を、本文解釈系（保存・提案・雛形作成）は 0.8 秒ごとの自動保存が詰まらない
// 水準を保ちつつ抑える。
const (
	kbShareLinkVerifyPerMinute = 10
	kbShareLinkVerifyBurst     = 5
	kbInviteByEmailPerMinute   = 10
	kbInviteByEmailBurst       = 5
	// 招待の案内（プレビュー）は未認証なので IP 単位。トークンは 256 bit で当てられず、案内に
	// 秘密は無いので、素直な大量アクセスを薄める層だけでよい。
	kbInvitationPreviewPerMinute = 20
	kbInvitationPreviewBurst     = 10
	kbCreateWorkspacePerMinute   = 10
	kbCreateWorkspaceBurst       = 5
	kbCreateSpacePerMinute       = 20
	kbCreateSpaceBurst           = 10
	kbReplaceContentPerMinute    = 120
	kbReplaceContentBurst        = 30
	kbParseDocPerMinute          = 30
	kbParseDocBurst              = 10
)

// registerKnowledgeBaseRoutes はナレッジのページ操作と権限操作のエンドポイントを登録する。
// ワークスペースは URL の slug から middleware が解決するので、ルートはすべて
// /kb/workspaces/:workspaceSlug 以下に置き、その middleware を通す group に登録する。
func registerKnowledgeBaseRoutes(g *gin.RouterGroup, deps *routeDeps) {
	registerKnowledgeBaseRoutesWith(
		g,
		persistence.NewKnowledgeBaseRepository(deps.db),
		persistence.NewKnowledgeBasePermissionRepository(deps.db),
		persistence.NewShareLinkRepository(deps.db),
		persistence.NewWorkspaceProvisioner(deps.db),
		persistence.NewUserRepository(deps.db),
		persistence.NewCommentRepository(deps.db),
		persistence.NewPageVersionRepository(deps.db),
		persistence.NewPageViewRepository(deps.db),
		persistence.NewPageFavoriteRepository(deps.db),
		persistence.NewPageTemplateRepository(deps.db),
		persistence.NewPageSuggestionRepository(deps.db),
		persistence.NewTicketRepository(deps.db),
		persistence.NewTxManager(deps.db),
		newKbImagePresignerOrFallback(deps),
		persistence.NewLabelRepository(deps.db),
		persistence.NewInvitationRepository(deps.db),
		persistence.NewNotificationRepository(deps.db),
	)
}

// newKbImagePresignerOrFallback は IMAGES_BUCKET 未設定なら stub にフォールバックする
// （明示的にローカル開発用と分かる状態なので安全）。bucket が設定されているのに
// infraGCS.NewPresigner が失敗する場合は fallback せず起動を失敗させる — 黙って stub
// （未署名 URL）へ倒すと、クライアントは成功と誤認したままアップロード PUT だけが失敗する。
func newKbImagePresignerOrFallback(deps *routeDeps) repository.KbImagePresigner {
	bucket := deps.cfg.Images.Bucket
	if bucket == "" {
		log.Printf("[kb-image] IMAGES_BUCKET unset — using stub presigner (DEV)")
		return persistence.NewStubKbImagePresigner("stub-bucket")
	}
	pre, err := infraGCS.NewPresigner(context.Background(), bucket)
	if err != nil {
		log.Fatalf("[kb-image] IMAGES_BUCKET=%q is set but GCS presigner init failed: %v — %s", bucket, err, imagesBucketHint)
	}
	return persistence.NewKbImagePresigner(pre)
}

// registerKnowledgeBasePublicRoutes は認証不要のナレッジエンドポイントを登録する。
//
// ここに置いてよいのは「ログインしていない相手が使う」ものだけ。共有リンクの検証（認可は
// トークンと任意のパスワードそのものが担う）と、招待 URL の案内（承諾はできず、見せるのは
// 宛先本人向けの案内だけ）の 2 本。
func registerKnowledgeBasePublicRoutes(g *gin.RouterGroup, deps *routeDeps) {
	registerKnowledgeBasePublicRoutesWith(
		g,
		persistence.NewKnowledgeBaseRepository(deps.db),
		persistence.NewKnowledgeBasePermissionRepository(deps.db),
		persistence.NewShareLinkRepository(deps.db),
		persistence.NewInvitationRepository(deps.db),
	)
}

// registerKnowledgeBaseRoutesWith は repository を受け取ってルートと middleware を組み立てる。
// 本番の wiring とテストが同じ 1 箇所を通るようにするために切り出してある
// （テストがルート表を書き写すと、本番だけ middleware が抜けた配線ミスを見逃す）。
func registerKnowledgeBaseRoutesWith(
	g *gin.RouterGroup,
	pages repository.KnowledgeBaseRepository,
	permissions repository.KnowledgeBasePermissionRepository,
	shareLinks repository.ShareLinkRepository,
	provisioner repository.WorkspaceProvisioner,
	users repository.UserRepository,
	comments repository.CommentRepository,
	versions repository.PageVersionRepository,
	views repository.PageViewRepository,
	favorites repository.PageFavoriteRepository,
	templates repository.PageTemplateRepository,
	suggestions repository.PageSuggestionRepository,
	tickets repository.TicketRepository,
	txManager repository.TxManager,
	kbImagePresigner repository.KbImagePresigner,
	labels repository.LabelRepository,
	invitations repository.InvitationRepository,
	notifications repository.NotificationRepository,
) {
	// ReplacePageBlocksUseCase は本文保存の成功直後に versionRepo.CreateVersionIfDue を同じ
	// トランザクションで呼ぶので、PageVersionHandler と同じ 1 つの
	// インスタンスを共有する（RestorePageVersionUseCase もこれをそのまま呼ぶ）。
	replaceBlocks := kb.NewReplacePageBlocksUseCase(pages, txManager, versions)
	h := NewKnowledgeBasePageHandler(
		kb.NewCheckPagePermissionUseCase(permissions),
		kb.NewCheckWorkspacePermissionUseCase(permissions),
		kb.NewResolvePageLocationUseCase(pages),
		kb.NewCheckSpacePermissionUseCase(permissions),
		kb.NewCanEditPageSubtreeUseCase(permissions),
		kb.NewListViewablePagesUseCase(permissions),
		kb.NewGetPageUseCase(pages),
		kb.NewFindPageUseCase(pages),
		kb.NewCreatePageUseCase(pages),
		kb.NewRenamePageUseCase(pages),
		kb.NewMovePageUseCase(pages),
		kb.NewArchivePageUseCase(pages),
		kb.NewUnarchivePageUseCase(pages),
		replaceBlocks,
		kb.NewResolvePageRefTitlesUseCase(permissions),
		kb.NewListViewableAncestorsUseCase(pages, permissions),
		kb.NewDeletePageUseCase(pages),
		kb.NewSetPageIconUseCase(pages),
		user.NewLookupUserDisplayUseCase(users),
		kb.NewIssuePageImageUploadURLUseCase(pages, kbImagePresigner),
		kb.NewIssuePageImageDownloadURLUseCase(pages, kbImagePresigner),
		kb.NewSetPageCoverUseCase(pages),
		kb.NewResolveCoverURLUseCase(kbImagePresigner),
		kb.NewListPageBacklinksUseCase(permissions),
		ticket.NewListTicketsReferencingPageUseCase(tickets),
		kb.NewRecordPageViewUseCase(views),
		kb.NewAddPageFavoriteUseCase(favorites),
		kb.NewRemovePageFavoriteUseCase(favorites),
		kb.NewIsPageFavoriteUseCase(favorites),
		kb.NewSetPageVisibilityUseCase(pages),
		kb.NewAddPageLabelUseCase(labels, pages),
		kb.NewRemovePageLabelUseCase(labels),
		kb.NewListLabelsForPageUseCase(labels),
	)

	// ページ全体へのコメント。認可は CommentHandler 内で
	// CheckPagePermissionUseCase を直接使う（CanComment / CanView の判定は
	// requireCommentPermission / requirePagePermissionWith を参照）。
	ch := NewCommentHandler(
		kb.NewCheckPagePermissionUseCase(permissions),
		comment.NewCreateCommentThreadUseCase(comments, txManager),
		comment.NewAddCommentUseCase(comments),
		comment.NewListCommentThreadsUseCase(comments),
		comment.NewResolveCommentThreadUseCase(comments),
		comment.NewReopenCommentThreadUseCase(comments),
		user.NewLookupUserDisplayUseCase(users),
	)

	// ページ本文の版。一覧・単体取得は CapabilityView、
	// 作成（「版を残す」）・復元は CapabilityEdit（PageVersionHandler 内の各ハンドラ参照）。
	vh := NewPageVersionHandler(
		kb.NewCheckPagePermissionUseCase(permissions),
		kb.NewCreateExplicitPageVersionUseCase(versions, pages, txManager),
		kb.NewListPageVersionsUseCase(versions),
		kb.NewGetPageVersionUseCase(versions),
		kb.NewRestorePageVersionUseCase(versions, replaceBlocks),
		user.NewLookupUserDisplayUseCase(users),
	)

	// ページの雛形。作成・削除はワークスペース全体への CanEdit、
	// 一覧はワークスペース所属者なら誰でも、使用（雛形からページを作る）は既存のページ作成
	// （h.Create）と全く同じ認可分岐で判定する（PageTemplateHandler 参照）。
	tplCheckSpace := kb.NewCheckSpacePermissionUseCase(permissions)
	th := NewPageTemplateHandler(
		kb.NewIsWorkspaceMemberUseCase(permissions),
		kb.NewCheckWorkspacePermissionUseCase(permissions),
		kb.NewCheckPagePermissionUseCase(permissions),
		tplCheckSpace,
		kb.NewListPageTemplatesUseCase(templates, tplCheckSpace),
		kb.NewCreateTemplateFromPageUseCase(pages, templates, tplCheckSpace),
		kb.NewDeletePageTemplateUseCase(templates, tplCheckSpace),
		kb.NewCreatePageFromTemplateUseCase(templates, tplCheckSpace, kb.NewCreatePageUseCase(pages), replaceBlocks, kb.NewDeletePageUseCase(pages)),
	)

	// 提案。作成は CanComment、一覧の閲覧は CanView、採用・却下は CanEdit
	// （PageSuggestionHandler 参照）。採用は本文保存の成功直後に版を切る通常の保存経路と
	// 同じ replaceBlocks インスタンスを使い回す（インスタンスを複数持つと版のトランザクション境界が
	// 揃わなくなるため）。
	sgh := NewPageSuggestionHandler(
		kb.NewCheckPagePermissionUseCase(permissions),
		kb.NewCreateSuggestionUseCase(pages, versions, suggestions),
		kb.NewListOpenPageSuggestionsUseCase(suggestions),
		kb.NewAcceptPageSuggestionUseCase(suggestions, versions, replaceBlocks, txManager),
		kb.NewRejectPageSuggestionUseCase(suggestions),
		kb.NewGetPageVersionUseCase(versions),
		user.NewLookupUserDisplayUseCase(users),
	)

	wh := NewKnowledgeBaseWorkspaceHandler(
		kb.NewListMemberWorkspacesUseCase(permissions),
		kb.NewCreateWorkspaceUseCase(provisioner),
		kb.NewDeleteWorkspaceUseCase(pages),
		kb.NewCheckWorkspacePermissionUseCase(permissions),
		kb.NewCreateSpaceUseCase(pages, provisioner),
		kb.NewListViewableSpacesUseCase(permissions),
		kb.NewCheckSpacePermissionUseCase(permissions),
		kb.NewRenameSpaceUseCase(pages),
		kb.NewSearchViewablePagesUseCase(permissions),
		kb.NewListWorkspaceMembersUseCase(permissions),
		kb.NewListWorkspaceMembersForAdminUseCase(permissions),
		kb.NewListMembershipEventsUseCase(permissions),
		user.NewLookupUserDisplayUseCase(users),
		kb.NewListPageFavoritesUseCase(favorites, kb.NewCheckPagePermissionUseCase(permissions)),
		kb.NewListSpaceMembersUseCase(permissions),
		kb.NewListMySpacesUseCase(permissions),
	)

	// 権限操作 API の認可判定はこの 1 つの gate を共有する。
	// 「なぜ handler で認可を判定するのか」「なぜ super_admin を特別扱いしないのか」
	// 「なぜ拒否を 404 で揃えるのか」は kb_permission_gate.go の冒頭に書いてある。
	gate := newKbPermissionGate(
		kb.NewCheckWorkspacePermissionUseCase(permissions),
		kb.NewCheckSpacePermissionUseCase(permissions),
		kb.NewCheckPagePermissionUseCase(permissions),
	)
	canRemoveAdmin := kb.NewCanRemoveWorkspaceAdminUseCase(permissions)

	gh := NewKnowledgeBaseGrantHandler(
		gate,
		kb.NewGrantWorkspaceRoleUseCase(permissions),
		kb.NewRevokeWorkspaceRoleUseCase(permissions),
		kb.NewGrantSpaceRoleUseCase(permissions),
		kb.NewRevokeSpaceRoleUseCase(permissions),
		kb.NewGrantPageRoleUseCase(permissions),
		kb.NewRevokePageRoleUseCase(permissions),
		kb.NewListPageGrantsUseCase(permissions),
		kb.NewListGrantablePrincipalsUseCase(permissions),
		canRemoveAdmin,
	)

	mh := NewKnowledgeBaseMemberHandler(
		gate,
		kb.NewRemoveWorkspaceMemberUseCase(permissions),
		kb.NewCreatePrincipalGroupUseCase(permissions),
		kb.NewAddGroupMemberUseCase(permissions),
		kb.NewRemoveGroupMemberUseCase(permissions),
		kb.NewEnsureSpaceEveryonePrincipalUseCase(permissions),
		canRemoveAdmin,
		user.NewSetUserActiveUseCase(users, permissions, txManager),
	)

	// この group には検証（Verify）を登録しないので、渡す limiter は使われない。
	// それでも組み立てるのは、handler の組み立て方をここと公開 group で揃えるため
	// （片方だけ nil を渡す形にすると、うっかり検証を認証済み側へ生やしたときに
	// 上限が無いまま動く）。
	sh := NewKnowledgeBaseShareLinkHandler(
		gate,
		kb.NewIssueShareLinkUseCase(shareLinks),
		kb.NewRevokeShareLinkUseCase(shareLinks),
		kb.NewListPageShareLinksUseCase(shareLinks),
		kb.NewVerifyShareLinkUseCase(shareLinks),
		ratelimit.New(kbShareLinkVerifyPerMinute, kbShareLinkVerifyBurst),
	)

	// 自分の最近見たページ（段2）。ワークスペースをまたぐため slug の middleware は通さない。
	meh := NewKnowledgeBaseMeHandler(
		kb.NewListMyRecentPagesUseCase(views, kb.NewCheckPagePermissionUseCase(permissions)),
	)

	// 所属ワークスペースの一覧と作成だけは middleware.KnowledgeBaseWorkspace を通さない。
	// あれは URL の slug から所属済みのワークスペースを確定させる middleware で、
	// 「どの slug を開けるのか」を知る前・そもそもワークスペースを作る前には使えない。
	// 認証（CurrentUser）は呼び出し元の group が既に通している。
	g.GET("/kb/workspaces", wh.List)
	// /p/{pageId} の解決。URL にテナントを持たないため slug の middleware は通せない
	// （権限判定は handler の中で、解決した workspace に対して必ず行う）。
	g.GET("/kb/pages/:pageId", h.ResolveByID)
	// 自分の最近見たページ（段2）。同じ理由でワークスペース横断のまま g に直接登録する。
	g.GET("/kb/me/recent-pages", meh.ListRecentPages)
	// 作成は認証済みなら誰でも叩けて、slug はテナントをまたいで一意。
	// 上限が無いと 1 人で短い slug を取り尽くせてしまい、取り返す手段が運用の手作業しか無い。
	// 保有数の上限までは塞げないが、掴み取りの速度は他の作成系と同じ土俵に落とす。
	// 鍵はユーザー単位（kbCreateWorkspacePerMinute の doc 参照）。
	g.POST("/kb/workspaces", middleware.RateLimitPerMinutePerUser(kbCreateWorkspacePerMinute, kbCreateWorkspaceBurst), wh.Create)

	// email 宛の招待。招かれた側（自分宛の一覧・承諾・辞退）は承諾するまで所属していないので、
	// middleware.KnowledgeBaseWorkspace を通さない（所属済みしか通さないため）。admin 側
	// （発行・一覧・再送・取消）は下の kbGroup に登録する。
	ih := NewKnowledgeBaseInvitationHandler(
		gate,
		kb.NewInviteByEmailUseCase(invitations, users, notifications, txManager),
		kb.NewListWorkspaceInvitationsUseCase(invitations),
		kb.NewResendInvitationUseCase(invitations),
		kb.NewRevokeInvitationUseCase(invitations),
		kb.NewListMyInvitationsUseCase(invitations, users),
		kb.NewAcceptInvitationUseCase(invitations, users, pages, permissions),
		kb.NewDeclineInvitationUseCase(invitations, users),
	)
	g.GET("/kb/invitations", ih.ListMine)
	g.POST("/kb/invitations/:invitationId/accept", ih.Accept)
	g.POST("/kb/invitations/:invitationId/decline", ih.Decline)

	kbGroup := g.Group("", middleware.KnowledgeBaseWorkspace(
		kb.NewResolveWorkspaceUseCase(pages, permissions),
	))
	// スペースの一覧はワークスペースのメンバーなら誰でも叩ける（返る中身が権限で変わる）。
	// 作成と違って admin の gate を掛けないのは、これがサイドバーの入口だから。
	// 見せてよいスペースの選別は handler ではなく usecase 側のふるいが行う。
	kbGroup.GET("/kb/workspaces/:workspaceSlug/spaces", wh.ListSpaces)
	// ワークスペースの人の一覧。所属していれば誰でも叩ける（担当の表示名・発言での名指しに使う）。
	// 権限を張る相手を選ぶ /pages/:pageId/principals とは別の口（あちらはページの管理権限が要る）。
	kbGroup.GET("/kb/workspaces/:workspaceSlug/members", wh.ListMembers)
	// 自分がアクセスできるスペースの一覧（段 14）。ListSpaceMembers の向きを逆にしたもの。
	// 自分自身の grants しか見ないので checkSpace は要らない（ListMembers と同じ判断）。
	kbGroup.GET("/kb/workspaces/:workspaceSlug/me/spaces", wh.ListMySpaces)
	// 所属・権限の変更履歴（段 6・監査）。admin だけが見られる（handler 内で CanManage を確認）。
	kbGroup.GET("/kb/workspaces/:workspaceSlug/membership-events", wh.ListMembershipEvents)
	kbGroup.GET("/kb/workspaces/:workspaceSlug/admin/members", wh.ListMembersForAdmin)
	// ワークスペースの削除（配下ごと・戻せない）。会社のワークスペースは SQL 側で守る。
	kbGroup.DELETE("/kb/workspaces/:workspaceSlug", wh.Delete)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/spaces",
		middleware.RateLimitPerMinutePerUser(kbCreateSpacePerMinute, kbCreateSpaceBurst), wh.CreateSpace)
	kbGroup.PATCH("/kb/workspaces/:workspaceSlug/spaces/:spaceId", wh.RenameSpace)
	// スペースメンバーの読み取り（段9）。判定は CanView（RenameSpace と同じ形）。
	kbGroup.GET("/kb/workspaces/:workspaceSlug/spaces/:spaceId/members", wh.ListSpaceMembers)
	// 検索は /pages/:pageId と衝突しないよう /search を独立させる。
	kbGroup.GET("/kb/workspaces/:workspaceSlug/search", wh.SearchPages)
	kbGroup.GET("/kb/workspaces/:workspaceSlug/spaces/:spaceId/pages", h.Tree)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/spaces/:spaceId/pages", h.Create)
	kbGroup.GET("/kb/workspaces/:workspaceSlug/pages/:pageId", h.Get)
	kbGroup.PATCH("/kb/workspaces/:workspaceSlug/pages/:pageId", h.Rename)
	kbGroup.DELETE("/kb/workspaces/:workspaceSlug/pages/:pageId", h.Delete)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/pages/:pageId/move", h.Move)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/pages/:pageId/archive", h.Archive)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/pages/:pageId/unarchive", h.Unarchive)
	kbGroup.PUT("/kb/workspaces/:workspaceSlug/pages/:pageId/content",
		middleware.RateLimitPerMinutePerUser(kbReplaceContentPerMinute, kbReplaceContentBurst), h.ReplaceContent)
	kbGroup.PUT("/kb/workspaces/:workspaceSlug/pages/:pageId/icon", h.SetIcon)
	kbGroup.DELETE("/kb/workspaces/:workspaceSlug/pages/:pageId/icon", h.ClearIcon)
	// 公開範囲・ラベル（段13）。
	kbGroup.PUT("/kb/workspaces/:workspaceSlug/pages/:pageId/visibility", h.SetVisibility)
	kbGroup.PUT("/kb/workspaces/:workspaceSlug/pages/:pageId/labels/:labelId", h.AddLabel)
	kbGroup.DELETE("/kb/workspaces/:workspaceSlug/pages/:pageId/labels/:labelId", h.RemoveLabel)
	// ページに閉じた画像の読み取り経路。
	kbGroup.POST("/kb/workspaces/:workspaceSlug/pages/:pageId/images/upload-url", h.IssueImageUploadURL)
	kbGroup.GET("/kb/workspaces/:workspaceSlug/pages/:pageId/images/download-url", h.IssueImageDownloadURL)
	kbGroup.PUT("/kb/workspaces/:workspaceSlug/pages/:pageId/cover", h.SetCover)
	kbGroup.DELETE("/kb/workspaces/:workspaceSlug/pages/:pageId/cover", h.ClearCover)
	// 逆リンク: このページを参照しているページの一覧。
	kbGroup.GET("/kb/workspaces/:workspaceSlug/pages/:pageId/backlinks", h.Backlinks)
	// お気に入り（段7）。閲覧権限があれば誰でも自分の分を付け外しできる。
	kbGroup.PUT("/kb/workspaces/:workspaceSlug/pages/:pageId/favorite", h.AddFavorite)
	kbGroup.DELETE("/kb/workspaces/:workspaceSlug/pages/:pageId/favorite", h.RemoveFavorite)
	kbGroup.GET("/kb/workspaces/:workspaceSlug/favorites", wh.ListFavorites)
	kbGroup.GET("/kb/workspaces/:workspaceSlug/pages/:pageId/ticket-backlinks", h.TicketBacklinks)

	// ページ全体へのコメント。一覧は CanView だけで許可し、
	// 作成・返信・解決・再開は CanComment を要求する（CommentHandler.requireCommentPermission）。
	kbGroup.POST("/kb/workspaces/:workspaceSlug/pages/:pageId/comment-threads", ch.CreateThread)
	kbGroup.GET("/kb/workspaces/:workspaceSlug/pages/:pageId/comment-threads", ch.ListThreads)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/pages/:pageId/comment-threads/:threadId/comments", ch.AddComment)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/pages/:pageId/comment-threads/:threadId/resolve", ch.Resolve)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/pages/:pageId/comment-threads/:threadId/reopen", ch.Reopen)

	// ページ本文の版。一覧・単体取得は CapabilityView（閲覧できれば
	// 誰でも読める）、「版を残す」・復元は CapabilityEdit を要求する（PageVersionHandler 参照）。
	kbGroup.GET("/kb/workspaces/:workspaceSlug/pages/:pageId/versions", vh.List)
	kbGroup.GET("/kb/workspaces/:workspaceSlug/pages/:pageId/versions/:seq", vh.Get)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/pages/:pageId/versions", vh.Create)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/pages/:pageId/versions/:seq/restore", vh.Restore)

	// ページの雛形。一覧はワークスペース所属者なら誰でも、
	// 作成（そのページを雛形として保存）・削除はワークスペース全体への CanEdit を要求する
	// （PageTemplateHandler 参照）。
	kbGroup.GET("/kb/workspaces/:workspaceSlug/templates", th.List)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/pages/:pageId/templates", th.CreateFromPage)
	kbGroup.DELETE("/kb/workspaces/:workspaceSlug/templates/:templateId", th.Delete)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/spaces/:spaceId/pages/from-template",
		middleware.RateLimitPerMinutePerUser(kbParseDocPerMinute, kbParseDocBurst), th.CreatePage)

	// 提案。作成は CanComment、一覧の閲覧は CanView、採用・却下は CanEdit
	// を要求する（PageSuggestionHandler 参照）。
	kbGroup.POST("/kb/workspaces/:workspaceSlug/pages/:pageId/suggestions",
		middleware.RateLimitPerMinutePerUser(kbParseDocPerMinute, kbParseDocBurst), sgh.Create)
	kbGroup.GET("/kb/workspaces/:workspaceSlug/pages/:pageId/suggestions", sgh.ListOpen)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/pages/:pageId/suggestions/:suggestionId/accept", sgh.Accept)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/pages/:pageId/suggestions/:suggestionId/reject", sgh.Reject)

	// ここから下が「権限そのものを変える」経路。すべて admin だけが通り、
	// 通らなかった要求は理由も対象の種類も伏せて 404 を返す（kb_permission_gate.go）。
	//
	// 既定の権限（grant）— ワークスペース全体とスペース単位の 2 段。
	kbGroup.PUT("/kb/workspaces/:workspaceSlug/grants/:principalId", gh.GrantWorkspaceRole)
	kbGroup.DELETE("/kb/workspaces/:workspaceSlug/grants/:principalId", gh.RevokeWorkspaceRole)
	kbGroup.PUT("/kb/workspaces/:workspaceSlug/spaces/:spaceId/grants/:principalId", gh.GrantSpaceRole)
	kbGroup.DELETE("/kb/workspaces/:workspaceSlug/spaces/:spaceId/grants/:principalId", gh.RevokeSpaceRole)
	// ページ単位の grant（既定の 3 段目）。このページとその子孫に効く。
	// 一覧が返すのはこの段で足した行だけで、上の段や祖先から届いている相手は含まない。
	kbGroup.GET("/kb/workspaces/:workspaceSlug/pages/:pageId/grants", gh.ListPageGrants)
	kbGroup.PUT("/kb/workspaces/:workspaceSlug/pages/:pageId/grants/:principalId", gh.GrantPageRole)
	kbGroup.DELETE("/kb/workspaces/:workspaceSlug/pages/:pageId/grants/:principalId", gh.RevokePageRole)
	// 権限を張れる相手（画面の相手選び）。認可はページ単位で、返る中身はワークスペース全体。
	kbGroup.GET("/kb/workspaces/:workspaceSlug/pages/:pageId/principals", gh.ListGrantablePrincipals)

	// 人をワークスペースへ招く入口は email 宛の招待だけ（users.id を受ける口は無い —
	// 「実在する id なら 204」で他人の実在を探れる走査器になるため）。招待しただけでは
	// principal も権限も一切発生せず、本人が /kb/invitations/:invitationId/accept を呼ぶまで
	// 所属しない。発行と再送は回数に上限を置く。鍵はログイン中のユーザー（検証済み JWT 由来
	// なので付け替えられない。IP は XFF で付け替えられるため鍵に使わない）。
	kbGroup.GET("/kb/workspaces/:workspaceSlug/invitations", ih.List)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/invitations",
		middleware.RateLimitPerMinutePerUser(kbInviteByEmailPerMinute, kbInviteByEmailBurst), ih.Invite)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/invitations/:invitationId/resend",
		middleware.RateLimitPerMinutePerUser(kbInviteByEmailPerMinute, kbInviteByEmailBurst), ih.Resend)
	kbGroup.DELETE("/kb/workspaces/:workspaceSlug/invitations/:invitationId", ih.Revoke)
	// 権限を張る相手（principals）の出し入れ。
	kbGroup.DELETE("/kb/workspaces/:workspaceSlug/members/:userId", mh.RemoveMember)
	// アカウントの停止・復帰（段 7）。効果は全ワークスペースに及ぶが、実行できるのは
	// 対象が現に所属するこのワークスペースの admin だけ（kb_member_handler.go の
	// KnowledgeBaseMemberHandler.Suspend の doc 参照）。
	kbGroup.PUT("/kb/workspaces/:workspaceSlug/members/:userId/suspend", mh.Suspend)
	kbGroup.PUT("/kb/workspaces/:workspaceSlug/members/:userId/restore", mh.Restore)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/groups", mh.CreateGroup)
	kbGroup.PUT("/kb/workspaces/:workspaceSlug/groups/:groupPrincipalId/members/:userId", mh.AddGroupMember)
	kbGroup.DELETE("/kb/workspaces/:workspaceSlug/groups/:groupPrincipalId/members/:userId", mh.RemoveGroupMember)
	kbGroup.PUT("/kb/workspaces/:workspaceSlug/spaces/:spaceId/principals/everyone", mh.EnsureSpaceEveryone)

	// 共有リンク（発行・一覧・失効）。発行と失効は「誰が見られるか」を変える操作。
	// 検証だけは未認証なので registerKnowledgeBasePublicRoutesWith 側に置く。
	kbGroup.GET("/kb/workspaces/:workspaceSlug/pages/:pageId/share-links", sh.ListShareLinks)
	kbGroup.POST("/kb/workspaces/:workspaceSlug/pages/:pageId/share-links", sh.IssueShareLink)
	kbGroup.DELETE("/kb/workspaces/:workspaceSlug/pages/:pageId/share-links/:shareLinkId", sh.RevokeShareLink)
}

// registerKnowledgeBasePublicRoutesWith は認証不要のルートを組み立てる。
//
// 共有リンクの検証は、認可をトークンそのものが担う唯一の経路。ログインしていない相手が
// 使うので middleware.KnowledgeBaseWorkspace（slug と所属からテナントを確定させる）を
// 通せず、ワークスペースはトークンから引いたリンクの側が持っている。
//
// トークンは 256 bit の乱数だが、パスワード付きリンクのパスワードは人が選ぶ短い値なので、
// 試行回数に上限をかける。鍵は IP ではなく**リンクそのもの**で、IP を変えても頭打ちになる
// （kbShareLinkAttemptKey の doc に理由がある）。IP 単位の上限も重ねるが、あれは
// 攻撃者が鍵を変えられるので、単独では総当たりの歯止めにならない。
func registerKnowledgeBasePublicRoutesWith(
	g *gin.RouterGroup,
	pages repository.KnowledgeBaseRepository,
	permissions repository.KnowledgeBasePermissionRepository,
	shareLinks repository.ShareLinkRepository,
	invitations repository.InvitationRepository,
) {
	sh := NewKnowledgeBaseShareLinkHandler(
		newKbPermissionGate(
			kb.NewCheckWorkspacePermissionUseCase(permissions),
			kb.NewCheckSpacePermissionUseCase(permissions),
			kb.NewCheckPagePermissionUseCase(permissions),
		),
		kb.NewIssueShareLinkUseCase(shareLinks),
		kb.NewRevokeShareLinkUseCase(shareLinks),
		kb.NewListPageShareLinksUseCase(shareLinks),
		kb.NewVerifyShareLinkUseCase(shareLinks),
		ratelimit.New(kbShareLinkVerifyPerMinute, kbShareLinkVerifyBurst),
	)
	// 上限は 2 段。**本命は handler 側のリンク 1 本あたりの上限**で、こちらの IP 単位は
	// 素直な大量アクセスを薄めるだけの層（XFF を詐称すれば鍵が変わるので、これだけでは
	// パスワードの総当たりを止められない）。詳細は kbShareLinkAttemptKey の doc。
	g.POST("/kb/share-links/verify", middleware.RateLimitPerMinute(20, 10), sh.VerifyShareLink)

	// 招待 URL を開いた人への案内。承諾はここではできない（宛先の email で確認済みのアカウントで
	// ログインしてから /kb/invitations/:invitationId/accept）。
	ph := NewKnowledgeBaseInvitationPreviewHandler(kb.NewPreviewInvitationUseCase(invitations))
	g.POST("/kb/invitations/preview",
		middleware.RateLimitPerMinute(kbInvitationPreviewPerMinute, kbInvitationPreviewBurst), ph.Preview)
}
