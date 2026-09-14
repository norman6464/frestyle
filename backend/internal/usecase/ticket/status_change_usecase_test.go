package ticket_test

import (
	"context"
	"testing"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// closed_at / resolution は状態の category から usecase が導く（domain.ResolveTicketClosedFields）。
// 呼び出し側（handler の入力）が直接指定できるのは resolution の「候補」だけで、
// category=done でなければ黙って無視される。
func Test_チケット状態変更_closedAtとresolutionをcategoryから導く(t *testing.T) {
	t.Run("doneへ変更するとclosed_atとresolutionが入る", func(t *testing.T) {
		repo := &mockTicketRepo{}
		before := &domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, StatusID: "status-todo"}
		doneStatus := &domain.TicketStatus{ID: "status-done", Name: "完了", Category: domain.TicketStatusCategoryDone}
		oldStatus := &domain.TicketStatus{ID: "status-todo", Name: "To Do", Category: domain.TicketStatusCategoryTodo}
		repo.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(before, nil)
		repo.On("FindTicketStatus", mock.Anything, tkWS, "", "status-done").Return(doneStatus, nil)
		repo.On("FindTicketStatus", mock.Anything, tkWS, "", "status-todo").Return(oldStatus, nil)
		repo.On(
			"ChangeTicketStatus", mock.Anything, tkWS, tkTicket, "status-done",
			mock.AnythingOfType("*time.Time"), mock.MatchedBy(func(r *domain.TicketResolution) bool {
				return r != nil && *r == domain.TicketResolutionDone
			}),
		).Return(&domain.Ticket{ID: tkTicket, StatusID: "status-done"}, nil)
		repo.On("InsertTicketChangeGroup", mock.Anything, mock.AnythingOfType("*domain.TicketChangeGroup")).Return(nil)
		repo.On("InsertTicketStatusTransition", mock.Anything, tkWS, "", tkTicket, "status-todo", "status-done", uint64(1)).Return(nil)

		_, err := ticket.NewChangeTicketStatusUseCase(repo).Execute(context.Background(), ticket.ChangeTicketStatusInput{
			WorkspaceID: tkWS, TicketID: tkTicket, StatusID: "status-done", ActorUserID: 1,
		})
		require.NoError(t, err)
	})

	t.Run("in_progressへ変更するとclosed_atは常にnil", func(t *testing.T) {
		repo := &mockTicketRepo{}
		before := &domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, StatusID: "status-todo"}
		progStatus := &domain.TicketStatus{ID: "status-prog", Name: "進行中", Category: domain.TicketStatusCategoryInProgress}
		oldStatus := &domain.TicketStatus{ID: "status-todo", Name: "To Do", Category: domain.TicketStatusCategoryTodo}
		repo.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(before, nil)
		repo.On("FindTicketStatus", mock.Anything, tkWS, "", "status-prog").Return(progStatus, nil)
		repo.On("FindTicketStatus", mock.Anything, tkWS, "", "status-todo").Return(oldStatus, nil)
		repo.On(
			"ChangeTicketStatus", mock.Anything, tkWS, tkTicket, "status-prog",
			(*time.Time)(nil), (*domain.TicketResolution)(nil),
		).Return(&domain.Ticket{ID: tkTicket, StatusID: "status-prog"}, nil)
		repo.On("InsertTicketChangeGroup", mock.Anything, mock.AnythingOfType("*domain.TicketChangeGroup")).Return(nil)
		repo.On("InsertTicketStatusTransition", mock.Anything, tkWS, "", tkTicket, "status-todo", "status-prog", uint64(1)).Return(nil)

		_, err := ticket.NewChangeTicketStatusUseCase(repo).Execute(context.Background(), ticket.ChangeTicketStatusInput{
			WorkspaceID: tkWS, TicketID: tkTicket, StatusID: "status-prog", ActorUserID: 1,
			Resolution: func() *domain.TicketResolution { r := domain.TicketResolutionDone; return &r }(),
		})
		require.NoError(t, err, "in_progressへの変更ではresolution指定があっても無視される")
	})
}

