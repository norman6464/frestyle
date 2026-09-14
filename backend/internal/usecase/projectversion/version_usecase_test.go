package projectversion_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/projectversion"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

const (
	pvWS      = "11111111-1111-1111-1111-111111111111"
	pvProject = "22222222-2222-2222-2222-222222222222"
	pvID      = "33333333-3333-3333-3333-333333333333"
	pvTicket  = "44444444-4444-4444-4444-444444444444"
)

var errBoom = errors.New("boom")

// mockVersionRepo は repository.ProjectVersionRepository の testify/mock 実装。
type mockVersionRepo struct{ mock.Mock }

var _ repository.ProjectVersionRepository = (*mockVersionRepo)(nil)

func (m *mockVersionRepo) CreateProjectVersion(
	ctx context.Context, workspaceID, projectID, name, position string,
) (*domain.ProjectVersion, error) {
	args := m.Called(ctx, workspaceID, projectID, name, position)
	v, _ := args.Get(0).(*domain.ProjectVersion)
	return v, args.Error(1)
}

func (m *mockVersionRepo) ListProjectVersions(
	ctx context.Context, workspaceID, projectID string, includeArchived bool,
) ([]domain.ProjectVersion, error) {
	args := m.Called(ctx, workspaceID, projectID, includeArchived)
	list, _ := args.Get(0).([]domain.ProjectVersion)
	return list, args.Error(1)
}

func (m *mockVersionRepo) GetProjectVersion(
	ctx context.Context, workspaceID, projectID, versionID string,
) (*domain.ProjectVersion, error) {
	args := m.Called(ctx, workspaceID, projectID, versionID)
	v, _ := args.Get(0).(*domain.ProjectVersion)
	return v, args.Error(1)
}

func (m *mockVersionRepo) UpdateProjectVersion(
	ctx context.Context, workspaceID, projectID, versionID string, in repository.ProjectVersionUpdate,
) (*domain.ProjectVersion, error) {
	args := m.Called(ctx, workspaceID, projectID, versionID, in)
	v, _ := args.Get(0).(*domain.ProjectVersion)
	return v, args.Error(1)
}

func (m *mockVersionRepo) ArchiveProjectVersion(ctx context.Context, workspaceID, projectID, versionID string) error {
	args := m.Called(ctx, workspaceID, projectID, versionID)
	return args.Error(0)
}

func (m *mockVersionRepo) RestoreProjectVersion(
	ctx context.Context, workspaceID, projectID, versionID, position string,
) error {
	args := m.Called(ctx, workspaceID, projectID, versionID, position)
	return args.Error(0)
}

func (m *mockVersionRepo) LastProjectVersionPosition(ctx context.Context, workspaceID, projectID string) (string, error) {
	args := m.Called(ctx, workspaceID, projectID)
	return args.String(0), args.Error(1)
}

func (m *mockVersionRepo) AddTicketFixVersion(ctx context.Context, workspaceID, ticketID, versionID string) error {
	args := m.Called(ctx, workspaceID, ticketID, versionID)
	return args.Error(0)
}

func (m *mockVersionRepo) RemoveTicketFixVersion(ctx context.Context, workspaceID, ticketID, versionID string) error {
	args := m.Called(ctx, workspaceID, ticketID, versionID)
	return args.Error(0)
}

func (m *mockVersionRepo) ListTicketFixVersions(
	ctx context.Context, workspaceID, ticketID string,
) ([]domain.ProjectVersion, error) {
	args := m.Called(ctx, workspaceID, ticketID)
	list, _ := args.Get(0).([]domain.ProjectVersion)
	return list, args.Error(1)
}

// --- 作成 ---

func Test_版の作成_末尾に置き前後の空白は落とす(t *testing.T) {
	repo := &mockVersionRepo{}
	created := &domain.ProjectVersion{ID: pvID, Name: "1.2.0"}
	repo.On("LastProjectVersionPosition", mock.Anything, pvWS, pvProject).Return("a0", nil)
	repo.On("CreateProjectVersion", mock.Anything, pvWS, pvProject, "1.2.0", mock.MatchedBy(func(pos string) bool {
		return pos > "a0"
	})).Return(created, nil)

	got, err := projectversion.NewCreateVersionUseCase(repo).Execute(
		context.Background(), projectversion.CreateVersionInput{
			WorkspaceID: pvWS, ProjectID: pvProject, Name: " 1.2.0 ",
		},
	)

	require.NoError(t, err)
	assert.Equal(t, created, got)
	repo.AssertExpectations(t)
}

