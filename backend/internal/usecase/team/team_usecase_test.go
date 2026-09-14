package team_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/team"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

const (
	tmWS      = "11111111-1111-1111-1111-111111111111"
	tmProject = "22222222-2222-2222-2222-222222222222"
	tmID      = "33333333-3333-3333-3333-333333333333"
	tmTicket  = "44444444-4444-4444-4444-444444444444"
	tmUser    = uint64(7)
)

var errBoom = errors.New("boom")

// mockTeamRepo は repository.TeamRepository の testify/mock 実装。
type mockTeamRepo struct{ mock.Mock }

var _ repository.TeamRepository = (*mockTeamRepo)(nil)

func (m *mockTeamRepo) CreateTeam(ctx context.Context, workspaceID, projectID, name string) (*domain.Team, error) {
	args := m.Called(ctx, workspaceID, projectID, name)
	t, _ := args.Get(0).(*domain.Team)
	return t, args.Error(1)
}

func (m *mockTeamRepo) ListTeams(ctx context.Context, workspaceID, projectID string) ([]domain.Team, error) {
	args := m.Called(ctx, workspaceID, projectID)
	list, _ := args.Get(0).([]domain.Team)
	return list, args.Error(1)
}

func (m *mockTeamRepo) GetTeam(ctx context.Context, workspaceID, projectID, teamID string) (*domain.Team, error) {
	args := m.Called(ctx, workspaceID, projectID, teamID)
	t, _ := args.Get(0).(*domain.Team)
	return t, args.Error(1)
}

func (m *mockTeamRepo) UpdateTeam(ctx context.Context, workspaceID, projectID, teamID, name string) (*domain.Team, error) {
	args := m.Called(ctx, workspaceID, projectID, teamID, name)
	t, _ := args.Get(0).(*domain.Team)
	return t, args.Error(1)
}

func (m *mockTeamRepo) ClearTicketsTeam(ctx context.Context, workspaceID, teamID string) error {
	args := m.Called(ctx, workspaceID, teamID)
	return args.Error(0)
}

func (m *mockTeamRepo) DeleteTeam(ctx context.Context, workspaceID, projectID, teamID string) error {
	args := m.Called(ctx, workspaceID, projectID, teamID)
	return args.Error(0)
}

func (m *mockTeamRepo) AddTeamMember(ctx context.Context, workspaceID, teamID string, userID uint64) error {
	args := m.Called(ctx, workspaceID, teamID, userID)
	return args.Error(0)
}

func (m *mockTeamRepo) RemoveTeamMember(ctx context.Context, workspaceID, teamID string, userID uint64) error {
	args := m.Called(ctx, workspaceID, teamID, userID)
	return args.Error(0)
}

func (m *mockTeamRepo) ListTeamMembers(ctx context.Context, workspaceID, teamID string) ([]domain.TeamMember, error) {
	args := m.Called(ctx, workspaceID, teamID)
	list, _ := args.Get(0).([]domain.TeamMember)
	return list, args.Error(1)
}

func (m *mockTeamRepo) SetTicketTeam(ctx context.Context, workspaceID, ticketID, teamID string) (*domain.Ticket, error) {
	args := m.Called(ctx, workspaceID, ticketID, teamID)
	tk, _ := args.Get(0).(*domain.Ticket)
	return tk, args.Error(1)
}

// --- fake: TxManager ---

// txMarkerKey は fakeTxManager が DoInTx の中で ctx に埋め込む印。本物の *sql.Tx を
// 持たないテストで「取引の中から呼ばれたか」を mock.MatchedBy(inTx) で確かめるための値。
type txMarkerKeyType struct{}

var txMarkerKey = txMarkerKeyType{}

func inTx(ctx context.Context) bool {
	v, _ := ctx.Value(txMarkerKey).(bool)
	return v
}

type fakeTxManager struct{ calls int }

var _ repository.TxManager = (*fakeTxManager)(nil)

func (f *fakeTxManager) DoInTx(ctx context.Context, fn func(context.Context) error) error {
	f.calls++
	return fn(context.WithValue(ctx, txMarkerKey, true))
}

// --- 作成 ---

func Test_チーム作成_前後の空白を落として保存する(t *testing.T) {
	repo := &mockTeamRepo{}
	created := &domain.Team{ID: tmID, WorkspaceID: tmWS, ProjectID: tmProject, Name: "基盤"}
	repo.On("CreateTeam", mock.Anything, tmWS, tmProject, "基盤").Return(created, nil)

	got, err := team.NewCreateTeamUseCase(repo).Execute(context.Background(), team.CreateTeamInput{
		WorkspaceID: tmWS, ProjectID: tmProject, Name: "  基盤  ",
	})

	require.NoError(t, err)
	assert.Equal(t, created, got)
	// 見た目が同じで前後の空白だけ違う 2 つのチームを作れてしまわないように、
	// 保存する前に落とす（同名は DB の一意制約が弾く）。
	repo.AssertExpectations(t)
}

