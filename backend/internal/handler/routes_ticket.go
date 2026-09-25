package handler

import (
	"context"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	infraGCS "github.com/norman6464/frestyle/backend/internal/infra/gcs"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
	"github.com/norman6464/frestyle/backend/internal/usecase/user"
)

// チケットへの発言作成に掛ける上限。@mention は件数を打ち切ってあるが（maxTicketCommentMentions）、
// 通知作成は要求のたびに走るので連投の速さも別に頭打ちにする。人が打つ速さには十分余裕を
// 持たせつつ自動化した連投は抑える。
const (
	ticketCreateCommentPerMinute = 30
	ticketCreateCommentBurst     = 10
	ticketListPerMinute          = 150
	ticketListBurst              = 30
)

// registerTicketRoutes はチケットのエンドポイントを登録する。
//
// URL は **/kb の下に置かない**（registerProjectRoutes と同じ判断）。チケットはプロジェクトに
// 属し、プロジェクトはワークスペースにしか属さないので、階層もそれを表す
// （/workspaces/:workspaceSlug/projects/:projectId/tickets）。ワークスペースの解決だけは
// middleware.KnowledgeBaseWorkspace を流用する — 名前は kb 由来だが、やっているのは
// 「slug からワークスペースを引いて所属を確かめる」ことだけ。
//
// kb 側の routes_knowledge_base.go には触れず別ファイルとして独立させてある
// （usecase/ticket は usecase/kb を import しない境界だが、handler 層は両方に依存してよい）。
func registerTicketRoutes(g *gin.RouterGroup, deps *routeDeps) {
	registerTicketRoutesWith(
		g,
		persistence.NewTicketRepository(deps.db),
		persistence.NewTicketCommentRepository(deps.db),
		persistence.NewLabelRepository(deps.db),
		persistence.NewTicketAttachmentRepository(deps.db),
		persistence.NewTicketSavedFilterRepository(deps.db),
		persistence.NewKnowledgeBasePermissionRepository(deps.db),
		persistence.NewKnowledgeBaseRepository(deps.db),
		persistence.NewUserRepository(deps.db),
		persistence.NewNotificationRepository(deps.db),
		persistence.NewTxManager(deps.db),
		newTicketAttachmentPresignerOrFallback(deps),
	)
}

// newTicketAttachmentPresignerOrFallback は newKbImagePresignerOrFallback と同じ判断——
// IMAGES_BUCKET 未設定なら stub、設定済みで初期化に失敗すれば起動を止める。添付は kb ページ
// 画像・rich-text 画像と同じバケットを tickets/ prefix で共有する（新しいバケットを増やさない）。
func newTicketAttachmentPresignerOrFallback(deps *routeDeps) repository.TicketAttachmentPresigner {
	bucket := deps.cfg.Images.Bucket
	if bucket == "" {
		log.Printf("[ticket-attachment] IMAGES_BUCKET unset — using stub presigner (DEV)")
		return persistence.NewStubTicketAttachmentPresigner("stub-bucket")
	}
	pre, err := infraGCS.NewPresigner(context.Background(), bucket)
	if err != nil {
		log.Fatalf("[ticket-attachment] IMAGES_BUCKET=%q is set but GCS presigner init failed: %v — %s", bucket, err, imagesBucketHint)
	}
	return persistence.NewTicketAttachmentPresigner(pre)
}

