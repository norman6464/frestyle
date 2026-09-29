package profile

import (
	"context"
	"errors"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// GetProfileUseCase は指定 user のプロフィール表示情報を返す。
type GetProfileUseCase struct {
	profiles repository.ProfileRepository
	users    repository.UserRepository
}

func NewGetProfileUseCase(
	profiles repository.ProfileRepository,
	users repository.UserRepository,
) *GetProfileUseCase {
	return &GetProfileUseCase{
		profiles: profiles,
		users:    users,
	}
}

func (u *GetProfileUseCase) Execute(ctx context.Context, userID uint64) (*domain.ProfileView, error) {
	if userID == 0 {
		return nil, errors.New("userID is required")
	}
	p, err := u.profiles.FindByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}

	user, err := u.users.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	return composeProfileView(userID, p, user), nil
}

func composeProfileView(userID uint64, p *domain.Profile, user *domain.User) *domain.ProfileView {
	view := &domain.ProfileView{
		UserID: userID,
	}

	if p != nil {
		view.Bio = p.Bio
		view.AvatarURL = p.AvatarURL
		view.StatusText = p.StatusText
		view.StatusEmoji = p.StatusEmoji
		view.StatusExpiresAt = p.StatusExpiresAt
		view.UpdatedAt = p.UpdatedAt
	}

	if user != nil {
		view.Name = user.Name
		view.Email = user.Email
	}

	return view
}

// UpdateProfileUseCase は氏名とプロフィールを更新し、プロフィール表示情報を返す。
type UpdateProfileUseCase struct {
	profiles repository.ProfileRepository
	users    repository.UserRepository
}

func NewUpdateProfileUseCase(
	profiles repository.ProfileRepository,
	users repository.UserRepository,
) *UpdateProfileUseCase {
	return &UpdateProfileUseCase{
		profiles: profiles,
		users:    users,
	}
}

type UpdateProfileInput struct {
	UserID     uint64
	Bio        string
	Name       string
	AvatarURL  string
	StatusText string
}

func (u *UpdateProfileUseCase) Execute(ctx context.Context, input UpdateProfileInput) (*domain.ProfileView, error) {
	if input.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	if input.Name != "" {
		if err := u.users.UpdateName(ctx, input.UserID, input.Name); err != nil {
			return nil, err
		}
	}
	p := &domain.Profile{
		UserID:     input.UserID,
		Bio:        input.Bio,
		AvatarURL:  input.AvatarURL,
		StatusText: input.StatusText,
	}
	if err := u.profiles.Upsert(ctx, p); err != nil {
		return nil, err
	}
	updatedProfile, err := u.profiles.FindByUserID(ctx, input.UserID)
	if err != nil {
		return nil, err
	}
	user, err := u.users.FindByID(ctx, input.UserID)
	if err != nil {
		return nil, err
	}
	return composeProfileView(input.UserID, updatedProfile, user), nil
}

// UpdateStatusInput は PUT /me/status の入力（段 14）。絵文字・テキスト・失効時刻だけを
// 扱う。bio / avatarURL には触れない（UpdateProfileUseCase の専管。互いの担当を混ぜない）。
type UpdateStatusInput struct {
	UserID    uint64
	Emoji     string
	Text      string
	ExpiresAt *time.Time
}

// UpdateStatusUseCase は一言ステータス（絵文字・テキスト・失効時刻）だけを upsert する。
type UpdateStatusUseCase struct {
	profiles repository.ProfileRepository
}

func NewUpdateStatusUseCase(p repository.ProfileRepository) *UpdateStatusUseCase {
	return &UpdateStatusUseCase{profiles: p}
}

func (u *UpdateStatusUseCase) Execute(ctx context.Context, in UpdateStatusInput) (*domain.Profile, error) {
	if in.UserID == 0 {
		return nil, errors.New("userID is required")
	}
	return u.profiles.UpdateStatus(ctx, in.UserID, in.Emoji, in.Text, in.ExpiresAt)
}

// ListMyIdentitiesUseCase は本人の認証方法一覧を返す（段 14。表示専用）。
type ListMyIdentitiesUseCase struct {
	identities repository.UserOidcIdentityRepository
}

func NewListMyIdentitiesUseCase(r repository.UserOidcIdentityRepository) *ListMyIdentitiesUseCase {
	return &ListMyIdentitiesUseCase{identities: r}
}

func (u *ListMyIdentitiesUseCase) Execute(ctx context.Context, userID uint64) ([]domain.UserIdentity, error) {
	if userID == 0 {
		return nil, errors.New("userID is required")
	}
	return u.identities.ListByUserID(ctx, userID)
}

// IssueProfileImageUploadURLUseCase は profile アイコン用 PUT 署名付き URL を発行する。
type IssueProfileImageUploadURLUseCase struct {
	presigner repository.ProfileImagePresigner
}

func NewIssueProfileImageUploadURLUseCase(p repository.ProfileImagePresigner) *IssueProfileImageUploadURLUseCase {
	return &IssueProfileImageUploadURLUseCase{presigner: p}
}

func (u *IssueProfileImageUploadURLUseCase) Execute(ctx context.Context, userID uint64, contentType string, size int64) (*domain.ProfileImageUploadURL, error) {
	if userID == 0 {
		return nil, errors.New("userID is required")
	}
	return u.presigner.Generate(ctx, userID, contentType, size)
}
