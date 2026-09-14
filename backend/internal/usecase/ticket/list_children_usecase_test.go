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

// Test_チケット子一覧_親のプロジェクトIDで問い合わせる は、子は親と同じプロジェクトにしか
// 居ない前提（domain.ValidateTicketParentChild）を repository への問い合わせに反映する。
// projectID は入力に持たず、FindTicket で親を引いてから使う。
func Test_チケット子一覧_親のプロジェクトIDで問い合わせる(t *testing.T) {
	repo := &mockTicketRepo{}
	parent := &domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject}
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(parent, nil)
	parentID := tkTicket
	children := []domain.Ticket{{ID: "child-1", WorkspaceID: tkWS, ProjectID: tkProject, ParentID: &parentID}}
	repo.On("ListTicketChildren", mock.Anything, tkWS, tkProject, tkTicket).Return(children, nil)

	got, err := ticket.NewListTicketChildrenUseCase(repo).Execute(context.Background(), ticket.ListTicketChildrenInput{
		WorkspaceID: tkWS, ParentTicketID: tkTicket,
	})
	require.NoError(t, err)
	require.Equal(t, children, got)
}

func Test_チケット子一覧_親が存在しなければ伝える(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).Return((*domain.Ticket)(nil), repository.ErrTicketNotFound)

	_, err := ticket.NewListTicketChildrenUseCase(repo).Execute(context.Background(), ticket.ListTicketChildrenInput{
		WorkspaceID: tkWS, ParentTicketID: tkTicket,
	})
	require.ErrorIs(t, err, repository.ErrTicketNotFound)
	repo.AssertNotCalled(t, "ListTicketChildren")
}

func Test_チケット子一覧_必須項目が無ければ拒否(t *testing.T) {
	repo := &mockTicketRepo{}
	_, err := ticket.NewListTicketChildrenUseCase(repo).Execute(context.Background(), ticket.ListTicketChildrenInput{
		WorkspaceID: "", ParentTicketID: tkTicket,
	})
	require.Error(t, err)

	_, err = ticket.NewListTicketChildrenUseCase(repo).Execute(context.Background(), ticket.ListTicketChildrenInput{
		WorkspaceID: tkWS, ParentTicketID: "",
	})
	require.Error(t, err)
	repo.AssertNotCalled(t, "FindTicket")
}
