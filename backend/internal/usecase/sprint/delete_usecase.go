package sprint

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// DeleteSprintUseCase はスプリントを消す。
//
// 入っていたチケットは消えない —— ticket_sprint_ranks の行が複合 FK の CASCADE で
// 一緒に消えるだけで、バックログの並び（ticket_backlog_ranks）は元のまま残る。
// つまり「スプリントを消す = 中身をバックログへ戻す」になる。
type DeleteSprintUseCase struct {
	repo repository.SprintRepository
}

func NewDeleteSprintUseCase(r repository.SprintRepository) *DeleteSprintUseCase {
	return &DeleteSprintUseCase{repo: r}
}

func (u *DeleteSprintUseCase) Execute(ctx context.Context, workspaceID, sprintID string) error {
	if workspaceID == "" || sprintID == "" {
		return errors.New("workspaceID and sprintID are required")
	}
	return u.repo.DeleteSprint(ctx, workspaceID, sprintID)
}
