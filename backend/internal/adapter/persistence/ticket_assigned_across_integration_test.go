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

// TestTicketRepository_ListAssignedTicketsAcrossWorkspaces_Integration はホームの「自分の担当」の
// SQL を実 PostgreSQL で固定する。ワークスペースごとに違う自分の principal の解き方、完了と
// アーカイブの除外、期限の近い順（期限なしは最後）と同順の決め方、上限は生 SQL でしか確かめられない。
func TestTicketRepository_ListAssignedTicketsAcrossWorkspaces_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	repo := persistence.NewTicketRepository(sqlDB)
	perm := persistence.NewKnowledgeBasePermissionRepository(sqlDB)
	ctx := context.Background()

	type fixture struct {
		wsA, wsB, wsC string
		bob, carol    uint64
		// ids は題名 → チケット ID。
		ids map[string]string
	}

	setup := func(t *testing.T) fixture {
		t.Helper()
		testsupport.TruncateAll(t, sqlDB, kbTables...)
		f := fixture{
			wsA: createWorkspace(t, sqlDB, "across-a"),
			wsB: createWorkspace(t, sqlDB, "across-b"),
			// wsC は bob が所属しているが、呼び出し側が範囲に入れない（見てよいと判定されなかった）。
			wsC: createWorkspace(t, sqlDB, "across-c"),
			ids: map[string]string{},
		}
		f.bob = createUser(t, sqlDB, "bob-across")
		f.carol = createUser(t, sqlDB, "carol-across")

		type place struct {
			ws, project, todo, done, typeID string
			bob, carol                      string
		}
		places := map[string]*place{}
		for name, ws := range map[string]string{"A": f.wsA, "B": f.wsB, "C": f.wsC} {
			project := createProject(t, sqlDB, ws, "P"+name)
			todo, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, project)
			done := &domain.TicketStatus{
				WorkspaceID: ws, ProjectID: project, Name: "完了",
				Category: domain.TicketStatusCategoryDone, Color: "#2f6b47", Position: "a1",
			}
			require.NoError(t, repo.InsertTicketStatus(ctx, done))
			bob, err := perm.EnsureUserPrincipal(ctx, ws, f.bob)
			require.NoError(t, err)
			carol, err := perm.EnsureUserPrincipal(ctx, ws, f.carol)
			require.NoError(t, err)
			places[name] = &place{ws: ws, project: project, todo: todo, done: done.ID, typeID: typeID, bob: bob.ID, carol: carol.ID}
		}

		// 作る順が作成時刻の順になる（期限が同じ行の並びを作成の古い順で決めることを見る）。
		for _, seed := range []struct {
			place, title string
			due          *string
			done         bool
			assignee     string // "bob" / "carol"
		}{
			{"A", "A 期限 10/5", strPtr("2026-10-05"), false, "bob"},
			{"B", "B 期限 9/28", strPtr("2026-09-28"), false, "bob"},
			{"A", "A 期限なし", nil, false, "bob"},
			{"B", "B 期限 10/5（A より後に作成）", strPtr("2026-10-05"), false, "bob"},
			{"A", "A 完了済み", strPtr("2026-09-01"), true, "bob"},
			{"A", "A アーカイブ済み", strPtr("2026-09-02"), false, "bob"},
			{"A", "A 他人の担当", strPtr("2026-09-03"), false, "carol"},
			{"C", "C 範囲外のワークスペース", strPtr("2026-09-04"), false, "bob"},
		} {
			p := places[seed.place]
			status := p.todo
			if seed.done {
				status = p.done
			}
			created, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
				WorkspaceID: p.ws, ProjectID: p.project, TypeID: p.typeID, StatusID: status,
				Title: seed.title, Doc: []byte(`{"type":"doc","content":[]}`),
				Priority: domain.TicketPriorityDefault, DueDate: seed.due, CreatedByUserID: f.bob,
			})
			require.NoError(t, err)
			assignee := p.bob
			if seed.assignee == "carol" {
				assignee = p.carol
			}
			require.NoError(t, repo.UpsertTicketAssignment(ctx, &domain.TicketAssignment{
				WorkspaceID: p.ws, TicketID: created.ID, AssigneePrincipalID: assignee, AssignedByUserID: f.bob,
			}))
			f.ids[seed.title] = created.ID
		}
		require.NoError(t, repo.ArchiveTicket(ctx, f.wsA, f.ids["A アーカイブ済み"]))
		return f
	}

	titles := func(rows []domain.AssignedTicketSummary) []string {
		out := make([]string, 0, len(rows))
		for _, r := range rows {
			out = append(out, r.Title)
		}
		return out
	}

	// 変異確認: SQL から `s.category <> 'done'` を外すと「A 完了済み」が先頭に来て落ちる。
	// ORDER BY の `NULLS LAST` を外すと「A 期限なし」が先頭に来て落ちる。
	t.Run("範囲のワークスペースを横断し未完了を期限の近い順に返す", func(t *testing.T) {
		f := setup(t)

		rows, err := repo.ListAssignedTicketsAcrossWorkspaces(ctx, f.bob, []string{f.wsA, f.wsB}, 20)
		require.NoError(t, err)

		assert.Equal(t, []string{
			"B 期限 9/28",
			"A 期限 10/5",
			"B 期限 10/5（A より後に作成）",
			"A 期限なし",
		}, titles(rows), "完了・アーカイブ・他人の担当・範囲外のワークスペースは出ない。期限が同じなら作成の古い順、期限なしは最後")

		first := rows[0]
		assert.Equal(t, f.ids["B 期限 9/28"], first.ID)
		assert.Equal(t, "across-b", first.WorkspaceSlug)
		assert.Equal(t, "across-b", first.WorkspaceName)
		assert.Equal(t, "PB", first.ProjectKey)
		assert.Equal(t, "To Do", first.StatusName)
		assert.Equal(t, domain.TicketStatusCategoryTodo, first.StatusCategory)
		assert.Equal(t, "タスク", first.TypeName)
		assert.Positive(t, first.Number)
		require.NotNil(t, first.DueDate)
		assert.Equal(t, "2026-09-28", *first.DueDate)
		assert.Nil(t, rows[3].DueDate, "期限なしは nil")
	})

	// 変異確認: SQL から `LIMIT` を外すと件数が 4 になって落ちる。
	t.Run("上限で切る", func(t *testing.T) {
		f := setup(t)

		rows, err := repo.ListAssignedTicketsAcrossWorkspaces(ctx, f.bob, []string{f.wsA, f.wsB}, 2)
		require.NoError(t, err)
		assert.Equal(t, []string{"B 期限 9/28", "A 期限 10/5"}, titles(rows))
	})

	t.Run("他人から見れば自分の担当だけ", func(t *testing.T) {
		f := setup(t)

		rows, err := repo.ListAssignedTicketsAcrossWorkspaces(ctx, f.carol, []string{f.wsA, f.wsB, f.wsC}, 20)
		require.NoError(t, err)
		assert.Equal(t, []string{"A 他人の担当"}, titles(rows))
	})

	t.Run("範囲が空か解釈できないIDだけなら0件で失敗にしない", func(t *testing.T) {
		f := setup(t)

		for _, ids := range [][]string{nil, {}, {"not-a-uuid"}} {
			rows, err := repo.ListAssignedTicketsAcrossWorkspaces(ctx, f.bob, ids, 20)
			require.NoError(t, err)
			assert.NotNil(t, rows)
			assert.Empty(t, rows)
		}
		// 解釈できない ID が混ざっても、ほかの範囲はそのまま効く。
		rows, err := repo.ListAssignedTicketsAcrossWorkspaces(ctx, f.bob, []string{"not-a-uuid", f.wsB}, 20)
		require.NoError(t, err)
		assert.Equal(t, []string{"B 期限 9/28", "B 期限 10/5（A より後に作成）"}, titles(rows))
	})
}
