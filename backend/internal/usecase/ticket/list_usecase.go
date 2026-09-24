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
	Limit        int
	Offset       int
}

func (u *ListTicketsUseCase) Execute(ctx context.Context, input ListTicketsInput) (repository.TicketList, error) {
	if input.WorkspaceID == "" {
		return repository.TicketList{}, errors.New("workspaceID is required")
	}
	if input.ProjectID == "" {
		return repository.TicketList{}, errors.New("projectID is required")
	}
	var assignedToMePrincipalID *string
	if input.AssignedToMe {
		if input.UserID == 0 {
			return repository.TicketList{}, errors.New("userID is required when assignedToMe is set")
		}
		principal, err := u.perms.FindUserPrincipal(ctx, input.WorkspaceID, input.UserID)
		if err != nil {
			return repository.TicketList{}, err
		}
		assignedToMePrincipalID = &principal.ID
	}
	return u.repo.ListTickets(ctx, repository.ListTicketsInput{
		WorkspaceID:             input.WorkspaceID,
		ProjectID:               input.ProjectID,
		IncludeArchived:         input.IncludeArchived,
		StatusID:                input.StatusID,
		TypeID:                  input.TypeID,
		AssigneePrincipalID:     input.AssigneePrincipalID,
		LabelID:                 input.LabelID,
		DueBefore:               input.DueBefore,
		StartAfter:              input.StartAfter,
		Unassigned:              input.Unassigned,
		AssignedToMePrincipalID: assignedToMePrincipalID,
		Overdue:                 input.Overdue,
		Q:                       input.Q,
		Limit:                   input.Limit,
		Offset:                  input.Offset,
	})
}
