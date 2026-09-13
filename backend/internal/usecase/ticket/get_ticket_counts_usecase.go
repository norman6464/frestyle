package ticket

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// GetTicketCountsUseCase はバックログのサイドバー「保存した絞り込み」の件数バッジを返す。
// 「自分の担当」判定に使う principal は、フロントエンドに解決させず、ここで
// perms.FindUserPrincipal(workspaceID, userID) から解決する。
type GetTicketCountsUseCase struct {
	repo  repository.TicketRepository
	perms repository.KnowledgeBasePermissionRepository
}

func NewGetTicketCountsUseCase(
	r repository.TicketRepository, perms repository.KnowledgeBasePermissionRepository,
) *GetTicketCountsUseCase {
	return &GetTicketCountsUseCase{repo: r, perms: perms}
}

type GetTicketCountsInput struct {
	WorkspaceID string
	SpaceID     string
	UserID      uint64
}

func (u *GetTicketCountsUseCase) Execute(ctx context.Context, in GetTicketCountsInput) (repository.TicketCounts, error) {
	if in.WorkspaceID == "" {
		return repository.TicketCounts{}, errors.New("workspaceID is required")
	}
	if in.SpaceID == "" {
		return repository.TicketCounts{}, errors.New("spaceID is required")
	}
	if in.UserID == 0 {
		return repository.TicketCounts{}, errors.New("userID is required")
	}
	principal, err := u.perms.FindUserPrincipal(ctx, in.WorkspaceID, in.UserID)
	if err != nil {
		return repository.TicketCounts{}, err
	}
	return u.repo.GetTicketCounts(ctx, in.WorkspaceID, in.SpaceID, &principal.ID)
}
