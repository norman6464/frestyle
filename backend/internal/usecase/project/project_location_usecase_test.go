package project_test

import (
	"context"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/project"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// mockWorkspaceFinder は project.WorkspaceFinder の testify/mock 実装。
type mockWorkspaceFinder struct{ mock.Mock }

func (m *mockWorkspaceFinder) FindWorkspaceByID(ctx context.Context, workspaceID string) (*domain.Workspace, error) {
	args := m.Called(ctx, workspaceID)
	ws, _ := args.Get(0).(*domain.Workspace)
	return ws, args.Error(1)
}

func Test_プロジェクトの所在_プロジェクトとワークスペースを返す(t *testing.T) {
	repo := &mockProjectRepo{}
	workspaces := &mockWorkspaceFinder{}
	repo.On("FindProjectByIDAcrossWorkspaces", mock.Anything, pjID).
		Return(&domain.Project{ID: pjID, WorkspaceID: pjWS, Key: "frestyle", Name: pjName}, nil)
	workspaces.On("FindWorkspaceByID", mock.Anything, pjWS).
		Return(&domain.Workspace{ID: pjWS, Slug: "acme", Name: "Acme 社", IsActive: true}, nil)
	uc := project.NewResolveProjectLocationUseCase(repo, workspaces)

	out, err := uc.Execute(context.Background(), pjID)

	require.NoError(t, err)
	assert.Equal(t, pjID, out.Project.ID)
	assert.Equal(t, pjName, out.Project.Name)
	assert.Equal(t, "acme", out.Workspace.Slug)
	assert.Equal(t, "Acme 社", out.Workspace.Name)
}

func Test_プロジェクトの所在_停止中のワークスペースのプロジェクトは存在しないのと同じ(t *testing.T) {
	repo := &mockProjectRepo{}
	workspaces := &mockWorkspaceFinder{}
	repo.On("FindProjectByIDAcrossWorkspaces", mock.Anything, pjID).
		Return(&domain.Project{ID: pjID, WorkspaceID: pjWS}, nil)
	workspaces.On("FindWorkspaceByID", mock.Anything, pjWS).
		Return(&domain.Workspace{ID: pjWS, Slug: "acme", IsActive: false}, nil)
	uc := project.NewResolveProjectLocationUseCase(repo, workspaces)

	_, err := uc.Execute(context.Background(), pjID)

	// ID の経路は slug の経路（ResolveWorkspaceUseCase）を通らないので、停止の判定をここでも行う。
	assert.ErrorIs(t, err, repository.ErrProjectNotFound)
}

func Test_プロジェクトの所在_無いIDは存在しない(t *testing.T) {
	repo := &mockProjectRepo{}
	workspaces := &mockWorkspaceFinder{}
	repo.On("FindProjectByIDAcrossWorkspaces", mock.Anything, pjID).
		Return(nil, repository.ErrProjectNotFound)
	uc := project.NewResolveProjectLocationUseCase(repo, workspaces)

	_, err := uc.Execute(context.Background(), pjID)

	assert.ErrorIs(t, err, repository.ErrProjectNotFound)
	workspaces.AssertNotCalled(t, "FindWorkspaceByID", mock.Anything, mock.Anything)
}

func Test_プロジェクトの所在_空のIDは引かずに存在しない(t *testing.T) {
	repo := &mockProjectRepo{}
	uc := project.NewResolveProjectLocationUseCase(repo, &mockWorkspaceFinder{})

	_, err := uc.Execute(context.Background(), "")

	assert.ErrorIs(t, err, repository.ErrProjectNotFound)
	repo.AssertNotCalled(t, "FindProjectByIDAcrossWorkspaces", mock.Anything, mock.Anything)
}
