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

func tkTaskType() domain.TicketType {
	return domain.TicketType{ID: "type-task", HierarchyLevel: 0}
}

func Test_チケット親変更_トップレベルへ戻す(t *testing.T) {
	repo := &mockTicketRepo{}
	current := &domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject, TypeID: "type-task", ParentID: &tkParent}
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(current, nil)
	repo.On("UpdateTicket", mock.Anything, tkWS, tkTicket, mock.MatchedBy(func(f repository.TicketUpdateFields) bool {
		return f.ParentID == nil
	})).Return(&domain.Ticket{ID: tkTicket}, nil)
	repo.On("InsertTicketChangeGroup", mock.Anything, mock.AnythingOfType("*domain.TicketChangeGroup")).Return(nil)
	repo.On("DetachTicketPathSubtree", mock.Anything, tkWS, tkTicket).Return(nil)

	_, err := ticket.NewChangeTicketParentUseCase(repo).Execute(context.Background(), ticket.ChangeTicketParentInput{
		WorkspaceID: tkWS, TicketID: tkTicket, ActorUserID: 1, NewParentID: nil,
	})
	require.NoError(t, err)
	repo.AssertCalled(t, "DetachTicketPathSubtree", mock.Anything, tkWS, tkTicket)
	repo.AssertNotCalled(t, "AttachTicketPathSubtree")
}

// 自分自身、または自分の子孫の下へは移せない（周期を作る）。
func Test_チケット親変更_自分自身の下には移せない(t *testing.T) {
	repo := &mockTicketRepo{}
	current := &domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject, TypeID: "type-task"}
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(current, nil)

	selfID := tkTicket
	_, err := ticket.NewChangeTicketParentUseCase(repo).Execute(context.Background(), ticket.ChangeTicketParentInput{
		WorkspaceID: tkWS, TicketID: tkTicket, ActorUserID: 1, NewParentID: &selfID,
	})
	require.ErrorIs(t, err, domain.ErrTicketHierarchyRejected)
	repo.AssertNotCalled(t, "UpdateTicket")
}

// 移動先が自分の子孫なら周期になる。ListTicketParentChain(候補の親) に自分の ID が
// 含まれていれば、その候補は自分の子孫（を含む祖先の連なり）ということ。
func Test_チケット親変更_子孫の下には移せない(t *testing.T) {
	repo := &mockTicketRepo{}
	current := &domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject, TypeID: "type-task"}
	grandchild := "grandchild-1"
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(current, nil)
	repo.On("FindTicket", mock.Anything, tkWS, grandchild).
		Return(&domain.Ticket{ID: grandchild, WorkspaceID: tkWS, ProjectID: tkProject, TypeID: "type-task"}, nil)
	repo.On("FindTicketType", mock.Anything, tkWS, tkProject, "type-task").Return(&domain.TicketType{ID: "type-task", HierarchyLevel: 0}, nil)
	// grandchild の祖先チェーンに tkTicket 自身が含まれる = grandchild は tkTicket の子孫。
	repo.On("ListTicketParentChain", mock.Anything, tkWS, grandchild).Return([]domain.Ticket{
		{ID: "root"}, {ID: tkTicket},
	}, nil)

	_, err := ticket.NewChangeTicketParentUseCase(repo).Execute(context.Background(), ticket.ChangeTicketParentInput{
		WorkspaceID: tkWS, TicketID: tkTicket, ActorUserID: 1, NewParentID: &grandchild,
	})
	require.ErrorIs(t, err, domain.ErrTicketHierarchyRejected)
}

func Test_チケット親変更_正常な移動は履歴を残す(t *testing.T) {
	repo := &mockTicketRepo{}
	newParent := "new-parent"
	current := &domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject, TypeID: "type-task", ParentID: nil}
	parentType := tkTaskType()
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(current, nil)
	repo.On("FindTicket", mock.Anything, tkWS, newParent).
		Return(&domain.Ticket{ID: newParent, WorkspaceID: tkWS, ProjectID: tkProject, TypeID: "type-task"}, nil)
	repo.On("FindTicketType", mock.Anything, tkWS, tkProject, "type-task").Return(&parentType, nil)
	repo.On("ListTicketParentChain", mock.Anything, tkWS, newParent).Return([]domain.Ticket{}, nil)
	repo.On("UpdateTicket", mock.Anything, tkWS, tkTicket, mock.AnythingOfType("repository.TicketUpdateFields")).
		Return(&domain.Ticket{ID: tkTicket}, nil)
	repo.On("InsertTicketChangeGroup", mock.Anything, mock.MatchedBy(func(g *domain.TicketChangeGroup) bool {
		return len(g.Items) == 1 && g.Items[0].Field == domain.TicketChangeFieldParent
	})).Return(nil)
	repo.On("DetachTicketPathSubtree", mock.Anything, tkWS, tkTicket).Return(nil)
	repo.On("AttachTicketPathSubtree", mock.Anything, tkWS, tkTicket, newParent).Return(nil)

	_, err := ticket.NewChangeTicketParentUseCase(repo).Execute(context.Background(), ticket.ChangeTicketParentInput{
		WorkspaceID: tkWS, TicketID: tkTicket, ActorUserID: 1, NewParentID: &newParent,
	})
	require.NoError(t, err)
	repo.AssertCalled(t, "DetachTicketPathSubtree", mock.Anything, tkWS, tkTicket)
	repo.AssertCalled(t, "AttachTicketPathSubtree", mock.Anything, tkWS, tkTicket, newParent)
}

func Test_チケット親変更_変化が無ければ履歴を残さない(t *testing.T) {
	repo := &mockTicketRepo{}
	current := &domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject, TypeID: "type-task", ParentID: nil}
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(current, nil)
	repo.On("UpdateTicket", mock.Anything, tkWS, tkTicket, mock.AnythingOfType("repository.TicketUpdateFields")).
		Return(current, nil)

	_, err := ticket.NewChangeTicketParentUseCase(repo).Execute(context.Background(), ticket.ChangeTicketParentInput{
		WorkspaceID: tkWS, TicketID: tkTicket, ActorUserID: 1, NewParentID: nil,
	})
	require.NoError(t, err)
	repo.AssertNotCalled(t, "InsertTicketChangeGroup")
	repo.AssertNotCalled(t, "DetachTicketPathSubtree")
	repo.AssertNotCalled(t, "AttachTicketPathSubtree")
}
