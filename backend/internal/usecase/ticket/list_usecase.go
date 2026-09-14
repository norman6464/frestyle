package ticket

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ListTicketsUseCase はプロジェクト内のチケット一覧を返す（position 順）。担当は同じ
// 問い合わせの LEFT JOIN で一緒に返る（画面が一覧でも担当を出すため）。
// 絞り込み条件はそのまま repository へ渡す（畳み方の規則を持たない、薄い層）。
// AssignedToMe だけは例外——「自分」の principal をフロントエンドに解決させないため、
// ここで perms.FindUserPrincipal を呼んで解決してから repository へ渡す。
type ListTicketsUseCase struct {
	repo  repository.TicketRepository
	perms repository.KnowledgeBasePermissionRepository
}

func NewListTicketsUseCase(r repository.TicketRepository, perms repository.KnowledgeBasePermissionRepository) *ListTicketsUseCase {
	return &ListTicketsUseCase{repo: r, perms: perms}
}

type ListTicketsInput struct {
	WorkspaceID         string
	ProjectID           string
	IncludeArchived     bool
	StatusID            *string
	TypeID              *string
	AssigneePrincipalID *string
	// LabelID / DueBefore / StartAfter。DueBefore / StartAfter は 'YYYY-MM-DD' 文字列。
	LabelID    *string
	DueBefore  *string
	StartAfter *string
	// Unassigned / AssignedToMe / Overdue / Q は保存した絞り込み・題名検索。
	// Unassigned・AssignedToMe・AssigneePrincipalID は互いに排他（呼び出し側の handler が
	// 検証する）。AssignedToMe が true のときは UserID が必須。
	Unassigned   bool
	AssignedToMe bool
	UserID       uint64
	Overdue      bool
	Q            *string
}

func (u *ListTicketsUseCase) Execute(ctx context.Context, in ListTicketsInput) ([]repository.TicketWithAssignee, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.ProjectID == "" {
		return nil, errors.New("projectID is required")
	}
	var assignedToMePrincipalID *string
	if in.AssignedToMe {
		if in.UserID == 0 {
			return nil, errors.New("userID is required when assignedToMe is set")
		}
		principal, err := u.perms.FindUserPrincipal(ctx, in.WorkspaceID, in.UserID)
		if err != nil {
			return nil, err
		}
		assignedToMePrincipalID = &principal.ID
	}
	return u.repo.ListTickets(ctx, repository.ListTicketsInput{
		WorkspaceID:             in.WorkspaceID,
		ProjectID:               in.ProjectID,
		IncludeArchived:         in.IncludeArchived,
		StatusID:                in.StatusID,
		TypeID:                  in.TypeID,
		AssigneePrincipalID:     in.AssigneePrincipalID,
		LabelID:                 in.LabelID,
		DueBefore:               in.DueBefore,
		StartAfter:              in.StartAfter,
		Unassigned:              in.Unassigned,
		AssignedToMePrincipalID: assignedToMePrincipalID,
		Overdue:                 in.Overdue,
		Q:                       in.Q,
	})
}
