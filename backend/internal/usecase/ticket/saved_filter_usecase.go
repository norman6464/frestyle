package ticket

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ErrTicketSavedFilterLimitReached は本人 × プロジェクトの保存数が上限
// （domain.MaxTicketSavedFiltersPerProject）に達しているときに返す。
var ErrTicketSavedFilterLimitReached = errors.New("ticket saved filter limit reached")

// SavedFilterFields は保存した絞り込みのうち利用者が決める部分（名前と条件）。作成・更新で共通。
type SavedFilterFields struct {
	Name                string
	StatusID            *string
	TypeID              *string
	LabelID             *string
	AssigneePrincipalID *string
	Unassigned          bool
	AssignedToMe        bool
	Overdue             bool
	Q                   *string
}

func (f SavedFilterFields) toDomain(workspaceID, projectID string, userID uint64) domain.TicketSavedFilter {
	return domain.TicketSavedFilter{
		WorkspaceID: workspaceID, ProjectID: projectID, UserID: userID, Name: f.Name,
		StatusID: f.StatusID, TypeID: f.TypeID, LabelID: f.LabelID, AssigneePrincipalID: f.AssigneePrincipalID,
		Unassigned: f.Unassigned, AssignedToMe: f.AssignedToMe, Overdue: f.Overdue, Q: f.Q,
	}
}

// SavedFilterWithCount は保存した絞り込みと、いまその条件に合う現役チケットの件数の組
// （画面の一覧が名前の横に件数を出す）。
type SavedFilterWithCount struct {
	Filter domain.TicketSavedFilter
	Count  int64
}

// savedFilterCounter は「絞り込みに合う件数」を数える部分。Create / Update / List が共有する。
// 「自分の担当」の主体はフロントエンドに解決させず、ここで perms.FindUserPrincipal から引く
// （ListTicketsUseCase / GetTicketCountsUseCase と同じ）。主体を引くのは「自分の担当」を含む
// 絞り込みが 1 つでもあるときだけ（要らない問い合わせを増やさない）。
type savedFilterCounter struct {
	tickets repository.TicketRepository
	perms   repository.KnowledgeBasePermissionRepository
}

func (c savedFilterCounter) count(
	ctx context.Context, workspaceID string, userID uint64, filters []domain.TicketSavedFilter,
) ([]SavedFilterWithCount, error) {
	var myPrincipalID *string
	for i := range filters {
		if filters[i].AssignedToMe {
			principal, err := c.perms.FindUserPrincipal(ctx, workspaceID, userID)
			if err != nil {
				return nil, err
			}
			myPrincipalID = &principal.ID
			break
		}
	}
	out := make([]SavedFilterWithCount, 0, len(filters))
	for i := range filters {
		n, err := c.tickets.CountTickets(ctx, savedFilterListInput(filters[i], myPrincipalID))
		if err != nil {
			return nil, err
		}
		out = append(out, SavedFilterWithCount{Filter: filters[i], Count: n})
	}
	return out, nil
}

// savedFilterListInput は保存した条件を ListTickets / CountTickets の入力に写す（一覧画面が
// URL の条件から組み立てるのと同じ形）。アーカイブ済みは数えない（固定の 4 つの件数
// GetTicketCounts と同じ）。
func savedFilterListInput(f domain.TicketSavedFilter, myPrincipalID *string) repository.ListTicketsInput {
	in := repository.ListTicketsInput{
		WorkspaceID: f.WorkspaceID, ProjectID: f.ProjectID,
		StatusID: f.StatusID, TypeID: f.TypeID, LabelID: f.LabelID,
		AssigneePrincipalID: f.AssigneePrincipalID, Unassigned: f.Unassigned, Overdue: f.Overdue, Q: f.Q,
	}
	if f.AssignedToMe {
		in.AssignedToMePrincipalID = myPrincipalID
	}
	return in
}

// CreateSavedFilterUseCase は絞り込みに名前を付けて保存する。保存数の上限は usecase が数えて
// 守る（同時に 2 つ作ると 1 つ超えることはあるが、上限は画面の一覧を長くしないための目安で、
// 厳密に守る価値が無い）。
type CreateSavedFilterUseCase struct {
	filters repository.TicketSavedFilterRepository
	counter savedFilterCounter
}

func NewCreateSavedFilterUseCase(
	filters repository.TicketSavedFilterRepository,
	tickets repository.TicketRepository,
	perms repository.KnowledgeBasePermissionRepository,
) *CreateSavedFilterUseCase {
	return &CreateSavedFilterUseCase{filters: filters, counter: savedFilterCounter{tickets: tickets, perms: perms}}
}

type CreateSavedFilterInput struct {
	WorkspaceID string
	ProjectID   string
	UserID      uint64
	SavedFilterFields
}

