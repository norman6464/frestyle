package ticket_test

import (
	"context"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func Test_状態一覧_必須項目の検証(t *testing.T) {
	uc := ticket.NewListTicketStatusesUseCase(&mockTicketRepo{})
	_, err := uc.Execute(context.Background(), ticket.ListTicketStatusesInput{})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(context.Background(), ticket.ListTicketStatusesInput{WorkspaceID: tkWS})
	require.Error(t, err, "projectID 必須")
}

// 管理画面は「使用中 N 件」を必ず出すので、一覧と件数は同じ 1 回の呼び出しで返す。
// 件数はプロジェクト 1 回の GROUP BY で取り、状態ごとに数えない（N+1 を作らない）。
func Test_状態一覧_使用中の件数を添えて返す(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("ListTicketStatuses", mock.Anything, tkWS, tkProject, true).
		Return([]domain.TicketStatus{{ID: "s1"}, {ID: "s2"}}, nil)
	repo.On("CountActiveTicketsByStatusForProject", mock.Anything, tkWS, tkProject).
		Return(map[string]int64{"s1": 3}, nil)

	got, err := ticket.NewListTicketStatusesUseCase(repo).Execute(context.Background(), ticket.ListTicketStatusesInput{
		WorkspaceID: tkWS, ProjectID: tkProject, IncludeArchived: true,
	})
	require.NoError(t, err)
	require.Len(t, got, 2)
	assert.Equal(t, "s1", got[0].Status.ID)
	assert.EqualValues(t, 3, got[0].ActiveTicketCount)
	assert.EqualValues(t, 0, got[1].ActiveTicketCount, "対応表に無い状態は 0 件")

	// 状態ごとに数える経路（N+1）は通らない。
	repo.AssertNotCalled(t, "CountActiveTicketsByStatus")
	repo.AssertNumberOfCalls(t, "CountActiveTicketsByStatusForProject", 1)
}

func Test_種別一覧_必須項目の検証(t *testing.T) {
	uc := ticket.NewListTicketTypesUseCase(&mockTicketRepo{})
	_, err := uc.Execute(context.Background(), ticket.ListTicketTypesInput{})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(context.Background(), ticket.ListTicketTypesInput{WorkspaceID: tkWS})
	require.Error(t, err, "projectID 必須")
}

func Test_種別一覧_使用中の件数を添えて返す(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("ListTicketTypes", mock.Anything, tkWS, tkProject, false).
		Return([]domain.TicketType{{ID: "t1"}}, nil)
	repo.On("CountActiveTicketsByTypeForProject", mock.Anything, tkWS, tkProject).
		Return(map[string]int64{"t1": 7}, nil)

	got, err := ticket.NewListTicketTypesUseCase(repo).Execute(context.Background(), ticket.ListTicketTypesInput{
		WorkspaceID: tkWS, ProjectID: tkProject,
	})
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, "t1", got[0].Type.ID)
	assert.EqualValues(t, 7, got[0].ActiveTicketCount)
	repo.AssertNotCalled(t, "CountActiveTicketsByType")
}
