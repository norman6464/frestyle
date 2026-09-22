//go:build integration

package persistence_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPageHierarchyMissingWorkspace_Integration(t *testing.T) {
	db := testsupport.OpenTestDB(t)
	uc := newKbUseCases(db)
	ctx := context.Background()
	missingWorkspace := uuid.NewString()
	space := uuid.NewString()

	t.Run("create returns workspace not found", func(t *testing.T) {
		page := &domain.Page{
			WorkspaceID: missingWorkspace, SpaceID: space,
			Title: "missing workspace", Position: "a0", CreatedByUserID: 1,
		}
		err := uc.repo.CreatePage(ctx, page)
		require.ErrorIs(t, err, repository.ErrWorkspaceNotFound)
		assert.Empty(t, page.ID)
	})

	t.Run("move returns workspace not found", func(t *testing.T) {
		err := uc.repo.MovePage(ctx, missingWorkspace, uuid.NewString(), nil, space, "a0")
		require.ErrorIs(t, err, repository.ErrWorkspaceNotFound)
	})
}

func TestPageDepth_Integration(t *testing.T) {
	db := testsupport.OpenTestDB(t)
	testsupport.TruncateAll(t, db, kbTables...)
	ws := createWorkspace(t, db, "depth-test")
	space := createSpace(t, db, ws, "depth")
	uc := newKbUseCases(db)
	ctx := context.Background()

	chain := make([]*domain.Page, 0, domain.PageMaxDepth)
	var parent *string
	for range domain.PageMaxDepth {
		page := mustCreatePage(ctx, t, uc, ws, space, parent, "chain")
		chain = append(chain, page)
		parent = &page.ID
	}

	t.Run("create rejects level 301 without saving", func(t *testing.T) {
		before := queryPagePaths(t, db, ws)
		page, err := uc.create.Execute(ctx, kb.CreatePageInput{
			WorkspaceID: ws, SpaceID: space, ParentID: parent, Title: "too deep", CreatedByUserID: 1,
		})
		require.ErrorIs(t, err, domain.ErrPageDepthExceeded)
		assert.Nil(t, page)
		assert.Equal(t, before, queryPagePaths(t, db, ws))
		var count int
		require.NoError(t, db.QueryRow("SELECT count(*) FROM pages WHERE workspace_id = $1", ws).Scan(&count))
		assert.Equal(t, domain.PageMaxDepth, count)
	})

	root := mustCreatePage(ctx, t, uc, ws, space, nil, "moving")
	child := mustCreatePage(ctx, t, uc, ws, space, &root.ID, "child")
	for _, archived := range []bool{false, true} {
		name := "move includes active descendants"
		if archived {
			name = "move includes archived descendants"
			require.NoError(t, uc.repo.ArchivePageSubtree(ctx, ws, child.ID))
		}
		t.Run(name, func(t *testing.T) {
			before := queryPagePaths(t, db, ws)
			_, err := uc.move.Execute(ctx, kb.MovePageInput{
				WorkspaceID: ws, PageID: root.ID, NewParentID: &chain[298].ID,
			})
			require.ErrorIs(t, err, domain.ErrPageDepthExceeded)
			assert.Equal(t, before, queryPagePaths(t, db, ws))
			unchanged, err := uc.repo.FindPage(ctx, ws, root.ID)
			require.NoError(t, err)
			assert.Nil(t, unchanged.ParentID)
		})
	}

	t.Run("move subtree exactly to limit and back to root", func(t *testing.T) {
		_, err := uc.move.Execute(ctx, kb.MovePageInput{
			WorkspaceID: ws, PageID: root.ID, NewParentID: &chain[297].ID,
		})
		require.NoError(t, err)
		var depth int
		require.NoError(t, db.QueryRow("SELECT max(depth) FROM page_paths WHERE workspace_id = $1 AND page_id = $2", ws, child.ID).Scan(&depth))
		assert.Equal(t, 299, depth)
		_, err = uc.move.Execute(ctx, kb.MovePageInput{WorkspaceID: ws, PageID: root.ID})
		require.NoError(t, err)
	})

	t.Run("repository also rejects cycles", func(t *testing.T) {
		err := uc.repo.MovePage(ctx, ws, chain[0].ID, &chain[1].ID, space, "a9")
		require.ErrorIs(t, err, domain.ErrPageCycle)
	})

	t.Run("concurrent create and move cannot exceed limit", func(t *testing.T) {
		moving := mustCreatePage(ctx, t, uc, ws, space, nil, "concurrent")
		start := make(chan struct{})
		results := make(chan error, 2)
		go func() {
			<-start
			results <- uc.repo.CreatePage(ctx, &domain.Page{
				WorkspaceID: ws, SpaceID: space, ParentID: &moving.ID,
				Title: "concurrent child", Position: "a0", CreatedByUserID: 1,
			})
		}()
		go func() {
			<-start
			results <- uc.repo.MovePage(ctx, ws, moving.ID, &chain[298].ID, space, "a1")
		}()
		close(start)
		first, second := <-results, <-results
		if first == nil {
			require.ErrorIs(t, second, domain.ErrPageDepthExceeded)
		} else {
			require.ErrorIs(t, first, domain.ErrPageDepthExceeded)
			require.NoError(t, second)
		}
		var maxDepth int
		require.NoError(t, db.QueryRow("SELECT max(depth) FROM page_paths WHERE workspace_id = $1", ws).Scan(&maxDepth))
		assert.LessOrEqual(t, maxDepth, 299)
	})
}
