package ticket

import (
	"context"
	"errors"
	"strings"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

const (
	// DefaultTicketRefSearchLimit は件数を指定しないときの候補の数。
	DefaultTicketRefSearchLimit = 8
	// MaxTicketRefSearchLimit は指定できる上限（候補は短い一覧で、全件は約束しない）。
	MaxTicketRefSearchLimit = 20
)

// ErrInvalidTicketRefSearchLimit は件数が 1〜MaxTicketRefSearchLimit の外。
var ErrInvalidTicketRefSearchLimit = errors.New("limit must be between 1 and 20")

// SearchTicketRefsUseCase は本文エディタの `#` の候補 — 表示キーか題名でワークスペースの
// 現役チケットを探す。閲覧の判定は handler（ワークスペースの閲覧権限 1 回）に委ねる
// （ListTicketsReferencingPageUseCase と同じ分担）。
type SearchTicketRefsUseCase struct {
	refs repository.TicketRefReader
}

func NewSearchTicketRefsUseCase(r repository.TicketRefReader) *SearchTicketRefsUseCase {
	return &SearchTicketRefsUseCase{refs: r}
}

type SearchTicketRefsInput struct {
	WorkspaceID string
	// Query は打った語。前後の空白は無視し、空なら探さない（候補は打った語で絞る口で、
	// 全件を返す口ではない）。
	Query string
	// Limit は返す最大件数（1〜MaxTicketRefSearchLimit）。
	Limit int
}

func (u *SearchTicketRefsUseCase) Execute(ctx context.Context, in SearchTicketRefsInput) ([]domain.TicketRefFact, error) {
	if in.WorkspaceID == "" {
		return nil, errors.New("workspaceID is required")
	}
	if in.Limit < 1 || in.Limit > MaxTicketRefSearchLimit {
		return nil, ErrInvalidTicketRefSearchLimit
	}
	q := strings.TrimSpace(in.Query)
	if q == "" {
		return []domain.TicketRefFact{}, nil
	}
	return u.refs.SearchTicketRefFacts(ctx, in.WorkspaceID, q, in.Limit)
}
