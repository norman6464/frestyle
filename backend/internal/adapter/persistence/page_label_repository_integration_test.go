//go:build integration

package persistence_test

import (
	"context"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestLabelRepository_ページ版_Integration は labelRepository のページ版メソッド
// （AddPageLabel/RemovePageLabel/ListLabelsByPage/ListLabelsByPageIDs）を実 Postgres で
// 検証する。CRUD（Create/Find/List/Update/Delete）は labels 表そのものを共有しており、
// TestLabelRepository_Integration が既に検証済みなのでここでは触らない。
func TestLabelRepository_ページ版_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	repo := persistence.NewLabelRepository(sqlDB)
	ctx := context.Background()

	setup := func(t *testing.T) (ws, space, pageID string) {
		t.Helper()
		testsupport.TruncateAll(t, sqlDB, kbTables...)
		ws = createWorkspace(t, sqlDB, "pg-labels")
		space = createSpace(t, sqlDB, ws, "eng")
		page := mustCreatePage(context.Background(), t, newKbUseCases(sqlDB), ws, space, nil, "対象ページ")
		return ws, space, page.ID
	}

	t.Run("付け外しは冪等", func(t *testing.T) {
		ws, _, pageID := setup(t)
		l := &domain.Label{WorkspaceID: ws, Name: "重要", Color: "#4a90d9"}
		require.NoError(t, repo.CreateLabel(ctx, l))

		require.NoError(t, repo.AddPageLabel(ctx, ws, pageID, l.ID))
		require.NoError(t, repo.AddPageLabel(ctx, ws, pageID, l.ID), "同じラベルの二重追加はエラーにならない")
		labels, err := repo.ListLabelsByPage(ctx, ws, pageID)
		require.NoError(t, err)
		require.Len(t, labels, 1, "複合主キーが重複を1件に吸収する")

		require.NoError(t, repo.RemovePageLabel(ctx, ws, pageID, l.ID))
		require.NoError(t, repo.RemovePageLabel(ctx, ws, pageID, l.ID), "付いていないラベルを外そうとしてもエラーにならない")
		labels, err = repo.ListLabelsByPage(ctx, ws, pageID)
		require.NoError(t, err)
		assert.Empty(t, labels)
	})

	t.Run("削除でpage_labelsも一緒に消える", func(t *testing.T) {
		ws, _, pageID := setup(t)
		l := &domain.Label{WorkspaceID: ws, Name: "重要", Color: "#4a90d9"}
		require.NoError(t, repo.CreateLabel(ctx, l))
		require.NoError(t, repo.AddPageLabel(ctx, ws, pageID, l.ID))

		require.NoError(t, repo.DeleteLabel(ctx, ws, l.ID))
		labels, err := repo.ListLabelsByPage(ctx, ws, pageID)
		require.NoError(t, err)
		assert.Empty(t, labels, "ON DELETE CASCADE でpage_labelsの行も消える")
	})

	t.Run("ページを削除するとpage_labelsも一緒に消える", func(t *testing.T) {
		ws, _, pageID := setup(t)
		l := &domain.Label{WorkspaceID: ws, Name: "重要", Color: "#4a90d9"}
		require.NoError(t, repo.CreateLabel(ctx, l))
		require.NoError(t, repo.AddPageLabel(ctx, ws, pageID, l.ID))

		pages := persistence.NewKnowledgeBaseRepository(sqlDB)
		require.NoError(t, pages.DeletePageSubtree(ctx, ws, pageID))

		labels, err := repo.ListLabelsByPage(ctx, ws, pageID)
		require.NoError(t, err)
		assert.Empty(t, labels, "ON DELETE CASCADE でpage_labelsの行も消える")
	})

	t.Run("ListLabelsByPageIDsはページごとにまとめて返す", func(t *testing.T) {
		ws, space, pageA := setup(t)
		pageB := mustCreatePage(ctx, t, newKbUseCases(sqlDB), ws, space, nil, "対象ページ2").ID

		l1 := &domain.Label{WorkspaceID: ws, Name: "重要", Color: "#4a90d9"}
		require.NoError(t, repo.CreateLabel(ctx, l1))
		l2 := &domain.Label{WorkspaceID: ws, Name: "レビュー待ち", Color: "#d94a4a"}
		require.NoError(t, repo.CreateLabel(ctx, l2))
		require.NoError(t, repo.AddPageLabel(ctx, ws, pageA, l1.ID))
		require.NoError(t, repo.AddPageLabel(ctx, ws, pageB, l2.ID))

		byPage, err := repo.ListLabelsByPageIDs(ctx, ws, []string{pageA, pageB})
		require.NoError(t, err)
		require.Len(t, byPage[pageA], 1)
		assert.Equal(t, "重要", byPage[pageA][0].Name)
		require.Len(t, byPage[pageB], 1)
		assert.Equal(t, "レビュー待ち", byPage[pageB][0].Name)
	})

	t.Run("空のIDリストはnilを返す", func(t *testing.T) {
		ws, _, _ := setup(t)
		got, err := repo.ListLabelsByPageIDs(ctx, ws, nil)
		require.NoError(t, err)
		assert.Nil(t, got)
	})

	t.Run("存在しないラベルを付けようとするとForeignKeyViolationがErrLabelNotFoundに翻訳される", func(t *testing.T) {
		ws, _, pageID := setup(t)
		err := repo.AddPageLabel(ctx, ws, pageID, "0198a000-0000-7000-8000-0000000000ff")
		require.ErrorIs(t, err, repository.ErrLabelNotFound)
	})
}
