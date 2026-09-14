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

const (
	tkWS      = "01a00000-0000-7000-8000-000000000001"
	tkProject = "01a00000-0000-7000-8000-000000000002"
	tkTicket  = "01a00000-0000-7000-8000-000000000003"
)

func tkGrantRole(r domain.GrantRole) *domain.GrantRole { return &r }

func Test_チケット権限確認_必須項目の検証(t *testing.T) {
	uc := ticket.NewCheckTicketPermissionUseCase(&mockTicketRepo{}, &mockKBPermissionRepo{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, ticket.CheckTicketPermissionInput{TicketID: tkTicket, UserID: 1})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(ctx, ticket.CheckTicketPermissionInput{WorkspaceID: tkWS, UserID: 1})
	require.Error(t, err, "ticketID 必須")
	_, err = uc.Execute(ctx, ticket.CheckTicketPermissionInput{WorkspaceID: tkWS, TicketID: tkTicket})
	require.Error(t, err, "userID 必須")
}

// チケットが実在しなければ、権限の事実を集めるまでもなく ErrTicketNotFound をそのまま伝える。
// テナント越え・非実在のどちらも同じ応答に畳む設計を、まずここで検証する。
func Test_チケット権限確認_チケットが無ければそのまま伝える(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(nil, repository.ErrTicketNotFound)
	permRepo := &mockKBPermissionRepo{}

	uc := ticket.NewCheckTicketPermissionUseCase(repo, permRepo)
	_, err := uc.Execute(context.Background(), ticket.CheckTicketPermissionInput{
		WorkspaceID: tkWS, TicketID: tkTicket, UserID: 1,
	})

	require.ErrorIs(t, err, repository.ErrTicketNotFound)
	permRepo.AssertNotCalled(t, "WorkspacePermissionFactsForUser")
}

// チケットが実在すれば、ワークスペースの実効権限（domain.ResolveScopePermission）を返す。
// バックログはナレッジのスペースから独立した製品なので、スペースの付与（space_grants）は
// 引かない。ticket 固有の権限テーブルも持たない。
func Test_チケット権限確認_ワークスペースの権限を返す(t *testing.T) {
	cases := map[string]struct {
		role                                    *domain.GrantRole
		canView, canComment, canEdit, canManage bool
	}{
		"役割なし":      {},
		"閲覧のみ届いている": {role: tkGrantRole(domain.GrantRoleViewer), canView: true},
		"コメントまで届いている": {
			role: tkGrantRole(domain.GrantRoleCommenter), canView: true, canComment: true,
		},
		"編集まで届いている": {
			role: tkGrantRole(domain.GrantRoleEditor), canView: true, canComment: true, canEdit: true,
		},
		"管理まで届いている": {
			role:    tkGrantRole(domain.GrantRoleAdmin),
			canView: true, canComment: true, canEdit: true, canManage: true,
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			repo := &mockTicketRepo{}
			repo.On("FindTicket", mock.Anything, tkWS, tkTicket).
				Return(&domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject}, nil)
			permRepo := &mockKBPermissionRepo{}
			var roles []domain.GrantRole
			if tc.role != nil {
				roles = []domain.GrantRole{*tc.role}
			}
			permRepo.On("WorkspacePermissionFactsForUser", mock.Anything, tkWS, uint64(1)).
				Return(&domain.ScopeFacts{Roles: roles}, nil)
			// スペースの付与は一切引かない（引いたらナレッジとの結び付きが権限側で復活する）。
			permRepo.AssertNotCalled(t, "SpacePermissionFactsForUser")

			got, err := ticket.NewCheckTicketPermissionUseCase(repo, permRepo).
				Execute(context.Background(), ticket.CheckTicketPermissionInput{
					WorkspaceID: tkWS, TicketID: tkTicket, UserID: 1,
				})

			require.NoError(t, err)
			assert.Equal(t, tc.canView, got.CanView)
			assert.Equal(t, tc.canComment, got.CanComment)
			assert.Equal(t, tc.canEdit, got.CanEdit)
			assert.Equal(t, tc.canManage, got.CanManage)
		})
	}
}
