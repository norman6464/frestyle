package ticket

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// ChangeTicketParentUseCase はチケットの親を変える（トップレベルへ戻すのも含む）。
//
// UpdateTicketUseCase から分けているのは、親の変更だけが「周期を作らない」「深さ最大 3」
// 「階層規則（設計 Ⅳ-D）」という重い検査を持つため（1 usecase 1 責務）。
// title/doc/type/priority/日付は変えない（現在の値をそのまま repository.UpdateTicket へ
// 渡し直す。ParentID だけを書き換える専用の repository メソッドは持たないため）。
type ChangeTicketParentUseCase struct {
	repo repository.TicketRepository
}

func NewChangeTicketParentUseCase(r repository.TicketRepository) *ChangeTicketParentUseCase {
	return &ChangeTicketParentUseCase{repo: r}
}

type ChangeTicketParentInput struct {
	WorkspaceID string
	TicketID    string
	// NewParentID が nil ならトップレベルへ戻す。
	NewParentID *string
	ActorUserID uint64
}

func (u *ChangeTicketParentUseCase) Execute(ctx context.Context, in ChangeTicketParentInput) (*domain.Ticket, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.TicketID == "" {
		return nil, errors.New("ticketID is required")
	}
	if in.ActorUserID == 0 {
		return nil, errors.New("actorUserID is required")
	}

	current, err := u.repo.FindTicket(ctx, in.WorkspaceID, in.TicketID)
	if err != nil {
		return nil, err
	}

	if in.NewParentID != nil && *in.NewParentID == in.TicketID {
		// 自分自身を親にする 1 行の周期。相手を読みに行くまでもなく決まる。
		return nil, domain.ErrTicketHierarchyRejected
	}

	if in.NewParentID != nil {
		if err := u.validateNewParent(ctx, in.WorkspaceID, current, *in.NewParentID); err != nil {
			return nil, err
		}
	}

	updated, err := u.repo.UpdateTicket(ctx, in.WorkspaceID, in.TicketID, repository.TicketUpdateFields{
		TypeID:    current.TypeID,
		ParentID:  in.NewParentID,
		Title:     current.Title,
		Doc:       current.Doc,
		PlainText: current.PlainText,
		Priority:  current.Priority,
		StartDate: current.StartDate,
		DueDate:   current.DueDate,
	})
	if err != nil {
		return nil, err
	}

	if !parentIDsEqual(current.ParentID, in.NewParentID) {
		if err := u.recordParentChange(ctx, in, current.ParentID); err != nil {
			return nil, err
		}
		// ticket_paths（閉包表。段 5）の付け替え。このチケットとその子孫すべてが
		// 対象になる（Detach/Attach 自体がサブツリー全体に効く。page_paths の MovePage と同じ
		// 順序 — Detach → Attach 固定。逆にすると Attach で張った行を Detach が消してしまう）。
		if err := u.repo.DetachTicketPathSubtree(ctx, in.WorkspaceID, in.TicketID); err != nil {
			return nil, err
		}
		if in.NewParentID != nil {
			if err := u.repo.AttachTicketPathSubtree(ctx, in.WorkspaceID, in.TicketID, *in.NewParentID); err != nil {
				return nil, err
			}
		}
	}
	return updated, nil
}

// validateNewParent は新しい親が「同じプロジェクトに実在する」「階層規則を満たす」
// 「周期・深さ超過を作らない」ことを検証する。
func (u *ChangeTicketParentUseCase) validateNewParent(
	ctx context.Context, workspaceID string, current *domain.Ticket, newParentID string,
) error {
	currentType, err := u.repo.FindTicketType(ctx, workspaceID, current.ProjectID, current.TypeID)
	if err != nil {
		return err
	}
	newParent, err := u.repo.FindTicket(ctx, workspaceID, newParentID)
	if err != nil {
		return err
	}
	if newParent.ProjectID != current.ProjectID {
		return repository.ErrTicketNotFound
	}
	newParentType, err := u.repo.FindTicketType(ctx, workspaceID, current.ProjectID, newParent.TypeID)
	if err != nil {
		return err
	}
	if err := domain.ValidateTicketParentChild(currentType.HierarchyLevel, newParentType.HierarchyLevel); err != nil {
		return err
	}

	chain, err := u.repo.ListTicketParentChain(ctx, workspaceID, newParentID)
	if err != nil {
		return err
	}
	for _, ancestor := range chain {
		if ancestor.ID == current.ID {
			// 新しい親の祖先に自分自身がいる ＝ 新しい親は自分の子孫。移すと周期になる。
			return domain.ErrTicketHierarchyRejected
		}
	}
	// 新しい親の深さ = len(chain)+1、自分がその下に入ると +1。
	if len(chain)+2 > TicketMaxDepth {
		return domain.ErrTicketHierarchyRejected
	}
	return nil
}

func (u *ChangeTicketParentUseCase) recordParentChange(
	ctx context.Context, in ChangeTicketParentInput, oldParentID *string,
) error {
	item := domain.TicketChangeItem{Field: domain.TicketChangeFieldParent, OldValue: oldParentID, NewValue: in.NewParentID}
	return u.repo.InsertTicketChangeGroup(ctx, &domain.TicketChangeGroup{
		WorkspaceID: in.WorkspaceID, TicketID: in.TicketID, ActorUserID: in.ActorUserID,
		Items: []domain.TicketChangeItem{item},
	})
}

// parentIDsEqual は 2 つの *string（親 ID）が同じ値を指すかを比べる（両方 nil も含む）。
func parentIDsEqual(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
