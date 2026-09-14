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

// TestTicketStatusTransitionRepository_Integration は InsertTicketStatusTransition
// （段 3・設計 Ⅵ）を実 Postgres で検証する。
func TestTicketStatusTransitionRepository_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	testsupport.TruncateAll(t, sqlDB, kbTables...)
	repo := persistence.NewTicketRepository(sqlDB)
	ctx := context.Background()

	ws := createWorkspace(t, sqlDB, "tk-transitions")
	project := createProject(t, sqlDB, ws, "eng")
	statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, project)
	doneStatus := &domain.TicketStatus{WorkspaceID: ws, ProjectID: project, Name: "完了", Category: domain.TicketStatusCategoryDone, Color: "#2f6b47", Position: "a1"}
	require.NoError(t, repo.InsertTicketStatus(ctx, doneStatus))
	created, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
		WorkspaceID: ws, ProjectID: project, TypeID: typeID, StatusID: statusID,
		Title: "x", Doc: []byte(`{"type":"doc","content":[]}`), Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
	})
	require.NoError(t, err)

	require.NoError(t, repo.InsertTicketStatusTransition(ctx, ws, project, created.ID, statusID, doneStatus.ID, 1))

	var count int
	require.NoError(t, sqlDB.QueryRow(
		`SELECT count(*) FROM ticket_status_transitions WHERE workspace_id = $1 AND ticket_id = $2 AND from_status_id = $3 AND to_status_id = $4`,
		ws, created.ID, statusID, doneStatus.ID,
	).Scan(&count))
	assert.Equal(t, 1, count)

	// 同じ状態への遷移（from == to）は CHECK で拒否される。
	err = repo.InsertTicketStatusTransition(ctx, ws, project, created.ID, statusID, statusID, 1)
	requirePgError(t, err, sqlStateCheckViolation, "ck_ticket_status_transitions_distinct")
}

