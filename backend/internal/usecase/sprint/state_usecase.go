package sprint

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ErrSprintStateTransition は許していない状態の移り方（戻す・飛ばす）。handler は 409 に畳む。
var ErrSprintStateTransition = errors.New("invalid sprint state transition")

// ErrActiveSprintExists は進行中のスプリントが既にある。handler は 409 に畳む。
var ErrActiveSprintExists = errors.New("active sprint already exists")

// ChangeSprintStateUseCase はスプリントを開始・完了する。
//
// 「開始」と「完了」を別の口にせず 1 つにまとめているのは、どちらも同じ規則
// （進む向きにしか動かさない）で守られるため。分けると規則が 2 か所になる。
type ChangeSprintStateUseCase struct {
	repo repository.SprintRepository
}

func NewChangeSprintStateUseCase(r repository.SprintRepository) *ChangeSprintStateUseCase {
	return &ChangeSprintStateUseCase{repo: r}
}

type ChangeSprintStateInput struct {
	WorkspaceID string
	SprintID    string
	State       domain.SprintState
}

func (u *ChangeSprintStateUseCase) Execute(ctx context.Context, in ChangeSprintStateInput) (*domain.Sprint, error) {
	if in.WorkspaceID == "" || in.SprintID == "" {
		return nil, errors.New("workspaceID and sprintID are required")
	}
	if !in.State.Valid() {
		return nil, ErrSprintStateTransition
	}
	current, err := u.repo.FindSprint(ctx, in.WorkspaceID, in.SprintID)
	if err != nil {
		return nil, err
	}
	if !current.State.CanTransitionTo(in.State) {
		return nil, ErrSprintStateTransition
	}
	// 進行中は 1 つまで。DB の制約にはしていない —— 表の形で禁じると「例外的に 2 本走らせたい」
	// が出たときに移行が要る。規則としてはここで守り、破りたくなったらここだけ直す。
	if in.State == domain.SprintStateActive {
		n, err := u.repo.CountActiveSprints(ctx, in.WorkspaceID, current.ProjectID)
		if err != nil {
			return nil, err
		}
		if n > 0 {
			return nil, ErrActiveSprintExists
		}
	}
	updated, err := u.repo.ChangeSprintState(
		ctx,
		in.WorkspaceID,
		in.SprintID,
		current.State,
		in.State,
	)

	if errors.Is(err, repository.ErrSprintStateConflict) {
		return nil, ErrSprintStateTransition
	}
	if errors.Is(err, repository.ErrActiveSprintAlreadyExists) {
		return nil, ErrActiveSprintExists
	}

	if err != nil {
		return nil, err
	}

	return updated, nil
}
