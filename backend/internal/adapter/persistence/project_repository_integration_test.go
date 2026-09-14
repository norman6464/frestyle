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

// TestProjectRepository_Integration は projects（バックログの入れ物）の SQL を実 Postgres で固定する。
//
// projects は workspaces だけを参照する（spaces への FK は持たない）。その独立を
// 「ナレッジのスペースを消してもプロジェクトは残る」という形でここで確かめる。
func TestProjectRepository_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	repo := persistence.NewProjectRepository(sqlDB)
	ctx := context.Background()

	t.Run("作成_一覧_取得_改名", func(t *testing.T) {
		testsupport.TruncateAll(t, sqlDB, "projects", "workspaces")
		ws := createWorkspace(t, sqlDB, "pj-main")

		p := &domain.Project{WorkspaceID: ws, Key: "frestyle", Name: "FreStyle 開発"}
		require.NoError(t, repo.CreateProject(ctx, p))
		require.NotEmpty(t, p.ID)
		assert.Equal(t, "frestyle", p.Key)

		list, err := repo.ListProjects(ctx, ws)
		require.NoError(t, err)
		require.Len(t, list, 1)
		assert.Equal(t, p.ID, list[0].ID)

		got, err := repo.FindProject(ctx, ws, p.ID)
		require.NoError(t, err)
		assert.Equal(t, "FreStyle 開発", got.Name)

		// 表示キーの解決は大文字小文字を問わない（FRESTYLE-12 の FRESTYLE から引く）。
		byKey, err := repo.FindProjectByKey(ctx, ws, "FRESTYLE")
		require.NoError(t, err)
		assert.Equal(t, p.ID, byKey.ID)

		require.NoError(t, repo.RenameProject(ctx, ws, p.ID, "FreStyle 本体"))
		renamed, err := repo.FindProject(ctx, ws, p.ID)
		require.NoError(t, err)
		assert.Equal(t, "FreStyle 本体", renamed.Name)
		assert.Equal(t, "frestyle", renamed.Key, "改名で key は変わらない")
	})

	t.Run("keyはワークスペース内で一意", func(t *testing.T) {
		testsupport.TruncateAll(t, sqlDB, "projects", "workspaces")
		ws := createWorkspace(t, sqlDB, "pj-main")
		other := createWorkspace(t, sqlDB, "pj-other")

		require.NoError(t, repo.CreateProject(ctx, &domain.Project{WorkspaceID: ws, Key: "eng", Name: "開発"}))
		err := repo.CreateProject(ctx, &domain.Project{WorkspaceID: ws, Key: "eng", Name: "開発2"})
		require.ErrorIs(t, err, repository.ErrProjectKeyTaken)

		// 別ワークスペースなら同じ key を使える。
		require.NoError(t, repo.CreateProject(ctx, &domain.Project{WorkspaceID: other, Key: "eng", Name: "開発"}))
	})

	t.Run("別ワークスペースのIDは見えない", func(t *testing.T) {
		testsupport.TruncateAll(t, sqlDB, "projects", "workspaces")
		ws := createWorkspace(t, sqlDB, "pj-main")
		other := createWorkspace(t, sqlDB, "pj-other")
		p := &domain.Project{WorkspaceID: ws, Key: "eng", Name: "開発"}
		require.NoError(t, repo.CreateProject(ctx, p))

		_, err := repo.FindProject(ctx, other, p.ID)
		require.ErrorIs(t, err, repository.ErrProjectNotFound)
		require.ErrorIs(t, repo.RenameProject(ctx, other, p.ID, "乗っ取り"), repository.ErrProjectNotFound)

		list, err := repo.ListProjects(ctx, other)
		require.NoError(t, err)
		assert.Empty(t, list)
	})

	// バックログがナレッジから独立していることの要。スペースを消してもプロジェクトは残る
	// （projects が spaces を参照していたら、この削除で道連れになる）。
	t.Run("ナレッジのスペースを消してもプロジェクトは残る", func(t *testing.T) {
		testsupport.TruncateAll(t, sqlDB, "projects", "spaces", "workspaces")
		ws := createWorkspace(t, sqlDB, "pj-main")
		space := createSpace(t, sqlDB, ws, "kb")
		p := &domain.Project{WorkspaceID: ws, Key: "eng", Name: "開発"}
		require.NoError(t, repo.CreateProject(ctx, p))

		_, err := sqlDB.Exec(`DELETE FROM spaces WHERE id = $1`, space)
		require.NoError(t, err)

		got, err := repo.FindProject(ctx, ws, p.ID)
		require.NoError(t, err)
		assert.Equal(t, p.ID, got.ID)
	})

	t.Run("ワークスペースを消すと配下のプロジェクトも消える", func(t *testing.T) {
		testsupport.TruncateAll(t, sqlDB, "projects", "workspaces")
		ws := createWorkspace(t, sqlDB, "pj-main")
		p := &domain.Project{WorkspaceID: ws, Key: "eng", Name: "開発"}
		require.NoError(t, repo.CreateProject(ctx, p))

		_, err := sqlDB.Exec(`DELETE FROM workspaces WHERE id = $1`, ws)
		require.NoError(t, err)

		var count int
		require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM projects WHERE id = $1`, p.ID).Scan(&count))
		assert.Equal(t, 0, count)
	})
}
