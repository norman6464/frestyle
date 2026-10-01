package kb

// 目次：権限の付与・剥奪と準備・安全確認
// - GrantWorkspaceRoleUseCase：ワークスペースの役割を付与。
// - RevokeWorkspaceRoleUseCase：ワークスペースの役割を剥奪。
// - GrantSpaceRoleUseCase：スペースの役割を付与。
// - RevokeSpaceRoleUseCase：スペースの役割を剥奪。
// - EnsureSpaceEveryonePrincipalUseCase：スペースの全員主体を準備。
// - CanRemoveWorkspaceAdminUseCase：管理者が残るか事前確認。

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

var ErrInvalidGrantRole = errors.New("invalid grant role")

type GrantWorkspaceRoleUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewGrantWorkspaceRoleUseCase(r repository.KnowledgeBasePermissionRepository) *GrantWorkspaceRoleUseCase {
	return &GrantWorkspaceRoleUseCase{repo: r}
}

type GrantWorkspaceRoleInput struct {
	WorkspaceID string
	PrincipalID string
	Role        domain.GrantRole
	ActorUserID uint64
}

func (u *GrantWorkspaceRoleUseCase) Execute(ctx context.Context, in GrantWorkspaceRoleInput) (*domain.WorkspaceGrant, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.PrincipalID == "" {
		return nil, errors.New("principalID is required")
	}
	if !in.Role.Valid() {
		return nil, ErrInvalidGrantRole
	}
	if _, err := u.repo.FindPrincipal(ctx, in.WorkspaceID, in.PrincipalID); err != nil {
		return nil, err
	}
	return u.repo.UpsertWorkspaceGrant(ctx, in.WorkspaceID, in.PrincipalID, in.Role, in.ActorUserID)
}

type RevokeWorkspaceRoleUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewRevokeWorkspaceRoleUseCase(r repository.KnowledgeBasePermissionRepository) *RevokeWorkspaceRoleUseCase {
	return &RevokeWorkspaceRoleUseCase{repo: r}
}

type RevokeWorkspaceRoleInput struct {
	WorkspaceID string
	PrincipalID string
	ActorUserID uint64
}

func (u *RevokeWorkspaceRoleUseCase) Execute(ctx context.Context, in RevokeWorkspaceRoleInput) error {
	if in.WorkspaceID == "" {
		return errors.New("workspaceID is required")
	}
	if in.PrincipalID == "" {
		return errors.New("principalID is required")
	}
	return u.repo.DeleteWorkspaceGrant(ctx, in.WorkspaceID, in.PrincipalID, in.ActorUserID)
}

type GrantSpaceRoleUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewGrantSpaceRoleUseCase(r repository.KnowledgeBasePermissionRepository) *GrantSpaceRoleUseCase {
	return &GrantSpaceRoleUseCase{repo: r}
}

type GrantSpaceRoleInput struct {
	WorkspaceID string
	SpaceID     string
	PrincipalID string
	Role        domain.GrantRole
}

func (u *GrantSpaceRoleUseCase) Execute(ctx context.Context, in GrantSpaceRoleInput) (*domain.SpaceGrant, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.SpaceID == "" {
		return nil, errors.New("spaceID is required")
	}
	if in.PrincipalID == "" {
		return nil, errors.New("principalID is required")
	}
	if !in.Role.Valid() {
		return nil, ErrInvalidGrantRole
	}
	if _, err := u.repo.FindPrincipal(ctx, in.WorkspaceID, in.PrincipalID); err != nil {
		return nil, err
	}
	return u.repo.UpsertSpaceGrant(ctx, in.WorkspaceID, in.SpaceID, in.PrincipalID, in.Role)
}

type RevokeSpaceRoleUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewRevokeSpaceRoleUseCase(r repository.KnowledgeBasePermissionRepository) *RevokeSpaceRoleUseCase {
	return &RevokeSpaceRoleUseCase{repo: r}
}

type RevokeSpaceRoleInput struct {
	WorkspaceID string
	SpaceID     string
	PrincipalID string
}

func (u *RevokeSpaceRoleUseCase) Execute(ctx context.Context, in RevokeSpaceRoleInput) error {
	if in.WorkspaceID == "" {
		return errors.New("workspaceID is required")
	}
	if in.SpaceID == "" {
		return errors.New("spaceID is required")
	}
	if in.PrincipalID == "" {
		return errors.New("principalID is required")
	}
	return u.repo.DeleteSpaceGrant(ctx, in.WorkspaceID, in.SpaceID, in.PrincipalID)
}

type EnsureSpaceEveryonePrincipalUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewEnsureSpaceEveryonePrincipalUseCase(r repository.KnowledgeBasePermissionRepository) *EnsureSpaceEveryonePrincipalUseCase {
	return &EnsureSpaceEveryonePrincipalUseCase{repo: r}
}

type EnsureSpaceEveryonePrincipalInput struct {
	WorkspaceID string
	SpaceID     string
}

func (u *EnsureSpaceEveryonePrincipalUseCase) Execute(ctx context.Context, in EnsureSpaceEveryonePrincipalInput) (*domain.Principal, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.SpaceID == "" {
		return nil, errors.New("spaceID is required")
	}
	return u.repo.EnsureSpaceEveryonePrincipal(ctx, in.WorkspaceID, in.SpaceID)
}

type CanRemoveWorkspaceAdminUseCase struct {
	repo repository.KnowledgeBasePermissionRepository
}

func NewCanRemoveWorkspaceAdminUseCase(r repository.KnowledgeBasePermissionRepository) *CanRemoveWorkspaceAdminUseCase {
	return &CanRemoveWorkspaceAdminUseCase{repo: r}
}

type CanRemoveWorkspaceAdminInput struct {
	WorkspaceID string
	PrincipalID string
	UserID      uint64
}

func (u *CanRemoveWorkspaceAdminUseCase) Execute(ctx context.Context, in CanRemoveWorkspaceAdminInput) (bool, error) {
	if in.WorkspaceID == "" {
		return false, errors.New("workspaceID is required")
	}
	if in.PrincipalID == "" && in.UserID == 0 {
		return false, errors.New("principalID or userID is required")
	}

	target := in.PrincipalID
	if target == "" {
		principal, err := u.repo.FindUserPrincipal(ctx, in.WorkspaceID, in.UserID)
		if err != nil {
			if errors.Is(err, repository.ErrPrincipalNotFound) {
				return true, nil
			}
			return false, err
		}
		target = principal.ID
	}

	grants, err := u.repo.ListWorkspaceGrants(ctx, in.WorkspaceID)
	if err != nil {
		return false, err
	}
	targetIsAdmin := false
	others := make([]string, 0, len(grants))
	for _, g := range grants {
		if g.Role != domain.GrantRoleAdmin {
			continue
		}
		if g.PrincipalID == target {
			targetIsAdmin = true
			continue
		}
		others = append(others, g.PrincipalID)
	}
	if !targetIsAdmin {
		return true, nil
	}

	for _, principalID := range others {
		p, err := u.repo.FindPrincipal(ctx, in.WorkspaceID, principalID)
		if err != nil {
			if errors.Is(err, repository.ErrPrincipalNotFound) {
				continue
			}
			return false, err
		}
		if p.Kind == domain.PrincipalKindUser {
			return true, nil
		}
	}
	return false, nil
}
