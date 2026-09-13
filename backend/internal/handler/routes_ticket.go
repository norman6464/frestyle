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
)

// registerTicketRoutes はチケットのエンドポイントを登録する。チケットは既存の spaces に
// 属するので、URL は kb と同じ /kb/workspaces/:workspaceSlug 以下に置き、同じ
// middleware.KnowledgeBaseWorkspace を通す。kb 側の routes_knowledge_base.go には触れず
// 別ファイルとして独立させてある（usecase/ticket は usecase/kb を import しない境界だが、
// handler 層は両方に依存してよい）。
func registerTicketRoutes(g *gin.RouterGroup, deps *routeDeps) {
	registerTicketRoutesWith(
		g,
		persistence.NewTicketRepository(deps.db),
		persistence.NewTicketCommentRepository(deps.db),
		persistence.NewLabelRepository(deps.db),
		persistence.NewTicketAttachmentRepository(deps.db),
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
	permissions repository.KnowledgeBasePermissionRepository,
	pages repository.KnowledgeBaseRepository,
	users repository.UserRepository,
	notifs repository.NotificationRepository,
	txManager repository.TxManager,
	attachmentPresigner repository.TicketAttachmentPresigner,
) {
	checkSpace := kb.NewCheckSpacePermissionUseCase(permissions)
	checkTicket := ticket.NewCheckTicketPermissionUseCase(tickets, permissions)

	h := NewTicketHandler(
		checkSpace,
		checkTicket,
		ticket.NewResolveTicketKeyUseCase(tickets),
		ticket.NewResolveTicketLocationUseCase(tickets, pages),
		ticket.NewEnableTicketsForSpaceUseCase(tickets, txManager),
		ticket.NewCreateTicketUseCase(tickets),
		ticket.NewGetTicketUseCase(tickets),
		ticket.NewGetTicketAssignmentUseCase(tickets),
		ticket.NewListTicketsUseCase(tickets, permissions),
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
		checkSpace,
		ticket.NewListTicketStatusesUseCase(tickets),
		ticket.NewCreateTicketStatusUseCase(tickets),
		ticket.NewUpdateTicketStatusUseCase(tickets),
		ticket.NewSetInitialTicketStatusUseCase(tickets),
		ticket.NewArchiveTicketStatusUseCase(tickets),
		ticket.NewRestoreTicketStatusUseCase(tickets),
	)
	th := NewTicketTypeHandler(
		checkSpace,
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
		checkSpace,
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

	// slug 無しの解決だけは middleware.KnowledgeBaseWorkspace を通さない（handler が ID から
	// ワークスペースを解決し、その場で権限判定を通す。kb の /kb/pages/:pageId と同じ）。
	g.GET("/kb/tickets/:ticketId", h.ResolveByID)

	tkGroup := g.Group("", middleware.KnowledgeBaseWorkspace(
		kb.NewResolveWorkspaceUseCase(pages, permissions),
	))

	tkGroup.POST("/kb/workspaces/:workspaceSlug/spaces/:spaceId/tickets/enable", h.Enable)
	tkGroup.GET("/kb/workspaces/:workspaceSlug/spaces/:spaceId/tickets", h.List)
	// 保存した絞り込みの件数バッジ（自分の担当・期限切れ・未割り当て・総数）。
	tkGroup.GET("/kb/workspaces/:workspaceSlug/spaces/:spaceId/tickets/counts", h.Counts)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/spaces/:spaceId/tickets", h.Create)
	// 表示キー（例 FRESTYLE-12）からの解決。キーはスペースの key を含む（domain.ParseTicketKey
	// が最後のハイフンで割る）ので URL 側にスペースを取らない。/tickets/:ticketId と衝突しない
	// よう /tickets/by-key/:key に独立させる。
	tkGroup.GET("/kb/workspaces/:workspaceSlug/tickets/by-key/:key", h.ResolveByKey)
	tkGroup.GET("/kb/workspaces/:workspaceSlug/tickets/:ticketId", h.Get)
	// 直下の子の一覧（孫は含まない）。
	tkGroup.GET("/kb/workspaces/:workspaceSlug/tickets/:ticketId/children", h.ListChildren)
	tkGroup.PUT("/kb/workspaces/:workspaceSlug/tickets/:ticketId", h.Update)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/tickets/:ticketId/move", h.Move)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/tickets/:ticketId/archive", h.Archive)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/tickets/:ticketId/restore", h.Restore)
	tkGroup.DELETE("/kb/workspaces/:workspaceSlug/tickets/:ticketId", h.Delete)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/tickets/:ticketId/restore-deleted", h.RestoreDeleted)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/tickets/:ticketId/status", h.ChangeStatus)
	tkGroup.PUT("/kb/workspaces/:workspaceSlug/tickets/:ticketId/parent", h.ChangeParent)
	tkGroup.PUT("/kb/workspaces/:workspaceSlug/tickets/:ticketId/assignee", h.Assign)
	tkGroup.DELETE("/kb/workspaces/:workspaceSlug/tickets/:ticketId/assignee", h.Unassign)
	tkGroup.GET("/kb/workspaces/:workspaceSlug/tickets/:ticketId/history", h.History)
	// ページへのチケット埋め込みの逆参照（段 5）。
	tkGroup.GET("/kb/workspaces/:workspaceSlug/tickets/:ticketId/page-backlinks", h.PageBacklinks)

	// 発言（段 3）。
	tkGroup.GET("/kb/workspaces/:workspaceSlug/tickets/:ticketId/comments", ch.List)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/tickets/:ticketId/comments",
		middleware.RateLimitPerMinutePerUser(ticketCreateCommentPerMinute, ticketCreateCommentBurst), ch.Create)
	tkGroup.PUT("/kb/workspaces/:workspaceSlug/tickets/:ticketId/comments/:commentId", ch.Update)
	tkGroup.DELETE("/kb/workspaces/:workspaceSlug/tickets/:ticketId/comments/:commentId", ch.Delete)
	tkGroup.GET("/kb/workspaces/:workspaceSlug/tickets/:ticketId/comments/:commentId/edits", ch.ListEdits)
	tkGroup.PUT("/kb/workspaces/:workspaceSlug/tickets/:ticketId/comments/:commentId/reactions/:emoji", ch.AddReaction)
	tkGroup.DELETE("/kb/workspaces/:workspaceSlug/tickets/:ticketId/comments/:commentId/reactions/:emoji", ch.RemoveReaction)

	// ラベル（段 4）。管理はスペース単位、チケットへの付け外しはチケット単位。
	tkGroup.GET("/kb/workspaces/:workspaceSlug/spaces/:spaceId/labels", lh.List)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/spaces/:spaceId/labels", lh.Create)
	tkGroup.PUT("/kb/workspaces/:workspaceSlug/spaces/:spaceId/labels/:labelId", lh.Update)
	tkGroup.DELETE("/kb/workspaces/:workspaceSlug/spaces/:spaceId/labels/:labelId", lh.Delete)
	tkGroup.PUT("/kb/workspaces/:workspaceSlug/tickets/:ticketId/labels/:labelId", lh.AddToTicket)
	tkGroup.DELETE("/kb/workspaces/:workspaceSlug/tickets/:ticketId/labels/:labelId", lh.RemoveFromTicket)

	// 添付（段 4）。
	tkGroup.GET("/kb/workspaces/:workspaceSlug/tickets/:ticketId/attachments", ah.List)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/tickets/:ticketId/attachments/upload-url", ah.IssueUploadURL)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/tickets/:ticketId/attachments", ah.Create)
	tkGroup.GET("/kb/workspaces/:workspaceSlug/tickets/:ticketId/attachments/:attachmentId/download-url", ah.IssueDownloadURL)
	tkGroup.DELETE("/kb/workspaces/:workspaceSlug/tickets/:ticketId/attachments/:attachmentId", ah.Delete)

	// 状態マスタ（管理画面）。
	tkGroup.GET("/kb/workspaces/:workspaceSlug/spaces/:spaceId/ticket-statuses", sh.List)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/spaces/:spaceId/ticket-statuses", sh.Create)
	tkGroup.PUT("/kb/workspaces/:workspaceSlug/spaces/:spaceId/ticket-statuses/:statusId", sh.Update)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/spaces/:spaceId/ticket-statuses/:statusId/set-initial", sh.SetInitial)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/spaces/:spaceId/ticket-statuses/:statusId/archive", sh.Archive)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/spaces/:spaceId/ticket-statuses/:statusId/restore", sh.Restore)

	// 種別マスタ（管理画面）。
	tkGroup.GET("/kb/workspaces/:workspaceSlug/spaces/:spaceId/ticket-types", th.List)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/spaces/:spaceId/ticket-types", th.Create)
	tkGroup.PUT("/kb/workspaces/:workspaceSlug/spaces/:spaceId/ticket-types/:typeId", th.Update)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/spaces/:spaceId/ticket-types/:typeId/set-default", th.SetDefault)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/spaces/:spaceId/ticket-types/:typeId/archive", th.Archive)
	tkGroup.POST("/kb/workspaces/:workspaceSlug/spaces/:spaceId/ticket-types/:typeId/restore", th.Restore)
}
