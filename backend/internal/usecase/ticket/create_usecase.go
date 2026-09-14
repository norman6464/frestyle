package ticket

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/pkg/fracindex"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// TicketMaxDepth はチケットの親子関係の最大の深さ（設計 Ⅳ-D）。ルート自身が 1。
// 最大 3 段なので閉包表は持たず、ListTicketParentChain で親を辿って数える。
const TicketMaxDepth = 3

// CreateTicketUseCase はプロジェクト直下または親チケットの下に新しいチケットを作る。
type CreateTicketUseCase struct {
	repo      repository.TicketRepository
	txManager repository.TxManager
}

func NewCreateTicketUseCase(r repository.TicketRepository, tx repository.TxManager) *CreateTicketUseCase {
	return &CreateTicketUseCase{repo: r, txManager: tx}
}

type CreateTicketInput struct {
	WorkspaceID string
	ProjectID   string
	// TypeID / StatusID が空なら既定（GetDefaultTicketType / GetInitialTicketStatus）を解決する。
	TypeID   string
	StatusID string
	// ParentID が nil ならトップレベル。
	ParentID        *string
	Title           string
	Doc             string
	Priority        domain.TicketPriority
	StartDate       *string
	DueDate         *string
	CreatedByUserID uint64
}

func (u *CreateTicketUseCase) Execute(ctx context.Context, in CreateTicketInput) (*domain.Ticket, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.ProjectID == "" {
		return nil, errors.New("projectID is required")
	}
	if strings.TrimSpace(in.Title) == "" {
		return nil, domain.ErrInvalidTicketName
	}
	if in.CreatedByUserID == 0 {
		return nil, errors.New("createdByUserID is required")
	}
	if !domain.ValidTicketDateOrder(in.StartDate, in.DueDate) {
		return nil, domain.ErrTicketDateRangeInverted
	}

	typ, err := u.resolveType(ctx, in.WorkspaceID, in.ProjectID, in.TypeID)
	if err != nil {
		return nil, err
	}
	status, err := u.resolveStatus(ctx, in.WorkspaceID, in.ProjectID, in.StatusID)
	if err != nil {
		return nil, err
	}
	if err := u.validateParent(ctx, in.WorkspaceID, in.ProjectID, in.ParentID, typ.HierarchyLevel); err != nil {
		return nil, err
	}

	// 並び順は ticket_backlog_ranks が正本（設計 Ⅳ-F）。位置はそこから 1 回だけ計算する。
	//
	// 以前は 2 か所（tickets / 並び順の表）から別々に最大値を引いて別々に計算していた。
	// 同じ「次の位置」を 2 つの経路で求めると、片方に行が欠けた瞬間に食い違う —— 実際に
	// 本番では並び順の行だけが欠けた状態ができていた。持ち手を 1 つに減らしたので、
	// 今は食い違いようがない。
	lastRank, err := u.repo.LastTicketRankPosition(ctx, in.WorkspaceID, in.ProjectID)
	if err != nil {
		return nil, err
	}
	rankPos, err := fracindex.Between(lastRank, "")
	if err != nil {
		return nil, err
	}

	stripped, err := StripDocRefTitles([]byte(in.Doc))
	if err != nil {
		return nil, fmt.Errorf("invalid doc: %w", err)
	}
	plainText := BuildPlainText(stripped)
	pageIDs, ticketIDs, err := ExtractDocRefs(stripped)
	if err != nil {
		return nil, fmt.Errorf("invalid doc: %w", err)
	}

	priority := in.Priority
	if priority == 0 {
		priority = domain.TicketPriorityDefault
	}

	// 1 件の作成は tickets への INSERT だけでは終わらない（並び順・閉包表・派生表の計 6 本）。
	// 途中で落ちたときに「チケット行だけ在って並び順の行が無い」中途半端な状態を残さないよう、
	// ひとまとまりの取引にする。
	//
	// これは実際に本番で起きた壊れ方でもある —— 旧 ticket_ranks の一意制約が壊れていた頃、
	// 並び順の INSERT だけが落ち、チケットだけが残っていた（読みが tickets.position へ
	// 落ちるため画面上は気づけなかった）。制約そのものは直したが、取引で包んでいなければ
	// 別の理由で同じ壊れ方が起きうる。
	var created *domain.Ticket
	if err := u.txManager.DoInTx(ctx, func(ctx context.Context) error {
		var err error
		created, err = u.repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID:     in.WorkspaceID,
			ProjectID:       in.ProjectID,
			TypeID:          typ.ID,
			StatusID:        status.ID,
			ParentID:        in.ParentID,
			Title:           in.Title,
			Doc:             stripped,
			PlainText:       plainText,
			Priority:        priority,
			StartDate:       in.StartDate,
			DueDate:         in.DueDate,
			CreatedByUserID: in.CreatedByUserID,
		})
		if err != nil {
			return err
		}

		// 並び順の正本（設計 Ⅳ-F）。created.Position を rankPos で埋めるのは、tickets の行からは
		// 並び順が取れない（列を撤去した）ため —— GetTicket が返す position と作成直後の応答を
		// 一致させる。
		if err := u.repo.InsertTicketRank(ctx, in.WorkspaceID, in.ProjectID, created.ID, rankPos); err != nil {
			return err
		}
		created.Position = rankPos

		// ticket_paths（閉包表・段 5）: 自己参照行（depth=0）は常に張り、親があれば祖先集合を +1 して
		// 引き継ぐ（page_paths の CreatePage と同じ考え方）。
		if err := u.repo.InsertTicketPathSelf(ctx, in.WorkspaceID, created.ID); err != nil {
			return err
		}
		if in.ParentID != nil {
			if err := u.repo.InsertTicketPathAncestors(ctx, in.WorkspaceID, created.ID, *in.ParentID); err != nil {
				return err
			}
		}

		// 派生表（本文からの参照）は作成直後に張る。空スライスでも Replace を呼び「参照 0 件」を明示し、
		// UpdateTicket と同じ経路に揃える。
		if err := u.repo.ReplaceTicketPageLinks(ctx, in.WorkspaceID, created.ID, pageIDs); err != nil {
			return err
		}
		return u.repo.ReplaceTicketTicketLinks(ctx, in.WorkspaceID, created.ID, ticketIDs)
	}); err != nil {
		return nil, err
	}
	created.Doc = stripped
	created.PlainText = plainText
	return created, nil
}