func Test_チーム作成_保存できない名前は問い合わせまで行かせない(t *testing.T) {
	cases := []struct {
		name string
		in   team.CreateTeamInput
		want error
	}{
		{name: "ワークスペースが空", in: team.CreateTeamInput{ProjectID: tmProject, Name: "基盤"}},
		{name: "プロジェクトが空", in: team.CreateTeamInput{WorkspaceID: tmWS, Name: "基盤"}},
		{
			name: "空白だけ",
			in:   team.CreateTeamInput{WorkspaceID: tmWS, ProjectID: tmProject, Name: "   "},
			want: domain.ErrInvalidTeamName,
		},
		{
			name: "長すぎる",
			in: team.CreateTeamInput{
				WorkspaceID: tmWS, ProjectID: tmProject,
				Name: strings.Repeat("あ", domain.TeamNameMax+1),
			},
			want: domain.ErrInvalidTeamName,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &mockTeamRepo{}
			_, err := team.NewCreateTeamUseCase(repo).Execute(context.Background(), tc.in)

			require.Error(t, err)
			if tc.want != nil {
				assert.ErrorIs(t, err, tc.want)
			}
			repo.AssertNotCalled(t, "CreateTeam", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
		})
	}
}

// --- 一覧 ---

func Test_チーム一覧_所属まで詰めて返す(t *testing.T) {
	repo := &mockTeamRepo{}
	repo.On("ListTeams", mock.Anything, tmWS, tmProject).Return([]domain.Team{
		{ID: tmID, Name: "基盤"},
		{ID: "other", Name: "画面"},
	}, nil)
	repo.On("ListTeamMembers", mock.Anything, tmWS, tmID).
		Return([]domain.TeamMember{{UserID: tmUser, Name: "川野"}}, nil)
	repo.On("ListTeamMembers", mock.Anything, tmWS, "other").Return([]domain.TeamMember{}, nil)

	got, err := team.NewListTeamsUseCase(repo).Execute(context.Background(), tmWS, tmProject)

	require.NoError(t, err)
	require.Len(t, got, 2)
	assert.Equal(t, "川野", got[0].Members[0].Name)
	assert.Empty(t, got[1].Members, "誰も居ないチームも一覧から落とさない")
	repo.AssertExpectations(t)
}

func Test_チーム一覧_所属が読めなければ一覧ごと失敗する(t *testing.T) {
	repo := &mockTeamRepo{}
	repo.On("ListTeams", mock.Anything, tmWS, tmProject).Return([]domain.Team{{ID: tmID}}, nil)
	repo.On("ListTeamMembers", mock.Anything, tmWS, tmID).Return([]domain.TeamMember(nil), errBoom)

	_, err := team.NewListTeamsUseCase(repo).Execute(context.Background(), tmWS, tmProject)

	// 所属だけ空で返すと「誰も居ないチーム」と区別が付かない。
	assert.ErrorIs(t, err, errBoom)
}

func Test_チーム一覧_入れ物が指定されていなければ断る(t *testing.T) {
	repo := &mockTeamRepo{}
	_, err := team.NewListTeamsUseCase(repo).Execute(context.Background(), "", tmProject)
	assert.Error(t, err)
	repo.AssertNotCalled(t, "ListTeams", mock.Anything, mock.Anything, mock.Anything)
}

// --- 改名 ---

func Test_チーム改名(t *testing.T) {
	repo := &mockTeamRepo{}
	renamed := &domain.Team{ID: tmID, Name: "基盤チーム"}
	repo.On("UpdateTeam", mock.Anything, tmWS, tmProject, tmID, "基盤チーム").Return(renamed, nil)

	got, err := team.NewUpdateTeamUseCase(repo).Execute(context.Background(), team.UpdateTeamInput{
		WorkspaceID: tmWS, ProjectID: tmProject, TeamID: tmID, Name: " 基盤チーム ",
	})

	require.NoError(t, err)
	assert.Equal(t, renamed, got)
	repo.AssertExpectations(t)
}

