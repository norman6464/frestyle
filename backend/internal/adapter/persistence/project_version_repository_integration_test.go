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

// TestProjectVersionRepository_Integration は版と、チケットに付ける修正バージョンを
// 実 Postgres で確かめる。
//
// **この設計の肝は「別プロジェクトのものが混ざらない」を DB に守らせたこと**なので、
// 正しく付く経路だけでなく、**別プロジェクトの版を渡したら拒まれる**ことを必ず押す。
// アプリ側の検査に頼ると、経路が増えたときに漏れる。
func TestProjectVersionRepository_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	repo := persistence.NewProjectVersionRepository(sqlDB)
	tickets := persistence.NewTicketRepository(sqlDB)

	setup := func(t *testing.T) (ws, projectA, projectB string) {
		t.Helper()
		testsupport.TruncateAll(t, sqlDB, kbTables...)
		ws = createWorkspace(t, sqlDB, "pv-ws")
		projectA = createProject(t, sqlDB, ws, "pva")
		projectB = createProject(t, sqlDB, ws, "pvb")
		return
	}

	t.Run("版を作って一覧・改名・畳む・戻す", func(t *testing.T) {
		ws, project, _ := setup(t)

		v, err := repo.CreateProjectVersion(ctx, ws, project, "1.0.0", "a0")
		require.NoError(t, err)
		assert.Equal(t, "1.0.0", v.Name)
		assert.Nil(t, v.ReleasedAt, "作った直後はまだ出していない")

		list, err := repo.ListProjectVersions(ctx, ws, project, false)
		require.NoError(t, err)
		require.Len(t, list, 1)

		updated, err := repo.UpdateProjectVersion(ctx, ws, project, v.ID, repository.ProjectVersionUpdate{Name: "1.0.1"})
		require.NoError(t, err)
		assert.Equal(t, "1.0.1", updated.Name)

		require.NoError(t, repo.ArchiveProjectVersion(ctx, ws, project, v.ID))
		live, err := repo.ListProjectVersions(ctx, ws, project, false)
		require.NoError(t, err)
		assert.Empty(t, live, "畳んだ版は現役の一覧に出ない")
		archived, err := repo.ListProjectVersions(ctx, ws, project, true)
		require.NoError(t, err)
		require.Len(t, archived, 1)

		require.NoError(t, repo.RestoreProjectVersion(ctx, ws, project, v.ID, "a1"))
		live, err = repo.ListProjectVersions(ctx, ws, project, false)
		require.NoError(t, err)
		require.Len(t, live, 1)
	})

	// 同名は部分 UNIQUE が拒む。畳んだ版の名前は再利用できる（現役だけを見ているため）。
	t.Run("同じプロジェクトで同名の版は作れない", func(t *testing.T) {
		ws, project, _ := setup(t)
		_, err := repo.CreateProjectVersion(ctx, ws, project, "2.0", "a0")
		require.NoError(t, err)

		_, err = repo.CreateProjectVersion(ctx, ws, project, "2.0", "a1")
		require.ErrorIs(t, err, repository.ErrProjectVersionNameTaken)

		// 大文字小文字の違いも同じ名前として扱う（name_lower の生成列）。
		_, err = repo.CreateProjectVersion(ctx, ws, project, "V1", "a2")
		require.NoError(t, err)
		_, err = repo.CreateProjectVersion(ctx, ws, project, "v1", "a3")
		require.ErrorIs(t, err, repository.ErrProjectVersionNameTaken)
	})

	t.Run("別プロジェクトなら同名の版を作れる", func(t *testing.T) {
		ws, projectA, projectB := setup(t)
		_, err := repo.CreateProjectVersion(ctx, ws, projectA, "1.0", "a0")
		require.NoError(t, err)
		_, err = repo.CreateProjectVersion(ctx, ws, projectB, "1.0", "a0")
		require.NoError(t, err, "版はプロジェクトごとの語彙なので、別プロジェクトでは同名でよい")
	})

	t.Run("チケットに版を付けて外す", func(t *testing.T) {
		ws, project, _ := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, tickets, ws, project)
		created, err := tickets.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, ProjectID: project, TypeID: typeID, StatusID: statusID,
			Title: "直す", Doc: []byte(`{"type":"doc","content":[]}`),
			Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)

		v1, err := repo.CreateProjectVersion(ctx, ws, project, "1.0", "a0")
		require.NoError(t, err)
		v2, err := repo.CreateProjectVersion(ctx, ws, project, "1.1", "a1")
		require.NoError(t, err)

		// 複数付けられる（同じ修正を複数の系統へ入れることがある）。
		require.NoError(t, repo.AddTicketFixVersion(ctx, ws, created.ID, v1.ID))
		require.NoError(t, repo.AddTicketFixVersion(ctx, ws, created.ID, v2.ID))
		got, err := repo.ListTicketFixVersions(ctx, ws, created.ID)
		require.NoError(t, err)
		require.Len(t, got, 2)

		// 二度押しても増えない（冪等）。
		require.NoError(t, repo.AddTicketFixVersion(ctx, ws, created.ID, v1.ID))
		got, err = repo.ListTicketFixVersions(ctx, ws, created.ID)
		require.NoError(t, err)
		require.Len(t, got, 2)

		require.NoError(t, repo.RemoveTicketFixVersion(ctx, ws, created.ID, v1.ID))
		got, err = repo.ListTicketFixVersions(ctx, ws, created.ID)
		require.NoError(t, err)
		require.Len(t, got, 1)
		assert.Equal(t, v2.ID, got[0].ID)
	})

	// ここが本丸。ticket_fix_versions が project_id を持ち、両側の FK に含めていることを
	// 実際に試す。この検査が外れると、別プロジェクトの版が付いた組が作れてしまう。
	t.Run("別プロジェクトの版はチケットに付けられない", func(t *testing.T) {
		ws, projectA, projectB := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, tickets, ws, projectA)
		created, err := tickets.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, ProjectID: projectA, TypeID: typeID, StatusID: statusID,
			Title: "A のチケット", Doc: []byte(`{"type":"doc","content":[]}`),
			Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)

		// 版は B のもの。チケットは A のもの。
		other, err := repo.CreateProjectVersion(ctx, ws, projectB, "B-1.0", "a0")
		require.NoError(t, err)

		err = repo.AddTicketFixVersion(ctx, ws, created.ID, other.ID)
		require.ErrorIs(t, err, repository.ErrProjectVersionNotFound, "複合 FK が拒む")

		got, err := repo.ListTicketFixVersions(ctx, ws, created.ID)
		require.NoError(t, err)
		assert.Empty(t, got, "拒まれたので組は残っていない")
	})
}
