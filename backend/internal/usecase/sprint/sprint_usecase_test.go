package sprint_test

import (
	"context"
	"errors"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/sprint"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

const (
	spWS      = "11111111-1111-1111-1111-111111111111"
	spProject = "22222222-2222-2222-2222-222222222222"
	spID      = "33333333-3333-3333-3333-333333333333"
	spTicket  = "44444444-4444-4444-4444-444444444444"
	spAnchor  = "55555555-5555-5555-5555-555555555555"
)

// errBoom は「repository が失敗したらそのまま外へ出す」ことを見るための番人。
var errBoom = errors.New("boom")

// mockSprintRepo は repository.SprintRepository の testify/mock 実装。
type mockSprintRepo struct{ mock.Mock }

var _ repository.SprintRepository = (*mockSprintRepo)(nil)

func (m *mockSprintRepo) CreateSprint(ctx context.Context, s *domain.Sprint) error {
	args := m.Called(ctx, s)
	if args.Error(0) == nil {
		// 実装は INSERT の RETURNING で受けた行を書き戻す。id を埋める振る舞いを写す。
		s.ID = spID
	}
	return args.Error(0)
}

func (m *mockSprintRepo) FindSprint(ctx context.Context, workspaceID, sprintID string) (*domain.Sprint, error) {
	args := m.Called(ctx, workspaceID, sprintID)
	s, _ := args.Get(0).(*domain.Sprint)
	return s, args.Error(1)
}

func (m *mockSprintRepo) ListSprints(ctx context.Context, workspaceID, projectID string) ([]domain.Sprint, error) {
	args := m.Called(ctx, workspaceID, projectID)
	list, _ := args.Get(0).([]domain.Sprint)
	return list, args.Error(1)
}

func (m *mockSprintRepo) LastSprintPosition(ctx context.Context, workspaceID, projectID string) (string, error) {
	args := m.Called(ctx, workspaceID, projectID)
	return args.String(0), args.Error(1)
}

func (m *mockSprintRepo) UpdateSprint(
	ctx context.Context, workspaceID, sprintID, name string, startDate, endDate *string,
) (*domain.Sprint, error) {
	args := m.Called(ctx, workspaceID, sprintID, name, startDate, endDate)
	s, _ := args.Get(0).(*domain.Sprint)
	return s, args.Error(1)
}

func (m *mockSprintRepo) ChangeSprintState(
	ctx context.Context,
	workspaceID, sprintID string,
	expectedState, newState domain.SprintState,
) (*domain.Sprint, error) {
	args := m.Called(ctx, workspaceID, sprintID, expectedState, newState)
	s, _ := args.Get(0).(*domain.Sprint)
	return s, args.Error(1)
}

func (m *mockSprintRepo) DeleteSprint(ctx context.Context, workspaceID, sprintID string) error {
	args := m.Called(ctx, workspaceID, sprintID)
	return args.Error(0)
}

func (m *mockSprintRepo) CountActiveSprints(ctx context.Context, workspaceID, projectID string) (int64, error) {
	args := m.Called(ctx, workspaceID, projectID)
	n, _ := args.Get(0).(int64)
	return n, args.Error(1)
}

func (m *mockSprintRepo) AddTicketToSprint(ctx context.Context, workspaceID, sprintID, ticketID, position string) error {
	args := m.Called(ctx, workspaceID, sprintID, ticketID, position)
	return args.Error(0)
}

func (m *mockSprintRepo) RemoveTicketFromSprint(ctx context.Context, workspaceID, ticketID string) error {
	args := m.Called(ctx, workspaceID, ticketID)
	return args.Error(0)
}

func (m *mockSprintRepo) LastTicketSprintRankPosition(ctx context.Context, workspaceID, sprintID string) (string, error) {
	args := m.Called(ctx, workspaceID, sprintID)
	return args.String(0), args.Error(1)
}

func (m *mockSprintRepo) ListSprintTicketIDs(ctx context.Context, workspaceID, sprintID string) ([]string, error) {
	args := m.Called(ctx, workspaceID, sprintID)
	ids, _ := args.Get(0).([]string)
	return ids, args.Error(1)
}

func (m *mockSprintRepo) ListSprintTicketRanks(
	ctx context.Context, workspaceID, sprintID string,
) ([]repository.SprintTicketRank, error) {
	args := m.Called(ctx, workspaceID, sprintID)
	ranks, _ := args.Get(0).([]repository.SprintTicketRank)
	return ranks, args.Error(1)
}

func (m *mockSprintRepo) FindTicketSprint(
	ctx context.Context, workspaceID, ticketID string,
) (*repository.SprintTicketRank, error) {
	args := m.Called(ctx, workspaceID, ticketID)
	r, _ := args.Get(0).(*repository.SprintTicketRank)
	return r, args.Error(1)
}

func (m *mockSprintRepo) MoveTicketSprintRank(ctx context.Context, workspaceID, ticketID, position string) error {
	args := m.Called(ctx, workspaceID, ticketID, position)
	return args.Error(0)
}

func (m *mockSprintRepo) CountSprintTickets(ctx context.Context, workspaceID, sprintID string) (int64, error) {
	args := m.Called(ctx, workspaceID, sprintID)
	n, _ := args.Get(0).(int64)
	return n, args.Error(1)
}

func ptr(s string) *string { return &s }

func sprintIn(state domain.SprintState) *domain.Sprint {
	return &domain.Sprint{ID: spID, WorkspaceID: spWS, ProjectID: spProject, Name: "スプリント 1", State: state}
}

// --- 作成 ---

func Test_スプリント作成_保存できない形は問い合わせまで行かせない(t *testing.T) {
	cases := []struct {
		name string
		in   sprint.CreateSprintInput
		want error
	}{
		{
			name: "ワークスペースが空",
			in:   sprint.CreateSprintInput{ProjectID: spProject, Name: "s"},
		},
		{
			name: "プロジェクトが空",
			in:   sprint.CreateSprintInput{WorkspaceID: spWS, Name: "s"},
		},
		{
			name: "名前が空白だけ",
			in:   sprint.CreateSprintInput{WorkspaceID: spWS, ProjectID: spProject, Name: "   "},
			want: sprint.ErrInvalidSprint,
		},
		{
			name: "終わりが始まりより前",
			in: sprint.CreateSprintInput{
				WorkspaceID: spWS, ProjectID: spProject, Name: "s",
				StartDate: ptr("2026-09-10"), EndDate: ptr("2026-09-01"),
			},
			want: sprint.ErrInvalidSprint,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &mockSprintRepo{}
			_, err := sprint.NewCreateSprintUseCase(repo).Execute(context.Background(), tc.in)

			require.Error(t, err)
			if tc.want != nil {
				assert.ErrorIs(t, err, tc.want)
			}
			// 検証で弾いたなら、書き込みの問い合わせは 1 本も出ていないこと。
			repo.AssertNotCalled(t, "CreateSprint", mock.Anything, mock.Anything)
			repo.AssertNotCalled(t, "LastSprintPosition", mock.Anything, mock.Anything, mock.Anything)
		})
	}
}

