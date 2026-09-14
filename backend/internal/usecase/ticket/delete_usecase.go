package ticket

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/pkg/fracindex"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

var (
	deletedTrue  = "true"
	deletedFalse = "false"
)

// recordDeletedChange は deleted フィールドの変更履歴を書く（recordArchivedChange の
// deleted 版。同じ形だが field 定数が違うので関数を分ける）。
func recordDeletedChange(
	ctx context.Context, repo repository.TicketRepository,
	workspaceID, ticketID string, actorUserID uint64, oldValue, newValue *string,
) error {
	return repo.InsertTicketChangeGroup(ctx, &domain.TicketChangeGroup{
		WorkspaceID: workspaceID,
		TicketID:    ticketID,
		ActorUserID: actorUserID,
		Items: []domain.TicketChangeItem{
			{Field: domain.TicketChangeFieldDeleted, OldValue: oldValue, NewValue: newValue},
		},
	})
}

// DeleteTicketUseCase はチケットを「消えたことにする」（設計 Ⅳ-J）。archived_at とは別の
// 独立した列で、戻す口は RestoreDeletedTicketUseCase だけ（archived_at のように一覧から
// 外すだけではなく、URL 直打ちでも見えなくなる）。
type DeleteTicketUseCase struct {
	repo repository.TicketRepository
}

func NewDeleteTicketUseCase(r repository.TicketRepository) *DeleteTicketUseCase {
	return &DeleteTicketUseCase{repo: r}
}

type DeleteTicketInput struct {
	WorkspaceID string
	TicketID    string
	ActorUserID uint64
}

func (u *DeleteTicketUseCase) Execute(ctx context.Context, in DeleteTicketInput) error {
	if in.WorkspaceID == "" {
		return errors.New("workspaceID is required")
	}
	if in.TicketID == "" {
		return errors.New("ticketID is required")
	}
	if in.ActorUserID == 0 {
		return errors.New("actorUserID is required")
	}
	if err := u.repo.DeleteTicket(ctx, in.WorkspaceID, in.TicketID); err != nil {
		return err
	}
	// 本文からの参照（派生索引）を一緒に隠す。ページ側の逆参照一覧・別チケットの
	// 逆参照一覧に、消えたはずのチケットが残らないようにする（設計 Ⅳ-J の
	// 「読み出しの述語を単純に保つ」）。担当・履歴は GetTicket 自体が deleted_at を
	// 見て 404 にするので、これ以上の伝播は不要（読み出しがすべてチケット単位の
	// ゲートを通ってから子表へ進む形になっているため）。
	if err := u.repo.DeleteTicketPageLinksBySourceCascade(ctx, in.WorkspaceID, in.TicketID); err != nil {
		return err
	}
	if err := u.repo.DeleteTicketTicketLinksBySourceCascade(ctx, in.WorkspaceID, in.TicketID); err != nil {
		return err
	}
	return recordDeletedChange(ctx, u.repo, in.WorkspaceID, in.TicketID, in.ActorUserID, &deletedFalse, &deletedTrue)
}

// FindDeletedTicketUseCase は削除済みチケットの所属プロジェクトを解決する。
// RestoreDeletedTicketUseCase の直前、権限判定（プロジェクト単位）が対象のプロジェクト ID を
// 要るために使う（CreateTicketUseCase の Enable と同じ「対象がまだ見えない操作」の形）。
type FindDeletedTicketUseCase struct {
	repo repository.TicketRepository
}

func NewFindDeletedTicketUseCase(r repository.TicketRepository) *FindDeletedTicketUseCase {
	return &FindDeletedTicketUseCase{repo: r}
}

func (u *FindDeletedTicketUseCase) Execute(ctx context.Context, workspaceID, ticketID string) (*domain.Ticket, error) {
	if workspaceID == "" || ticketID == "" {
		return nil, repository.ErrTicketNotDeleted
	}
	return u.repo.FindDeletedTicket(ctx, workspaceID, ticketID)
}

// RestoreDeletedTicketUseCase は削除済みチケットを現役へ戻す。position は末尾へ付け直す
// （RestoreTicketUseCase と同じ理由）。
type RestoreDeletedTicketUseCase struct {
	repo repository.TicketRepository
}

func NewRestoreDeletedTicketUseCase(r repository.TicketRepository) *RestoreDeletedTicketUseCase {
	return &RestoreDeletedTicketUseCase{repo: r}
}

type RestoreDeletedTicketInput struct {
	WorkspaceID string
	TicketID    string
	ActorUserID uint64
}

func (u *RestoreDeletedTicketUseCase) Execute(ctx context.Context, in RestoreDeletedTicketInput) (*domain.Ticket, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.TicketID == "" {
		return nil, errors.New("ticketID is required")
	}
	if in.ActorUserID == 0 {
		return nil, errors.New("actorUserID is required")
	}
	t, err := u.repo.FindDeletedTicket(ctx, in.WorkspaceID, in.TicketID)
	if err != nil {
		return nil, err
	}
	if err := u.repo.RestoreDeletedTicket(ctx, in.WorkspaceID, in.TicketID); err != nil {
		return nil, err
	}
	// 並び順は末尾へ付け直す（削除されていた間に他のチケットの並びが進んでいる可能性が
	// あるため、元の位置は復元しない）。upsert なのは、この表より前に作られて削除済み
	// だったチケットには並び順の行が無いため（移行では現役の分だけ入れた）。
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
	if err := recordDeletedChange(ctx, u.repo, in.WorkspaceID, in.TicketID, in.ActorUserID, &deletedTrue, &deletedFalse); err != nil {
		return nil, err
	}
	return u.repo.FindTicket(ctx, in.WorkspaceID, in.TicketID)
}
