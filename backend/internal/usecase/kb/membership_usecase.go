package kb

// 目次：メンバーの読み取り・管理
// - IsWorkspaceMemberUseCase：所属を確認。
// - ListWorkspaceMembersUseCase：メンバーと表示名を取得。
// - ListWorkspaceMembersForAdminUseCase：管理者向けメンバー情報を取得。
// - ListSpaceMembersUseCase：スペースのメンバーと権限を取得。
// - ListMySpacesUseCase：自分が権限を持つスペースを取得。
// - ListMemberWorkspacesUseCase：自分の所属ワークスペースを取得。
// - RemoveWorkspaceMemberUseCase：メンバーを外す。
// - ListMembershipEventsUseCase：所属・権限の変更履歴を取得。

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

type IsWorkspaceMemberUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewIsWorkspaceMemberUseCase(r repository.KnowledgeBasePermissionRepository) *IsWorkspaceMemberUseCase {
	return &IsWorkspaceMemberUseCase{repo: r}
}

type IsWorkspaceMemberInput struct {
	WorkspaceID string
	UserID      uint64
}

func (u *IsWorkspaceMemberUseCase) Execute(ctx context.Context, in IsWorkspaceMemberInput) (bool, error) {
	if in.WorkspaceID == "" {
		return false, errors.New("workspaceID is required")
	}
	if in.UserID == 0 {
		return false, errors.New("userID is required")
	}
	return u.repo.IsWorkspaceMember(ctx, in.WorkspaceID, in.UserID)
}

type ListWorkspaceMembersUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListWorkspaceMembersUseCase(r repository.KnowledgeBasePermissionRepository) *ListWorkspaceMembersUseCase {
	return &ListWorkspaceMembersUseCase{repo: r}
}

func (u *ListWorkspaceMembersUseCase) Execute(ctx context.Context, workspaceID string) ([]domain.WorkspaceMember, error) {
	if workspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	return u.repo.ListWorkspaceMembers(ctx, workspaceID)
}

type ListWorkspaceMembersForAdminUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListWorkspaceMembersForAdminUseCase(r repository.KnowledgeBasePermissionRepository) *ListWorkspaceMembersForAdminUseCase {
	return &ListWorkspaceMembersForAdminUseCase{repo: r}
}

func (u *ListWorkspaceMembersForAdminUseCase) Execute(ctx context.Context, workspaceID string) ([]domain.AdminWorkspaceMember, error) {
	if workspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	return u.repo.ListWorkspaceMembersForAdmin(ctx, workspaceID)
}

type ListSpaceMembersUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListSpaceMembersUseCase(r repository.KnowledgeBasePermissionRepository) *ListSpaceMembersUseCase {
	return &ListSpaceMembersUseCase{repo: r}
}

func (u *ListSpaceMembersUseCase) Execute(ctx context.Context, workspaceID, spaceID string) ([]domain.SpaceMember, error) {
	if workspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if spaceID == "" {
		return nil, errors.New("spaceID is required")
	}
	return u.repo.ListSpaceMembers(ctx, workspaceID, spaceID)
}

type ListMySpacesUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListMySpacesUseCase(r repository.KnowledgeBasePermissionRepository) *ListMySpacesUseCase {
	return &ListMySpacesUseCase{repo: r}
}

func (u *ListMySpacesUseCase) Execute(ctx context.Context, workspaceID string, userID uint64) ([]domain.MySpace, error) {
	if workspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if userID == 0 {
		return nil, errors.New("userID is required")
	}
	return u.repo.ListMySpaces(ctx, workspaceID, userID)
}

type RemoveWorkspaceMemberUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewRemoveWorkspaceMemberUseCase(r repository.KnowledgeBasePermissionRepository) *RemoveWorkspaceMemberUseCase {
	return &RemoveWorkspaceMemberUseCase{repo: r}
}

type RemoveWorkspaceMemberInput struct {
	WorkspaceID string
	UserID      uint64
	ActorUserID uint64
}

func (u *RemoveWorkspaceMemberUseCase) Execute(ctx context.Context, in RemoveWorkspaceMemberInput) error {
	if in.WorkspaceID == "" {
		return errors.New("workspaceID is required")
	}
	if in.UserID == 0 {
		return errors.New("userID is required")
	}
	return u.repo.LeaveWorkspaceMembership(ctx, in.WorkspaceID, in.UserID, in.ActorUserID)
}

type ListMembershipEventsUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListMembershipEventsUseCase(r repository.KnowledgeBasePermissionRepository) *ListMembershipEventsUseCase {
	return &ListMembershipEventsUseCase{repo: r}
}

func (u *ListMembershipEventsUseCase) Execute(ctx context.Context, workspaceID string) ([]domain.MembershipEvent, error) {
	if workspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	return u.repo.ListMembershipEvents(ctx, workspaceID)
}

type ListMemberWorkspacesUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewListMemberWorkspacesUseCase(r repository.KnowledgeBasePermissionRepository) *ListMemberWorkspacesUseCase {
	return &ListMemberWorkspacesUseCase{repo: r}
}

type ListMemberWorkspacesInput struct {
	UserID uint64
}

func (u *ListMemberWorkspacesUseCase) Execute(ctx context.Context, in ListMemberWorkspacesInput) ([]domain.MemberWorkspace, error) {
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	facts, err := u.repo.ListMemberWorkspaces(ctx, in.UserID)
	if err != nil {
		return nil, err
	}
	out := make([]domain.MemberWorkspace, 0, len(facts))
	for _, f := range facts {
		out = append(out, domain.MemberWorkspace{
			Workspace:  f.Workspace,
			Permission: domain.ResolveScopePermission(f.Facts),
		})
	}
	return out, nil
}
