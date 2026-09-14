package ticket

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ListTicketChildrenUseCase は 1 件の直下の子（孫は含まない）を並び順で返す。
//
// ListTicketsUseCase と分けているのは、対象がプロジェクトではなく親チケット 1 件で、
// 権限判定もプロジェクト単位ではなく親チケット単位（requireTicketPermission と同じ経路）に
// なるため。担当のバッチ引きはしない（一覧の子表示は件数が少なく、いまは付けない —
// 要る場面が出たら ListTicketsUseCase と同じ形へ寄せる）。
type ListTicketChildrenUseCase struct {
	repo repository.TicketRepository
}

func NewListTicketChildrenUseCase(r repository.TicketRepository) *ListTicketChildrenUseCase {
	return &ListTicketChildrenUseCase{repo: r}
}

type ListTicketChildrenInput struct {
	WorkspaceID string
	// ParentTicketID は子を数える側のチケット。
	ParentTicketID string
}

func (u *ListTicketChildrenUseCase) Execute(ctx context.Context, in ListTicketChildrenInput) ([]domain.Ticket, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.ParentTicketID == "" {
		return nil, errors.New("parentTicketID is required")
	}
	parent, err := u.repo.FindTicket(ctx, in.WorkspaceID, in.ParentTicketID)
	if err != nil {
		return nil, err
	}
	return u.repo.ListTicketChildren(ctx, in.WorkspaceID, parent.ProjectID, in.ParentTicketID)
}