func Test_版の作成_保存できない名前は問い合わせまで行かせない(t *testing.T) {
	cases := []struct {
		name string
		in   projectversion.CreateVersionInput
		want error
	}{
		{name: "ワークスペースが空", in: projectversion.CreateVersionInput{ProjectID: pvProject, Name: "1.0.0"}},
		{name: "プロジェクトが空", in: projectversion.CreateVersionInput{WorkspaceID: pvWS, Name: "1.0.0"}},
		{
			name: "空白だけ",
			in:   projectversion.CreateVersionInput{WorkspaceID: pvWS, ProjectID: pvProject, Name: " "},
			want: domain.ErrInvalidProjectVersionName,
		},
		{
			name: "長すぎる",
			in: projectversion.CreateVersionInput{
				WorkspaceID: pvWS, ProjectID: pvProject,
				Name: strings.Repeat("v", domain.ProjectVersionNameMax+1),
			},
			want: domain.ErrInvalidProjectVersionName,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &mockVersionRepo{}
			_, err := projectversion.NewCreateVersionUseCase(repo).Execute(context.Background(), tc.in)

			require.Error(t, err)
			if tc.want != nil {
				assert.ErrorIs(t, err, tc.want)
			}
			repo.AssertNotCalled(t, "LastProjectVersionPosition", mock.Anything, mock.Anything, mock.Anything)
			repo.AssertNotCalled(t, "CreateProjectVersion",
				mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
		})
	}
}

