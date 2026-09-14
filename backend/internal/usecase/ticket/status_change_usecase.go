package ticket

import (
	"context"
	"errors"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ChangeTicketStatusUseCase はチケットの状態を変える。
//
// closed_at / resolution は新しい状態の category から必ず導く
// （domain.ResolveTicketClosedFields）。呼び出し側が指定できる Resolution は
// 「category=done のときに使う候補」でしかなく、done 以外へ変わるときは黙って無視する
// （state=todo なのに resolution が入った矛盾行を作らせないため）。
type ChangeTicketStatusUseCase struct {
	repo repository.TicketRepository
}

func NewChangeTicketStatusUseCase(r repository.TicketRepository) *ChangeTicketStatusUseCase {
	return &ChangeTicketStatusUseCase{repo: r}
}

type ChangeTicketStatusInput struct {
	WorkspaceID string
	TicketID    string
	StatusID    string
	// Resolution は category=done のときだけ使う（未指定なら domain.TicketResolutionDone）。
	Resolution  *domain.TicketResolution
	ActorUserID uint64
}

func (u *ChangeTicketStatusUseCase) Execute(ctx context.Context, in ChangeTicketStatusInput) (*domain.Ticket, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.TicketID == "" {
		return nil, errors.New("ticketID is required")
	}
	if in.StatusID == "" {
		return nil, errors.New("statusID is required")
	}
	if in.ActorUserID == 0 {
		return nil, errors.New("actorUserID is required")
	}

	before, err := u.repo.FindTicket(ctx, in.WorkspaceID, in.TicketID)
	if err != nil {
		return nil, err
	}
	newStatus, err := u.repo.FindTicketStatus(ctx, in.WorkspaceID, before.ProjectID, in.StatusID)
	if err != nil {
		return nil, err
	}

	unchanged := before.StatusID == in.StatusID
	var oldStatus *domain.TicketStatus
	if !unchanged {
		oldStatus, err = u.repo.FindTicketStatus(ctx, in.WorkspaceID, before.ProjectID, before.StatusID)
		if err != nil {
			return nil, err
		}
	}

	closedAt, resolution := domain.ResolveTicketClosedFields(newStatus.Category, in.Resolution, time.Now())
	updated, err := u.repo.ChangeTicketStatus(ctx, in.WorkspaceID, in.TicketID, in.StatusID, closedAt, resolution)
	if err != nil {
		return nil, err
	}

	if !unchanged {
		if err := u.recordStatusChange(ctx, in.WorkspaceID, in.TicketID, in.ActorUserID, oldStatus, newStatus); err != nil {
			return nil, err
		}
		// ticket_status_transitions は ticket_change_items（人が読む履歴）とは別の専用ログ
		// （設計 Ⅵ）。同じ状態変更の一部として両方へ書く。
		if err := u.repo.InsertTicketStatusTransition(
			ctx, in.WorkspaceID, before.ProjectID, in.TicketID, oldStatus.ID, newStatus.ID, in.ActorUserID,
		); err != nil {
			return nil, err
		}
	}
	return updated, nil
}

func (u *ChangeTicketStatusUseCase) recordStatusChange(
	ctx context.Context, workspaceID, ticketID string, actorUserID uint64,
	oldStatus, newStatus *domain.TicketStatus,
) error {
	oldValue, newValue := oldStatus.ID, newStatus.ID
	oldLabel, newLabel := oldStatus.Name, newStatus.Name
	group := &domain.TicketChangeGroup{
		WorkspaceID: workspaceID,
		TicketID:    ticketID,
		ActorUserID: actorUserID,
		Items: []domain.TicketChangeItem{
			{
				Field:    domain.TicketChangeFieldStatus,
				OldValue: &oldValue, NewValue: &newValue,
				OldLabel: &oldLabel, NewLabel: &newLabel,
			},
		},
	}
	return u.repo.InsertTicketChangeGroup(ctx, group)
}
