package ticket

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/pkg/fracindex"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

var (
	archivedTrue  = "true"
	archivedFalse = "false"
)

// recordArchivedChange は archived フィールドの変更履歴を 1 グループ・1 項目で書く。
// Archive/Restore の両方から呼ぶ共通処理。
func recordArchivedChange(
	ctx context.Context, repo repository.TicketRepository,
	workspaceID, ticketID string, actorUserID uint64, oldValue, newValue *string,
) error {
	return repo.InsertTicketChangeGroup(ctx, &domain.TicketChangeGroup{
		WorkspaceID: workspaceID,
		TicketID:    ticketID,
		ActorUserID: actorUserID,
		Items: []domain.TicketChangeItem{
			{Field: domain.TicketChangeFieldArchived, OldValue: oldValue, NewValue: newValue},
		},
	})
}

// ArchiveTicketUseCase はチケットをアーカイブする（隠すだけで物理削除しない）。
type ArchiveTicketUseCase struct {
	repo repository.TicketRepository
}

func NewArchiveTicketUseCase(r repository.TicketRepository) *ArchiveTicketUseCase {
	return &ArchiveTicketUseCase{repo: r}
}

type ArchiveTicketInput struct {
	WorkspaceID string
	TicketID    string
	ActorUserID uint64
}

func (u *ArchiveTicketUseCase) Execute(ctx context.Context, in ArchiveTicketInput) (*domain.Ticket, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.TicketID == "" {
		return nil, errors.New("ticketID is required")
	}
	if in.ActorUserID == 0 {
		return nil, errors.New("actorUserID is required")
	}
	if err := u.repo.ArchiveTicket(ctx, in.WorkspaceID, in.TicketID); err != nil {
		return nil, err
	}
	if err := recordArchivedChange(ctx, u.repo, in.WorkspaceID, in.TicketID, in.ActorUserID, &archivedFalse, &archivedTrue); err != nil {
		return nil, err
	}
	return u.repo.FindTicket(ctx, in.WorkspaceID, in.TicketID)
}

// RestoreTicketUseCase はアーカイブ済みチケットを現役へ戻す。position は末尾へ付け直す
// （アーカイブ中に他のチケットの並びが進んでいる可能性があるため、元の位置は復元しない）。
type RestoreTicketUseCase struct {
	repo repository.TicketRepository
}

func NewRestoreTicketUseCase(r repository.TicketRepository) *RestoreTicketUseCase {
	return &RestoreTicketUseCase{repo: r}
}

type RestoreTicketInput struct {
	WorkspaceID string
	TicketID    string
	ActorUserID uint64
}

func (u *RestoreTicketUseCase) Execute(ctx context.Context, in RestoreTicketInput) (*domain.Ticket, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.TicketID == "" {
		return nil, errors.New("ticketID is required")
	}
	if in.ActorUserID == 0 {
		return nil, errors.New("actorUserID is required")
	}
	t, err := u.repo.FindTicket(ctx, in.WorkspaceID, in.TicketID)
	if err != nil {
		return nil, err
	}
	if err := u.repo.RestoreTicket(ctx, in.WorkspaceID, in.TicketID); err != nil {
		return nil, err
	}
	// 並び順は末尾へ付け直す。アーカイブされていた間に他のチケットの並びが進んでいる
	// 可能性があるため、元の位置は復元しない（削除からの復元 RestoreDeletedTicketUseCase
	// と同じ扱い）。upsert なのは、この表より前に作られてアーカイブ済みだったチケットには
	// 並び順の行が無いため（移行では現役の分だけ入れた）。
	last, err := u.repo.LastTicketRankPosition(ctx, in.WorkspaceID, t.ProjectID)
	if err != nil {
		return nil, err
	}
	pos, err := fracindex.Between(last, "")
	if err != nil {
		return nil, err
	}
	if err := u.repo.UpsertTicketRank(ctx, in.WorkspaceID, t.ProjectID, in.TicketID, pos); err != nil {
		return nil, err
	}
	if err := recordArchivedChange(ctx, u.repo, in.WorkspaceID, in.TicketID, in.ActorUserID, &archivedTrue, &archivedFalse); err != nil {
		return nil, err
	}
	return u.repo.FindTicket(ctx, in.WorkspaceID, in.TicketID)
}
