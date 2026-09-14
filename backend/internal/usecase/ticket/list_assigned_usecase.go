package ticket

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ListAssignedTicketsUseCase は「自分の担当」の一覧を返す。
//
// ListTicketsUseCase（プロジェクト内の一覧）との違いは**射程**。こちらはワークスペース
// 全体を横断するので、プロジェクトの指定を取らない。代わりに「誰の担当か」は必ず
// 呼び出した本人になる —— 他人の担当を覗く口にはしない（他人の担当を見たい要求が出たら、
// 覗いてよい相手の範囲を決めてから別の入り口として足す）。
//
// 「自分」の principal をフロントエンドに解決させないのは ListTicketsUseCase と同じ理由。
type ListAssignedTicketsUseCase struct {
	repo  repository.TicketRepository
	perms repository.KnowledgeBasePermissionRepository
}

func NewListAssignedTicketsUseCase(r repository.TicketRepository, perms repository.KnowledgeBasePermissionRepository) *ListAssignedTicketsUseCase {
	return &ListAssignedTicketsUseCase{repo: r, perms: perms}
}

type ListAssignedTicketsInput struct {
	WorkspaceID string
	// UserID は呼び出した本人。ここから principal を引く。
	UserID uint64
}

func (u *ListAssignedTicketsUseCase) Execute(ctx context.Context, in ListAssignedTicketsInput) ([]domain.AssignedTicket, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	principal, err := u.perms.FindUserPrincipal(ctx, in.WorkspaceID, in.UserID)
	if err != nil {
		return nil, err
	}
	return u.repo.ListAssignedTickets(ctx, in.WorkspaceID, principal.ID)
}
