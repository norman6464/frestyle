package kb

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// CreateSpaceUseCase はワークスペース配下にスペースを作る。
// 誰が作れるかの判定は handler が CheckWorkspacePermissionUseCase で先に行う（認可は 1 か所）。
type CreateSpaceUseCase struct {
	repo repository.KnowledgeBaseRepository
	// provisioner は private のスペース作成に使う（スペース + 作成者への grant を
	// 1 トランザクションで書く必要があり、単発の CreateSpace では表せない）。
	provisioner repository.WorkspaceProvisioner
}

func NewCreateSpaceUseCase(
	r repository.KnowledgeBaseRepository, p repository.WorkspaceProvisioner,
) *CreateSpaceUseCase {
	return &CreateSpaceUseCase{repo: r, provisioner: p}
}

type CreateSpaceInput struct {
	WorkspaceID string
	// Key は空でよい。空なら自動採番する（ワークスペースの slug と同じ方針）。
	Key  string
	Name string
	// Visibility は空なら 'workspace'（今までどおりの共有スペース）。
	Visibility domain.SpaceVisibility
	// CreatorUserID は作成者。private のときに要る（space_grant(admin) を張らないと
	// 作った本人にも見えない）。
	CreatorUserID uint64
}

func (u *CreateSpaceUseCase) Execute(ctx context.Context, in CreateSpaceInput) (*domain.Space, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.Visibility == "" {
		in.Visibility = domain.SpaceVisibilityWorkspace
	}
	if !domain.ValidSpaceVisibility(in.Visibility) {
		return nil, ErrInvalidSpaceVisibility
	}
	if in.Visibility == domain.SpaceVisibilityPrivate && in.CreatorUserID == 0 {
		return nil, errors.New("creatorUserID is required for private space")
	}
	autoKey := in.Key == ""
	if autoKey {
		in.Key = generatedURLKey("s")
	}
	if !domain.ValidSpaceKey(in.Key) {
		return nil, ErrInvalidSpaceKey
	}
	if !validDisplayName(in.Name, domain.SpaceNameMaxLen) {
		return nil, ErrInvalidName
	}
	for {
		space, err := u.createOnce(ctx, in)
		// 自動採番の衝突は引き直す（ワークスペースの slug と同じ方針）。
		if autoKey && errors.Is(err, repository.ErrSpaceKeyTaken) {
			in.Key = generatedURLKey("s")
			continue
		}
		if err != nil {
			return nil, err
		}
		return space, nil
	}
}

// createOnce は 1 回分の作成。private は provisioner（grant とセット）、
// workspace は今までどおり repo の単発 INSERT。
func (u *CreateSpaceUseCase) createOnce(ctx context.Context, in CreateSpaceInput) (*domain.Space, error) {
	if in.Visibility == domain.SpaceVisibilityPrivate {
		return u.provisioner.ProvisionPrivateSpace(ctx, repository.PrivateSpaceProvisionInput{
			WorkspaceID:   in.WorkspaceID,
			Key:           in.Key,
			Name:          in.Name,
			CreatorUserID: in.CreatorUserID,
		})
	}
	space := &domain.Space{
		WorkspaceID: in.WorkspaceID,
		Key:         in.Key,
		Name:        in.Name,
		Visibility:  domain.SpaceVisibilityWorkspace,
	}
	if err := u.repo.CreateSpace(ctx, space); err != nil {
		return nil, err
	}
	return space, nil
}

// RenameSpaceUseCase はスペースの表示名だけを変える。
// key は変えない — key は URL・識別の一部で、変えると共有済みの場所が全部外れる。
// 誰が変えられるかの判定は handler が CheckSpacePermissionUseCase で先に行う。
type RenameSpaceUseCase struct {
	repo repository.KnowledgeBaseRepository
}

func NewRenameSpaceUseCase(r repository.KnowledgeBaseRepository) *RenameSpaceUseCase {
	return &RenameSpaceUseCase{repo: r}
}

type RenameSpaceInput struct {
	WorkspaceID string
	SpaceID     string
	Name        string
}

func (u *RenameSpaceUseCase) Execute(ctx context.Context, in RenameSpaceInput) (*domain.Space, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.SpaceID == "" {
		return nil, errors.New("spaceID is required")
	}
	if !validDisplayName(in.Name, domain.SpaceNameMaxLen) {
		return nil, ErrInvalidName
	}
	if err := u.repo.UpdateSpaceName(ctx, in.WorkspaceID, in.SpaceID, in.Name); err != nil {
		return nil, err
	}
	// 更新後の姿を読み直して返す（updated_at は DB の now() が入るため、書いた値では作れない）。
	return u.repo.FindSpace(ctx, in.WorkspaceID, in.SpaceID)
}