func Test_スプリント作成_直後は必ず計画中(t *testing.T) {
	repo := &mockSprintRepo{}
	repo.On("LastSprintPosition", mock.Anything, spWS, spProject).Return("a0", nil)
	repo.On("CreateSprint", mock.Anything, mock.Anything).Return(nil)

	got, err := sprint.NewCreateSprintUseCase(repo).Execute(context.Background(), sprint.CreateSprintInput{
		WorkspaceID: spWS, ProjectID: spProject, Name: "スプリント 1",
		StartDate: ptr("2026-09-01"), EndDate: ptr("2026-09-14"),
	})

	require.NoError(t, err)
	assert.Equal(t, spID, got.ID)
	// 開始は ChangeSprintState の仕事。作成でいきなり進行中にはしない。
	assert.Equal(t, domain.SprintStatePlanned, got.State)
	assert.Greater(t, got.Position, "a0", "末尾（最後の位置より後ろ）に置くこと")
	repo.AssertExpectations(t)
}

func Test_スプリント作成_並び順が読めなければ作らない(t *testing.T) {
	repo := &mockSprintRepo{}
	repo.On("LastSprintPosition", mock.Anything, spWS, spProject).Return("", errBoom)

	_, err := sprint.NewCreateSprintUseCase(repo).Execute(context.Background(), sprint.CreateSprintInput{
		WorkspaceID: spWS, ProjectID: spProject, Name: "スプリント 1",
	})

	assert.ErrorIs(t, err, errBoom)
	repo.AssertNotCalled(t, "CreateSprint", mock.Anything, mock.Anything)
}

