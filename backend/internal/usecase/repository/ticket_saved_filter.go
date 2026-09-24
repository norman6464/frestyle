package repository

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// ErrTicketSavedFilterNotFound は対象の絞り込みが存在しない（または他人のもの・別プロジェクトの
// もの）ときに返す。他人の絞り込みは「見えない = 存在しない」で、ID を当てられても読めず消せない。
var ErrTicketSavedFilterNotFound = errors.New("ticket saved filter not found")

// ErrTicketSavedFilterNameTaken は同じ本人・同じプロジェクトに同名（大文字小文字を区別しない）が
// 既にあるときに返す（uq_ticket_saved_filters_owner_name の一意制約違反を repository が翻訳する）。
var ErrTicketSavedFilterNameTaken = errors.New("ticket saved filter name is already taken")

// TicketSavedFilterRepository は利用者が保存した絞り込み（ticket_saved_filters）の永続化を担う。
// TicketRepository とは別 interface（LabelRepository と同じ判断 — 固有の CRUD を持つ表の群は
// fat interface へ足さず、専用の interface + persistence struct を新設する）。
//
// どのメソッドも本人（userID）とプロジェクトで絞る。参照先の誤り（別プロジェクトの状態・
// 別ワークスペースのラベル・user でない主体）は DB の複合 FK が弾き、repository が
// ErrTicketStatusNotFound / ErrTicketTypeNotFound / ErrLabelNotFound / ErrTicketAssigneeNotFound /
// ErrProjectNotFound へ翻訳する（usecase が事前に 4 表を引いて確かめる代わりに、DB を最後の砦
// かつ唯一の判定にする）。
type TicketSavedFilterRepository interface {
	// InsertTicketSavedFilter は 1 件作り、採番した ID と時刻を f に書き戻す。
	InsertTicketSavedFilter(ctx context.Context, f *domain.TicketSavedFilter) error
	// UpdateTicketSavedFilter は f.ID の名前と条件を丸ごと書き換え、保存後の行を f に書き戻す。
	UpdateTicketSavedFilter(ctx context.Context, f *domain.TicketSavedFilter) error
	DeleteTicketSavedFilter(ctx context.Context, workspaceID, projectID string, userID uint64, filterID string) error
	// ListTicketSavedFilters は本人がそのプロジェクトで保存した絞り込みを作った順に返す。
	ListTicketSavedFilters(ctx context.Context, workspaceID, projectID string, userID uint64) ([]domain.TicketSavedFilter, error)
	CountTicketSavedFilters(ctx context.Context, workspaceID, projectID string, userID uint64) (int64, error)
}
