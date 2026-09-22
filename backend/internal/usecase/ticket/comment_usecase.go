package ticket

import (
	"context"
	"errors"
	"log/slog"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ErrNotCommentAuthor は投稿者本人でも CanManage でもない相手が編集・削除を試みたときに返す
// （handler が 403 にマップする）。
var ErrNotCommentAuthor = errors.New("actor is not the comment author")

// CreateTicketCommentUseCase はチケットへ発言（返信を含む）を 1 件作る。
// @mention を拾いワークスペース一員だけへ ticket_mentioned 通知を送り、担当者本人以外なら
// ticket_commented も送る（ウォッチャー機構が無いので当面は担当で代用）。
type CreateTicketCommentUseCase struct {
	comments repository.TicketCommentRepository
	tickets  repository.TicketRepository
	perms    repository.KnowledgeBasePermissionRepository
	notifs   repository.NotificationRepository
}

func NewCreateTicketCommentUseCase(
	comments repository.TicketCommentRepository,
	tickets repository.TicketRepository,
	perms repository.KnowledgeBasePermissionRepository,
	notifs repository.NotificationRepository,
) *CreateTicketCommentUseCase {
	return &CreateTicketCommentUseCase{comments: comments, tickets: tickets, perms: perms, notifs: notifs}
}

type CreateTicketCommentInput struct {
	WorkspaceID     string
	TicketID        string
	ParentCommentID *string
	AuthorUserID    uint64
	Body            string
}

func (u *CreateTicketCommentUseCase) Execute(ctx context.Context, in CreateTicketCommentInput) (*domain.TicketComment, error) {
	if in.WorkspaceID == "" || in.TicketID == "" {
		return nil, errors.New("workspaceID and ticketID are required")
	}
	if in.AuthorUserID == 0 {
		return nil, errors.New("authorUserID is required")
	}
	if err := domain.ValidateCommentBody(in.Body); err != nil {
		return nil, err
	}
	t, err := u.tickets.FindTicket(ctx, in.WorkspaceID, in.TicketID)
	if err != nil {
		return nil, err
	}
	if in.ParentCommentID != nil {
		// 親発言が同じチケットに属し削除済みでないか確認する（別チケット・削除済みへの返信を防ぐ）。
		if _, err := u.comments.FindTicketComment(ctx, in.WorkspaceID, in.TicketID, *in.ParentCommentID); err != nil {
			return nil, err
		}
	}
	c := &domain.TicketComment{
		WorkspaceID: in.WorkspaceID, TicketID: in.TicketID,
		ParentCommentID: in.ParentCommentID, AuthorUserID: in.AuthorUserID, Body: in.Body,
	}
	if err := u.comments.CreateTicketComment(ctx, c); err != nil {
		return nil, err
	}
	u.notify(ctx, in, t)
	return c, nil
}

// notify は通知作成に失敗しても発言の作成自体は失敗させない（保存は既に成功しているため）。
func (u *CreateTicketCommentUseCase) notify(ctx context.Context, in CreateTicketCommentInput, t *domain.Ticket) {
	var notifs []domain.Notification

	mentioned := ExtractTicketCommentMentions([]byte(in.Body))
	seen := map[uint64]struct{}{in.AuthorUserID: {}} // 自分への通知は作らない
	// 所属確認は名指しされた全員をまとめて 1 回で解決する（逐次 SELECT は接続プールを圧迫する）。
	// メンションが無ければ問い合わせ自体を出さない。
	var members map[uint64]bool
	if len(mentioned) > 0 {
		var err error
		members, err = u.perms.IsWorkspaceMemberBulk(ctx, in.WorkspaceID, mentioned)
		if err != nil {
			slog.WarnContext(ctx, "ticket comment: mention membership check failed", "err", err, "ticketId", in.TicketID)
			members = nil
		}
	}
	for _, userID := range mentioned {
		if _, dup := seen[userID]; dup {
			continue
		}
		seen[userID] = struct{}{}
		if !members[userID] {
			continue
		}
		notifs = append(notifs, domain.Notification{
			UserID: userID, Type: domain.NotificationTypeTicketMentioned,
			Title: "チケットで名指しされました", Body: t.Title,
			LinkPath: ticketLinkPath(in.TicketID),
		})
	}

	if assignment, err := u.tickets.FindTicketAssignment(ctx, in.WorkspaceID, in.TicketID); err == nil && assignment != nil {
		// assignee_principal_id は principals への複合 FK。通知は users.id 宛にしか送れないため
		// kind='user' の principal だけ解決する（group 等の代理担当は対象外）。
		if principal, err := u.perms.FindPrincipal(ctx, in.WorkspaceID, assignment.AssigneePrincipalID); err == nil &&
			principal != nil && principal.UserID != nil {
			assigneeUserID := *principal.UserID
			if _, dup := seen[assigneeUserID]; !dup {
				notifs = append(notifs, domain.Notification{
					UserID: assigneeUserID, Type: domain.NotificationTypeTicketCommented,
					Title: "担当チケットにコメントが付きました", Body: t.Title,
					LinkPath: ticketLinkPath(in.TicketID),
				})
			}
		}
	}

	if len(notifs) == 0 {
		return
	}
	if err := u.notifs.CreateMany(ctx, notifs); err != nil {
		slog.WarnContext(ctx, "ticket comment: notification create failed", "err", err, "ticketId", in.TicketID)
	}
}

// UpdateTicketCommentUseCase は発言の本文を書き換える。投稿者本人かワークスペースの CanManage
// を持つ相手だけ可能（ActorCanManage は handler が権限判定済みの結果を渡す）。
type UpdateTicketCommentUseCase struct {
	repo      repository.TicketCommentRepository
	txManager repository.TxManager
}

func NewUpdateTicketCommentUseCase(repo repository.TicketCommentRepository, txManager repository.TxManager) *UpdateTicketCommentUseCase {
	return &UpdateTicketCommentUseCase{repo: repo, txManager: txManager}
}

type UpdateTicketCommentInput struct {
	WorkspaceID    string
	TicketID       string
	CommentID      string
	ActorUserID    uint64
	ActorCanManage bool
	Body           string
}

func (u *UpdateTicketCommentUseCase) Execute(ctx context.Context, in UpdateTicketCommentInput) (*domain.TicketComment, error) {
	if err := domain.ValidateCommentBody(in.Body); err != nil {
		return nil, err
	}
	existing, err := u.repo.FindTicketComment(ctx, in.WorkspaceID, in.TicketID, in.CommentID)
	if err != nil {
		return nil, err
	}
	if existing.AuthorUserID != in.ActorUserID && !in.ActorCanManage {
		return nil, ErrNotCommentAuthor
	}
	var updated *domain.TicketComment
	// 退避 → 書き換えを 1 トランザクションに入れる。片方だけ成功すると中間状態が残るため
	// （CreateCommentThreadUseCase と同じ理由）。
	err = u.txManager.DoInTx(ctx, func(ctx context.Context) error {
		if err := u.repo.InsertTicketCommentEdit(ctx, &domain.TicketCommentEdit{
			WorkspaceID: in.WorkspaceID, CommentID: in.CommentID,
			EditorUserID: in.ActorUserID, PreviousBody: existing.Body,
		}); err != nil {
			return err
		}
		updated, err = u.repo.UpdateTicketCommentBody(ctx, in.WorkspaceID, in.TicketID, in.CommentID, in.Body)
		return err
	})
	if err != nil {
		return nil, err
	}
	return updated, nil
}

// DeleteTicketCommentUseCase は発言を deleted_at で論理削除する（返信がぶら下がる場合に
// 親を残す必要があるため、物理削除はしない）。
type DeleteTicketCommentUseCase struct {
	repo repository.TicketCommentRepository
}

func NewDeleteTicketCommentUseCase(repo repository.TicketCommentRepository) *DeleteTicketCommentUseCase {
	return &DeleteTicketCommentUseCase{repo: repo}
}

type DeleteTicketCommentInput struct {
	WorkspaceID    string
	TicketID       string
	CommentID      string
	ActorUserID    uint64
	ActorCanManage bool
}

func (u *DeleteTicketCommentUseCase) Execute(ctx context.Context, in DeleteTicketCommentInput) error {
	existing, err := u.repo.FindTicketComment(ctx, in.WorkspaceID, in.TicketID, in.CommentID)
	if err != nil {
		return err
	}
	if existing.AuthorUserID != in.ActorUserID && !in.ActorCanManage {
		return ErrNotCommentAuthor
	}
	return u.repo.DeleteTicketComment(ctx, in.WorkspaceID, in.TicketID, in.CommentID)
}

type TicketCommentWithReactions struct {
	Comment   domain.TicketComment
	Reactions []domain.TicketCommentReaction
}

// ListTicketCommentsUseCase はチケットの発言一覧を反応付きで返す。ツリー組み立ては
// 呼び出し側に任せ、ここではフラットな時系列のまま返す。
type ListTicketCommentsUseCase struct {
	repo repository.TicketCommentRepository
}

func NewListTicketCommentsUseCase(repo repository.TicketCommentRepository) *ListTicketCommentsUseCase {
	return &ListTicketCommentsUseCase{repo: repo}
}

func (u *ListTicketCommentsUseCase) Execute(ctx context.Context, workspaceID, ticketID string) ([]TicketCommentWithReactions, error) {
	comments, err := u.repo.ListTicketComments(ctx, workspaceID, ticketID)
	if err != nil {
		return nil, err
	}
	if len(comments) == 0 {
		return []TicketCommentWithReactions{}, nil
	}
	ids := make([]string, 0, len(comments))
	for _, c := range comments {
		ids = append(ids, c.ID)
	}
	reactions, err := u.repo.ListTicketCommentReactions(ctx, workspaceID, ids)
	if err != nil {
		return nil, err
	}
	byComment := make(map[string][]domain.TicketCommentReaction, len(comments))
	for _, r := range reactions {
		byComment[r.CommentID] = append(byComment[r.CommentID], r)
	}
	out := make([]TicketCommentWithReactions, 0, len(comments))
	for _, c := range comments {
		out = append(out, TicketCommentWithReactions{Comment: c, Reactions: byComment[c.ID]})
	}
	return out, nil
}

// ListTicketCommentEditsUseCase は発言 1 件の編集履歴をオンデマンドで返す（一覧応答には
// 含めない。大半の発言は編集されないため）。
type ListTicketCommentEditsUseCase struct {
	comments repository.TicketCommentRepository
}

func NewListTicketCommentEditsUseCase(comments repository.TicketCommentRepository) *ListTicketCommentEditsUseCase {
	return &ListTicketCommentEditsUseCase{comments: comments}
}

func (u *ListTicketCommentEditsUseCase) Execute(ctx context.Context, workspaceID, ticketID, commentID string) ([]domain.TicketCommentEdit, error) {
	// 実在確認（他チケット・他テナントの commentId を渡されても 404 にする）。
	if _, err := u.comments.FindTicketComment(ctx, workspaceID, ticketID, commentID); err != nil {
		return nil, err
	}
	return u.comments.ListTicketCommentEdits(ctx, workspaceID, commentID)
}

// AddTicketCommentReactionUseCase / RemoveTicketCommentReactionUseCase は発言への反応の
// 付け外し。付け外しは冪等（AddTicketCommentReaction のドキュメント参照）。
type AddTicketCommentReactionUseCase struct {
	comments repository.TicketCommentRepository
}

func NewAddTicketCommentReactionUseCase(comments repository.TicketCommentRepository) *AddTicketCommentReactionUseCase {
	return &AddTicketCommentReactionUseCase{comments: comments}
}

func (u *AddTicketCommentReactionUseCase) Execute(ctx context.Context, workspaceID, ticketID, commentID string, userID uint64, emoji string) error {
	if !domain.ValidTicketCommentReactionEmoji(emoji) {
		return domain.ErrInvalidTicketCommentReactionEmoji
	}
	// 実在確認（削除済み・他チケットの commentId への反応を防ぐ）。
	if _, err := u.comments.FindTicketComment(ctx, workspaceID, ticketID, commentID); err != nil {
		return err
	}
	return u.comments.AddTicketCommentReaction(ctx, workspaceID, commentID, userID, emoji)
}

type RemoveTicketCommentReactionUseCase struct {
	comments repository.TicketCommentRepository
}

func NewRemoveTicketCommentReactionUseCase(comments repository.TicketCommentRepository) *RemoveTicketCommentReactionUseCase {
	return &RemoveTicketCommentReactionUseCase{comments: comments}
}

func (u *RemoveTicketCommentReactionUseCase) Execute(ctx context.Context, workspaceID, ticketID, commentID string, userID uint64, emoji string) error {
	if _, err := u.comments.FindTicketComment(ctx, workspaceID, ticketID, commentID); err != nil {
		return err
	}
	return u.comments.RemoveTicketCommentReaction(ctx, workspaceID, commentID, userID, emoji)
}

// ticketLinkPath は通知からチケットの全画面へ飛ぶためのアプリ内パス。フロントの
// /tickets/:ticketId と一致させる。ここで組み立てておけば、通知の行は種別を知らなくても飛べる。
func ticketLinkPath(ticketID string) string {
	return "/tickets/" + ticketID
}
