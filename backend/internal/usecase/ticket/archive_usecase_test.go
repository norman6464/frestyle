package ticket_test

import (
	"context"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func Test_チケットアーカイブ_必須項目の検証(t *testing.T) {
	uc := ticket.NewArchiveTicketUseCase(&mockTicketRepo{})
	_, err := uc.Execute(context.Background(), ticket.ArchiveTicketInput{TicketID: tkTicket, ActorUserID: 1})
	require.Error(t, err)
}

func Test_チケットアーカイブ_履歴を残す(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("ArchiveTicket", mock.Anything, tkWS, tkTicket).Return(nil)
	repo.On("InsertTicketChangeGroup", mock.Anything, mock.MatchedBy(func(g *domain.TicketChangeGroup) bool {
		return g.WorkspaceID == tkWS && g.TicketID == tkTicket && g.ActorUserID == 1 &&
			len(g.Items) == 1 && g.Items[0].Field == domain.TicketChangeFieldArchived
	})).Return(nil)
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).
		Return(&domain.Ticket{ID: tkTicket, WorkspaceID: tkWS}, nil)

	_, err := ticket.NewArchiveTicketUseCase(repo).Execute(context.Background(), ticket.ArchiveTicketInput{
		WorkspaceID: tkWS, TicketID: tkTicket, ActorUserID: 1,
	})
	require.NoError(t, err)
}

// 復元したチケットは並び順の末尾へ置き直す。書き込み先は ticket_backlog_ranks で、
// tickets 側には並び順の列が無い（撤去済み）。
func Test_チケット復元_並び順を末尾へ付け直す(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).
		Return(&domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject}, nil)
	repo.On("RestoreTicket", mock.Anything, tkWS, tkTicket).Return(nil)
	repo.On("LastTicketRankPosition", mock.Anything, tkWS, tkProject).Return("a0", nil)
	// アーカイブ中に行が消えている場合もあるので upsert。末尾（既存の最大より後ろ）へ置く。
	repo.On("UpsertTicketRank", mock.Anything, tkWS, tkProject, tkTicket, mock.MatchedBy(func(pos string) bool {
		return pos > "a0"
	})).Return(nil)
	repo.On("InsertTicketChangeGroup", mock.Anything, mock.AnythingOfType("*domain.TicketChangeGroup")).Return(nil)

	_, err := ticket.NewRestoreTicketUseCase(repo).Execute(context.Background(), ticket.RestoreTicketInput{
		WorkspaceID: tkWS, TicketID: tkTicket, ActorUserID: 1,
	})
	require.NoError(t, err)
}

func Test_チケットアーカイブ_存在しなければそのまま伝える(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("ArchiveTicket", mock.Anything, tkWS, tkTicket).Return(repository.ErrTicketNotFound)

	_, err := ticket.NewArchiveTicketUseCase(repo).Execute(context.Background(), ticket.ArchiveTicketInput{
		WorkspaceID: tkWS, TicketID: tkTicket, ActorUserID: 1,
	})
	require.ErrorIs(t, err, repository.ErrTicketNotFound)
	repo.AssertNotCalled(t, "InsertTicketChangeGroup")
}
