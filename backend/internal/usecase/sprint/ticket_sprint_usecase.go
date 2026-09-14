package sprint

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// FindTicketSprintUseCase は「このチケットはどのスプリントに入っているか」を返す。
//
// 入れる・外す・並べ替えるだけの口はあったが、**読む口が無かった**ため、チケットの詳細で
// スプリント名を出せなかった。入っていなければ nil を返す（無いことは異常ではない）。
type FindTicketSprintUseCase struct {
	repo repository.SprintRepository
}

func NewFindTicketSprintUseCase(r repository.SprintRepository) *FindTicketSprintUseCase {
	return &FindTicketSprintUseCase{repo: r}
}

func (u *FindTicketSprintUseCase) Execute(ctx context.Context, workspaceID, ticketID string) (*domain.Sprint, error) {
	if workspaceID == "" || ticketID == "" {
		return nil, errors.New("workspaceID and ticketID are required")
	}
	rank, err := u.repo.FindTicketSprint(ctx, workspaceID, ticketID)
	if err != nil {
		return nil, err
	}
	if rank == nil {
		return nil, nil
	}
	// 名前や状態は sprints 側にしかないので、改めて 1 件引く。
	return u.repo.FindSprint(ctx, workspaceID, rank.SprintID)
}
