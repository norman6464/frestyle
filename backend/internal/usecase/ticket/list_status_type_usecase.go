package ticket

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// TicketStatusWithUsage は状態 1 件と、その状態を使っている現役チケットの件数。
//
// 件数は tickets を数えた派生値なので domain.TicketStatus には持たせない（あの型は
// ticket_statuses の 1 行を表す）。管理画面は「使用中 N 件」を必ず出すので、
// 一覧と同じ 1 回の呼び出しで運ぶ。
type TicketStatusWithUsage struct {
	Status            domain.TicketStatus
	ActiveTicketCount int64
}

// TicketTypeWithUsage は TicketStatusWithUsage の種別版。
type TicketTypeWithUsage struct {
	Type              domain.TicketType
	ActiveTicketCount int64
}

// ListTicketStatusesUseCase はプロジェクトの状態一覧を、使用中の件数と一緒に返す
// （管理画面の表・作成フォームの選択肢）。
type ListTicketStatusesUseCase struct {
	repo repository.TicketRepository
}

func NewListTicketStatusesUseCase(r repository.TicketRepository) *ListTicketStatusesUseCase {
	return &ListTicketStatusesUseCase{repo: r}
}

type ListTicketStatusesInput struct {
	WorkspaceID     string
	ProjectID       string
	IncludeArchived bool
}

func (u *ListTicketStatusesUseCase) Execute(ctx context.Context, in ListTicketStatusesInput) ([]TicketStatusWithUsage, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.ProjectID == "" {
		return nil, errors.New("projectID is required")
	}
	statuses, err := u.repo.ListTicketStatuses(ctx, in.WorkspaceID, in.ProjectID, in.IncludeArchived)
	if err != nil {
		return nil, err
	}
	// 件数はプロジェクト 1 回の GROUP BY。状態ごとに数えると N+1 になる。
	counts, err := u.repo.CountActiveTicketsByStatusForProject(ctx, in.WorkspaceID, in.ProjectID)
	if err != nil {
		return nil, err
	}
	out := make([]TicketStatusWithUsage, len(statuses))
	for i, s := range statuses {
		out[i] = TicketStatusWithUsage{Status: s, ActiveTicketCount: counts[s.ID]}
	}
	return out, nil
}

// ListTicketTypesUseCase はプロジェクトの種別一覧を、使用中の件数と一緒に返す。
type ListTicketTypesUseCase struct {
	repo repository.TicketRepository
}

func NewListTicketTypesUseCase(r repository.TicketRepository) *ListTicketTypesUseCase {
	return &ListTicketTypesUseCase{repo: r}
}

type ListTicketTypesInput struct {
	WorkspaceID     string
	ProjectID       string
	IncludeArchived bool
}

func (u *ListTicketTypesUseCase) Execute(ctx context.Context, in ListTicketTypesInput) ([]TicketTypeWithUsage, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.ProjectID == "" {
		return nil, errors.New("projectID is required")
	}
	types, err := u.repo.ListTicketTypes(ctx, in.WorkspaceID, in.ProjectID, in.IncludeArchived)
	if err != nil {
		return nil, err
	}
	counts, err := u.repo.CountActiveTicketsByTypeForProject(ctx, in.WorkspaceID, in.ProjectID)
	if err != nil {
		return nil, err
	}
	out := make([]TicketTypeWithUsage, len(types))
	for i, t := range types {
		out[i] = TicketTypeWithUsage{Type: t, ActiveTicketCount: counts[t.ID]}
	}
	return out, nil
}
