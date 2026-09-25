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

	// 壊れた ID（UUID として読めない文字列）は「無い」として扱う。落ちたり、
	// 解釈できないまま SQL へ渡して FK 違反にしたりしない —— ID は URL から来るので、
	// 利用者が何を書いてもここで止まる必要がある。
	t.Run("壊れたIDは無いものとして扱う", func(t *testing.T) {
		ws, project := setup(t)
		const broken = "ID ではない"

		_, err := repo.FindSprint(ctx, ws, broken)
		assert.ErrorIs(t, err, repository.ErrSprintNotFound)
		assert.ErrorIs(t, repo.DeleteSprint(ctx, ws, broken), repository.ErrSprintNotFound)
		_, err = repo.UpdateSprint(ctx, ws, broken, "名前", nil, nil)
		assert.ErrorIs(t, err, repository.ErrSprintNotFound)
		assert.ErrorIs(t, repo.MoveTicketSprintRank(ctx, ws, broken, "a0"), repository.ErrSprintTicketNotFound)
		_, err = repo.FindTicketSprint(ctx, ws, broken)
		assert.ErrorIs(t, err, repository.ErrSprintTicketNotFound)

		// 読み取りは「0 件」で返す（存在し得ない ID なので、結果は空と同じ）。
		list, err := repo.ListSprints(ctx, broken, project)
		require.NoError(t, err)
		assert.Empty(t, list)
		n, err := repo.CountSprintTickets(ctx, ws, broken)
		require.NoError(t, err)
		assert.EqualValues(t, 0, n)
		last, err := repo.LastTicketSprintRankPosition(ctx, ws, broken)
		require.NoError(t, err)
		assert.Empty(t, last)
		ids, err := repo.ListSprintTicketIDs(ctx, ws, broken)
		require.NoError(t, err)
		assert.Empty(t, ids)
		ranks, err := repo.ListSprintTicketRanks(ctx, ws, broken)
		require.NoError(t, err)
		assert.Empty(t, ranks)
	})

	// 一覧・改名・件数・末尾の位置は、どれも画面がそのまま使う口。実 DB を通さないと
	// 並び順（position 昇順）も「別プロジェクトのスプリントを拾わない」も確かめられない。
	t.Run("一覧は並び順で返し別プロジェクトを混ぜない", func(t *testing.T) {
		ws, project := setup(t)
		other := createProject(t, sqlDB, ws, "spo")
		first := newSprint(t, ws, project, "スプリント 1")
		second := newSprint(t, ws, project, "スプリント 2")
		newSprint(t, ws, other, "別プロジェクトのスプリント")

		got, err := repo.ListSprints(ctx, ws, project)
		require.NoError(t, err)
		require.Len(t, got, 2, "別プロジェクトのものを混ぜない")
		assert.Equal(t, first.ID, got[0].ID, "position の昇順で返す")
		assert.Equal(t, second.ID, got[1].ID)

		last, err := repo.LastSprintPosition(ctx, ws, project)
		require.NoError(t, err)
		assert.Equal(t, second.Position, last, "末尾は一番後ろの位置キー")
	})

	t.Run("名前と期間は書き換えられ状態は動かない", func(t *testing.T) {
		ws, project := setup(t)
		s := newSprint(t, ws, project, "スプリント 1")
		start, end := "2026-09-01", "2026-09-14"

		updated, err := repo.UpdateSprint(ctx, ws, s.ID, "スプリント 一", &start, &end)
		require.NoError(t, err)
		assert.Equal(t, "スプリント 一", updated.Name)
		require.NotNil(t, updated.StartDate)
		assert.Equal(t, start, *updated.StartDate)
		assert.Equal(t, domain.SprintStatePlanned, updated.State, "名前を直しても状態は動かさない")

		// 期間は「未定へ戻す」もできる（計画中は決まっていないのが普通）。
		cleared, err := repo.UpdateSprint(ctx, ws, s.ID, "スプリント 一", nil, nil)
		require.NoError(t, err)
		assert.Nil(t, cleared.StartDate)
		assert.Nil(t, cleared.EndDate)

		_, err = repo.UpdateSprint(ctx, ws, "00000000-0000-0000-0000-000000000000", "居ない", nil, nil)
		assert.ErrorIs(t, err, repository.ErrSprintNotFound)
	})

	t.Run("中身の件数と末尾の位置を数える", func(t *testing.T) {
		ws, project := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, tickets, ws, project)
		s := newSprint(t, ws, project, "スプリント 1")

		n, err := repo.CountSprintTickets(ctx, ws, s.ID)
		require.NoError(t, err)
		assert.EqualValues(t, 0, n, "空のスプリントは 0 件")
		last, err := repo.LastTicketSprintRankPosition(ctx, ws, s.ID)
		require.NoError(t, err)
		assert.Empty(t, last, "1 件も無ければ末尾は空")

		for i, pos := range []string{"a1", "a5"} {
			created, err := tickets.CreateTicket(ctx, repository.TicketCreateInput{
				WorkspaceID: ws, ProjectID: project, TypeID: typeID, StatusID: statusID,
				Title: "仕事", Doc: []byte(`{"type":"doc","content":[]}`),
				Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
			})
			require.NoError(t, err)
			require.NoError(t, repo.AddTicketToSprint(ctx, ws, s.ID, created.ID, pos))
			n, err = repo.CountSprintTickets(ctx, ws, s.ID)
			require.NoError(t, err)
			assert.EqualValues(t, i+1, n)
		}

		last, err = repo.LastTicketSprintRankPosition(ctx, ws, s.ID)
		require.NoError(t, err)
		assert.Equal(t, "a5", last, "末尾は一番後ろの位置キー")
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
		list, err := tickets.ListTickets(ctx, repository.ListTicketsInput{WorkspaceID: ws, ProjectID: project})
		require.NoError(t, err)
		listed := list.Items
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
