package kb

// 目次：権限用グループの管理
// - CreatePrincipalGroupUseCase：グループ主体を作成。
// - AddGroupMemberUseCase：ユーザーをグループに追加。
// - RemoveGroupMemberUseCase：ユーザーをグループから外す。

import (
	"context"
	"errors"
	"unicode/utf8"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

var ErrPrincipalKindMismatch = errors.New("principal kind does not match the operation")

const kbGroupNameMaxLen = 200

type CreatePrincipalGroupUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewCreatePrincipalGroupUseCase(r repository.KnowledgeBasePermissionRepository) *CreatePrincipalGroupUseCase {
	return &CreatePrincipalGroupUseCase{repo: r}
}

type CreatePrincipalGroupInput struct {
	WorkspaceID string
	Name        string
}

func (u *CreatePrincipalGroupUseCase) Execute(ctx context.Context, in CreatePrincipalGroupInput) (*domain.Principal, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.Name == "" {
		return nil, errors.New("name is required")
	}
	if utf8.RuneCountInString(in.Name) > kbGroupNameMaxLen {
		return nil, errors.New("name is too long")
	}
	return u.repo.CreateGroupPrincipal(ctx, in.WorkspaceID, in.Name)
}

type AddGroupMemberUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewAddGroupMemberUseCase(r repository.KnowledgeBasePermissionRepository) *AddGroupMemberUseCase {
	return &AddGroupMemberUseCase{repo: r}
}

type AddGroupMemberInput struct {
	WorkspaceID      string
	GroupPrincipalID string
	MemberUserID     uint64
}

func (u *AddGroupMemberUseCase) Execute(ctx context.Context, in AddGroupMemberInput) error {
	if in.WorkspaceID == "" {
		return errors.New("workspaceID is required")
	}
	if in.GroupPrincipalID == "" {
		return errors.New("groupPrincipalID is required")
	}
	if in.MemberUserID == 0 {
		return errors.New("memberUserID is required")
	}
	group, err := u.repo.FindPrincipal(ctx, in.WorkspaceID, in.GroupPrincipalID)
	if err != nil {
		return err
	}
	if group.Kind != domain.PrincipalKindGroup {
		return ErrPrincipalKindMismatch
	}
	member, err := u.repo.FindUserPrincipal(ctx, in.WorkspaceID, in.MemberUserID)
	if err != nil {
		return err
	}
	return u.repo.AddGroupMember(ctx, in.WorkspaceID, group.ID, member.ID)
}

type RemoveGroupMemberUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewRemoveGroupMemberUseCase(r repository.KnowledgeBasePermissionRepository) *RemoveGroupMemberUseCase {
	return &RemoveGroupMemberUseCase{repo: r}
}

type RemoveGroupMemberInput struct {
	WorkspaceID      string
	GroupPrincipalID string
	MemberUserID     uint64
}

func (u *RemoveGroupMemberUseCase) Execute(ctx context.Context, in RemoveGroupMemberInput) error {
	if in.WorkspaceID == "" {
		return errors.New("workspaceID is required")
	}
	if in.GroupPrincipalID == "" {
		return errors.New("groupPrincipalID is required")
	}
	if in.MemberUserID == 0 {
		return errors.New("memberUserID is required")
	}
	member, err := u.repo.FindUserPrincipal(ctx, in.WorkspaceID, in.MemberUserID)
	if err != nil {
		if errors.Is(err, repository.ErrPrincipalNotFound) {
			return nil
		}
		return err
	}
	return u.repo.RemoveGroupMember(ctx, in.WorkspaceID, in.GroupPrincipalID, member.ID)
}
