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

// fakeTxManager は DoInTx をそのまま fn(ctx) の呼び出しに委譲する（テストではトランザクションの
// 有無を区別しない。usecase/kb/mocks_test.go の同名ヘルパーと同じ理由）。
type fakeTxManager struct{}

func (fakeTxManager) DoInTx(ctx context.Context, fn func(ctx context.Context) error) error {
	return fn(ctx)
}

// Test_チケット有効化_既に有効なら409相当のエラー は「有効化済み」の正本判定
// （初期状態を持つ現役の状態が 1 つでもあるか）を検証する。
func Test_チケット有効化_既に有効なら拒否(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("HasActiveInitialTicketStatus", mock.Anything, tkWS, tkProject).Return(true, nil)

	_, err := ticket.NewEnableTicketsForProjectUseCase(repo, fakeTxManager{}).
		Execute(context.Background(), ticket.EnableTicketsForProjectInput{WorkspaceID: tkWS, ProjectID: tkProject})

	require.ErrorIs(t, err, repository.ErrTicketsAlreadyEnabled)
	repo.AssertNotCalled(t, "InsertTicketStatus")
	repo.AssertNotCalled(t, "InsertTicketType")
}

// 既定の雛形: To Do(todo・初期状態) / 開発 / レビュー中 / リリース検証(in_progress) /
// リリース(done) の 5 状態と、設計 / 開発タスク(既定) / バグ の 3 種別（画面の見本と同じ並び）。
// 有効化後はいつでも管理画面で足せる・変えられるので、ここでの選択は初期値でしかない。
func Test_チケット有効化_既定の雛形を作る(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("HasActiveInitialTicketStatus", mock.Anything, tkWS, tkProject).Return(false, nil)

	var insertedStatuses []*domain.TicketStatus
	repo.On("InsertTicketStatus", mock.Anything, mock.AnythingOfType("*domain.TicketStatus")).
		Run(func(args mock.Arguments) {
			s := args.Get(1).(*domain.TicketStatus)
			cp := *s
			insertedStatuses = append(insertedStatuses, &cp)
		}).Return(nil)

	var insertedTypes []*domain.TicketType
	repo.On("InsertTicketType", mock.Anything, mock.AnythingOfType("*domain.TicketType")).
		Run(func(args mock.Arguments) {
			ty := args.Get(1).(*domain.TicketType)
			cp := *ty
			insertedTypes = append(insertedTypes, &cp)
		}).Return(nil)

	err := func() error {
		_, err := ticket.NewEnableTicketsForProjectUseCase(repo, fakeTxManager{}).
			Execute(context.Background(), ticket.EnableTicketsForProjectInput{WorkspaceID: tkWS, ProjectID: tkProject})
		return err
	}()
	require.NoError(t, err)

	require.Len(t, insertedStatuses, 5, "To Do / 開発 / レビュー中 / リリース検証 / リリース")
	byCategory := map[domain.TicketStatusCategory]*domain.TicketStatus{}
	for _, s := range insertedStatuses {
		require.Equal(t, tkWS, s.WorkspaceID)
		require.Equal(t, tkProject, s.ProjectID)
		require.True(t, domain.ValidHexColor(s.Color), "色は正規化済みで保存する: %s", s.Color)
		require.NotEmpty(t, s.Position)
		byCategory[s.Category] = s
	}
	require.Contains(t, byCategory, domain.TicketStatusCategoryTodo)
	require.Contains(t, byCategory, domain.TicketStatusCategoryInProgress)
	require.Contains(t, byCategory, domain.TicketStatusCategoryDone)
	require.True(t, byCategory[domain.TicketStatusCategoryTodo].IsInitial, "初期状態は To Do")
	require.False(t, byCategory[domain.TicketStatusCategoryDone].IsInitial)

	// 初期状態は現役の中で 1 つだけ（部分 UNIQUE が DB 側にもあるが、雛形の時点で守る）。
	initialCount := 0
	for _, s := range insertedStatuses {
		if s.IsInitial {
			initialCount++
		}
	}
	require.Equal(t, 1, initialCount, "初期状態は 1 つだけ")

	// 位置は重複しない（uq_ticket_statuses_space_position は部分 UNIQUE）。
	seenPos := map[string]bool{}
	for _, s := range insertedStatuses {
		require.False(t, seenPos[s.Position], "位置が重複している: %s", s.Position)
		seenPos[s.Position] = true
	}
	// position は fracindex のバイト順で To Do → 進行中 → 完了 の順に並ぶこと。
	require.Less(t,
		byCategory[domain.TicketStatusCategoryTodo].Position,
		byCategory[domain.TicketStatusCategoryInProgress].Position)
	require.Less(t,
		byCategory[domain.TicketStatusCategoryInProgress].Position,
		byCategory[domain.TicketStatusCategoryDone].Position)

	require.Len(t, insertedTypes, 3, "設計 / 開発タスク / バグ")
	defaultCount := 0
	seenTypePos := map[string]bool{}
	for _, ty := range insertedTypes {
		require.Equal(t, tkWS, ty.WorkspaceID)
		require.Equal(t, tkProject, ty.ProjectID)
		require.True(t, domain.ValidHexColor(ty.Color), "色は正規化済みで保存する: %s", ty.Color)
		require.NotEmpty(t, ty.Position)
		require.False(t, seenTypePos[ty.Position], "位置が重複している: %s", ty.Position)
		seenTypePos[ty.Position] = true
		// 階層レベルは -1..1 の範囲（ck_ticket_types_hierarchy_level）。
		require.GreaterOrEqual(t, ty.HierarchyLevel, -1)
		require.LessOrEqual(t, ty.HierarchyLevel, 1)
		if ty.IsDefault {
			defaultCount++
			require.Equal(t, 0, ty.HierarchyLevel, "既定の種別は標準（0）にする")
		}
	}
	require.Equal(t, 1, defaultCount, "既定の種別は 1 つだけ")
}

