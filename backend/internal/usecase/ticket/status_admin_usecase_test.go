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

func Test_状態作成_不正な値は拒否(t *testing.T) {
	uc := ticket.NewCreateTicketStatusUseCase(&mockTicketRepo{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, ticket.CreateTicketStatusInput{WorkspaceID: tkWS, ProjectID: tkProject, Name: "", Category: domain.TicketStatusCategoryTodo, Color: "#2f6b47"})
	require.ErrorIs(t, err, domain.ErrInvalidTicketName, "空の名前は拒否")
	_, err = uc.Execute(ctx, ticket.CreateTicketStatusInput{WorkspaceID: tkWS, ProjectID: tkProject, Name: "  ", Category: domain.TicketStatusCategoryTodo, Color: "#2f6b47"})
	require.ErrorIs(t, err, domain.ErrInvalidTicketName, "空白だけの名前も拒否")
	_, err = uc.Execute(ctx, ticket.CreateTicketStatusInput{WorkspaceID: tkWS, ProjectID: tkProject, Name: "OK", Category: "unknown", Color: "#2f6b47"})
	require.ErrorIs(t, err, domain.ErrInvalidTicketStatusCategory, "未知のcategoryは拒否")
	_, err = uc.Execute(ctx, ticket.CreateTicketStatusInput{WorkspaceID: tkWS, ProjectID: tkProject, Name: "OK", Category: domain.TicketStatusCategoryTodo, Color: "url(evil)"})
	require.ErrorIs(t, err, domain.ErrInvalidTicketColor, "不正な色は拒否")
}

func Test_状態作成_色は正規化してから保存する(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("LastActiveTicketStatusPosition", mock.Anything, tkWS, tkProject).Return("a0", nil)
	var captured *domain.TicketStatus
	repo.On("InsertTicketStatus", mock.Anything, mock.AnythingOfType("*domain.TicketStatus")).
		Run(func(args mock.Arguments) { captured = args.Get(1).(*domain.TicketStatus) }).Return(nil)

	_, err := ticket.NewCreateTicketStatusUseCase(repo).Execute(context.Background(), ticket.CreateTicketStatusInput{
		WorkspaceID: tkWS, ProjectID: tkProject, Name: "レビュー中", Category: domain.TicketStatusCategoryInProgress, Color: "#2F6B47",
	})
	require.NoError(t, err)
	require.Equal(t, "#2f6b47", captured.Color)
	require.False(t, captured.IsInitial, "新規作成では既定で初期状態にしない")
}

func Test_状態アーカイブ_使用中なら拒否(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("CountActiveTicketsByStatus", mock.Anything, tkWS, tkProject, "status-1").Return(int64(3), nil)

	err := ticket.NewArchiveTicketStatusUseCase(repo).Execute(context.Background(), ticket.ArchiveTicketStatusInput{
		WorkspaceID: tkWS, ProjectID: tkProject, StatusID: "status-1",
	})
	require.ErrorIs(t, err, ticket.ErrTicketStatusInUse)
	repo.AssertNotCalled(t, "ArchiveTicketStatus")
}

func Test_状態アーカイブ_未使用なら実行する(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("CountActiveTicketsByStatus", mock.Anything, tkWS, tkProject, "status-1").Return(int64(0), nil)
	repo.On("ArchiveTicketStatus", mock.Anything, tkWS, tkProject, "status-1").Return(nil)

	err := ticket.NewArchiveTicketStatusUseCase(repo).Execute(context.Background(), ticket.ArchiveTicketStatusInput{
		WorkspaceID: tkWS, ProjectID: tkProject, StatusID: "status-1",
	})
	require.NoError(t, err)
}

func Test_状態復元_positionを末尾へ(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("LastActiveTicketStatusPosition", mock.Anything, tkWS, tkProject).Return("a0", nil)
	repo.On("RestoreTicketStatus", mock.Anything, tkWS, tkProject, "status-1", mock.MatchedBy(func(pos string) bool {
		return pos > "a0"
	})).Return(nil)

	err := ticket.NewRestoreTicketStatusUseCase(repo).Execute(context.Background(), ticket.RestoreTicketStatusInput{
		WorkspaceID: tkWS, ProjectID: tkProject, StatusID: "status-1",
	})
	require.NoError(t, err)
}

func Test_状態復元_名前衝突は409相当(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("LastActiveTicketStatusPosition", mock.Anything, tkWS, tkProject).Return("a0", nil)
	repo.On("RestoreTicketStatus", mock.Anything, tkWS, tkProject, "status-1", mock.Anything).
		Return(repository.ErrTicketStatusNameTaken)

	err := ticket.NewRestoreTicketStatusUseCase(repo).Execute(context.Background(), ticket.RestoreTicketStatusInput{
		WorkspaceID: tkWS, ProjectID: tkProject, StatusID: "status-1",
	})
	require.ErrorIs(t, err, repository.ErrTicketStatusNameTaken)
}
