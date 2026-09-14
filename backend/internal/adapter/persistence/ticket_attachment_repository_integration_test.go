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

// TestTicketAttachmentRepository_Integration は ticketAttachmentRepository（段 4: 添付の
// メタデータ）を実 Postgres で検証する。
func TestTicketAttachmentRepository_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	repo := persistence.NewTicketAttachmentRepository(sqlDB)
	tickets := persistence.NewTicketRepository(sqlDB)
	ctx := context.Background()

	setup := func(t *testing.T) (ws, ticketID string) {
		t.Helper()
		testsupport.TruncateAll(t, sqlDB, kbTables...)
		ws = createWorkspace(t, sqlDB, "tk-attachments")
		project := createProject(t, sqlDB, ws, "eng")
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, tickets, ws, project)
		created, err := tickets.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, ProjectID: project, TypeID: typeID, StatusID: statusID,
			Title: "x", Doc: []byte(`{"type":"doc","content":[]}`), Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		return ws, created.ID
	}

	t.Run("作成_取得_一覧_削除", func(t *testing.T) {
		ws, ticketID := setup(t)
		a := &domain.TicketAttachment{
			WorkspaceID: ws, TicketID: ticketID, Key: "tickets/" + ws + "/" + ticketID + "/1.bin",
			Filename: "資料.pdf", ContentType: "application/pdf", SizeBytes: 1024, UploadedByUserID: 1,
		}
		require.NoError(t, repo.CreateTicketAttachment(ctx, a))
		require.NotEmpty(t, a.ID)

		got, err := repo.FindTicketAttachment(ctx, ws, ticketID, a.ID)
		require.NoError(t, err)
		assert.Equal(t, "資料.pdf", got.Filename)
		assert.Equal(t, int64(1024), got.SizeBytes)

		list, err := repo.ListTicketAttachments(ctx, ws, ticketID)
		require.NoError(t, err)
		require.Len(t, list, 1)

		require.NoError(t, repo.DeleteTicketAttachment(ctx, ws, ticketID, a.ID))
		_, err = repo.FindTicketAttachment(ctx, ws, ticketID, a.ID)
		require.ErrorIs(t, err, repository.ErrTicketAttachmentNotFound)
		require.ErrorIs(t, repo.DeleteTicketAttachment(ctx, ws, ticketID, a.ID), repository.ErrTicketAttachmentNotFound, "二重削除は404相当")
	})

	t.Run("別テナントの添付は取得できない", func(t *testing.T) {
		ws, ticketID := setup(t)
		// setup はテーブル全体を TRUNCATE するので、2 回目の呼び出しはここで作った ws/ticketID
		// ごと消してしまう。別テナント役は truncate を経由しない createWorkspace だけで足りる
		// （FindTicketAttachment は workspace_id の一致だけを見るので、その先の実在は不要）。
		otherWs := createWorkspace(t, sqlDB, "tk-attachments-other")
		a := &domain.TicketAttachment{
			WorkspaceID: ws, TicketID: ticketID, Key: "tickets/" + ws + "/" + ticketID + "/1.bin",
			Filename: "資料.pdf", ContentType: "application/pdf", SizeBytes: 1024, UploadedByUserID: 1,
		}
		require.NoError(t, repo.CreateTicketAttachment(ctx, a))

		_, err := repo.FindTicketAttachment(ctx, otherWs, ticketID, a.ID)
		require.ErrorIs(t, err, repository.ErrTicketAttachmentNotFound, "別ワークプロジェクトからは見えない")
	})

	t.Run("サイズは正でなければならない", func(t *testing.T) {
		ws, ticketID := setup(t)
		_, err := sqlDB.Exec(
			`INSERT INTO ticket_attachments (id, workspace_id, ticket_id, key, filename, content_type, size_bytes, uploaded_by_user_id)
			 VALUES ($1, $2, $3, 'k', 'f', 'application/pdf', 0, 1)`,
			newID(), ws, ticketID,
		)
		requirePgError(t, err, sqlStateCheckViolation, "ck_ticket_attachments_size_positive")
	})

	t.Run("ファイル名_ContentTypeは空文字にできない", func(t *testing.T) {
		ws, ticketID := setup(t)
		_, err := sqlDB.Exec(
			`INSERT INTO ticket_attachments (id, workspace_id, ticket_id, key, filename, content_type, size_bytes, uploaded_by_user_id)
			 VALUES ($1, $2, $3, 'k', '', 'application/pdf', 1024, 1)`,
			newID(), ws, ticketID,
		)
		requirePgError(t, err, sqlStateCheckViolation, "ck_ticket_attachments_filename_not_empty")

		_, err = sqlDB.Exec(
			`INSERT INTO ticket_attachments (id, workspace_id, ticket_id, key, filename, content_type, size_bytes, uploaded_by_user_id)
			 VALUES ($1, $2, $3, 'k', 'f', '', 1024, 1)`,
			newID(), ws, ticketID,
		)
		requirePgError(t, err, sqlStateCheckViolation, "ck_ticket_attachments_content_type_not_empty")
	})
}
