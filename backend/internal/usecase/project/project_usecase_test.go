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

const (
	pjWS   = "11111111-1111-1111-1111-111111111111"
	pjID   = "22222222-2222-2222-2222-222222222222"
	pjName = "FreStyle 開発"
)

// mockProjectRepo は repository.ProjectRepository の testify/mock 実装。
type mockProjectRepo struct{ mock.Mock }

var _ repository.ProjectRepository = (*mockProjectRepo)(nil)

func (m *mockProjectRepo) CreateProject(ctx context.Context, p *domain.Project) error {
	args := m.Called(ctx, p)
	// 実装は INSERT の RETURNING で受け取った行を書き戻す。id を埋める振る舞いを写す。
	if args.Error(0) == nil {
		p.ID = pjID
	}
	return args.Error(0)
}

func (m *mockProjectRepo) ListProjects(ctx context.Context, workspaceID string) ([]domain.Project, error) {
	args := m.Called(ctx, workspaceID)
	list, _ := args.Get(0).([]domain.Project)
	return list, args.Error(1)
}

func (m *mockProjectRepo) FindProject(ctx context.Context, workspaceID, projectID string) (*domain.Project, error) {
	args := m.Called(ctx, workspaceID, projectID)
	p, _ := args.Get(0).(*domain.Project)
	return p, args.Error(1)
}

func (m *mockProjectRepo) FindProjectByKey(ctx context.Context, workspaceID, key string) (*domain.Project, error) {
	args := m.Called(ctx, workspaceID, key)
	p, _ := args.Get(0).(*domain.Project)
	return p, args.Error(1)
}

func (m *mockProjectRepo) RenameProject(ctx context.Context, workspaceID, projectID, name string) error {
	args := m.Called(ctx, workspaceID, projectID, name)
	return args.Error(0)
}

func Test_プロジェクト作成_必須項目の検証(t *testing.T) {
	uc := project.NewCreateProjectUseCase(&mockProjectRepo{})
	_, err := uc.Execute(context.Background(), project.CreateProjectInput{Name: pjName})
	require.Error(t, err, "workspaceID 必須")

	_, err = uc.Execute(context.Background(), project.CreateProjectInput{WorkspaceID: pjWS})
	require.ErrorIs(t, err, project.ErrInvalidName, "名前は空にできない")

	_, err = uc.Execute(context.Background(), project.CreateProjectInput{
		WorkspaceID: pjWS, Key: "Bad Key", Name: pjName,
	})
	require.ErrorIs(t, err, project.ErrInvalidProjectKey, "key の形は spaces.key と同じ規則")
}

func Test_プロジェクト作成_keyを省略すると自動採番する(t *testing.T) {
	repo := &mockProjectRepo{}
	repo.On("CreateProject", mock.Anything, mock.MatchedBy(func(p *domain.Project) bool {
		return domain.ValidProjectKey(p.Key) && p.Key != ""
	})).Return(nil).Once()

	p, err := project.NewCreateProjectUseCase(repo).Execute(context.Background(), project.CreateProjectInput{
		WorkspaceID: pjWS, Name: pjName,
	})
	require.NoError(t, err)
	assert.Equal(t, pjID, p.ID)
	repo.AssertExpectations(t)
}

func Test_プロジェクト作成_自動採番の衝突は引き直す(t *testing.T) {
	repo := &mockProjectRepo{}
	// 1 回目は衝突、2 回目で成功。引き直しは一意制約の結果だけを見る（空きを先に確認しない）。
	repo.On("CreateProject", mock.Anything, mock.Anything).Return(repository.ErrProjectKeyTaken).Once()
	repo.On("CreateProject", mock.Anything, mock.Anything).Return(nil).Once()

	_, err := project.NewCreateProjectUseCase(repo).Execute(context.Background(), project.CreateProjectInput{
		WorkspaceID: pjWS, Name: pjName,
	})
	require.NoError(t, err)
	repo.AssertExpectations(t)
}

func Test_プロジェクト作成_明示したkeyの衝突はそのまま返す(t *testing.T) {
	repo := &mockProjectRepo{}
	repo.On("CreateProject", mock.Anything, mock.Anything).Return(repository.ErrProjectKeyTaken).Once()

	_, err := project.NewCreateProjectUseCase(repo).Execute(context.Background(), project.CreateProjectInput{
		WorkspaceID: pjWS, Key: "eng", Name: pjName,
	})
	require.ErrorIs(t, err, repository.ErrProjectKeyTaken, "人が決めた key は黙って引き直さない")
	repo.AssertExpectations(t)
}

func Test_プロジェクト改名_名前だけを変える(t *testing.T) {
	repo := &mockProjectRepo{}
	repo.On("RenameProject", mock.Anything, pjWS, pjID, "新しい名前").Return(nil).Once()
	repo.On("FindProject", mock.Anything, pjWS, pjID).
		Return(&domain.Project{ID: pjID, WorkspaceID: pjWS, Key: "eng", Name: "新しい名前"}, nil).Once()

	p, err := project.NewRenameProjectUseCase(repo).Execute(context.Background(), project.RenameProjectInput{
		WorkspaceID: pjWS, ProjectID: pjID, Name: "新しい名前",
	})
	require.NoError(t, err)
	assert.Equal(t, "新しい名前", p.Name)
	assert.Equal(t, "eng", p.Key, "key は改名の対象外")
	repo.AssertExpectations(t)
}

func Test_プロジェクト改名_空の名前は弾く(t *testing.T) {
	repo := &mockProjectRepo{}
	_, err := project.NewRenameProjectUseCase(repo).Execute(context.Background(), project.RenameProjectInput{
		WorkspaceID: pjWS, ProjectID: pjID, Name: "",
	})
	require.ErrorIs(t, err, project.ErrInvalidName)
	repo.AssertNotCalled(t, "RenameProject", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_プロジェクト一覧_必須項目の検証(t *testing.T) {
	_, err := project.NewListProjectsUseCase(&mockProjectRepo{}).Execute(context.Background(), "")
	require.Error(t, err)
}

func Test_プロジェクト取得_IDが空なら見つからない扱い(t *testing.T) {
	_, err := project.NewGetProjectUseCase(&mockProjectRepo{}).Execute(context.Background(), pjWS, "")
	require.ErrorIs(t, err, repository.ErrProjectNotFound)
}
