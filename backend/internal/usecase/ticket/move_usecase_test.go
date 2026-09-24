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

func Test_チケット移動_アンカー無しなら末尾へ(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).
		Return(&domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject, Position: "a0"}, nil)
	repo.On("LastTicketRankPosition", mock.Anything, tkWS, tkProject).Return("a1", nil)
	repo.On("MoveTicketRank", mock.Anything, tkWS, tkTicket, mock.MatchedBy(func(pos string) bool {
		return pos > "a1"
	})).Return(nil)

	err := ticket.NewMoveTicketUseCase(repo).Execute(context.Background(), ticket.MoveTicketInput{
		WorkspaceID: tkWS, TicketID: tkTicket,
	})
	require.NoError(t, err)
}

// アンカーに指定したチケットが現役の兄弟（同じプロジェクト・アーカイブされていない）で
// なければ、黙って末尾へ落とさず拒否する（設計: 落とした場所と違う場所に入り、
// しかも成功したように見える事故を防ぐ）。
func Test_チケット移動_アンカーが兄弟でなければ拒否(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).
		Return(&domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject, Position: "a0"}, nil)
	repo.On("ListTickets", mock.Anything, repository.ListTicketsInput{WorkspaceID: tkWS, ProjectID: tkProject}).
		Return(repository.TicketList{Items: []repository.TicketWithAssignee{{Ticket: domain.Ticket{ID: tkTicket, Position: "a0"}}}}, nil)

	anchor := "does-not-exist"
	err := ticket.NewMoveTicketUseCase(repo).Execute(context.Background(), ticket.MoveTicketInput{
		WorkspaceID: tkWS, TicketID: tkTicket, AnchorTicketID: &anchor,
	})
	require.ErrorIs(t, err, ticket.ErrTicketMoveAnchorNotSibling)
	repo.AssertNotCalled(t, "MoveTicketRank")
}

func Test_チケット移動_アンカーの直後に置く(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).
		Return(&domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject, Position: "a2"}, nil)
	anchor := "t-anchor"
	repo.On("ListTickets", mock.Anything, repository.ListTicketsInput{WorkspaceID: tkWS, ProjectID: tkProject}).
		Return(repository.TicketList{Items: []repository.TicketWithAssignee{
			{Ticket: domain.Ticket{ID: anchor, Position: "a0"}},
			{Ticket: domain.Ticket{ID: "t-next", Position: "a1"}},
			{Ticket: domain.Ticket{ID: tkTicket, Position: "a2"}},
		}}, nil)
	repo.On("MoveTicketRank", mock.Anything, tkWS, tkTicket, mock.MatchedBy(func(pos string) bool {
		return pos > "a0" && pos < "a1"
	})).Return(nil)

	err := ticket.NewMoveTicketUseCase(repo).Execute(context.Background(), ticket.MoveTicketInput{
		WorkspaceID: tkWS, TicketID: tkTicket, AnchorTicketID: &anchor, AnchorAfter: true,
	})
	require.NoError(t, err)
}
