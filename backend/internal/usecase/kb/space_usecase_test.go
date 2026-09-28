package kb_test

import (
	"context"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

const kbResolveSpaceID = "0198a000-0000-7000-8000-0000000000a1"

func Test_スペースの所在_スペースとワークスペースを返す(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindSpaceByIDAcrossWorkspaces", mock.Anything, kbResolveSpaceID).
		Return(&domain.Space{ID: kbResolveSpaceID, WorkspaceID: kbWS, Name: "開発部"}, nil)
	repo.On("FindWorkspaceByID", mock.Anything, kbWS).
		Return(&domain.Workspace{ID: kbWS, Slug: "acme", Name: "Acme 社", IsActive: true}, nil)
	uc := kb.NewResolveSpaceLocationUseCase(repo)

	out, err := uc.Execute(context.Background(), kbResolveSpaceID)

	require.NoError(t, err)
	assert.Equal(t, kbResolveSpaceID, out.Space.ID)
	assert.Equal(t, "開発部", out.Space.Name)
	assert.Equal(t, "acme", out.Workspace.Slug)
	assert.Equal(t, "Acme 社", out.Workspace.Name)
}

func Test_スペースの所在_停止中のワークスペースのスペースは存在しないのと同じ(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindSpaceByIDAcrossWorkspaces", mock.Anything, kbResolveSpaceID).
		Return(&domain.Space{ID: kbResolveSpaceID, WorkspaceID: kbWS}, nil)
	repo.On("FindWorkspaceByID", mock.Anything, kbWS).
		Return(&domain.Workspace{ID: kbWS, Slug: "acme", IsActive: false}, nil)
	uc := kb.NewResolveSpaceLocationUseCase(repo)

	_, err := uc.Execute(context.Background(), kbResolveSpaceID)

	// ID の経路は slug の経路（ResolveWorkspaceUseCase）を通らないので、停止の判定をここでも行う。
	assert.ErrorIs(t, err, repository.ErrSpaceNotFound)
}

func Test_スペースの所在_無いIDは存在しない(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindSpaceByIDAcrossWorkspaces", mock.Anything, kbResolveSpaceID).
		Return(nil, repository.ErrSpaceNotFound)
	uc := kb.NewResolveSpaceLocationUseCase(repo)

	_, err := uc.Execute(context.Background(), kbResolveSpaceID)

	assert.ErrorIs(t, err, repository.ErrSpaceNotFound)
	repo.AssertNotCalled(t, "FindWorkspaceByID", mock.Anything, mock.Anything)
}

func Test_スペースの所在_空のIDは引かずに存在しない(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	uc := kb.NewResolveSpaceLocationUseCase(repo)

	_, err := uc.Execute(context.Background(), "")

	assert.ErrorIs(t, err, repository.ErrSpaceNotFound)
	repo.AssertNotCalled(t, "FindSpaceByIDAcrossWorkspaces", mock.Anything, mock.Anything)
}