func (u *CreateTicketUseCase) resolveType(ctx context.Context, workspaceID, projectID, typeID string) (*domain.TicketType, error) {
	if typeID == "" {
		return u.repo.GetDefaultTicketType(ctx, workspaceID, projectID)
	}
	return u.repo.FindTicketType(ctx, workspaceID, projectID, typeID)
}

func (u *CreateTicketUseCase) resolveStatus(ctx context.Context, workspaceID, projectID, statusID string) (*domain.TicketStatus, error) {
	if statusID == "" {
		return u.repo.GetInitialTicketStatus(ctx, workspaceID, projectID)
	}
	return u.repo.FindTicketStatus(ctx, workspaceID, projectID, statusID)
}

// validateParent は親チケットが指定されたときだけ、実在・同一プロジェクト・階層規則
// （設計 Ⅳ-D: 子の段 <= 親の段、同段の親子は 0 だけ、-1 は親になれない）・深さ最大 3 を検証する。
func (u *CreateTicketUseCase) validateParent(
	ctx context.Context, workspaceID, projectID string, parentID *string, childLevel int,
) error {
	if parentID == nil {
		return nil
	}
	parent, err := u.repo.FindTicket(ctx, workspaceID, *parentID)
	if err != nil {
		return err
	}
	if parent.ProjectID != projectID {
		// プロジェクトをまたぐ親子は作れない。存在しない ID と同じ応答に畳み、どちらだったかを
		// 漏らさない（ページの木と同じ方針）。
		return repository.ErrTicketNotFound
	}
	parentType, err := u.repo.FindTicketType(ctx, workspaceID, projectID, parent.TypeID)
	if err != nil {
		return err
	}
	if err := domain.ValidateTicketParentChild(childLevel, parentType.HierarchyLevel); err != nil {
		return err
	}
	chain, err := u.repo.ListTicketParentChain(ctx, workspaceID, *parentID)
	if err != nil {
		return err
	}
	// chain は親自身を含まない祖先列。親の深さ = len(chain)+1、新しい子の深さは
	// さらに +1。これが TicketMaxDepth を超えるなら拒否。
	childDepth := len(chain) + 2
	if childDepth > TicketMaxDepth {
		return domain.ErrTicketHierarchyRejected
	}
	return nil
}
