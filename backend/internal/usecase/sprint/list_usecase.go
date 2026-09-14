package sprint

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// SprintWithCount はスプリント 1 件と、その中のチケット件数。
// 一覧の見出しに「（N 件の作業項目）」を出すためだけの値で、中身までは持たない。
type SprintWithCount struct {
	Sprint      domain.Sprint
	TicketCount int64
}

// ListSprintsUseCase はプロジェクトのスプリントを並び順で返す。
type ListSprintsUseCase struct {
	repo repository.SprintRepository
}

func NewListSprintsUseCase(r repository.SprintRepository) *ListSprintsUseCase {
	return &ListSprintsUseCase{repo: r}
}

func (u *ListSprintsUseCase) Execute(ctx context.Context, workspaceID, projectID string) ([]SprintWithCount, error) {
	if workspaceID == "" || projectID == "" {
		return nil, errors.New("workspaceID and projectID are required")
	}
	sprints, err := u.repo.ListSprints(ctx, workspaceID, projectID)
	if err != nil {
		return nil, err
	}
	out := make([]SprintWithCount, 0, len(sprints))
	for _, s := range sprints {
		// 件数はスプリントごとに 1 回ずつ数える。実データでスプリントは 1 プロジェクトに
		// 数個なので、いまはこれで足りる（数十に増えたらまとめて数える問い合わせにする）。
		n, err := u.repo.CountSprintTickets(ctx, workspaceID, s.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, SprintWithCount{Sprint: s, TicketCount: n})
	}
	return out, nil
}