// --- 更新・削除 ---

func Test_スプリント更新_名前と期間だけを直す(t *testing.T) {
	repo := &mockSprintRepo{}
	updated := sprintIn(domain.SprintStateActive)
	repo.On("UpdateSprint", mock.Anything, spWS, spID, "改名後", mock.Anything, mock.Anything).Return(updated, nil)

	got, err := sprint.NewUpdateSprintUseCase(repo).Execute(context.Background(), sprint.UpdateSprintInput{
		WorkspaceID: spWS, SprintID: spID, Name: "改名後", StartDate: ptr("2026-09-01"), EndDate: ptr("2026-09-14"),
	})

	require.NoError(t, err)
	assert.Equal(t, updated, got)
	repo.AssertExpectations(t)
}

func Test_スプリント更新_壊れた形は断る(t *testing.T) {
	repo := &mockSprintRepo{}

	_, err := sprint.NewUpdateSprintUseCase(repo).Execute(context.Background(), sprint.UpdateSprintInput{
		WorkspaceID: spWS, SprintID: spID, Name: " ",
	})
	assert.ErrorIs(t, err, sprint.ErrInvalidSprint)

	_, err = sprint.NewUpdateSprintUseCase(repo).Execute(context.Background(), sprint.UpdateSprintInput{
		WorkspaceID: spWS, Name: "s",
	})
	assert.Error(t, err, "スプリントが指定されていない")

	repo.AssertNotCalled(t, "UpdateSprint", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_スプリント削除(t *testing.T) {
	repo := &mockSprintRepo{}
	repo.On("DeleteSprint", mock.Anything, spWS, spID).Return(nil)

	require.NoError(t, sprint.NewDeleteSprintUseCase(repo).Execute(context.Background(), spWS, spID))
	assert.Error(t, sprint.NewDeleteSprintUseCase(repo).Execute(context.Background(), spWS, ""))
	repo.AssertExpectations(t)
}

// --- 一覧 ---

func Test_スプリント一覧_件数を1件ずつ添える(t *testing.T) {
	repo := &mockSprintRepo{}
	repo.On("ListSprints", mock.Anything, spWS, spProject).Return([]domain.Sprint{
		{ID: spID, Name: "スプリント 1"},
		{ID: spAnchor, Name: "スプリント 2"},
	}, nil)
	repo.On("CountSprintTickets", mock.Anything, spWS, spID).Return(int64(3), nil)
	repo.On("CountSprintTickets", mock.Anything, spWS, spAnchor).Return(int64(0), nil)

	got, err := sprint.NewListSprintsUseCase(repo).Execute(context.Background(), spWS, spProject)

	require.NoError(t, err)
	require.Len(t, got, 2)
	assert.EqualValues(t, 3, got[0].TicketCount)
	assert.EqualValues(t, 0, got[1].TicketCount, "0 件のスプリントも一覧から落とさない")
	repo.AssertExpectations(t)
}

func Test_スプリント一覧_件数が読めなければ一覧ごと失敗する(t *testing.T) {
	repo := &mockSprintRepo{}
	repo.On("ListSprints", mock.Anything, spWS, spProject).Return([]domain.Sprint{{ID: spID}}, nil)
	repo.On("CountSprintTickets", mock.Anything, spWS, spID).Return(int64(0), errBoom)

	_, err := sprint.NewListSprintsUseCase(repo).Execute(context.Background(), spWS, spProject)

	// 件数だけ 0 にして返すと「空のスプリント」と区別が付かない。
	assert.ErrorIs(t, err, errBoom)
}

func Test_スプリント一覧_入れ物が指定されていなければ断る(t *testing.T) {
	repo := &mockSprintRepo{}
	_, err := sprint.NewListSprintsUseCase(repo).Execute(context.Background(), spWS, "")
	assert.Error(t, err)
	repo.AssertNotCalled(t, "ListSprints", mock.Anything, mock.Anything, mock.Anything)
}

// --- 状態 ---

func Test_スプリントの状態_進む向きにしか動かさない(t *testing.T) {
	cases := []struct {
		name string
		from domain.SprintState
		to   domain.SprintState
	}{
		{name: "計画中へ戻す", from: domain.SprintStateActive, to: domain.SprintStatePlanned},
		{name: "計画中から完了へ飛ばす", from: domain.SprintStatePlanned, to: domain.SprintStateCompleted},
		{name: "完了から開始し直す", from: domain.SprintStateCompleted, to: domain.SprintStateActive},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &mockSprintRepo{}
			repo.On("FindSprint", mock.Anything, spWS, spID).Return(sprintIn(tc.from), nil)

			_, err := sprint.NewChangeSprintStateUseCase(repo).Execute(context.Background(), sprint.ChangeSprintStateInput{
				WorkspaceID: spWS, SprintID: spID, State: tc.to,
			})

			assert.ErrorIs(t, err, sprint.ErrSprintStateTransition)
			repo.AssertNotCalled(t, "ChangeSprintState", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
		})
	}
}

func Test_スプリントの状態_知らない値は断る(t *testing.T) {
	repo := &mockSprintRepo{}

	_, err := sprint.NewChangeSprintStateUseCase(repo).Execute(context.Background(), sprint.ChangeSprintStateInput{
		WorkspaceID: spWS, SprintID: spID, State: domain.SprintState("なんとなく"),
	})

	assert.ErrorIs(t, err, sprint.ErrSprintStateTransition)
	repo.AssertNotCalled(t, "FindSprint", mock.Anything, mock.Anything, mock.Anything)
}

func Test_スプリントの状態_進行中は1つまで(t *testing.T) {
	repo := &mockSprintRepo{}
	repo.On("FindSprint", mock.Anything, spWS, spID).Return(sprintIn(domain.SprintStatePlanned), nil)
	repo.On("CountActiveSprints", mock.Anything, spWS, spProject).Return(int64(1), nil)

	_, err := sprint.NewChangeSprintStateUseCase(repo).Execute(context.Background(), sprint.ChangeSprintStateInput{
		WorkspaceID: spWS, SprintID: spID, State: domain.SprintStateActive,
	})

	assert.ErrorIs(t, err, sprint.ErrActiveSprintExists)
	repo.AssertNotCalled(
		t,
		"ChangeSprintState",
		mock.Anything,
		mock.Anything,
		mock.Anything,
		mock.Anything,
		mock.Anything,
	)
}

func Test_スプリントの状態_他に進行中が無ければ開始できる(t *testing.T) {
	repo := &mockSprintRepo{}
	started := sprintIn(domain.SprintStateActive)
	repo.On("FindSprint", mock.Anything, spWS, spID).Return(sprintIn(domain.SprintStatePlanned), nil)
	repo.On("CountActiveSprints", mock.Anything, spWS, spProject).Return(int64(0), nil)
	repo.On(
		"ChangeSprintState",
		mock.Anything,
		spWS,
		spID,
		domain.SprintStatePlanned,
		domain.SprintStateActive,
	).Return(started, nil)

	got, err := sprint.NewChangeSprintStateUseCase(repo).Execute(context.Background(), sprint.ChangeSprintStateInput{
		WorkspaceID: spWS, SprintID: spID, State: domain.SprintStateActive,
	})

	require.NoError(t, err)
	assert.Equal(t, domain.SprintStateActive, got.State)
	repo.AssertExpectations(t)
}

func Test_スプリントの状態_完了は進行中の数を数えない(t *testing.T) {
	repo := &mockSprintRepo{}
	done := sprintIn(domain.SprintStateCompleted)
	repo.On("FindSprint", mock.Anything, spWS, spID).Return(sprintIn(domain.SprintStateActive), nil)
	repo.On(
		"ChangeSprintState",
		mock.Anything,
		spWS,
		spID,
		domain.SprintStateActive,
		domain.SprintStateCompleted,
	).Return(done, nil)

	got, err := sprint.NewChangeSprintStateUseCase(repo).Execute(context.Background(), sprint.ChangeSprintStateInput{
		WorkspaceID: spWS, SprintID: spID, State: domain.SprintStateCompleted,
	})

	require.NoError(t, err)
	assert.Equal(t, domain.SprintStateCompleted, got.State)
	// 「1 つまで」は開始のときだけの規則。完了で数えると無駄な問い合わせが 1 本増える。
	repo.AssertNotCalled(t, "CountActiveSprints", mock.Anything, mock.Anything, mock.Anything)
}

func Test_スプリントの状態_更新競合を既存エラーに変換する(t *testing.T) {
	tests := []struct {
		name    string
		repoErr error
		wantErr error
	}{
		{
			name:    "状態が途中で変わった",
			repoErr: repository.ErrSprintStateConflict,
			wantErr: sprint.ErrSprintStateTransition,
		},
		{
			name:    "別のスプリントが先にactiveになった",
			repoErr: repository.ErrActiveSprintAlreadyExists,
			wantErr: sprint.ErrActiveSprintExists,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &mockSprintRepo{}

			repo.On("FindSprint", mock.Anything, spWS, spID).
				Return(sprintIn(domain.SprintStatePlanned), nil)

			repo.On("CountActiveSprints", mock.Anything, spWS, spProject).
				Return(int64(0), nil)

			repo.On(
				"ChangeSprintState",
				mock.Anything,
				spWS,
				spID,
				domain.SprintStatePlanned,
				domain.SprintStateActive,
			).Return((*domain.Sprint)(nil), tt.repoErr)

			_, err := sprint.NewChangeSprintStateUseCase(repo).Execute(
				context.Background(),
				sprint.ChangeSprintStateInput{
					WorkspaceID: spWS,
					SprintID:    spID,
					State:       domain.SprintStateActive,
				},
			)

			assert.ErrorIs(t, err, tt.wantErr)
			repo.AssertExpectations(t)
		})
	}
}

