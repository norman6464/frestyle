package ticket_test

import (
	"context"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func Test_種別作成_不正な値は拒否(t *testing.T) {
	uc := ticket.NewCreateTicketTypeUseCase(&mockTicketRepo{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, ticket.CreateTicketTypeInput{WorkspaceID: tkWS, ProjectID: tkProject, Name: "", HierarchyLevel: 0, Color: "#2f6b47"})
	require.ErrorIs(t, err, domain.ErrInvalidTicketName, "空の名前は拒否")
	_, err = uc.Execute(ctx, ticket.CreateTicketTypeInput{WorkspaceID: tkWS, ProjectID: tkProject, Name: "OK", HierarchyLevel: 2, Color: "#2f6b47"})
	require.ErrorIs(t, err, domain.ErrInvalidTicketHierarchyLevel, "範囲外のhierarchy_levelは拒否")
	_, err = uc.Execute(ctx, ticket.CreateTicketTypeInput{WorkspaceID: tkWS, ProjectID: tkProject, Name: "OK", HierarchyLevel: 0, Color: "not-a-color"})
	require.ErrorIs(t, err, domain.ErrInvalidTicketColor, "不正な色は拒否")
}

func Test_種別作成_正常に作る(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("LastActiveTicketTypePosition", mock.Anything, tkWS, tkProject).Return("", nil)
	var captured *domain.TicketType
	repo.On("InsertTicketType", mock.Anything, mock.AnythingOfType("*domain.TicketType")).
		Run(func(args mock.Arguments) { captured = args.Get(1).(*domain.TicketType) }).Return(nil)

	_, err := ticket.NewCreateTicketTypeUseCase(repo).Execute(context.Background(), ticket.CreateTicketTypeInput{
		WorkspaceID: tkWS, ProjectID: tkProject, Name: "バグ", HierarchyLevel: 0, Color: "#9A3B2E",
	})
	require.NoError(t, err)
	require.Equal(t, "#9a3b2e", captured.Color)
	require.False(t, captured.IsDefault)
}

func Test_種別アーカイブ_使用中なら拒否(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("CountActiveTicketsByType", mock.Anything, tkWS, tkProject, "type-1").Return(int64(1), nil)

	err := ticket.NewArchiveTicketTypeUseCase(repo).Execute(context.Background(), ticket.ArchiveTicketTypeInput{
		WorkspaceID: tkWS, ProjectID: tkProject, TypeID: "type-1",
	})
	require.ErrorIs(t, err, ticket.ErrTicketTypeInUse)
	repo.AssertNotCalled(t, "ArchiveTicketType")
}
