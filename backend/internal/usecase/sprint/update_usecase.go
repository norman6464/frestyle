package sprint

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// UpdateSprintUseCase は名前と期間を直す。状態は触らない（ChangeSprintStateUseCase の仕事）。
type UpdateSprintUseCase struct {
	repo repository.SprintRepository
}

func NewUpdateSprintUseCase(r repository.SprintRepository) *UpdateSprintUseCase {
	return &UpdateSprintUseCase{repo: r}
}

type UpdateSprintInput struct {
	WorkspaceID string
	SprintID    string
	Name        string
	StartDate   *string
	EndDate     *string
}

func (u *UpdateSprintUseCase) Execute(ctx context.Context, in UpdateSprintInput) (*domain.Sprint, error) {
	if in.WorkspaceID == "" || in.SprintID == "" {
		return nil, errors.New("workspaceID and sprintID are required")
	}
	if !domain.ValidSprintName(in.Name) || !domain.ValidSprintPeriod(in.StartDate, in.EndDate) {
		return nil, ErrInvalidSprint
	}
	return u.repo.UpdateSprint(ctx, in.WorkspaceID, in.SprintID, in.Name, in.StartDate, in.EndDate)
}
