package ticket_test

import (
	"context"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func Test_チケット取得_必須項目の検証(t *testing.T) {
	uc := ticket.NewGetTicketUseCase(&mockTicketRepo{})
	_, err := uc.Execute(context.Background(), ticket.GetTicketInput{TicketID: tkTicket})
	require.Error(t, err)
	_, err = uc.Execute(context.Background(), ticket.GetTicketInput{WorkspaceID: tkWS})
	require.Error(t, err)
}

func Test_チケット取得_存在しなければそのまま伝える(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("FindTicketWithAssignee", mock.Anything, tkWS, tkTicket).Return(nil, repository.ErrTicketNotFound)

	_, err := ticket.NewGetTicketUseCase(repo).Execute(context.Background(), ticket.GetTicketInput{
		WorkspaceID: tkWS, TicketID: tkTicket,
	})
	require.ErrorIs(t, err, repository.ErrTicketNotFound)
}

func Test_チケット取得_そのまま返す(t *testing.T) {
	repo := &mockTicketRepo{}
	assignee := "principal-1"
	repo.On("FindTicketWithAssignee", mock.Anything, tkWS, tkTicket).
		Return(&repository.TicketWithAssignee{
			Ticket: domain.Ticket{
				ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject,
				Doc: []byte(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"本文"}]}]}`),
			},
			AssigneePrincipalID: &assignee,
		}, nil)

	got, err := ticket.NewGetTicketUseCase(repo).Execute(context.Background(), ticket.GetTicketInput{
		WorkspaceID: tkWS, TicketID: tkTicket,
	})
	require.NoError(t, err)
	assert.Equal(t, tkTicket, got.Ticket.ID)
	assert.Contains(t, string(got.Ticket.Doc), "本文")
	require.NotNil(t, got.AssigneePrincipalID, "担当は同じ問い合わせで一緒に返る")
	assert.Equal(t, "principal-1", *got.AssigneePrincipalID)
}