// sourceProjectId を指定すると、そのプロジェクトの現役の状態・種別をそのまま複製する
// （別プロジェクトの構成を複製できる）。
// handler/呼び出し側が別途確かめる前提（このユースケースは複製そのものだけを担う）。
func Test_チケット有効化_複製元を指定すると現役の構成を複製する(t *testing.T) {
	sourceSpace := "01a00000-0000-7000-8000-000000000099"
	repo := &mockTicketRepo{}
	repo.On("HasActiveInitialTicketStatus", mock.Anything, tkWS, tkProject).Return(false, nil)
	repo.On("ListTicketStatuses", mock.Anything, tkWS, sourceSpace, false).Return([]domain.TicketStatus{
		{Name: "未対応", Category: domain.TicketStatusCategoryTodo, Color: "#5b6b7a", Position: "a0", IsInitial: true},
		{Name: "対応中", Category: domain.TicketStatusCategoryInProgress, Color: "#a0661a", Position: "a1"},
		{Name: "対応済み", Category: domain.TicketStatusCategoryDone, Color: "#2f6b47", Position: "a2"},
		{Name: "却下", Category: domain.TicketStatusCategoryDone, Color: "#9a3b2e", Position: "a3"},
	}, nil)
	repo.On("ListTicketTypes", mock.Anything, tkWS, sourceSpace, false).Return([]domain.TicketType{
		{Name: "バグ", HierarchyLevel: 0, Color: "#9a3b2e", Position: "a0", IsDefault: true},
		{Name: "要望", HierarchyLevel: 0, Color: "#2f4858", Position: "a1"},
	}, nil)

	var insertedStatuses []*domain.TicketStatus
	repo.On("InsertTicketStatus", mock.Anything, mock.AnythingOfType("*domain.TicketStatus")).
		Run(func(args mock.Arguments) {
			s := args.Get(1).(*domain.TicketStatus)
			cp := *s
			insertedStatuses = append(insertedStatuses, &cp)
		}).Return(nil)
	var insertedTypes []*domain.TicketType
	repo.On("InsertTicketType", mock.Anything, mock.AnythingOfType("*domain.TicketType")).
		Run(func(args mock.Arguments) {
			ty := args.Get(1).(*domain.TicketType)
			cp := *ty
			insertedTypes = append(insertedTypes, &cp)
		}).Return(nil)

	_, err := ticket.NewEnableTicketsForProjectUseCase(repo, fakeTxManager{}).
		Execute(context.Background(), ticket.EnableTicketsForProjectInput{
			WorkspaceID: tkWS, ProjectID: tkProject, SourceProjectID: &sourceSpace,
		})
	require.NoError(t, err)

	require.Len(t, insertedStatuses, 4)
	require.Len(t, insertedTypes, 2)
	names := map[string]bool{}
	for _, s := range insertedStatuses {
		names[s.Name] = true
		require.Equal(t, tkProject, s.ProjectID, "複製先のプロジェクトに作る（複製元ではない）")
	}
	require.True(t, names["却下"], "複製元の状態名をそのまま使う")
}
