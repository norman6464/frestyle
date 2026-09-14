package sprint

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/pkg/fracindex"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ErrInvalidSprint は名前や期間が保存してよい形になっていない。handler は 400 に畳む。
var ErrInvalidSprint = errors.New("invalid sprint")

// CreateSprintUseCase はプロジェクトにスプリントを 1 つ足す。
// 作った直後は必ず planned（開始は ChangeSprintStateUseCase の仕事）。
type CreateSprintUseCase struct {
	repo repository.SprintRepository
}

func NewCreateSprintUseCase(r repository.SprintRepository) *CreateSprintUseCase {
	return &CreateSprintUseCase{repo: r}
}

type CreateSprintInput struct {
	WorkspaceID string
	ProjectID   string
	Name        string
	// StartDate / EndDate は 'YYYY-MM-DD'。計画中は未定でよいので nil を取る。
	StartDate *string
	EndDate   *string
}

func (u *CreateSprintUseCase) Execute(ctx context.Context, in CreateSprintInput) (*domain.Sprint, error) {
	if in.WorkspaceID == "" || in.ProjectID == "" {
		return nil, errors.New("workspaceID and projectID are required")
	}
	if !domain.ValidSprintName(in.Name) {
		return nil, ErrInvalidSprint
	}
	if !domain.ValidSprintPeriod(in.StartDate, in.EndDate) {
		return nil, ErrInvalidSprint
	}
	last, err := u.repo.LastSprintPosition(ctx, in.WorkspaceID, in.ProjectID)
	if err != nil {
		return nil, err
	}
	pos, err := fracindex.Between(last, "")
	if err != nil {
		return nil, err
	}
	s := &domain.Sprint{
		WorkspaceID: in.WorkspaceID, ProjectID: in.ProjectID, Name: in.Name,
		State: domain.SprintStatePlanned, StartDate: in.StartDate, EndDate: in.EndDate, Position: pos,
	}
	if err := u.repo.CreateSprint(ctx, s); err != nil {
		return nil, err
	}
	return s, nil
}
