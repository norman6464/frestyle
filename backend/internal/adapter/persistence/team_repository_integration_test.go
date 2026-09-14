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

// TestTeamRepository_Integration はチームと所属、チケットへの付け替えを実 Postgres で確かめる。
//
// 版と同じく、**別プロジェクトのチームが付かない**ことが設計の肝。
// そこと「チームを消してもチケットは消えない」を必ず押す。
func TestTeamRepository_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	repo := persistence.NewTeamRepository(sqlDB)
	tickets := persistence.NewTicketRepository(sqlDB)

	setup := func(t *testing.T) (ws, projectA, projectB string) {
		t.Helper()
		testsupport.TruncateAll(t, sqlDB, kbTables...)
		ws = createWorkspace(t, sqlDB, "team-ws")
		projectA = createProject(t, sqlDB, ws, "tma")
		projectB = createProject(t, sqlDB, ws, "tmb")
		return
	}

	newTicket := func(t *testing.T, ws, project string) *domain.Ticket {
		t.Helper()
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, tickets, ws, project)
		created, err := tickets.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, ProjectID: project, TypeID: typeID, StatusID: statusID,
			Title: "仕事", Doc: []byte(`{"type":"doc","content":[]}`),
			Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		return created
	}

	t.Run("チームを作って一覧・改名する", func(t *testing.T) {
		ws, project, _ := setup(t)
		team, err := repo.CreateTeam(ctx, ws, project, "基盤")
		require.NoError(t, err)
		assert.Equal(t, "基盤", team.Name)

		list, err := repo.ListTeams(ctx, ws, project)
		require.NoError(t, err)
		require.Len(t, list, 1)

		renamed, err := repo.UpdateTeam(ctx, ws, project, team.ID, "基盤/SRE")
		require.NoError(t, err)
		assert.Equal(t, "基盤/SRE", renamed.Name)
	})

	t.Run("同じプロジェクトで同名のチームは作れない", func(t *testing.T) {
		ws, project, projectB := setup(t)
		_, err := repo.CreateTeam(ctx, ws, project, "開発")
		require.NoError(t, err)
		_, err = repo.CreateTeam(ctx, ws, project, "開発")
		require.ErrorIs(t, err, repository.ErrTeamNameTaken)
		// 大文字小文字の違いも同じ扱い。
		_, err = repo.CreateTeam(ctx, ws, project, "Dev")
		require.NoError(t, err)
		_, err = repo.CreateTeam(ctx, ws, project, "dev")
		require.ErrorIs(t, err, repository.ErrTeamNameTaken)
		// 別プロジェクトなら同名でよい。
		_, err = repo.CreateTeam(ctx, ws, projectB, "開発")
		require.NoError(t, err)
	})

	t.Run("所属の付け外し", func(t *testing.T) {
		ws, project, _ := setup(t)
		team, err := repo.CreateTeam(ctx, ws, project, "運用")
		require.NoError(t, err)
		alice := createUser(t, sqlDB, "team-alice")
		bob := createUser(t, sqlDB, "team-bob")

		require.NoError(t, repo.AddTeamMember(ctx, ws, team.ID, alice))
		require.NoError(t, repo.AddTeamMember(ctx, ws, team.ID, bob))
		// 二度押しても増えない。
		require.NoError(t, repo.AddTeamMember(ctx, ws, team.ID, alice))
		members, err := repo.ListTeamMembers(ctx, ws, team.ID)
		require.NoError(t, err)
		require.Len(t, members, 2)

		require.NoError(t, repo.RemoveTeamMember(ctx, ws, team.ID, bob))
		members, err = repo.ListTeamMembers(ctx, ws, team.ID)
		require.NoError(t, err)
		require.Len(t, members, 1)
		assert.Equal(t, alice, members[0].UserID)
	})

	t.Run("チケットにチームを付けて外す", func(t *testing.T) {
		ws, project, _ := setup(t)
		ticket := newTicket(t, ws, project)
		team, err := repo.CreateTeam(ctx, ws, project, "担当チーム")
		require.NoError(t, err)

		_, err = repo.SetTicketTeam(ctx, ws, ticket.ID, team.ID)
		require.NoError(t, err)
		_, err = repo.SetTicketTeam(ctx, ws, ticket.ID, "")
		require.NoError(t, err, "空文字で外せる")
	})

	// ここが本丸。fk_tickets_team が (workspace_id, project_id, team_id) の複合 FK で
	// あることを実際に試す。単一列の FK に戻すとこのテストが通ってしまう。
	t.Run("別プロジェクトのチームはチケットに付けられない", func(t *testing.T) {
		ws, projectA, projectB := setup(t)
		ticket := newTicket(t, ws, projectA)
		other, err := repo.CreateTeam(ctx, ws, projectB, "B のチーム")
		require.NoError(t, err)

		_, err = repo.SetTicketTeam(ctx, ws, ticket.ID, other.ID)
		require.ErrorIs(t, err, repository.ErrTeamNotFound, "複合 FK が拒む")
	})

	// チームは「付け外しできる印」。消してもチケットは残り、印だけが外れる。
	//
	// 順番が要る。**付いたまま消そうとすると DB が拒む**（複合 FK に SET NULL は使えず
	// NO ACTION にしてあるため）。外してから消す、をコード側で明示している。
	t.Run("付いたままでは消せず、外してから消すとチケットは残る", func(t *testing.T) {
		ws, project, _ := setup(t)
		ticket := newTicket(t, ws, project)
		team, err := repo.CreateTeam(ctx, ws, project, "消えるチーム")
		require.NoError(t, err)
		_, err = repo.SetTicketTeam(ctx, ws, ticket.ID, team.ID)
		require.NoError(t, err)

		require.Error(t, repo.DeleteTeam(ctx, ws, project, team.ID), "付いたままでは消せない")

		require.NoError(t, repo.ClearTicketsTeam(ctx, ws, team.ID))
		require.NoError(t, repo.DeleteTeam(ctx, ws, project, team.ID))

		still, err := tickets.FindTicket(ctx, ws, ticket.ID)
		require.NoError(t, err, "チケットそのものは残る")
		assert.Equal(t, ticket.ID, still.ID)
	})
}
