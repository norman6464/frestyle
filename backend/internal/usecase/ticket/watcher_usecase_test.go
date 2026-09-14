package ticket_test

import (
	"context"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

const watcherUserID = uint64(7)

func Test_チケットの監視_付け外しは望む状態を送る(t *testing.T) {
	t.Run("監視する", func(t *testing.T) {
		repo := &mockTicketRepo{}
		repo.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(&domain.Ticket{ID: tkTicket}, nil)
		repo.On("AddTicketWatcher", mock.Anything, tkWS, tkTicket, watcherUserID).Return(nil)
		repo.On("IsTicketWatchedBy", mock.Anything, tkWS, tkTicket, watcherUserID).Return(true, nil)
		repo.On("CountTicketWatchers", mock.Anything, tkWS, tkTicket).Return(int64(3), nil)

		got, err := ticket.NewWatchTicketUseCase(repo).Execute(context.Background(), ticket.WatchTicketInput{
			WorkspaceID: tkWS, TicketID: tkTicket, UserID: watcherUserID, Watching: true,
		})

		require.NoError(t, err)
		assert.True(t, got.Watching)
		assert.EqualValues(t, 3, got.Count)
		// 「切り替え」ではないので、二度押しても外れない。
		repo.AssertNotCalled(t, "RemoveTicketWatcher", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	})

	t.Run("外す", func(t *testing.T) {
		repo := &mockTicketRepo{}
		repo.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(&domain.Ticket{ID: tkTicket}, nil)
		repo.On("RemoveTicketWatcher", mock.Anything, tkWS, tkTicket, watcherUserID).Return(nil)
		repo.On("IsTicketWatchedBy", mock.Anything, tkWS, tkTicket, watcherUserID).Return(false, nil)
		repo.On("CountTicketWatchers", mock.Anything, tkWS, tkTicket).Return(int64(2), nil)

		got, err := ticket.NewWatchTicketUseCase(repo).Execute(context.Background(), ticket.WatchTicketInput{
			WorkspaceID: tkWS, TicketID: tkTicket, UserID: watcherUserID,
		})

		require.NoError(t, err)
		assert.False(t, got.Watching)
		repo.AssertNotCalled(t, "AddTicketWatcher", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	})
}

func Test_チケットの監視_無いチケットには付けない(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(nil, repository.ErrTicketNotFound)

	_, err := ticket.NewWatchTicketUseCase(repo).Execute(context.Background(), ticket.WatchTicketInput{
		WorkspaceID: tkWS, TicketID: tkTicket, UserID: watcherUserID, Watching: true,
	})

	// FK 違反を待たず、ここで「無い」に落とす（handler が 404 に畳める）。
	assert.ErrorIs(t, err, repository.ErrTicketNotFound)
	repo.AssertNotCalled(t, "AddTicketWatcher", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_チケットの監視_指定が足りなければ断る(t *testing.T) {
	repo := &mockTicketRepo{}

	// 監視できるのは自分の分だけなので、誰かが分からない要求は通さない。
	_, err := ticket.NewWatchTicketUseCase(repo).Execute(context.Background(), ticket.WatchTicketInput{
		WorkspaceID: tkWS, TicketID: tkTicket, Watching: true,
	})
	assert.Error(t, err)

	_, err = ticket.NewWatchTicketUseCase(repo).Execute(context.Background(), ticket.WatchTicketInput{
		WorkspaceID: tkWS, UserID: watcherUserID,
	})
	assert.Error(t, err)

	repo.AssertNotCalled(t, "FindTicket", mock.Anything, mock.Anything, mock.Anything)
}

func Test_チケットの監視状態_自分の分と人数を返す(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("IsTicketWatchedBy", mock.Anything, tkWS, tkTicket, watcherUserID).Return(true, nil)
	repo.On("CountTicketWatchers", mock.Anything, tkWS, tkTicket).Return(int64(5), nil)

	got, err := ticket.NewGetTicketWatchStateUseCase(repo).Execute(
		context.Background(), tkWS, tkTicket, watcherUserID,
	)

	require.NoError(t, err)
	assert.True(t, got.Watching)
	assert.EqualValues(t, 5, got.Count)
}

func Test_チケットの監視状態_人数が読めなければ失敗させる(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("IsTicketWatchedBy", mock.Anything, tkWS, tkTicket, watcherUserID).Return(true, nil)
	repo.On("CountTicketWatchers", mock.Anything, tkWS, tkTicket).Return(int64(0), repository.ErrTicketNotFound)

	_, err := ticket.NewGetTicketWatchStateUseCase(repo).Execute(
		context.Background(), tkWS, tkTicket, watcherUserID,
	)

	// 0 人として返すと「誰も見ていない」と区別が付かない。
	assert.ErrorIs(t, err, repository.ErrTicketNotFound)
}

func Test_チケットの監視状態_指定が足りなければ断る(t *testing.T) {
	repo := &mockTicketRepo{}

	_, err := ticket.NewGetTicketWatchStateUseCase(repo).Execute(context.Background(), tkWS, "", watcherUserID)

	assert.Error(t, err)
	repo.AssertNotCalled(t, "IsTicketWatchedBy", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_自分の担当_本人の主体で引く(t *testing.T) {
	repo := &mockTicketRepo{}
	perms := &mockKBPermissionRepo{}
	perms.On("FindUserPrincipal", mock.Anything, tkWS, watcherUserID).
		Return(&domain.Principal{ID: "principal-1"}, nil)
	repo.On("ListAssignedTickets", mock.Anything, tkWS, "principal-1").
		Return([]domain.AssignedTicket{{Ticket: domain.Ticket{ID: tkTicket}}}, nil)

	got, err := ticket.NewListAssignedTicketsUseCase(repo, perms).Execute(
		context.Background(), ticket.ListAssignedTicketsInput{WorkspaceID: tkWS, UserID: watcherUserID},
	)

	require.NoError(t, err)
	assert.Len(t, got, 1)
	// 「誰の担当か」は必ず呼び出した本人。他人の担当を覗く口にはしない。
	perms.AssertExpectations(t)
	repo.AssertExpectations(t)
}

func Test_自分の担当_主体が引けなければそのまま伝える(t *testing.T) {
	repo := &mockTicketRepo{}
	perms := &mockKBPermissionRepo{}
	perms.On("FindUserPrincipal", mock.Anything, tkWS, watcherUserID).
		Return(nil, repository.ErrPrincipalNotFound)

	_, err := ticket.NewListAssignedTicketsUseCase(repo, perms).Execute(
		context.Background(), ticket.ListAssignedTicketsInput{WorkspaceID: tkWS, UserID: watcherUserID},
	)

	assert.ErrorIs(t, err, repository.ErrPrincipalNotFound)
	repo.AssertNotCalled(t, "ListAssignedTickets", mock.Anything, mock.Anything, mock.Anything)
}

func Test_自分の担当_指定が足りなければ断る(t *testing.T) {
	repo := &mockTicketRepo{}
	perms := &mockKBPermissionRepo{}
	uc := ticket.NewListAssignedTicketsUseCase(repo, perms)

	_, err := uc.Execute(context.Background(), ticket.ListAssignedTicketsInput{UserID: watcherUserID})
	assert.Error(t, err)

	_, err = uc.Execute(context.Background(), ticket.ListAssignedTicketsInput{WorkspaceID: tkWS})
	assert.Error(t, err, "誰の担当かが分からない要求は通さない")

	perms.AssertNotCalled(t, "FindUserPrincipal", mock.Anything, mock.Anything, mock.Anything)
}
