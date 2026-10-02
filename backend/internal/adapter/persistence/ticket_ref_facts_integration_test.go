//go:build integration

package persistence_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// TestTicketRefFacts_Integration はページ本文のチケット参照を解決するための読み取り口を
// 実 Postgres で確かめる。表示キーの材料（プロジェクトの key・連番）と状態（名前・枠）が
// 1 回の問い合わせで返り、削除済み・他ワークスペースの ID は返らないこと。
func TestTicketRefFacts_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	repo := persistence.NewTicketRepository(sqlDB)
	reader := persistence.NewTicketRefReader(sqlDB)
	ctx := context.Background()

	testsupport.TruncateAll(t, sqlDB, kbTables...)
	ws := createWorkspace(t, sqlDB, "tk-ref")
	project := createProject(t, sqlDB, ws, "eng")
	status := &domain.TicketStatus{WorkspaceID: ws, ProjectID: project, Name: "進行中", Category: domain.TicketStatusCategoryInProgress, Color: "#5b6b7a", Position: "a0", IsInitial: true}
	require.NoError(t, repo.InsertTicketStatus(ctx, status))
	typ := &domain.TicketType{WorkspaceID: ws, ProjectID: project, Name: "タスク", Color: "#2f6b47", Position: "a0", IsDefault: true}
	require.NoError(t, repo.InsertTicketType(ctx, typ))
	mk := func(title string) *domain.Ticket {
		created, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, ProjectID: project, TypeID: typ.ID, StatusID: status.ID,
			Title: title, Doc: []byte(`{"type":"doc","content":[]}`), Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		return created
	}
	alive := mk("ログインが落ちる")
	deleted := mk("消したチケット")
	require.NoError(t, repo.DeleteTicket(ctx, ws, deleted.ID))

	otherWS := createWorkspace(t, sqlDB, "tk-ref-other")
	otherProject := createProject(t, sqlDB, otherWS, "ops")
	otherStatus := &domain.TicketStatus{WorkspaceID: otherWS, ProjectID: otherProject, Name: "To Do", Category: domain.TicketStatusCategoryTodo, Color: "#5b6b7a", Position: "a0", IsInitial: true}
	require.NoError(t, repo.InsertTicketStatus(ctx, otherStatus))
	otherType := &domain.TicketType{WorkspaceID: otherWS, ProjectID: otherProject, Name: "タスク", Color: "#2f6b47", Position: "a0", IsDefault: true}
	require.NoError(t, repo.InsertTicketType(ctx, otherType))
	foreign, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
		WorkspaceID: otherWS, ProjectID: otherProject, TypeID: otherType.ID, StatusID: otherStatus.ID,
		Title: "よそのチケット", Doc: []byte(`{"type":"doc","content":[]}`), Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
	})
	require.NoError(t, err)

	t.Run("現役のチケットは鍵の材料と状態つきで返り、削除済みとよそのワークスペースは返らない", func(t *testing.T) {
		facts, err := reader.ListTicketRefFactsByIDs(ctx, ws, []string{alive.ID, deleted.ID, foreign.ID, "not-a-uuid"})
		require.NoError(t, err)
		require.Len(t, facts, 1)
		assert.Equal(t, alive.ID, facts[0].ID)
		assert.Equal(t, "eng", facts[0].ProjectKey)
		assert.EqualValues(t, alive.Number, facts[0].Number)
		assert.Equal(t, "ログインが落ちる", facts[0].Title)
		assert.Equal(t, "進行中", facts[0].StatusName)
		assert.Equal(t, domain.TicketStatusCategoryInProgress, facts[0].StatusCategory)
	})

	t.Run("アーカイブ済みも返す（削除とは違い、参照先として開ける）", func(t *testing.T) {
		require.NoError(t, repo.ArchiveTicket(ctx, ws, alive.ID))
		facts, err := reader.ListTicketRefFactsByIDs(ctx, ws, []string{alive.ID})
		require.NoError(t, err)
		require.Len(t, facts, 1)
		assert.Equal(t, "ログインが落ちる", facts[0].Title)
	})

	t.Run("ID が 1 つも無ければ問い合わせずに空", func(t *testing.T) {
		facts, err := reader.ListTicketRefFactsByIDs(ctx, ws, nil)
		require.NoError(t, err)
		assert.Empty(t, facts)
	})
}
