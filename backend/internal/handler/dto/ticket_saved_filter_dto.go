package dto

import (
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// TicketSavedFilterRequest は POST / PUT /workspaces/:workspaceSlug/projects/:projectId/saved-filters の
// 入力。条件の項目名は応答（TicketSavedFilterResponse）と、画面が URL に持つ絞り込みの状態
// （statusId / typeId / labelId / assigneePrincipalId / unassigned / assignedToMe / overdue / q）に
// そろえる。一覧 API（GET .../tickets）のクエリともほぼ同じだが、ラベルだけは一覧が `label` で
// 受ける（先にできた口の名残）。ここは応答と同じ `labelId` にそろえ、画面は一覧のクエリでは
// なく URL の状態から組み立てて送る。長さ・組み合わせの検証は domain.TicketSavedFilter.Normalize
// が行い、ここでは名前の有無だけを binding で見る。
type TicketSavedFilterRequest struct {
	// Name は絞り込みの名前（1〜60 文字。前後の空白は落とす）。
	Name string `json:"name" binding:"required" example:"自分の不具合"`
	// StatusID / TypeID / LabelID / AssigneePrincipalID は指定しないとき省略か空文字。
	StatusID            *string `json:"statusId"`
	TypeID              *string `json:"typeId"`
	LabelID             *string `json:"labelId"`
	AssigneePrincipalID *string `json:"assigneePrincipalId"`
	// Unassigned / AssignedToMe / AssigneePrincipalID は担当の条件で、高々 1 つ。
	Unassigned   bool `json:"unassigned"`
	AssignedToMe bool `json:"assignedToMe"`
	Overdue      bool `json:"overdue"`
	// Q は題名・本文のあいまい検索の語（200 文字まで）。
	Q *string `json:"q"`
}

// TicketSavedFilterResponse は保存した絞り込み 1 件の返却形。Count はいまその条件に合う
// 現役チケットの件数（固定の「自分の担当」等の件数と同じく、アーカイブ済みは数えない）。
type TicketSavedFilterResponse struct {
	ID                  string    `json:"id" example:"0198a000-0000-7000-8000-00000000000f"`
	Name                string    `json:"name" example:"自分の不具合"`
	StatusID            *string   `json:"statusId,omitempty"`
	TypeID              *string   `json:"typeId,omitempty"`
	LabelID             *string   `json:"labelId,omitempty"`
	AssigneePrincipalID *string   `json:"assigneePrincipalId,omitempty"`
	Unassigned          bool      `json:"unassigned"`
	AssignedToMe        bool      `json:"assignedToMe"`
	Overdue             bool      `json:"overdue"`
	Q                   *string   `json:"q,omitempty"`
	Count               int64     `json:"count" example:"3"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

// TicketSavedFilterListResponse は一覧の返却形。0 件は null ではなく [] を返す。
type TicketSavedFilterListResponse struct {
	SavedFilters []TicketSavedFilterResponse `json:"savedFilters"`
}

// TicketSavedFilterFromDomain は保存した絞り込みと件数を応答の形にする。
func TicketSavedFilterFromDomain(f domain.TicketSavedFilter, count int64) TicketSavedFilterResponse {
	return TicketSavedFilterResponse{
		ID:                  f.ID,
		Name:                f.Name,
		StatusID:            f.StatusID,
		TypeID:              f.TypeID,
		LabelID:             f.LabelID,
		AssigneePrincipalID: f.AssigneePrincipalID,
		Unassigned:          f.Unassigned,
		AssignedToMe:        f.AssignedToMe,
		Overdue:             f.Overdue,
		Q:                   f.Q,
		Count:               count,
		CreatedAt:           f.CreatedAt,
		UpdatedAt:           f.UpdatedAt,
	}
}
