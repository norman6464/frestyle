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

// スプリントの表が守る不変条件を、実 Postgres で固定する。
//
// 「1 件のチケットは同時に 1 つのスプリントにしか入らない」「同じスプリント内で順位が
// 重複しない」「スプリントを消してもチケットは消えない」は、どれも**表の形**で決めている。
// Go 側の条件分岐では守っていないので、生 SQL を通してしか確かめられない。
func TestSprintRepository_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	repo := persistence.NewSprintRepository(sqlDB)
	tickets := persistence.NewTicketRepository(sqlDB)

	setup := func(t *testing.T) (string, string) {
		t.Helper()
		testsupport.TruncateAll(t, sqlDB, kbTables...)
		ws := createWorkspace(t, sqlDB, "sprint-ws")
		project := createProject(t, sqlDB, ws, "spr")
		return ws, project
	}

	newSprint := func(t *testing.T, ws, project, name string) *domain.Sprint {
		t.Helper()
		last, err := repo.LastSprintPosition(ctx, ws, project)
		require.NoError(t, err)
		pos := last + "z"
		s := &domain.Sprint{WorkspaceID: ws, ProjectID: project, Name: name, Position: pos}
		require.NoError(t, repo.CreateSprint(ctx, s))
		return s
	}

	t.Run("作った直後はplannedで期間は未定でよい", func(t *testing.T) {
		ws, project := setup(t)
		s := newSprint(t, ws, project, "スプリント 1")

		assert.Equal(t, domain.SprintStatePlanned, s.State, "作った直後は必ず planned")
		assert.Nil(t, s.StartDate, "計画中は期間が未定でよい")
		assert.Nil(t, s.EndDate)

		got, err := repo.FindSprint(ctx, ws, s.ID)
		require.NoError(t, err)
		assert.Equal(t, s.ID, got.ID)
		assert.Equal(t, "スプリント 1", got.Name)
	})

	t.Run("状態は進む向きにだけ動かせる", func(t *testing.T) {
		ws, project := setup(t)
		s := newSprint(t, ws, project, "スプリント 1")

		started, err := repo.ChangeSprintState(ctx, ws, s.ID, domain.SprintStateActive)
		require.NoError(t, err)
		assert.Equal(t, domain.SprintStateActive, started.State)

		n, err := repo.CountActiveSprints(ctx, ws, project)
		require.NoError(t, err)
		assert.EqualValues(t, 1, n, "進行中の数を数えられる（1 つまでの判定に使う）")

		done, err := repo.ChangeSprintState(ctx, ws, s.ID, domain.SprintStateCompleted)
		require.NoError(t, err)
		assert.Equal(t, domain.SprintStateCompleted, done.State)

		n, err = repo.CountActiveSprints(ctx, ws, project)
		require.NoError(t, err)
		assert.EqualValues(t, 0, n, "完了したら進行中から外れる")
	})

	t.Run("チケットは同時に1つのスプリントにしか入らない", func(t *testing.T) {
		ws, project := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, tickets, ws, project)
		created, err := tickets.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, ProjectID: project, TypeID: typeID, StatusID: statusID,
			Title: "移す仕事", Doc: []byte(`{"type":"doc","content":[]}`), Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)

		s1 := newSprint(t, ws, project, "スプリント 1")
		s2 := newSprint(t, ws, project, "スプリント 2")

		require.NoError(t, repo.AddTicketToSprint(ctx, ws, s1.ID, created.ID, "a0"))
		ids, err := repo.ListSprintTicketIDs(ctx, ws, s1.ID)
		require.NoError(t, err)
		require.Len(t, ids, 1)

		// もう一方へ入れると「移動」になる（表の PK が 1 件 1 スプリントを保証する）。
		require.NoError(t, repo.AddTicketToSprint(ctx, ws, s2.ID, created.ID, "a0"))

		ids, err = repo.ListSprintTicketIDs(ctx, ws, s1.ID)
		require.NoError(t, err)
		assert.Empty(t, ids, "元のスプリントからは外れる")

		ids, err = repo.ListSprintTicketIDs(ctx, ws, s2.ID)
		require.NoError(t, err)
		require.Len(t, ids, 1, "移した先にだけ入っている")
		assert.Equal(t, created.ID, ids[0])
	})

	t.Run("同じスプリントの中で順位は重複しない", func(t *testing.T) {
		ws, project := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, tickets, ws, project)
		mk := func(title string) string {
			created, err := tickets.CreateTicket(ctx, repository.TicketCreateInput{
				WorkspaceID: ws, ProjectID: project, TypeID: typeID, StatusID: statusID,
				Title: title, Doc: []byte(`{"type":"doc","content":[]}`),
				Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
			})
			require.NoError(t, err)
			return created.ID
		}
		a, b := mk("1 件目"), mk("2 件目")
		s := newSprint(t, ws, project, "スプリント 1")

		require.NoError(t, repo.AddTicketToSprint(ctx, ws, s.ID, a, "a0"))
		err := repo.AddTicketToSprint(ctx, ws, s.ID, b, "a0")
		require.Error(t, err, "同じスプリントで順位が重複したら落ちる")
	})

	// スプリント内の並べ替え。バックログの並び（ticket_backlog_ranks）とは別の表なので、
	// 同じチケットが 2 つの順番を同時に持てることも合わせて確かめる。
	t.Run("スプリント内の並べ替えはバックログの並びに触らない", func(t *testing.T) {
		ws, project := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, tickets, ws, project)
		mk := func(title, position string) string {
			created, err := tickets.CreateTicket(ctx, repository.TicketCreateInput{
				WorkspaceID: ws, ProjectID: project, TypeID: typeID, StatusID: statusID,
				Title: title, Doc: []byte(`{"type":"doc","content":[]}`), Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
			})
			require.NoError(t, err)
			require.NoError(t, tickets.InsertTicketRank(ctx, ws, project, created.ID, position))
			return created.ID
		}
		a, b := mk("1 件目", "a0"), mk("2 件目", "a1")
		s := newSprint(t, ws, project, "スプリント 1")
		require.NoError(t, repo.AddTicketToSprint(ctx, ws, s.ID, a, "a0"))
		require.NoError(t, repo.AddTicketToSprint(ctx, ws, s.ID, b, "a1"))

		ranks, err := repo.ListSprintTicketRanks(ctx, ws, s.ID)
		require.NoError(t, err)
		require.Len(t, ranks, 2)
		assert.Equal(t, a, ranks[0].TicketID, "最初は入れた順")

		// b を a の手前へ動かす。
		require.NoError(t, repo.MoveTicketSprintRank(ctx, ws, b, "Zz"))

		ranks, err = repo.ListSprintTicketRanks(ctx, ws, s.ID)
		require.NoError(t, err)
		require.Len(t, ranks, 2)
		assert.Equal(t, b, ranks[0].TicketID, "スプリントの中では入れ替わる")

		// バックログの並びは触っていない（別の表なので影響しない）。
		listed, err := tickets.ListTickets(ctx, repository.ListTicketsInput{WorkspaceID: ws, ProjectID: project})
		require.NoError(t, err)
		require.Len(t, listed, 2)
		assert.Equal(t, a, listed[0].Ticket.ID, "バックログの並びは元のまま")

		// どのスプリントに居るかを引ける。
		found, err := repo.FindTicketSprint(ctx, ws, b)
		require.NoError(t, err)
		assert.Equal(t, s.ID, found.SprintID)
	})

	t.Run("スプリントを消してもチケットは消えずバックログへ戻る", func(t *testing.T) {
		ws, project := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, tickets, ws, project)
		created, err := tickets.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, ProjectID: project, TypeID: typeID, StatusID: statusID,
			Title: "残る仕事", Doc: []byte(`{"type":"doc","content":[]}`), Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		// バックログの並びにも居る状態にしておく（スプリントを消しても残ることの確認用）。
		require.NoError(t, tickets.InsertTicketRank(ctx, ws, project, created.ID, "a0"))

		s := newSprint(t, ws, project, "スプリント 1")
		require.NoError(t, repo.AddTicketToSprint(ctx, ws, s.ID, created.ID, "a0"))

		require.NoError(t, repo.DeleteSprint(ctx, ws, s.ID))

		_, err = repo.FindSprint(ctx, ws, s.ID)
		require.ErrorIs(t, err, repository.ErrSprintNotFound, "スプリントは消える")

		got, err := tickets.FindTicket(ctx, ws, created.ID)
		require.NoError(t, err, "チケットは消えない")
		assert.Equal(t, "a0", got.Position, "バックログの並びも残っている")
	})

	t.Run("外すとスプリントから居なくなる", func(t *testing.T) {
		ws, project := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, tickets, ws, project)
		created, err := tickets.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, ProjectID: project, TypeID: typeID, StatusID: statusID,
			Title: "外す仕事", Doc: []byte(`{"type":"doc","content":[]}`), Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		s := newSprint(t, ws, project, "スプリント 1")
		require.NoError(t, repo.AddTicketToSprint(ctx, ws, s.ID, created.ID, "a0"))

		require.NoError(t, repo.RemoveTicketFromSprint(ctx, ws, created.ID))

		ids, err := repo.ListSprintTicketIDs(ctx, ws, s.ID)
		require.NoError(t, err)
		assert.Empty(t, ids)

		// 入っていないものを外そうとしたら「無い」（握り潰さない）。
		err = repo.RemoveTicketFromSprint(ctx, ws, created.ID)
		require.ErrorIs(t, err, repository.ErrSprintTicketNotFound)
	})
}
