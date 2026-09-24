package ticket_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
)

func memberWorkspace(id string, roles ...domain.GrantRole) repository.WorkspaceWithScopeFacts {
	if roles == nil {
		roles = []domain.GrantRole{}
	}
	return repository.WorkspaceWithScopeFacts{
		Workspace: domain.Workspace{ID: id, Slug: id},
		Facts:     domain.ScopeFacts{Roles: roles},
	}
}

func Test_横断の担当_必須項目と件数の範囲(t *testing.T) {
	uc := ticket.NewListAssignedAcrossWorkspacesUseCase(&mockTicketRepo{}, &mockKBPermissionRepo{})

	_, err := uc.Execute(context.Background(), ticket.ListAssignedAcrossWorkspacesInput{Limit: 3})
	require.Error(t, err, "userID 必須")

	for _, limit := range []int{0, -1, ticket.MaxAssignedAcrossLimit + 1} {
		_, err := uc.Execute(context.Background(), ticket.ListAssignedAcrossWorkspacesInput{UserID: 7, Limit: limit})
		assert.ErrorIs(t, err, ticket.ErrInvalidAssignedAcrossLimit, "limit=%d", limit)
	}
}

// 認可が先、上限が後。見てよいワークスペースだけを渡し、上限はそのまま repository に任せる。
func Test_横断の担当_見てよいワークスペースだけを渡す(t *testing.T) {
	perms := &mockKBPermissionRepo{}
	perms.On("ListMemberWorkspaces", mock.Anything, uint64(7)).Return([]repository.WorkspaceWithScopeFacts{
		memberWorkspace("ws-viewer", domain.GrantRoleViewer),
		memberWorkspace("ws-none"),
		memberWorkspace("ws-admin", domain.GrantRoleCommenter, domain.GrantRoleAdmin),
	}, nil)
	repo := &mockTicketRepo{}
	want := []domain.AssignedTicketSummary{{ID: "t-1", WorkspaceSlug: "ws-viewer"}}
	repo.On("ListAssignedTicketsAcrossWorkspaces", mock.Anything, uint64(7),
		[]string{"ws-viewer", "ws-admin"}, ticket.MaxAssignedAcrossLimit).Return(want, nil)
	uc := ticket.NewListAssignedAcrossWorkspacesUseCase(repo, perms)

	got, err := uc.Execute(context.Background(), ticket.ListAssignedAcrossWorkspacesInput{
		UserID: 7, Limit: ticket.MaxAssignedAcrossLimit,
	})

	require.NoError(t, err)
	assert.Equal(t, want, got)
	repo.AssertExpectations(t)
}

func Test_横断の担当_見てよいワークスペースが無ければ問い合わせない(t *testing.T) {
	perms := &mockKBPermissionRepo{}
	perms.On("ListMemberWorkspaces", mock.Anything, uint64(7)).Return([]repository.WorkspaceWithScopeFacts{
		memberWorkspace("ws-none"),
	}, nil)
	repo := &mockTicketRepo{}
	uc := ticket.NewListAssignedAcrossWorkspacesUseCase(repo, perms)

	got, err := uc.Execute(context.Background(), ticket.ListAssignedAcrossWorkspacesInput{UserID: 7, Limit: 1})

	require.NoError(t, err)
	assert.NotNil(t, got, "0 件は nil でなく空（応答で null にしない）")
	assert.Empty(t, got)
	repo.AssertNotCalled(t, "ListAssignedTicketsAcrossWorkspaces", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_横断の担当_失敗はそのまま伝える(t *testing.T) {
	boom := errors.New("db down")

	perms := &mockKBPermissionRepo{}
	perms.On("ListMemberWorkspaces", mock.Anything, uint64(7)).Return([]repository.WorkspaceWithScopeFacts(nil), boom)
	uc := ticket.NewListAssignedAcrossWorkspacesUseCase(&mockTicketRepo{}, perms)
	_, err := uc.Execute(context.Background(), ticket.ListAssignedAcrossWorkspacesInput{UserID: 7, Limit: 3})
	assert.ErrorIs(t, err, boom, "所属一覧の失敗")

	perms = &mockKBPermissionRepo{}
	perms.On("ListMemberWorkspaces", mock.Anything, uint64(7)).Return([]repository.WorkspaceWithScopeFacts{
		memberWorkspace("ws-viewer", domain.GrantRoleViewer),
	}, nil)
	repo := &mockTicketRepo{}
	repo.On("ListAssignedTicketsAcrossWorkspaces", mock.Anything, uint64(7), []string{"ws-viewer"}, 3).
		Return([]domain.AssignedTicketSummary(nil), boom)
	uc = ticket.NewListAssignedAcrossWorkspacesUseCase(repo, perms)
	_, err = uc.Execute(context.Background(), ticket.ListAssignedAcrossWorkspacesInput{UserID: 7, Limit: 3})
	assert.ErrorIs(t, err, boom, "担当の取得の失敗")
}