func Test_スプリントの状態_指定が足りなければ断る(t *testing.T) {
	repo := &mockSprintRepo{}
	_, err := sprint.NewChangeSprintStateUseCase(repo).Execute(context.Background(), sprint.ChangeSprintStateInput{
		SprintID: spID, State: domain.SprintStateActive,
	})
	assert.Error(t, err)
}

// --- 出し入れ ---

func Test_スプリントへ入れる_終わったスプリントには足させない(t *testing.T) {
	repo := &mockSprintRepo{}
	repo.On("FindSprint", mock.Anything, spWS, spID).Return(sprintIn(domain.SprintStateCompleted), nil)

	err := sprint.NewAddTicketToSprintUseCase(repo).Execute(context.Background(), spWS, spID, spTicket)

	// 終わったスプリントは記録。後から中身が変わると、終えた期間の実績が書き換わる。
	assert.ErrorIs(t, err, sprint.ErrSprintClosed)
	repo.AssertNotCalled(t, "AddTicketToSprint", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_スプリントへ入れる_末尾に置く(t *testing.T) {
	repo := &mockSprintRepo{}
	repo.On("FindSprint", mock.Anything, spWS, spID).Return(sprintIn(domain.SprintStateActive), nil)
	repo.On("LastTicketSprintRankPosition", mock.Anything, spWS, spID).Return("a0", nil)
	repo.On("AddTicketToSprint", mock.Anything, spWS, spID, spTicket, mock.MatchedBy(func(pos string) bool {
		return pos > "a0"
	})).Return(nil)

	require.NoError(t, sprint.NewAddTicketToSprintUseCase(repo).Execute(context.Background(), spWS, spID, spTicket))
	repo.AssertExpectations(t)
}

func Test_スプリントへ入れる_指定が足りなければ断る(t *testing.T) {
	repo := &mockSprintRepo{}
	assert.Error(t, sprint.NewAddTicketToSprintUseCase(repo).Execute(context.Background(), spWS, spID, ""))
	repo.AssertNotCalled(t, "FindSprint", mock.Anything, mock.Anything, mock.Anything)
}

func Test_スプリントから外す(t *testing.T) {
	repo := &mockSprintRepo{}
	repo.On("RemoveTicketFromSprint", mock.Anything, spWS, spTicket).Return(nil)

	require.NoError(t, sprint.NewRemoveTicketFromSprintUseCase(repo).Execute(context.Background(), spWS, spTicket))
	assert.Error(t, sprint.NewRemoveTicketFromSprintUseCase(repo).Execute(context.Background(), "", spTicket))
	repo.AssertExpectations(t)
}

func Test_スプリントの中身の一覧(t *testing.T) {
	repo := &mockSprintRepo{}
	repo.On("ListSprintTicketIDs", mock.Anything, spWS, spID).Return([]string{spTicket}, nil)

	got, err := sprint.NewListSprintTicketIDsUseCase(repo).Execute(context.Background(), spWS, spID)
	require.NoError(t, err)
	assert.Equal(t, []string{spTicket}, got)

	_, err = sprint.NewListSprintTicketIDsUseCase(repo).Execute(context.Background(), spWS, "")
	assert.Error(t, err)
}

// --- チケットが入っているスプリント ---

func Test_チケットのスプリント_入っていなければnilを返す(t *testing.T) {
	repo := &mockSprintRepo{}
	repo.On("FindTicketSprint", mock.Anything, spWS, spTicket).Return((*repository.SprintTicketRank)(nil), nil)

	got, err := sprint.NewFindTicketSprintUseCase(repo).Execute(context.Background(), spWS, spTicket)

	// 入っていないことは異常ではない。エラーにすると詳細画面がそこで止まる。
	require.NoError(t, err)
	assert.Nil(t, got)
	repo.AssertNotCalled(t, "FindSprint", mock.Anything, mock.Anything, mock.Anything)
}

// repository は「行が無い」を ErrSprintTicketNotFound で知らせる。素通しすると
// handler が 404 にしてしまい、スプリントに入っていないチケット（大多数）の詳細で
// 毎回「取れなかった」扱いになる。
func Test_チケットのスプリント_行が無いという知らせは入っていないとして扱う(t *testing.T) {
	repo := &mockSprintRepo{}
	repo.On("FindTicketSprint", mock.Anything, spWS, spTicket).
		Return((*repository.SprintTicketRank)(nil), repository.ErrSprintTicketNotFound)

	got, err := sprint.NewFindTicketSprintUseCase(repo).Execute(context.Background(), spWS, spTicket)

	require.NoError(t, err)
	assert.Nil(t, got)
	repo.AssertNotCalled(t, "FindSprint", mock.Anything, mock.Anything, mock.Anything)
}

func Test_チケットのスプリント_名前まで引き直す(t *testing.T) {
	repo := &mockSprintRepo{}
	repo.On("FindTicketSprint", mock.Anything, spWS, spTicket).
		Return(&repository.SprintTicketRank{SprintID: spID, TicketID: spTicket, Position: "a0"}, nil)
	repo.On("FindSprint", mock.Anything, spWS, spID).Return(sprintIn(domain.SprintStateActive), nil)

	got, err := sprint.NewFindTicketSprintUseCase(repo).Execute(context.Background(), spWS, spTicket)

	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "スプリント 1", got.Name, "並びの行には名前が無いので sprints から引くこと")
	repo.AssertExpectations(t)
}

func Test_チケットのスプリント_指定が足りなければ断る(t *testing.T) {
	repo := &mockSprintRepo{}
	_, err := sprint.NewFindTicketSprintUseCase(repo).Execute(context.Background(), "", spTicket)
	assert.Error(t, err)
}

// --- 並べ替え ---

func moveRepo(t *testing.T, state domain.SprintState) *mockSprintRepo {
	t.Helper()
	repo := &mockSprintRepo{}
	repo.On("FindTicketSprint", mock.Anything, spWS, spTicket).
		Return(&repository.SprintTicketRank{SprintID: spID, TicketID: spTicket, Position: "a5"}, nil)
	repo.On("FindSprint", mock.Anything, spWS, spID).Return(sprintIn(state), nil)
	return repo
}

func Test_スプリント内の並べ替え_終わったスプリントでは動かさない(t *testing.T) {
	repo := moveRepo(t, domain.SprintStateCompleted)

	err := sprint.NewMoveTicketInSprintUseCase(repo).Execute(context.Background(), sprint.MoveTicketInSprintInput{
		WorkspaceID: spWS, TicketID: spTicket,
	})

	assert.ErrorIs(t, err, sprint.ErrSprintClosed)
	repo.AssertNotCalled(t, "MoveTicketSprintRank", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_スプリント内の並べ替え_隣を指さなければ末尾へ(t *testing.T) {
	repo := moveRepo(t, domain.SprintStateActive)
	repo.On("LastTicketSprintRankPosition", mock.Anything, spWS, spID).Return("a9", nil)
	repo.On("MoveTicketSprintRank", mock.Anything, spWS, spTicket, mock.MatchedBy(func(pos string) bool {
		return pos > "a9"
	})).Return(nil)

	require.NoError(t, sprint.NewMoveTicketInSprintUseCase(repo).Execute(
		context.Background(), sprint.MoveTicketInSprintInput{WorkspaceID: spWS, TicketID: spTicket},
	))
	repo.AssertExpectations(t)
}

func Test_スプリント内の並べ替え_隣の前後へ挟む(t *testing.T) {
	ranks := []repository.SprintTicketRank{
		{SprintID: spID, TicketID: "t1", Position: "a1"},
		{SprintID: spID, TicketID: spAnchor, Position: "a5"},
		{SprintID: spID, TicketID: "t3", Position: "a9"},
	}

	t.Run("直後へ置くと隣とその次のあいだに入る", func(t *testing.T) {
		repo := moveRepo(t, domain.SprintStateActive)
		repo.On("ListSprintTicketRanks", mock.Anything, spWS, spID).Return(ranks, nil)
		repo.On("MoveTicketSprintRank", mock.Anything, spWS, spTicket, mock.MatchedBy(func(pos string) bool {
			return pos > "a5" && pos < "a9"
		})).Return(nil)

		require.NoError(t, sprint.NewMoveTicketInSprintUseCase(repo).Execute(
			context.Background(), sprint.MoveTicketInSprintInput{
				WorkspaceID: spWS, TicketID: spTicket, AnchorTicketID: ptr(spAnchor), AnchorAfter: true,
			},
		))
		repo.AssertExpectations(t)
	})

	t.Run("手前へ置くと隣とその前のあいだに入る", func(t *testing.T) {
		repo := moveRepo(t, domain.SprintStateActive)
		repo.On("ListSprintTicketRanks", mock.Anything, spWS, spID).Return(ranks, nil)
		repo.On("MoveTicketSprintRank", mock.Anything, spWS, spTicket, mock.MatchedBy(func(pos string) bool {
			return pos > "a1" && pos < "a5"
		})).Return(nil)

		require.NoError(t, sprint.NewMoveTicketInSprintUseCase(repo).Execute(
			context.Background(), sprint.MoveTicketInSprintInput{
				WorkspaceID: spWS, TicketID: spTicket, AnchorTicketID: ptr(spAnchor),
			},
		))
		repo.AssertExpectations(t)
	})
}

func Test_スプリント内の並べ替え_同じスプリントに居ない隣は断る(t *testing.T) {
	repo := moveRepo(t, domain.SprintStateActive)
	repo.On("ListSprintTicketRanks", mock.Anything, spWS, spID).Return([]repository.SprintTicketRank{
		{SprintID: spID, TicketID: "t1", Position: "a1"},
	}, nil)

	err := sprint.NewMoveTicketInSprintUseCase(repo).Execute(context.Background(), sprint.MoveTicketInSprintInput{
		WorkspaceID: spWS, TicketID: spTicket, AnchorTicketID: ptr("居ない人"),
	})

	// 黙って末尾へ落とすと、置いた場所と違う場所に入ったまま成功したように見える。
	assert.ErrorIs(t, err, sprint.ErrSprintMoveAnchorNotSibling)
	repo.AssertNotCalled(t, "MoveTicketSprintRank", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_スプリント内の並べ替え_どのスプリントにも入っていなければそのまま返す(t *testing.T) {
	repo := &mockSprintRepo{}
	repo.On("FindTicketSprint", mock.Anything, spWS, spTicket).
		Return((*repository.SprintTicketRank)(nil), repository.ErrSprintTicketNotFound)

	err := sprint.NewMoveTicketInSprintUseCase(repo).Execute(context.Background(), sprint.MoveTicketInSprintInput{
		WorkspaceID: spWS, TicketID: spTicket,
	})

	assert.ErrorIs(t, err, repository.ErrSprintTicketNotFound)
}

func Test_スプリント内の並べ替え_指定が足りなければ断る(t *testing.T) {
	repo := &mockSprintRepo{}
	err := sprint.NewMoveTicketInSprintUseCase(repo).Execute(context.Background(), sprint.MoveTicketInSprintInput{
		WorkspaceID: spWS,
	})
	assert.Error(t, err)
	repo.AssertNotCalled(t, "FindTicketSprint", mock.Anything, mock.Anything, mock.Anything)
}
