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

func Test_チケット件数_必須項目の検証(t *testing.T) {
	uc := ticket.NewGetTicketCountsUseCase(&mockTicketRepo{}, &mockKBPermissionRepo{})
	_, err := uc.Execute(context.Background(), ticket.GetTicketCountsInput{})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(context.Background(), ticket.GetTicketCountsInput{WorkspaceID: tkWS})
	require.Error(t, err, "spaceID 必須")
	_, err = uc.Execute(context.Background(), ticket.GetTicketCountsInput{WorkspaceID: tkWS, SpaceID: tkSpace})
	require.Error(t, err, "userID 必須")
}

func Test_チケット件数_UserIDからprincipalを解決してrepositoryへ渡す(t *testing.T) {
	repo := &mockTicketRepo{}
	perms := &mockKBPermissionRepo{}
	perms.On("FindUserPrincipal", mock.Anything, tkWS, uint64(42)).
		Return(&domain.Principal{ID: "principal-me"}, nil)
	repo.On("GetTicketCounts", mock.Anything, tkWS, tkSpace, strPtr("principal-me")).
		Return(repository.TicketCounts{Total: 10, AssignedToMe: 3, Overdue: 2, Unassigned: 1}, nil)

	got, err := ticket.NewGetTicketCountsUseCase(repo, perms).Execute(context.Background(), ticket.GetTicketCountsInput{
		WorkspaceID: tkWS, SpaceID: tkSpace, UserID: 42,
	})
	require.NoError(t, err)
	require.Equal(t, repository.TicketCounts{Total: 10, AssignedToMe: 3, Overdue: 2, Unassigned: 1}, got)
	perms.AssertExpectations(t)
	repo.AssertExpectations(t)
}

func Test_チケット件数_principal解決に失敗したらエラーを伝える(t *testing.T) {
	perms := &mockKBPermissionRepo{}
	perms.On("FindUserPrincipal", mock.Anything, tkWS, uint64(42)).
		Return(nil, repository.ErrPrincipalNotFound)

	_, err := ticket.NewGetTicketCountsUseCase(&mockTicketRepo{}, perms).Execute(context.Background(), ticket.GetTicketCountsInput{
		WorkspaceID: tkWS, SpaceID: tkSpace, UserID: 42,
	})
	require.ErrorIs(t, err, repository.ErrPrincipalNotFound)
}