func (u *CreateSavedFilterUseCase) Execute(ctx context.Context, in CreateSavedFilterInput) (*SavedFilterWithCount, error) {
	if in.WorkspaceID == "" || in.ProjectID == "" || in.UserID == 0 {
		return nil, errors.New("workspaceID, projectID and userID are required")
	}
	f := in.toDomain(in.WorkspaceID, in.ProjectID, in.UserID)
	if err := f.Normalize(); err != nil {
		return nil, err
	}
	n, err := u.filters.CountTicketSavedFilters(ctx, in.WorkspaceID, in.ProjectID, in.UserID)
	if err != nil {
		return nil, err
	}
	if n >= domain.MaxTicketSavedFiltersPerProject {
		return nil, ErrTicketSavedFilterLimitReached
	}
	if err := u.filters.InsertTicketSavedFilter(ctx, &f); err != nil {
		return nil, err
	}
	counted, err := u.counter.count(ctx, in.WorkspaceID, in.UserID, []domain.TicketSavedFilter{f})
	if err != nil {
		return nil, err
	}
	return &counted[0], nil
}

// UpdateSavedFilterUseCase は保存した絞り込みの名前と条件を丸ごと書き換える（本人の分だけ）。
type UpdateSavedFilterUseCase struct {
	filters repository.TicketSavedFilterRepository
	counter savedFilterCounter
}

func NewUpdateSavedFilterUseCase(
	filters repository.TicketSavedFilterRepository,
	tickets repository.TicketRepository,
	perms repository.KnowledgeBasePermissionRepository,
) *UpdateSavedFilterUseCase {
	return &UpdateSavedFilterUseCase{filters: filters, counter: savedFilterCounter{tickets: tickets, perms: perms}}
}

type UpdateSavedFilterInput struct {
	WorkspaceID string
	ProjectID   string
	UserID      uint64
	FilterID    string
	SavedFilterFields
}

func (u *UpdateSavedFilterUseCase) Execute(ctx context.Context, in UpdateSavedFilterInput) (*SavedFilterWithCount, error) {
	if in.WorkspaceID == "" || in.ProjectID == "" || in.UserID == 0 || in.FilterID == "" {
		return nil, errors.New("workspaceID, projectID, userID and filterID are required")
	}
	f := in.toDomain(in.WorkspaceID, in.ProjectID, in.UserID)
	f.ID = in.FilterID
	if err := f.Normalize(); err != nil {
		return nil, err
	}
	if err := u.filters.UpdateTicketSavedFilter(ctx, &f); err != nil {
		return nil, err
	}
	counted, err := u.counter.count(ctx, in.WorkspaceID, in.UserID, []domain.TicketSavedFilter{f})
	if err != nil {
		return nil, err
	}
	return &counted[0], nil
}

// DeleteSavedFilterUseCase は保存した絞り込みを消す（本人の分だけ。他人の分は「無い」）。
type DeleteSavedFilterUseCase struct {
	filters repository.TicketSavedFilterRepository
}

func NewDeleteSavedFilterUseCase(filters repository.TicketSavedFilterRepository) *DeleteSavedFilterUseCase {
	return &DeleteSavedFilterUseCase{filters: filters}
}

type DeleteSavedFilterInput struct {
	WorkspaceID string
	ProjectID   string
	UserID      uint64
	FilterID    string
}

func (u *DeleteSavedFilterUseCase) Execute(ctx context.Context, in DeleteSavedFilterInput) error {
	if in.WorkspaceID == "" || in.ProjectID == "" || in.UserID == 0 || in.FilterID == "" {
		return errors.New("workspaceID, projectID, userID and filterID are required")
	}
	return u.filters.DeleteTicketSavedFilter(ctx, in.WorkspaceID, in.ProjectID, in.UserID, in.FilterID)
}

// ListSavedFiltersUseCase は本人がそのプロジェクトで保存した絞り込みを、それぞれの件数付きで返す。
// 件数は絞り込みごとに 1 回ずつ数える（本人 × プロジェクトで高々 20 件。1 つの SQL に畳むには
// 条件の組み合わせが可変で、sqlc の静的なクエリでは書けない）。
type ListSavedFiltersUseCase struct {
	filters repository.TicketSavedFilterRepository
	counter savedFilterCounter
}

func NewListSavedFiltersUseCase(
	filters repository.TicketSavedFilterRepository,
	tickets repository.TicketRepository,
	perms repository.KnowledgeBasePermissionRepository,
) *ListSavedFiltersUseCase {
	return &ListSavedFiltersUseCase{filters: filters, counter: savedFilterCounter{tickets: tickets, perms: perms}}
}

type ListSavedFiltersInput struct {
	WorkspaceID string
	ProjectID   string
	UserID      uint64
}

func (u *ListSavedFiltersUseCase) Execute(ctx context.Context, in ListSavedFiltersInput) ([]SavedFilterWithCount, error) {
	if in.WorkspaceID == "" || in.ProjectID == "" || in.UserID == 0 {
		return nil, errors.New("workspaceID, projectID and userID are required")
	}
	filters, err := u.filters.ListTicketSavedFilters(ctx, in.WorkspaceID, in.ProjectID, in.UserID)
	if err != nil {
		return nil, err
	}
	return u.counter.count(ctx, in.WorkspaceID, in.UserID, filters)
}
