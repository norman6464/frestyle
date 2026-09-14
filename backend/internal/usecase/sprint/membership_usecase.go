package sprint

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/pkg/fracindex"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ErrSprintClosed は終わったスプリントの中身を変えようとした。handler は 409 に畳む。
var ErrSprintClosed = errors.New("sprint is completed")

// AddTicketToSprintUseCase はチケットをスプリントへ入れる（末尾に置く）。
// 既に別のスプリントへ入っていれば移動になる（表の PK が 1 件 1 スプリントを保証する）。
type AddTicketToSprintUseCase struct {
	repo repository.SprintRepository
}

func NewAddTicketToSprintUseCase(r repository.SprintRepository) *AddTicketToSprintUseCase {
	return &AddTicketToSprintUseCase{repo: r}
}

func (u *AddTicketToSprintUseCase) Execute(ctx context.Context, workspaceID, sprintID, ticketID string) error {
	if workspaceID == "" || sprintID == "" || ticketID == "" {
		return errors.New("workspaceID, sprintID and ticketID are required")
	}
	s, err := u.repo.FindSprint(ctx, workspaceID, sprintID)
	if err != nil {
		return err
	}
	// 終わったスプリントは記録なので、後から中身を足させない。
	if s.State == domain.SprintStateCompleted {
		return ErrSprintClosed
	}
	last, err := u.repo.LastTicketSprintRankPosition(ctx, workspaceID, sprintID)
	if err != nil {
		return err
	}
	pos, err := fracindex.Between(last, "")
	if err != nil {
		return err
	}
	return u.repo.AddTicketToSprint(ctx, workspaceID, sprintID, ticketID, pos)
}

// RemoveTicketFromSprintUseCase はチケットをスプリントから外す（バックログへ戻る）。
type RemoveTicketFromSprintUseCase struct {
	repo repository.SprintRepository
}

func NewRemoveTicketFromSprintUseCase(r repository.SprintRepository) *RemoveTicketFromSprintUseCase {
	return &RemoveTicketFromSprintUseCase{repo: r}
}

func (u *RemoveTicketFromSprintUseCase) Execute(ctx context.Context, workspaceID, ticketID string) error {
	if workspaceID == "" || ticketID == "" {
		return errors.New("workspaceID and ticketID are required")
	}
	return u.repo.RemoveTicketFromSprint(ctx, workspaceID, ticketID)
}

// ListSprintTicketIDsUseCase はスプリントに入っているチケットの ID を並び順で返す。
type ListSprintTicketIDsUseCase struct {
	repo repository.SprintRepository
}

func NewListSprintTicketIDsUseCase(r repository.SprintRepository) *ListSprintTicketIDsUseCase {
	return &ListSprintTicketIDsUseCase{repo: r}
}

func (u *ListSprintTicketIDsUseCase) Execute(ctx context.Context, workspaceID, sprintID string) ([]string, error) {
	if workspaceID == "" || sprintID == "" {
		return nil, errors.New("workspaceID and sprintID are required")
	}
	return u.repo.ListSprintTicketIDs(ctx, workspaceID, sprintID)
}