func Test_版の作成_並び順が読めなければ作らない(t *testing.T) {
	repo := &mockVersionRepo{}
	repo.On("LastProjectVersionPosition", mock.Anything, pvWS, pvProject).Return("", errBoom)

	_, err := projectversion.NewCreateVersionUseCase(repo).Execute(
		context.Background(), projectversion.CreateVersionInput{
			WorkspaceID: pvWS, ProjectID: pvProject, Name: "1.0.0",
		},
	)

	assert.ErrorIs(t, err, errBoom)
	repo.AssertNotCalled(t, "CreateProjectVersion",
		mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

// --- 一覧 ---

func Test_版の一覧_畳んだものを出すかは呼び出し側が決める(t *testing.T) {
	for _, includeArchived := range []bool{true, false} {
		repo := &mockVersionRepo{}
		repo.On("ListProjectVersions", mock.Anything, pvWS, pvProject, includeArchived).
			Return([]domain.ProjectVersion{{ID: pvID}}, nil)

		got, err := projectversion.NewListVersionsUseCase(repo).Execute(
			context.Background(), projectversion.ListVersionsInput{
				WorkspaceID: pvWS, ProjectID: pvProject, IncludeArchived: includeArchived,
			},
		)

		require.NoError(t, err)
		assert.Len(t, got, 1)
		repo.AssertExpectations(t)
	}
}

func Test_版の一覧_入れ物が指定されていなければ断る(t *testing.T) {
	repo := &mockVersionRepo{}
	_, err := projectversion.NewListVersionsUseCase(repo).Execute(
		context.Background(), projectversion.ListVersionsInput{WorkspaceID: pvWS},
	)

	assert.Error(t, err)
	repo.AssertNotCalled(t, "ListProjectVersions", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

// --- 更新 ---

func Test_版の更新_リリース日は消せる(t *testing.T) {
	repo := &mockVersionRepo{}
	updated := &domain.ProjectVersion{ID: pvID, Name: "1.2.0"}
	repo.On("UpdateProjectVersion", mock.Anything, pvWS, pvProject, pvID,
		repository.ProjectVersionUpdate{Name: "1.2.0", ReleasedAt: nil}).Return(updated, nil)

	got, err := projectversion.NewUpdateVersionUseCase(repo).Execute(
		context.Background(), projectversion.UpdateVersionInput{
			WorkspaceID: pvWS, ProjectID: pvProject, VersionID: pvID, Name: " 1.2.0 ",
		},
	)

	require.NoError(t, err)
	assert.Equal(t, updated, got)
	repo.AssertExpectations(t)
}

func Test_版の更新_リリース日を入れる(t *testing.T) {
	repo := &mockVersionRepo{}
	at := time.Date(2026, 9, 14, 0, 0, 0, 0, time.UTC)
	repo.On("UpdateProjectVersion", mock.Anything, pvWS, pvProject, pvID,
		repository.ProjectVersionUpdate{Name: "1.2.0", ReleasedAt: &at}).
		Return(&domain.ProjectVersion{ID: pvID, ReleasedAt: &at}, nil)

	got, err := projectversion.NewUpdateVersionUseCase(repo).Execute(
		context.Background(), projectversion.UpdateVersionInput{
			WorkspaceID: pvWS, ProjectID: pvProject, VersionID: pvID, Name: "1.2.0", ReleasedAt: &at,
		},
	)

	require.NoError(t, err)
	// 出した日そのものに意味があるので、真偽値には畳まない。
	require.NotNil(t, got.ReleasedAt)
	assert.Equal(t, at, *got.ReleasedAt)
}

func Test_版の更新_壊れた名前と指定漏れは断る(t *testing.T) {
	repo := &mockVersionRepo{}

	_, err := projectversion.NewUpdateVersionUseCase(repo).Execute(
		context.Background(), projectversion.UpdateVersionInput{
			WorkspaceID: pvWS, ProjectID: pvProject, VersionID: pvID, Name: "  ",
		},
	)
	assert.ErrorIs(t, err, domain.ErrInvalidProjectVersionName)

	_, err = projectversion.NewUpdateVersionUseCase(repo).Execute(
		context.Background(), projectversion.UpdateVersionInput{
			WorkspaceID: pvWS, ProjectID: pvProject, Name: "1.0.0",
		},
	)
	assert.Error(t, err)

	repo.AssertNotCalled(t, "UpdateProjectVersion",
		mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

// --- 畳む・戻す ---

func Test_版を畳む(t *testing.T) {
	repo := &mockVersionRepo{}
	repo.On("ArchiveProjectVersion", mock.Anything, pvWS, pvProject, pvID).Return(nil)

	require.NoError(t, projectversion.NewArchiveVersionUseCase(repo).Execute(
		context.Background(), projectversion.VersionRefInput{
			WorkspaceID: pvWS, ProjectID: pvProject, VersionID: pvID,
		},
	))
	repo.AssertExpectations(t)
}

func Test_版を畳む_指定が足りなければ断る(t *testing.T) {
	repo := &mockVersionRepo{}

	err := projectversion.NewArchiveVersionUseCase(repo).Execute(
		context.Background(), projectversion.VersionRefInput{WorkspaceID: pvWS, ProjectID: pvProject},
	)

	assert.Error(t, err)
	repo.AssertNotCalled(t, "ArchiveProjectVersion", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_版を戻す_並びは末尾へ付け直す(t *testing.T) {
	repo := &mockVersionRepo{}
	repo.On("LastProjectVersionPosition", mock.Anything, pvWS, pvProject).Return("a5", nil)
	repo.On("RestoreProjectVersion", mock.Anything, pvWS, pvProject, pvID, mock.MatchedBy(func(pos string) bool {
		return pos > "a5"
	})).Return(nil)

	require.NoError(t, projectversion.NewRestoreVersionUseCase(repo).Execute(
		context.Background(), projectversion.VersionRefInput{
			WorkspaceID: pvWS, ProjectID: pvProject, VersionID: pvID,
		},
	))
	repo.AssertExpectations(t)
}

func Test_版を戻す_並び順が読めなければ戻さない(t *testing.T) {
	repo := &mockVersionRepo{}
	repo.On("LastProjectVersionPosition", mock.Anything, pvWS, pvProject).Return("", errBoom)

	err := projectversion.NewRestoreVersionUseCase(repo).Execute(
		context.Background(), projectversion.VersionRefInput{
			WorkspaceID: pvWS, ProjectID: pvProject, VersionID: pvID,
		},
	)

	assert.ErrorIs(t, err, errBoom)
	repo.AssertNotCalled(t, "RestoreProjectVersion",
		mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_版を戻す_指定が足りなければ断る(t *testing.T) {
	repo := &mockVersionRepo{}

	err := projectversion.NewRestoreVersionUseCase(repo).Execute(
		context.Background(), projectversion.VersionRefInput{WorkspaceID: pvWS, VersionID: pvID},
	)

	assert.Error(t, err)
	repo.AssertNotCalled(t, "LastProjectVersionPosition", mock.Anything, mock.Anything, mock.Anything)
}

// --- チケットの修正バージョン ---

func Test_チケットの修正バージョン_付け外しは望む状態を送る(t *testing.T) {
	t.Run("付ける", func(t *testing.T) {
		repo := &mockVersionRepo{}
		repo.On("AddTicketFixVersion", mock.Anything, pvWS, pvTicket, pvID).Return(nil)
		repo.On("ListTicketFixVersions", mock.Anything, pvWS, pvTicket).
			Return([]domain.ProjectVersion{{ID: pvID, Name: "1.2.0"}}, nil)

		got, err := projectversion.NewTicketFixVersionUseCase(repo).Execute(
			context.Background(), projectversion.TicketFixVersionInput{
				WorkspaceID: pvWS, TicketID: pvTicket, VersionID: pvID, Attach: true,
			},
		)

		require.NoError(t, err)
		assert.Len(t, got, 1)
		// 「切り替え」ではないので二度押しても外れない。
		repo.AssertNotCalled(t, "RemoveTicketFixVersion", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	})

	t.Run("外す", func(t *testing.T) {
		repo := &mockVersionRepo{}
		repo.On("RemoveTicketFixVersion", mock.Anything, pvWS, pvTicket, pvID).Return(nil)
		repo.On("ListTicketFixVersions", mock.Anything, pvWS, pvTicket).Return([]domain.ProjectVersion{}, nil)

		got, err := projectversion.NewTicketFixVersionUseCase(repo).Execute(
			context.Background(), projectversion.TicketFixVersionInput{
				WorkspaceID: pvWS, TicketID: pvTicket, VersionID: pvID,
			},
		)

		require.NoError(t, err)
		assert.Empty(t, got)
		repo.AssertNotCalled(t, "AddTicketFixVersion", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	})
}

func Test_チケットの修正バージョン_付け外しに失敗したら一覧を返さない(t *testing.T) {
	repo := &mockVersionRepo{}
	repo.On("AddTicketFixVersion", mock.Anything, pvWS, pvTicket, pvID).Return(errBoom)

	_, err := projectversion.NewTicketFixVersionUseCase(repo).Execute(
		context.Background(), projectversion.TicketFixVersionInput{
			WorkspaceID: pvWS, TicketID: pvTicket, VersionID: pvID, Attach: true,
		},
	)

	// 失敗したのに一覧を返すと、付いたように見える。
	assert.ErrorIs(t, err, errBoom)
	repo.AssertNotCalled(t, "ListTicketFixVersions", mock.Anything, mock.Anything, mock.Anything)
}

func Test_チケットの修正バージョン_指定が足りなければ断る(t *testing.T) {
	repo := &mockVersionRepo{}

	_, err := projectversion.NewTicketFixVersionUseCase(repo).Execute(
		context.Background(), projectversion.TicketFixVersionInput{
			WorkspaceID: pvWS, TicketID: pvTicket, Attach: true,
		},
	)

	assert.Error(t, err)
	repo.AssertNotCalled(t, "AddTicketFixVersion", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_チケットの修正バージョンの一覧(t *testing.T) {
	repo := &mockVersionRepo{}
	repo.On("ListTicketFixVersions", mock.Anything, pvWS, pvTicket).
		Return([]domain.ProjectVersion{{ID: pvID}}, nil)

	got, err := projectversion.NewListTicketFixVersionsUseCase(repo).Execute(context.Background(), pvWS, pvTicket)
	require.NoError(t, err)
	assert.Len(t, got, 1)

	_, err = projectversion.NewListTicketFixVersionsUseCase(repo).Execute(context.Background(), pvWS, "")
	assert.Error(t, err)
}