// registerTicketRoutesWith は repository を受け取ってルートと middleware を組み立てる
// （本番の wiring とテストが同じ 1 箇所を通るようにするため）。
func registerTicketRoutesWith(
	g *gin.RouterGroup,
	tickets repository.TicketRepository,
	comments repository.TicketCommentRepository,
	labels repository.LabelRepository,
	attachments repository.TicketAttachmentRepository,
	savedFilters repository.TicketSavedFilterRepository,
	permissions repository.KnowledgeBasePermissionRepository,
	pages repository.KnowledgeBaseRepository,
	users repository.UserRepository,
	notifs repository.NotificationRepository,
	txManager repository.TxManager,
	attachmentPresigner repository.TicketAttachmentPresigner,
) {
	// バックログの権限はワークスペース単位（スペースの付与は引かない。
	// ticket.CheckTicketPermissionUseCase の doc コメント参照）。
	checkWorkspace := kb.NewCheckWorkspacePermissionUseCase(permissions)
	checkTicket := ticket.NewCheckTicketPermissionUseCase(tickets, permissions)

	h := NewTicketHandler(
		checkWorkspace,
		checkTicket,
		ticket.NewResolveTicketKeyUseCase(tickets),
		ticket.NewResolveTicketLocationUseCase(tickets, pages),
		ticket.NewEnableTicketsForProjectUseCase(tickets, txManager),
		ticket.NewCreateTicketUseCase(tickets, txManager),
		ticket.NewGetTicketUseCase(tickets),
		ticket.NewGetTicketAssignmentUseCase(tickets),
		ticket.NewListTicketsUseCase(tickets, permissions),
		ticket.NewListAssignedTicketsUseCase(tickets, permissions),
		ticket.NewWatchTicketUseCase(tickets),
		ticket.NewGetTicketWatchStateUseCase(tickets),
		ticket.NewGetTicketCountsUseCase(tickets, permissions),
		ticket.NewListTicketChildrenUseCase(tickets),
		ticket.NewUpdateTicketUseCase(tickets),
		ticket.NewMoveTicketUseCase(tickets),
		ticket.NewArchiveTicketUseCase(tickets),
		ticket.NewRestoreTicketUseCase(tickets),
		ticket.NewDeleteTicketUseCase(tickets),
		ticket.NewFindDeletedTicketUseCase(tickets),
		ticket.NewRestoreDeletedTicketUseCase(tickets),
		ticket.NewChangeTicketStatusUseCase(tickets),
		ticket.NewChangeTicketParentUseCase(tickets),
		ticket.NewAssignTicketUseCase(tickets),
		ticket.NewUnassignTicketUseCase(tickets),
		ticket.NewListTicketHistoryUseCase(tickets),
		ticket.NewListLabelsForTicketUseCase(labels),
		ticket.NewListLabelsByTicketIDsUseCase(labels),
		ticket.NewListTicketAncestorsUseCase(tickets),
		kb.NewListPagesReferencingTicketUseCase(permissions),
		user.NewLookupUserDisplayUseCase(users),
	)
	sh := NewTicketStatusHandler(
		checkWorkspace,
		ticket.NewListTicketStatusesUseCase(tickets),
		ticket.NewCreateTicketStatusUseCase(tickets),
		ticket.NewUpdateTicketStatusUseCase(tickets),
		ticket.NewSetInitialTicketStatusUseCase(tickets),
		ticket.NewArchiveTicketStatusUseCase(tickets),
		ticket.NewRestoreTicketStatusUseCase(tickets),
	)
	th := NewTicketTypeHandler(
		checkWorkspace,
		ticket.NewListTicketTypesUseCase(tickets),
		ticket.NewCreateTicketTypeUseCase(tickets),
		ticket.NewUpdateTicketTypeUseCase(tickets),
		ticket.NewSetDefaultTicketTypeUseCase(tickets),
		ticket.NewArchiveTicketTypeUseCase(tickets),
		ticket.NewRestoreTicketTypeUseCase(tickets),
	)
	ch := NewTicketCommentHandler(
		checkTicket,
		ticket.NewCreateTicketCommentUseCase(comments, tickets, permissions, notifs),
		ticket.NewUpdateTicketCommentUseCase(comments, txManager),
		ticket.NewDeleteTicketCommentUseCase(comments),
		ticket.NewListTicketCommentsUseCase(comments),
		ticket.NewListTicketCommentEditsUseCase(comments),
		ticket.NewAddTicketCommentReactionUseCase(comments),
		ticket.NewRemoveTicketCommentReactionUseCase(comments),
		user.NewLookupUserDisplayUseCase(users),
	)
	lh := NewTicketLabelHandler(
		checkWorkspace,
		checkTicket,
		ticket.NewListLabelsUseCase(labels),
		ticket.NewCreateLabelUseCase(labels),
		ticket.NewUpdateLabelUseCase(labels),
		ticket.NewDeleteLabelUseCase(labels),
		ticket.NewAddTicketLabelUseCase(labels, tickets),
		ticket.NewRemoveTicketLabelUseCase(labels),
	)
	ah := NewTicketAttachmentHandler(
		checkTicket,
		ticket.NewIssueTicketAttachmentUploadURLUseCase(tickets, attachmentPresigner),
		ticket.NewCreateTicketAttachmentUseCase(tickets, attachments),
		ticket.NewListTicketAttachmentsUseCase(attachments),
		ticket.NewIssueTicketAttachmentDownloadURLUseCase(attachments, attachmentPresigner),
		ticket.NewDeleteTicketAttachmentUseCase(attachments),
	)
	fh := NewTicketSavedFilterHandler(
		checkWorkspace,
		ticket.NewListSavedFiltersUseCase(savedFilters, tickets, permissions),
		ticket.NewCreateSavedFilterUseCase(savedFilters, tickets, permissions),
		ticket.NewUpdateSavedFilterUseCase(savedFilters, tickets, permissions),
		ticket.NewDeleteSavedFilterUseCase(savedFilters),
	)

	// slug 無しの解決だけは middleware.KnowledgeBaseWorkspace を通さない（handler が ID から
	// ワークスペースを解決し、その場で権限判定を通す。kb の /kb/pages/:pageId と同じ）。
	g.GET("/tickets/:ticketId", h.ResolveByID)

	// ホームの「自分の担当」。全ワークスペースを横断するので URL に slug を取らない。どの
	// ワークスペースを見てよいかは usecase が所属と役割から決める。
	mh := NewTicketMeHandler(ticket.NewListAssignedAcrossWorkspacesUseCase(tickets, permissions))
	g.GET("/me/assigned-tickets", mh.ListAssigned)

	tkGroup := g.Group("", middleware.KnowledgeBaseWorkspace(
		kb.NewResolveWorkspaceUseCase(pages, permissions),
	))

	// 「自分の担当」。プロジェクトを横断するので URL にプロジェクトを取らない。誰の担当かは
	// 常に呼び出した本人（他人の担当を覗く口にはしない。usecase のコメント参照）。
	tkGroup.GET("/workspaces/:workspaceSlug/tickets/assigned", h.ListAssigned)

	// 監視（自分の分だけ付け外しできる。見る権限があれば足りる）。
	tkGroup.GET("/workspaces/:workspaceSlug/tickets/:ticketId/watch", h.GetWatchState)
	tkGroup.PUT("/workspaces/:workspaceSlug/tickets/:ticketId/watch", h.Watch)

	tkGroup.POST("/workspaces/:workspaceSlug/projects/:projectId/tickets/enable", h.Enable)
	tkGroup.GET("/workspaces/:workspaceSlug/projects/:projectId/tickets",
		middleware.RateLimitPerMinutePerUser(ticketListPerMinute, ticketListBurst), h.List)
	// 保存した絞り込みの件数バッジ（自分の担当・期限切れ・未割り当て・総数）。
	tkGroup.GET("/workspaces/:workspaceSlug/projects/:projectId/tickets/counts", h.Counts)
	tkGroup.POST("/workspaces/:workspaceSlug/projects/:projectId/tickets", h.Create)
	// 利用者が保存した絞り込み（本人 × プロジェクト。固定の 4 つの下に並ぶ）。
	tkGroup.GET("/workspaces/:workspaceSlug/projects/:projectId/saved-filters", fh.List)
	tkGroup.POST("/workspaces/:workspaceSlug/projects/:projectId/saved-filters", fh.Create)
	tkGroup.PUT("/workspaces/:workspaceSlug/projects/:projectId/saved-filters/:filterId", fh.Update)
	tkGroup.DELETE("/workspaces/:workspaceSlug/projects/:projectId/saved-filters/:filterId", fh.Delete)
	// 表示キー（例 FRESTYLE-12）からの解決。キーはプロジェクトの key を含む
	// （domain.ParseTicketKey が最後のハイフンで割る）ので URL 側にプロジェクトを取らない。
	// /tickets/:ticketId と衝突しないよう /tickets/by-key/:key に独立させる。
	tkGroup.GET("/workspaces/:workspaceSlug/tickets/by-key/:key", h.ResolveByKey)
	tkGroup.GET("/workspaces/:workspaceSlug/tickets/:ticketId", h.Get)
	// 直下の子の一覧（孫は含まない）。
	tkGroup.GET("/workspaces/:workspaceSlug/tickets/:ticketId/children", h.ListChildren)
	tkGroup.PUT("/workspaces/:workspaceSlug/tickets/:ticketId", h.Update)
	tkGroup.POST("/workspaces/:workspaceSlug/tickets/:ticketId/move", h.Move)
	tkGroup.POST("/workspaces/:workspaceSlug/tickets/:ticketId/archive", h.Archive)
	tkGroup.POST("/workspaces/:workspaceSlug/tickets/:ticketId/restore", h.Restore)
	tkGroup.DELETE("/workspaces/:workspaceSlug/tickets/:ticketId", h.Delete)
	tkGroup.POST("/workspaces/:workspaceSlug/tickets/:ticketId/restore-deleted", h.RestoreDeleted)
	tkGroup.POST("/workspaces/:workspaceSlug/tickets/:ticketId/status", h.ChangeStatus)
	tkGroup.PUT("/workspaces/:workspaceSlug/tickets/:ticketId/parent", h.ChangeParent)
	tkGroup.PUT("/workspaces/:workspaceSlug/tickets/:ticketId/assignee", h.Assign)
	tkGroup.DELETE("/workspaces/:workspaceSlug/tickets/:ticketId/assignee", h.Unassign)
	tkGroup.GET("/workspaces/:workspaceSlug/tickets/:ticketId/history", h.History)
	// ページへのチケット埋め込みの逆参照。
	tkGroup.GET("/workspaces/:workspaceSlug/tickets/:ticketId/page-backlinks", h.PageBacklinks)

	// 発言。
	tkGroup.GET("/workspaces/:workspaceSlug/tickets/:ticketId/comments", ch.List)
	tkGroup.POST("/workspaces/:workspaceSlug/tickets/:ticketId/comments",
		middleware.RateLimitPerMinutePerUser(ticketCreateCommentPerMinute, ticketCreateCommentBurst), ch.Create)
	tkGroup.PUT("/workspaces/:workspaceSlug/tickets/:ticketId/comments/:commentId", ch.Update)
	tkGroup.DELETE("/workspaces/:workspaceSlug/tickets/:ticketId/comments/:commentId", ch.Delete)
	tkGroup.GET("/workspaces/:workspaceSlug/tickets/:ticketId/comments/:commentId/edits", ch.ListEdits)
	tkGroup.PUT("/workspaces/:workspaceSlug/tickets/:ticketId/comments/:commentId/reactions/:emoji", ch.AddReaction)
	tkGroup.DELETE("/workspaces/:workspaceSlug/tickets/:ticketId/comments/:commentId/reactions/:emoji", ch.RemoveReaction)

	// ラベル。語彙はワークスペース単位（ページとチケットで共有する）、付け外しはチケット単位。
	tkGroup.GET("/workspaces/:workspaceSlug/labels", lh.List)
	tkGroup.POST("/workspaces/:workspaceSlug/labels", lh.Create)
	tkGroup.PUT("/workspaces/:workspaceSlug/labels/:labelId", lh.Update)
	tkGroup.DELETE("/workspaces/:workspaceSlug/labels/:labelId", lh.Delete)
	tkGroup.PUT("/workspaces/:workspaceSlug/tickets/:ticketId/labels/:labelId", lh.AddToTicket)
	tkGroup.DELETE("/workspaces/:workspaceSlug/tickets/:ticketId/labels/:labelId", lh.RemoveFromTicket)

	// 添付。
	tkGroup.GET("/workspaces/:workspaceSlug/tickets/:ticketId/attachments", ah.List)
	tkGroup.POST("/workspaces/:workspaceSlug/tickets/:ticketId/attachments/upload-url", ah.IssueUploadURL)
	tkGroup.POST("/workspaces/:workspaceSlug/tickets/:ticketId/attachments", ah.Create)
	tkGroup.GET("/workspaces/:workspaceSlug/tickets/:ticketId/attachments/:attachmentId/download-url", ah.IssueDownloadURL)
	tkGroup.DELETE("/workspaces/:workspaceSlug/tickets/:ticketId/attachments/:attachmentId", ah.Delete)

	// 状態マスタ（管理画面）。
	tkGroup.GET("/workspaces/:workspaceSlug/projects/:projectId/ticket-statuses", sh.List)
	tkGroup.POST("/workspaces/:workspaceSlug/projects/:projectId/ticket-statuses", sh.Create)
	tkGroup.PUT("/workspaces/:workspaceSlug/projects/:projectId/ticket-statuses/:statusId", sh.Update)
	tkGroup.POST("/workspaces/:workspaceSlug/projects/:projectId/ticket-statuses/:statusId/set-initial", sh.SetInitial)
	tkGroup.POST("/workspaces/:workspaceSlug/projects/:projectId/ticket-statuses/:statusId/archive", sh.Archive)
	tkGroup.POST("/workspaces/:workspaceSlug/projects/:projectId/ticket-statuses/:statusId/restore", sh.Restore)

	// 種別マスタ（管理画面）。
	tkGroup.GET("/workspaces/:workspaceSlug/projects/:projectId/ticket-types", th.List)
	tkGroup.POST("/workspaces/:workspaceSlug/projects/:projectId/ticket-types", th.Create)
	tkGroup.PUT("/workspaces/:workspaceSlug/projects/:projectId/ticket-types/:typeId", th.Update)
	tkGroup.POST("/workspaces/:workspaceSlug/projects/:projectId/ticket-types/:typeId/set-default", th.SetDefault)
	tkGroup.POST("/workspaces/:workspaceSlug/projects/:projectId/ticket-types/:typeId/archive", th.Archive)
	tkGroup.POST("/workspaces/:workspaceSlug/projects/:projectId/ticket-types/:typeId/restore", th.Restore)
}