// 同じ状態への変更（実質の変化なし）は履歴を残さない。
func Test_チケット状態変更_変化が無ければ履歴を残さない(t *testing.T) {
	repo := &mockTicketRepo{}
	same := &domain.TicketStatus{ID: "status-todo", Name: "To Do", Category: domain.TicketStatusCategoryTodo}
	before := &domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, StatusID: "status-todo"}
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(before, nil)
	repo.On("FindTicketStatus", mock.Anything, tkWS, "", "status-todo").Return(same, nil)
	repo.On(
		"ChangeTicketStatus", mock.Anything, tkWS, tkTicket, "status-todo",
		(*time.Time)(nil), (*domain.TicketResolution)(nil),
	).Return(&domain.Ticket{ID: tkTicket, StatusID: "status-todo"}, nil)

	_, err := ticket.NewChangeTicketStatusUseCase(repo).Execute(context.Background(), ticket.ChangeTicketStatusInput{
		WorkspaceID: tkWS, TicketID: tkTicket, StatusID: "status-todo", ActorUserID: 1,
	})
	require.NoError(t, err)
	repo.AssertNotCalled(t, "InsertTicketChangeGroup", mock.Anything, mock.Anything)
	repo.AssertNotCalled(t, "InsertTicketStatusTransition", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_チケット状態変更_必須項目の検証(t *testing.T) {
	uc := ticket.NewChangeTicketStatusUseCase(&mockTicketRepo{})
	ctx := context.Background()
	_, err := uc.Execute(ctx, ticket.ChangeTicketStatusInput{TicketID: tkTicket, StatusID: "s", ActorUserID: 1})
	require.Error(t, err)
	_, err = uc.Execute(ctx, ticket.ChangeTicketStatusInput{WorkspaceID: tkWS, StatusID: "s", ActorUserID: 1})
	require.Error(t, err)
	_, err = uc.Execute(ctx, ticket.ChangeTicketStatusInput{WorkspaceID: tkWS, TicketID: tkTicket, ActorUserID: 1})
	require.Error(t, err)
	_, err = uc.Execute(ctx, ticket.ChangeTicketStatusInput{WorkspaceID: tkWS, TicketID: tkTicket, StatusID: "s"})
	require.Error(t, err, "actorUserID 必須（履歴に誰がやったか残すため）")
}

func Test_チケット状態変更_チケットが無ければそのまま伝える(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(nil, repository.ErrTicketNotFound)
	_, err := ticket.NewChangeTicketStatusUseCase(repo).Execute(context.Background(), ticket.ChangeTicketStatusInput{
		WorkspaceID: tkWS, TicketID: tkTicket, StatusID: "s", ActorUserID: 1,
	})
	require.ErrorIs(t, err, repository.ErrTicketNotFound)
}

// 状態自体が別プロジェクトに属していれば FindTicketStatus が ErrTicketStatusNotFound を返す
// （projectID はチケットから引く。呼び出し側の入力にプロジェクト ID は要らない）。
func Test_チケット状態変更_状態が別プロジェクトなら404相当(t *testing.T) {
	repo := &mockTicketRepo{}
	before := &domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject, StatusID: "status-todo"}
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(before, nil)
	repo.On("FindTicketStatus", mock.Anything, tkWS, tkProject, "status-other").
		Return(nil, repository.ErrTicketStatusNotFound)

	_, err := ticket.NewChangeTicketStatusUseCase(repo).Execute(context.Background(), ticket.ChangeTicketStatusInput{
		WorkspaceID: tkWS, TicketID: tkTicket, StatusID: "status-other", ActorUserID: 1,
	})
	require.ErrorIs(t, err, repository.ErrTicketStatusNotFound)
}