// TestTicketCommentRepository_Integration は ticketCommentRepository（段 3: 発言・編集履歴・
// 反応）を実 Postgres で検証する。
func TestTicketCommentRepository_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	repo := persistence.NewTicketCommentRepository(sqlDB)
	tickets := persistence.NewTicketRepository(sqlDB)
	ctx := context.Background()

	setup := func(t *testing.T) (ws, ticketID string) {
		t.Helper()
		testsupport.TruncateAll(t, sqlDB, kbTables...)
		ws = createWorkspace(t, sqlDB, "tk-comments")
		project := createProject(t, sqlDB, ws, "eng")
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, tickets, ws, project)
		created, err := tickets.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, ProjectID: project, TypeID: typeID, StatusID: statusID,
			Title: "x", Doc: []byte(`{"type":"doc","content":[]}`), Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		return ws, created.ID
	}

	t.Run("作成_取得_一覧_削除済みは一覧に出ない", func(t *testing.T) {
		ws, ticketID := setup(t)
		c := &domain.TicketComment{WorkspaceID: ws, TicketID: ticketID, AuthorUserID: 1, Body: `[{"type":"text","text":"最初の発言"}]`}
		require.NoError(t, repo.CreateTicketComment(ctx, c))
		require.NotEmpty(t, c.ID)

		got, err := repo.FindTicketComment(ctx, ws, ticketID, c.ID)
		require.NoError(t, err)
		assert.Equal(t, c.Body, got.Body)
		assert.Nil(t, got.DeletedAt)

		list, err := repo.ListTicketComments(ctx, ws, ticketID)
		require.NoError(t, err)
		require.Len(t, list, 1)

		require.NoError(t, repo.DeleteTicketComment(ctx, ws, ticketID, c.ID))
		_, err = repo.FindTicketComment(ctx, ws, ticketID, c.ID)
		require.ErrorIs(t, err, repository.ErrTicketCommentNotFound, "削除済みは現役取得から見えない")
		list, err = repo.ListTicketComments(ctx, ws, ticketID)
		require.NoError(t, err)
		assert.Empty(t, list, "削除済みは一覧に出ない")

		// 二重削除は 0 行。
		require.ErrorIs(t, repo.DeleteTicketComment(ctx, ws, ticketID, c.ID), repository.ErrTicketCommentNotFound)
	})

	t.Run("返信は自己参照FKで親発言に紐づく", func(t *testing.T) {
		ws, ticketID := setup(t)
		root := &domain.TicketComment{WorkspaceID: ws, TicketID: ticketID, AuthorUserID: 1, Body: `[{"type":"text","text":"親"}]`}
		require.NoError(t, repo.CreateTicketComment(ctx, root))
		reply := &domain.TicketComment{WorkspaceID: ws, TicketID: ticketID, ParentCommentID: &root.ID, AuthorUserID: 2, Body: `[{"type":"text","text":"返信"}]`}
		require.NoError(t, repo.CreateTicketComment(ctx, reply))

		got, err := repo.FindTicketComment(ctx, ws, ticketID, reply.ID)
		require.NoError(t, err)
		require.NotNil(t, got.ParentCommentID)
		assert.Equal(t, root.ID, *got.ParentCommentID)
	})

	t.Run("編集で本文を書き換え編集履歴が積まれる", func(t *testing.T) {
		ws, ticketID := setup(t)
		c := &domain.TicketComment{WorkspaceID: ws, TicketID: ticketID, AuthorUserID: 1, Body: `[{"type":"text","text":"旧"}]`}
		require.NoError(t, repo.CreateTicketComment(ctx, c))
		require.Nil(t, c.EditedAt)

		require.NoError(t, repo.InsertTicketCommentEdit(ctx, &domain.TicketCommentEdit{
			WorkspaceID: ws, CommentID: c.ID, EditorUserID: 1, PreviousBody: c.Body,
		}))
		updated, err := repo.UpdateTicketCommentBody(ctx, ws, ticketID, c.ID, `[{"type":"text","text":"新"}]`)
		require.NoError(t, err)
		require.NotNil(t, updated.EditedAt, "編集後は edited_at が立つ")
		assert.JSONEq(t, `[{"type":"text","text":"新"}]`, updated.Body)

		edits, err := repo.ListTicketCommentEdits(ctx, ws, c.ID)
		require.NoError(t, err)
		require.Len(t, edits, 1)
		assert.Equal(t, uint64(1), edits[0].EditorUserID)
	})

	t.Run("反応の付け外しは冪等で複合主キーが重複を吸収する", func(t *testing.T) {
		ws, ticketID := setup(t)
		c := &domain.TicketComment{WorkspaceID: ws, TicketID: ticketID, AuthorUserID: 1, Body: `[{"type":"text","text":"x"}]`}
		require.NoError(t, repo.CreateTicketComment(ctx, c))

		require.NoError(t, repo.AddTicketCommentReaction(ctx, ws, c.ID, 2, "👍"))
		require.NoError(t, repo.AddTicketCommentReaction(ctx, ws, c.ID, 2, "👍"), "同じ反応の二重追加はエラーにならない")

		reactions, err := repo.ListTicketCommentReactions(ctx, ws, []string{c.ID})
		require.NoError(t, err)
		require.Len(t, reactions, 1, "複合主キーが重複を1件に吸収する")

		require.NoError(t, repo.RemoveTicketCommentReaction(ctx, ws, c.ID, 2, "👍"))
		require.NoError(t, repo.RemoveTicketCommentReaction(ctx, ws, c.ID, 2, "👍"), "付いていない反応を外そうとしてもエラーにならない")
		reactions, err = repo.ListTicketCommentReactions(ctx, ws, []string{c.ID})
		require.NoError(t, err)
		assert.Empty(t, reactions)
	})

	t.Run("本文はjsonb配列でなければならない", func(t *testing.T) {
		ws, ticketID := setup(t)
		_, err := sqlDB.Exec(
			`INSERT INTO ticket_comments (id, workspace_id, ticket_id, author_user_id, body) VALUES ($1, $2, $3, 1, '{}'::jsonb)`,
			newID(), ws, ticketID,
		)
		requirePgError(t, err, sqlStateCheckViolation, "ck_ticket_comments_body_array")
	})
}
