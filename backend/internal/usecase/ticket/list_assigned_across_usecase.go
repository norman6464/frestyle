package ticket

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

const (
	// DefaultAssignedAcrossLimit は件数を指定しないときの上限（ホームの広い画面で並べる行数）。
	DefaultAssignedAcrossLimit = 3
	// MaxAssignedAcrossLimit は指定できる上限。ホームの短い一覧のための口で、全件は「自分の担当」の
	// 画面（ワークスペースごとの ListAssignedTicketsUseCase）が受け持つ。
	MaxAssignedAcrossLimit = 20
)

// ErrInvalidAssignedAcrossLimit は件数が 1〜MaxAssignedAcrossLimit の外。
var ErrInvalidAssignedAcrossLimit = errors.New("limit must be between 1 and 20")

// ListAssignedAcrossWorkspacesUseCase はホームの「自分の担当」を返す。所属する全ワークスペースを
// 横断し、未完了のものを期限の近い順（期限なしは最後）に上限まで。
//
// 認可が先、上限が後。所属一覧の役割を domain の規則（ResolveScopePermission の CanView。
// 1 ワークスペースの担当画面やチケットの入口と同じ判定）にかけ、チケットを見てよいワークスペース
// だけを repository に渡す。見られないワークスペースの行が上限を埋めて、見てよい行を押し出す
// ことは起きない。
//
// 誰の担当かは常に呼び出した本人（ListAssignedTicketsUseCase と同じく、他人の担当は覗かせない）。
type ListAssignedAcrossWorkspacesUseCase struct {
	repo  repository.TicketRepository
	perms repository.KnowledgeBasePermissionRepository
}

func NewListAssignedAcrossWorkspacesUseCase(
	r repository.TicketRepository, perms repository.KnowledgeBasePermissionRepository,
) *ListAssignedAcrossWorkspacesUseCase {
	return &ListAssignedAcrossWorkspacesUseCase{repo: r, perms: perms}
}

type ListAssignedAcrossWorkspacesInput struct {
	// UserID は呼び出した本人。
	UserID uint64
	// Limit は返す最大件数（1〜MaxAssignedAcrossLimit）。
	Limit int
}

func (u *ListAssignedAcrossWorkspacesUseCase) Execute(
	ctx context.Context, in ListAssignedAcrossWorkspacesInput,
) ([]domain.AssignedTicketSummary, error) {
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	if in.Limit < 1 || in.Limit > MaxAssignedAcrossLimit {
		return nil, ErrInvalidAssignedAcrossLimit
	}
	workspaces, err := u.perms.ListMemberWorkspaces(ctx, in.UserID)
	if err != nil {
		return nil, err
	}
	viewable := make([]string, 0, len(workspaces))
	for _, ws := range workspaces {
		if domain.ResolveScopePermission(ws.Facts).CanView {
			viewable = append(viewable, ws.Workspace.ID)
		}
	}
	if len(viewable) == 0 {
		return []domain.AssignedTicketSummary{}, nil
	}
	return u.repo.ListAssignedTicketsAcrossWorkspaces(ctx, in.UserID, viewable, in.Limit)
}
