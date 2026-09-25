package ticket

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/pkg/fracindex"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ErrTicketMoveAnchorNotSibling は move で指定された「隣のチケット」が、移動先の
// 現役の兄弟（同じプロジェクト・アーカイブされていない）で無かったときに返す。
// 不在・別プロジェクト・アーカイブ済みを区別しない。
//
// 黙って末尾へ落とさないのは、**利用者が落とした場所と違う場所に入り、しかも
// 成功したように見える**ため（page の MovePageUseCase と同じ方針）。断って、
// やり直せるようにする。
var ErrTicketMoveAnchorNotSibling = errors.New("anchor ticket is not a sibling")

// MoveTicketUseCase はチケットの並び順を変える。
type MoveTicketUseCase struct {
	repo repository.TicketRepository
}

func NewMoveTicketUseCase(r repository.TicketRepository) *MoveTicketUseCase {
	return &MoveTicketUseCase{repo: r}
}

type MoveTicketInput struct {
	WorkspaceID string
	TicketID    string
	// AnchorTicketID が nil なら末尾に置く。指定があれば、そのチケットの手前／直後に置く
	// （AnchorAfter で切り替え。ページの Anchor/AnchorBefore と同じ形だが、こちらは
	// 「直後」を既定の意味に取り違えないよう AnchorAfter という肯定形の名前にしている）。
	AnchorTicketID *string
	AnchorAfter    bool
}

func (u *MoveTicketUseCase) Execute(ctx context.Context, in MoveTicketInput) error {
	if in.WorkspaceID == "" {
		return errors.New("workspaceID is required")
	}
	if in.TicketID == "" {
		return errors.New("ticketID is required")
	}
	t, err := u.repo.FindTicket(ctx, in.WorkspaceID, in.TicketID)
	if err != nil {
		return err
	}

	pos, err := u.placementPosition(ctx, in, t.ProjectID)
	if err != nil {
		return err
	}
	// 並び順の正本は ticket_backlog_ranks だけ（tickets.position は撤去済み）。
	return u.repo.MoveTicketRank(ctx, in.WorkspaceID, in.TicketID, pos)
}

func (u *MoveTicketUseCase) placementPosition(ctx context.Context, in MoveTicketInput, projectID string) (string, error) {
	if in.AnchorTicketID == nil {
		last, err := u.repo.LastTicketRankPosition(ctx, in.WorkspaceID, projectID)
		if err != nil {
			return "", err
		}
		return fracindex.Between(last, "")
	}

	// 「隣の直後/直前にどのキーを挟むか」を専用クエリでは持っていないため、現役の一覧
	// （position 順）をここで読み、アンカーの前後を自分で探す。ワークスペース内のチケット数は
	// 実データで数百件規模（設計 artifact Ⅱ）なので、一覧をそのまま読む実装で十分間に合う。
	list, err := u.repo.ListTickets(ctx, repository.ListTicketsInput{
		WorkspaceID: in.WorkspaceID, ProjectID: projectID,
	})
	if err != nil {
		return "", err
	}
	tickets := list.Items
	idx := -1
	for i, tk := range tickets {
		if tk.Ticket.ID == *in.AnchorTicketID {
			idx = i
			break
		}
	}
	if idx < 0 {
		return "", ErrTicketMoveAnchorNotSibling
	}
	anchorPos := tickets[idx].Ticket.Position
	if in.AnchorAfter {
		next := ""
		if idx+1 < len(tickets) {
			next = tickets[idx+1].Ticket.Position
		}
		return fracindex.Between(anchorPos, next)
	}
	prev := ""
	if idx > 0 {
		prev = tickets[idx-1].Ticket.Position
	}
	return fracindex.Between(prev, anchorPos)
}
