package ticket_test

import (
	"context"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

const (
	sfProject            = "project-sf"
	sfUser        uint64 = 7
	sfMyPrincipal        = "principal-me"
)

func sfPtr(s string) *string { return &s }

type savedFilterMocks struct {
	filters *mockTicketSavedFilterRepo
	tickets *mockTicketRepo
	perms   *mockKBPermissionRepo
}

func newSavedFilterMocks() savedFilterMocks {
	return savedFilterMocks{filters: &mockTicketSavedFilterRepo{}, tickets: &mockTicketRepo{}, perms: &mockKBPermissionRepo{}}
}

func (m savedFilterMocks) create() *ticket.CreateSavedFilterUseCase {
	return ticket.NewCreateSavedFilterUseCase(m.filters, m.tickets, m.perms)
}

func (m savedFilterMocks) update() *ticket.UpdateSavedFilterUseCase {
	return ticket.NewUpdateSavedFilterUseCase(m.filters, m.tickets, m.perms)
}

func (m savedFilterMocks) list() *ticket.ListSavedFiltersUseCase {
	return ticket.NewListSavedFiltersUseCase(m.filters, m.tickets, m.perms)
}

// stubInsert は InsertTicketSavedFilter が採番して書き戻す振る舞いをまねる。
func (m savedFilterMocks) stubInsert(id string) {
	m.filters.On("InsertTicketSavedFilter", mock.Anything, mock.AnythingOfType("*domain.TicketSavedFilter")).
		Run(func(args mock.Arguments) { args.Get(1).(*domain.TicketSavedFilter).ID = id }).Return(nil)
}

func Test_保存した絞り込み作成_名前や条件の誤りはrepositoryへ行く前に拒否(t *testing.T) {
	m := newSavedFilterMocks()
	uc := m.create()
	ctx := context.Background()
	base := ticket.CreateSavedFilterInput{WorkspaceID: tkWS, ProjectID: sfProject, UserID: sfUser}

	in := base
	in.Name, in.Overdue = "   ", true
	_, err := uc.Execute(ctx, in)
	require.ErrorIs(t, err, domain.ErrInvalidTicketSavedFilterName, "空白だけの名前")

	in = base
	in.Name = "すべて"
	_, err = uc.Execute(ctx, in)
	require.ErrorIs(t, err, domain.ErrTicketSavedFilterNoCondition, "条件なし")

	in = base
	in.Name, in.Unassigned, in.AssignedToMe = "担当", true, true
	_, err = uc.Execute(ctx, in)
	require.ErrorIs(t, err, domain.ErrTicketSavedFilterAssigneeConflict, "担当の条件が 2 つ")

	_, err = uc.Execute(ctx, ticket.CreateSavedFilterInput{
		WorkspaceID: tkWS, ProjectID: sfProject,
		SavedFilterFields: ticket.SavedFilterFields{Name: "x", Overdue: true},
	})
	require.Error(t, err, "userID 必須")

	m.filters.AssertNotCalled(t, "CountTicketSavedFilters")
	m.filters.AssertNotCalled(t, "InsertTicketSavedFilter")
}

func Test_保存した絞り込み作成_上限に達していれば拒否(t *testing.T) {
	m := newSavedFilterMocks()
	m.filters.On("CountTicketSavedFilters", mock.Anything, tkWS, sfProject, sfUser).
		Return(int64(domain.MaxTicketSavedFiltersPerProject), nil)

	_, err := m.create().Execute(context.Background(), ticket.CreateSavedFilterInput{
		WorkspaceID: tkWS, ProjectID: sfProject, UserID: sfUser,
		SavedFilterFields: ticket.SavedFilterFields{Name: "21 個目", Overdue: true},
	})
	require.ErrorIs(t, err, ticket.ErrTicketSavedFilterLimitReached)
	m.filters.AssertNotCalled(t, "InsertTicketSavedFilter")
}

func Test_保存した絞り込み作成_正規化して保存し同じ条件で件数を数える(t *testing.T) {
	m := newSavedFilterMocks()
	m.filters.On("CountTicketSavedFilters", mock.Anything, tkWS, sfProject, sfUser).Return(int64(3), nil)
	var captured *domain.TicketSavedFilter
	m.filters.On("InsertTicketSavedFilter", mock.Anything, mock.AnythingOfType("*domain.TicketSavedFilter")).
		Run(func(args mock.Arguments) {
			captured = args.Get(1).(*domain.TicketSavedFilter)
			captured.ID = "filter-1"
		}).Return(nil)
	m.tickets.On("CountTickets", mock.Anything, mock.MatchedBy(func(in repository.ListTicketsInput) bool {
		return in.WorkspaceID == tkWS && in.ProjectID == sfProject && !in.IncludeArchived &&
			in.StatusID != nil && *in.StatusID == "status-1" && in.TypeID == nil &&
			in.Q != nil && *in.Q == "ログイン" && in.AssignedToMePrincipalID == nil
	})).Return(int64(4), nil)

	got, err := m.create().Execute(context.Background(), ticket.CreateSavedFilterInput{
		WorkspaceID: tkWS, ProjectID: sfProject, UserID: sfUser,
		SavedFilterFields: ticket.SavedFilterFields{
			Name: "  未完了のログイン  ", StatusID: sfPtr("status-1"), TypeID: sfPtr(""), Q: sfPtr(" ログイン "),
		},
	})
	require.NoError(t, err)
	require.Equal(t, "filter-1", got.Filter.ID)
	require.Equal(t, int64(4), got.Count)
	require.Equal(t, "未完了のログイン", captured.Name, "名前は前後の空白を落として保存する")
	require.Nil(t, captured.TypeID, "空文字の ID は指定なしとして保存する")
	require.Equal(t, sfUser, captured.UserID, "本人で保存する")
	m.perms.AssertNotCalled(t, "FindUserPrincipal")
}

func Test_保存した絞り込み作成_自分の担当は主体を解決してから数える(t *testing.T) {
	m := newSavedFilterMocks()
	m.filters.On("CountTicketSavedFilters", mock.Anything, tkWS, sfProject, sfUser).Return(int64(0), nil)
	m.stubInsert("filter-1")
	m.perms.On("FindUserPrincipal", mock.Anything, tkWS, sfUser).
		Return(&domain.Principal{ID: sfMyPrincipal, WorkspaceID: tkWS, Kind: domain.PrincipalKindUser}, nil)
	m.tickets.On("CountTickets", mock.Anything, mock.MatchedBy(func(in repository.ListTicketsInput) bool {
		return in.AssignedToMePrincipalID != nil && *in.AssignedToMePrincipalID == sfMyPrincipal && in.Overdue
	})).Return(int64(2), nil)

	got, err := m.create().Execute(context.Background(), ticket.CreateSavedFilterInput{
		WorkspaceID: tkWS, ProjectID: sfProject, UserID: sfUser,
		SavedFilterFields: ticket.SavedFilterFields{Name: "自分の期限切れ", AssignedToMe: true, Overdue: true},
	})
	require.NoError(t, err)
	require.Equal(t, int64(2), got.Count)
}

func Test_保存した絞り込み作成_自分の主体が無ければそのまま伝える(t *testing.T) {
	m := newSavedFilterMocks()
	m.filters.On("CountTicketSavedFilters", mock.Anything, tkWS, sfProject, sfUser).Return(int64(0), nil)
	m.stubInsert("filter-1")
	m.perms.On("FindUserPrincipal", mock.Anything, tkWS, sfUser).Return(nil, repository.ErrPrincipalNotFound)

	_, err := m.create().Execute(context.Background(), ticket.CreateSavedFilterInput{
		WorkspaceID: tkWS, ProjectID: sfProject, UserID: sfUser,
		SavedFilterFields: ticket.SavedFilterFields{Name: "自分の担当", AssignedToMe: true},
	})
	require.ErrorIs(t, err, repository.ErrPrincipalNotFound)
	m.tickets.AssertNotCalled(t, "CountTickets")
}

func Test_保存した絞り込み一覧_自分の担当を含むときだけ主体を1回引く(t *testing.T) {
	m := newSavedFilterMocks()
	filters := []domain.TicketSavedFilter{
		{ID: "f-1", WorkspaceID: tkWS, ProjectID: sfProject, UserID: sfUser, Name: "未割り当て", Unassigned: true},
		{ID: "f-2", WorkspaceID: tkWS, ProjectID: sfProject, UserID: sfUser, Name: "自分", AssignedToMe: true},
		{ID: "f-3", WorkspaceID: tkWS, ProjectID: sfProject, UserID: sfUser, Name: "自分の期限切れ", AssignedToMe: true, Overdue: true},
	}
	m.filters.On("ListTicketSavedFilters", mock.Anything, tkWS, sfProject, sfUser).Return(filters, nil)
	m.perms.On("FindUserPrincipal", mock.Anything, tkWS, sfUser).
		Return(&domain.Principal{ID: sfMyPrincipal, WorkspaceID: tkWS, Kind: domain.PrincipalKindUser}, nil).Once()
	m.tickets.On("CountTickets", mock.Anything, mock.MatchedBy(func(in repository.ListTicketsInput) bool {
		return in.Unassigned && in.AssignedToMePrincipalID == nil
	})).Return(int64(5), nil)
	m.tickets.On("CountTickets", mock.Anything, mock.MatchedBy(func(in repository.ListTicketsInput) bool {
		return !in.Unassigned && in.AssignedToMePrincipalID != nil && *in.AssignedToMePrincipalID == sfMyPrincipal && !in.Overdue
	})).Return(int64(3), nil)
	m.tickets.On("CountTickets", mock.Anything, mock.MatchedBy(func(in repository.ListTicketsInput) bool {
		return in.AssignedToMePrincipalID != nil && in.Overdue
	})).Return(int64(1), nil)

	got, err := m.list().Execute(context.Background(), ticket.ListSavedFiltersInput{
		WorkspaceID: tkWS, ProjectID: sfProject, UserID: sfUser,
	})
	require.NoError(t, err)
	require.Len(t, got, 3)
	require.Equal(t, []int64{5, 3, 1}, []int64{got[0].Count, got[1].Count, got[2].Count})
	require.Equal(t, "f-2", got[1].Filter.ID, "repository の並び（作った順）をそのまま返す")
	m.perms.AssertNumberOfCalls(t, "FindUserPrincipal", 1)
}

func Test_保存した絞り込み一覧_自分の担当が無ければ主体を引かない(t *testing.T) {
	m := newSavedFilterMocks()
	m.filters.On("ListTicketSavedFilters", mock.Anything, tkWS, sfProject, sfUser).
		Return([]domain.TicketSavedFilter{{ID: "f-1", WorkspaceID: tkWS, ProjectID: sfProject, UserID: sfUser, Overdue: true}}, nil)
	m.tickets.On("CountTickets", mock.Anything, mock.Anything).Return(int64(0), nil)

	got, err := m.list().Execute(context.Background(), ticket.ListSavedFiltersInput{
		WorkspaceID: tkWS, ProjectID: sfProject, UserID: sfUser,
	})
	require.NoError(t, err)
	require.Len(t, got, 1)
	m.perms.AssertNotCalled(t, "FindUserPrincipal")
}

func Test_保存した絞り込み一覧_0件はnilではなく空で返す(t *testing.T) {
	m := newSavedFilterMocks()
	m.filters.On("ListTicketSavedFilters", mock.Anything, tkWS, sfProject, sfUser).Return(nil, nil)

	got, err := m.list().Execute(context.Background(), ticket.ListSavedFiltersInput{
		WorkspaceID: tkWS, ProjectID: sfProject, UserID: sfUser,
	})
	require.NoError(t, err)
	require.NotNil(t, got)
	require.Empty(t, got)
}

func Test_保存した絞り込み更新_同名なら重複エラーをそのまま伝える(t *testing.T) {
	m := newSavedFilterMocks()
	m.filters.On("UpdateTicketSavedFilter", mock.Anything, mock.AnythingOfType("*domain.TicketSavedFilter")).
		Return(repository.ErrTicketSavedFilterNameTaken)

	_, err := m.update().Execute(context.Background(), ticket.UpdateSavedFilterInput{
		WorkspaceID: tkWS, ProjectID: sfProject, UserID: sfUser, FilterID: "filter-1",
		SavedFilterFields: ticket.SavedFilterFields{Name: "重複", Overdue: true},
	})
	require.ErrorIs(t, err, repository.ErrTicketSavedFilterNameTaken)
	m.tickets.AssertNotCalled(t, "CountTickets")
}

func Test_保存した絞り込み更新_本人とIDを添えて書き換え件数を数え直す(t *testing.T) {
	m := newSavedFilterMocks()
	var captured *domain.TicketSavedFilter
	m.filters.On("UpdateTicketSavedFilter", mock.Anything, mock.AnythingOfType("*domain.TicketSavedFilter")).
		Run(func(args mock.Arguments) { captured = args.Get(1).(*domain.TicketSavedFilter) }).Return(nil)
	m.tickets.On("CountTickets", mock.Anything, mock.MatchedBy(func(in repository.ListTicketsInput) bool {
		return in.LabelID != nil && *in.LabelID == "label-1"
	})).Return(int64(6), nil)

	got, err := m.update().Execute(context.Background(), ticket.UpdateSavedFilterInput{
		WorkspaceID: tkWS, ProjectID: sfProject, UserID: sfUser, FilterID: "filter-1",
		SavedFilterFields: ticket.SavedFilterFields{Name: "不具合", LabelID: sfPtr("label-1")},
	})
	require.NoError(t, err)
	require.Equal(t, "filter-1", captured.ID)
	require.Equal(t, sfUser, captured.UserID, "他人の行を書き換えないよう本人で絞る")
	require.Equal(t, int64(6), got.Count)

	_, err = m.update().Execute(context.Background(), ticket.UpdateSavedFilterInput{
		WorkspaceID: tkWS, ProjectID: sfProject, UserID: sfUser,
		SavedFilterFields: ticket.SavedFilterFields{Name: "不具合", LabelID: sfPtr("label-1")},
	})
	require.Error(t, err, "filterID 必須")
}

func Test_保存した絞り込み削除_本人で絞ってrepositoryを呼ぶ(t *testing.T) {
	m := newSavedFilterMocks()
	m.filters.On("DeleteTicketSavedFilter", mock.Anything, tkWS, sfProject, sfUser, "filter-1").
		Return(repository.ErrTicketSavedFilterNotFound)
	uc := ticket.NewDeleteSavedFilterUseCase(m.filters)

	err := uc.Execute(context.Background(), ticket.DeleteSavedFilterInput{
		WorkspaceID: tkWS, ProjectID: sfProject, UserID: sfUser, FilterID: "filter-1",
	})
	require.ErrorIs(t, err, repository.ErrTicketSavedFilterNotFound, "他人の分は「無い」としてそのまま伝える")

	err = uc.Execute(context.Background(), ticket.DeleteSavedFilterInput{WorkspaceID: tkWS, ProjectID: sfProject, UserID: sfUser})
	require.Error(t, err, "filterID 必須")
	m.filters.AssertNumberOfCalls(t, "DeleteTicketSavedFilter", 1)
}
