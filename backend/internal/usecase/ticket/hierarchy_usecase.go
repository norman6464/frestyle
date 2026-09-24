package ticket

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ListTicketAncestorsUseCase はチケットのパンくず（根から順の祖先列）を返す
// （ticket_paths の閉包表を読む。段 5）。
//
// ページ側の ListViewableAncestorsUseCase と違い、祖先ごとの可視判定は行わない。
// チケットの親は常に同一プロジェクト限定（fk_tickets_parent）なので、このチケット自体が
// 見えている（handler が requireTicketPermission を先に通している）なら、同じプロジェクトの
// 祖先もすべて見える（チケットの実効権限はワークスペース単位）。
type ListTicketAncestorsUseCase struct {
	repo repository.TicketRepository
}

func NewListTicketAncestorsUseCase(r repository.TicketRepository) *ListTicketAncestorsUseCase {
	return &ListTicketAncestorsUseCase{repo: r}
}

func (u *ListTicketAncestorsUseCase) Execute(ctx context.Context, workspaceID, ticketID string) ([]domain.Ticket, error) {
	if workspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if ticketID == "" {
		return nil, errors.New("ticketID is required")
	}
	return u.repo.ListTicketAncestors(ctx, workspaceID, ticketID)
}

const (
	// DefaultPageBacklinkLimit は件数を指定しないときの上限。
	DefaultPageBacklinkLimit = 10
	// MaxPageBacklinkLimit は指定できる上限（逆参照は短い一覧として出す口で、全件は約束しない）。
	MaxPageBacklinkLimit = 50
)

// ErrInvalidPageBacklinkLimit は件数が 1〜MaxPageBacklinkLimit の外。
var ErrInvalidPageBacklinkLimit = errors.New("limit must be between 1 and 50")

// ListTicketsReferencingPageUseCase はページを本文中の pageRef で参照しているチケットを、
// 更新の新しい順に上限まで返す（ホームの「続きからはじめる」が最後に開いたページに添える）。
//
// チケットには pages のような個票の権限が無く、実効権限はワークスペース単位のため、ここでは
// 可視判定を行わない — 候補チケットをそのまま返し、バックログ側を見せてよいかの判定は
// handler 側（kb.CheckWorkspacePermissionUseCase で 1 回）に委ねる。usecase/ticket は
// usecase/kb を import できない（サブパッケージ同士は import しない規約）ため、この分担は
// handler 層でのみ組める。
type ListTicketsReferencingPageUseCase struct {
	repo repository.TicketRepository
}

func NewListTicketsReferencingPageUseCase(r repository.TicketRepository) *ListTicketsReferencingPageUseCase {
	return &ListTicketsReferencingPageUseCase{repo: r}
}

type ListTicketsReferencingPageInput struct {
	WorkspaceID string
	PageID      string
	// Limit は返す最大件数（1〜MaxPageBacklinkLimit）。
	Limit int
}

func (u *ListTicketsReferencingPageUseCase) Execute(
	ctx context.Context, in ListTicketsReferencingPageInput,
) ([]domain.TicketReference, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.PageID == "" {
		return nil, errors.New("pageID is required")
	}
	if in.Limit < 1 || in.Limit > MaxPageBacklinkLimit {
		return nil, ErrInvalidPageBacklinkLimit
	}
	return u.repo.ListTicketsReferencingPage(ctx, in.WorkspaceID, in.PageID, in.Limit)
}