func Test_チーム改名_壊れた名前と指定漏れは断る(t *testing.T) {
	repo := &mockTeamRepo{}

	_, err := team.NewUpdateTeamUseCase(repo).Execute(context.Background(), team.UpdateTeamInput{
		WorkspaceID: tmWS, ProjectID: tmProject, TeamID: tmID, Name: "  ",
	})
	assert.ErrorIs(t, err, domain.ErrInvalidTeamName)

	_, err = team.NewUpdateTeamUseCase(repo).Execute(context.Background(), team.UpdateTeamInput{
		WorkspaceID: tmWS, ProjectID: tmProject, Name: "基盤",
	})
	assert.Error(t, err)

	repo.AssertNotCalled(t, "UpdateTeam", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

// --- 削除 ---

func Test_チーム削除_印を外してから消すまでを1つの取引で行う(t *testing.T) {
	repo := &mockTeamRepo{}
	tx := &fakeTxManager{}
	repo.On("ClearTicketsTeam", mock.MatchedBy(inTx), tmWS, tmID).Return(nil)
	repo.On("DeleteTeam", mock.MatchedBy(inTx), tmWS, tmProject, tmID).Return(nil)

	require.NoError(t, team.NewDeleteTeamUseCase(repo, tx).Execute(context.Background(), tmWS, tmProject, tmID))

	assert.Equal(t, 1, tx.calls, "2 文をまとめて 1 つの取引にすること")
	repo.AssertExpectations(t)
}

func Test_チーム削除_印を外せなければ消しに行かない(t *testing.T) {
	repo := &mockTeamRepo{}
	tx := &fakeTxManager{}
	repo.On("ClearTicketsTeam", mock.Anything, tmWS, tmID).Return(errBoom)

	err := team.NewDeleteTeamUseCase(repo, tx).Execute(context.Background(), tmWS, tmProject, tmID)

	// 消してから外すと、消えたチームの id がチケットに残る（複合 FK が無効な組を指す）。
	assert.ErrorIs(t, err, errBoom)
	repo.AssertNotCalled(t, "DeleteTeam", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_チーム削除_指定が足りなければ取引も始めない(t *testing.T) {
	repo := &mockTeamRepo{}
	tx := &fakeTxManager{}

	err := team.NewDeleteTeamUseCase(repo, tx).Execute(context.Background(), tmWS, tmProject, "")

	assert.Error(t, err)
	assert.Equal(t, 0, tx.calls)
}

// --- 所属の付け外し ---

func Test_チーム所属_どちらにしたいかを送る(t *testing.T) {
	t.Run("入れる", func(t *testing.T) {
		repo := &mockTeamRepo{}
		repo.On("AddTeamMember", mock.Anything, tmWS, tmID, tmUser).Return(nil)
		repo.On("ListTeamMembers", mock.Anything, tmWS, tmID).
			Return([]domain.TeamMember{{UserID: tmUser, Name: "川野"}}, nil)

		got, err := team.NewTeamMembershipUseCase(repo).Execute(context.Background(), team.TeamMembershipInput{
			WorkspaceID: tmWS, TeamID: tmID, UserID: tmUser, Member: true,
		})

		require.NoError(t, err)
		assert.Len(t, got, 1)
		// 「切り替え」ではないので、二重に押しても外れない。
		repo.AssertNotCalled(t, "RemoveTeamMember", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	})

	t.Run("外す", func(t *testing.T) {
		repo := &mockTeamRepo{}
		repo.On("RemoveTeamMember", mock.Anything, tmWS, tmID, tmUser).Return(nil)
		repo.On("ListTeamMembers", mock.Anything, tmWS, tmID).Return([]domain.TeamMember{}, nil)

		got, err := team.NewTeamMembershipUseCase(repo).Execute(context.Background(), team.TeamMembershipInput{
			WorkspaceID: tmWS, TeamID: tmID, UserID: tmUser,
		})

		require.NoError(t, err)
		assert.Empty(t, got)
		repo.AssertNotCalled(t, "AddTeamMember", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	})
}

func Test_チーム所属_付け外しに失敗したら一覧を返さない(t *testing.T) {
	repo := &mockTeamRepo{}
	repo.On("AddTeamMember", mock.Anything, tmWS, tmID, tmUser).Return(errBoom)

	_, err := team.NewTeamMembershipUseCase(repo).Execute(context.Background(), team.TeamMembershipInput{
		WorkspaceID: tmWS, TeamID: tmID, UserID: tmUser, Member: true,
	})

	assert.ErrorIs(t, err, errBoom)
	repo.AssertNotCalled(t, "ListTeamMembers", mock.Anything, mock.Anything, mock.Anything)
}

func Test_チーム所属_指定が足りなければ断る(t *testing.T) {
	repo := &mockTeamRepo{}

	_, err := team.NewTeamMembershipUseCase(repo).Execute(context.Background(), team.TeamMembershipInput{
		WorkspaceID: tmWS, TeamID: tmID, Member: true,
	})

	assert.Error(t, err, "誰を入れるのかが無い")
	repo.AssertNotCalled(t, "AddTeamMember", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

// --- チケットの担当チーム ---

func Test_チケットの担当チーム_空なら外す(t *testing.T) {
	repo := &mockTeamRepo{}
	repo.On("SetTicketTeam", mock.Anything, tmWS, tmTicket, "").Return(&domain.Ticket{ID: tmTicket}, nil)

	got, err := team.NewSetTicketTeamUseCase(repo).Execute(context.Background(), team.SetTicketTeamInput{
		WorkspaceID: tmWS, TicketID: tmTicket,
	})

	require.NoError(t, err)
	assert.Equal(t, tmTicket, got.ID)
	repo.AssertExpectations(t)
}

func Test_チケットの担当チーム_指定が足りなければ断る(t *testing.T) {
	repo := &mockTeamRepo{}

	_, err := team.NewSetTicketTeamUseCase(repo).Execute(context.Background(), team.SetTicketTeamInput{
		WorkspaceID: tmWS, TeamID: tmID,
	})

	assert.Error(t, err)
	repo.AssertNotCalled(t, "SetTicketTeam", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}
