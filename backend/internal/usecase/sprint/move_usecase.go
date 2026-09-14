package sprint

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/pkg/fracindex"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ErrSprintMoveAnchorNotSibling は「隣のチケット」が同じスプリントに入っていなかった。
//
// 黙って末尾へ落とさない —— 利用者が置いた場所と違う場所に入り、しかも成功したように
// 見えるため（バックログの MoveTicketUseCase と同じ方針）。断ってやり直させる。
var ErrSprintMoveAnchorNotSibling = errors.New("anchor ticket is not in the same sprint")

// MoveTicketInSprintUseCase はスプリントの中での並び順を変える。
//
// バックログの並び（ticket_backlog_ranks）とは別の表を触る。同じチケットが
// 「バックログでの順番」と「スプリントの中での順番」を同時に持てるのは、文脈ごとに
// 表を分けているから（schema.hcl の ticket_backlog_ranks のコメント参照）。
type MoveTicketInSprintUseCase struct {
	repo repository.SprintRepository
}

func NewMoveTicketInSprintUseCase(r repository.SprintRepository) *MoveTicketInSprintUseCase {
	return &MoveTicketInSprintUseCase{repo: r}
}

type MoveTicketInSprintInput struct {
	WorkspaceID string
	TicketID    string
	// AnchorTicketID が nil なら末尾へ。指定があればその手前／直後へ置く。
	AnchorTicketID *string
	AnchorAfter    bool
}

func (u *MoveTicketInSprintUseCase) Execute(ctx context.Context, in MoveTicketInSprintInput) error {
	if in.WorkspaceID == "" || in.TicketID == "" {
		return errors.New("workspaceID and ticketID are required")
	}
	current, err := u.repo.FindTicketSprint(ctx, in.WorkspaceID, in.TicketID)
	if err != nil {
		return err
	}
	// 終わったスプリントの中身は記録なので動かさせない（入れる・外すと同じ扱い）。
	s, err := u.repo.FindSprint(ctx, in.WorkspaceID, current.SprintID)
	if err != nil {
		return err
	}
	if s.State == domain.SprintStateCompleted {
		return ErrSprintClosed
	}

	pos, err := u.placementPosition(ctx, in, current.SprintID)
	if err != nil {
		return err
	}
	return u.repo.MoveTicketSprintRank(ctx, in.WorkspaceID, in.TicketID, pos)
}

func (u *MoveTicketInSprintUseCase) placementPosition(ctx context.Context, in MoveTicketInSprintInput, sprintID string) (string, error) {
	if in.AnchorTicketID == nil {
		last, err := u.repo.LastTicketSprintRankPosition(ctx, in.WorkspaceID, sprintID)
		if err != nil {
			return "", err
		}
		return fracindex.Between(last, "")
	}

	// 「隣の前後へ何を挟むか」を専用クエリでは持たないので、並びを読んで自分で探す。
	// 1 スプリントのチケット数はせいぜい数十なので、一覧を読む実装で足りる。
	ranks, err := u.repo.ListSprintTicketRanks(ctx, in.WorkspaceID, sprintID)
	if err != nil {
		return "", err
	}
	idx := -1
	for i, r := range ranks {
		if r.TicketID == *in.AnchorTicketID {
			idx = i
			break
		}
	}
	if idx < 0 {
		return "", ErrSprintMoveAnchorNotSibling
	}
	anchorPos := ranks[idx].Position
	if in.AnchorAfter {
		next := ""
		if idx+1 < len(ranks) {
			next = ranks[idx+1].Position
		}
		return fracindex.Between(anchorPos, next)
	}
	prev := ""
	if idx > 0 {
		prev = ranks[idx-1].Position
	}
	return fracindex.Between(prev, anchorPos)
}
