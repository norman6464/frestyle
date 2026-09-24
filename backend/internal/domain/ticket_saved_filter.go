package domain

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

// TicketSavedFilter は利用者が名前を付けて保存したバックログの絞り込み（本人 × プロジェクト）。
//
// 条件は一覧画面が URL から組み立てる絞り込みと同じ語彙（状態・種別・ラベル・担当・期限切れ・
// 検索語）。担当は「この主体 / 未割り当て / 自分」の高々 1 つで、DB も同じ規則を CHECK で持つ
// （ck_ticket_saved_filters_assignee_mode）。条件が 1 つも無い絞り込みは保存できない —
// 固定の「すべて」と同じ結果にしかならず、名前を付けて残す意味が無い。
type TicketSavedFilter struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"-"`
	ProjectID   string `json:"-"`
	// UserID は保存した本人。応答には載せない（本人の一覧にしか出ないので冗長なだけだが、
	// 他の表と同じく「所有者の内部 ID は出さない」で揃える）。
	UserID uint64 `json:"-"`
	Name   string `json:"name"`

	StatusID            *string `json:"statusId,omitempty"`
	TypeID              *string `json:"typeId,omitempty"`
	LabelID             *string `json:"labelId,omitempty"`
	AssigneePrincipalID *string `json:"assigneePrincipalId,omitempty"`
	Unassigned          bool    `json:"unassigned"`
	AssignedToMe        bool    `json:"assignedToMe"`
	Overdue             bool    `json:"overdue"`
	// Q は題名・本文のあいまい検索の語。
	Q *string `json:"q,omitempty"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

const (
	// MaxTicketSavedFilterNameLen は名前の列幅（character varying(60)。文字数）。
	MaxTicketSavedFilterNameLen = 60
	// MaxTicketSavedFilterQueryLen は検索語の列幅（character varying(200)。文字数）。
	MaxTicketSavedFilterQueryLen = 200
	// MaxTicketSavedFiltersPerProject は本人 × プロジェクトで持てる数の上限。画面の一覧
	// （固定の 4 つの下に並ぶ）が長くなりすぎないための目安で、DB では守らない。
	MaxTicketSavedFiltersPerProject = 20
)

var (
	ErrInvalidTicketSavedFilterName      = errors.New("domain: invalid ticket saved filter name")
	ErrInvalidTicketSavedFilterQuery     = errors.New("domain: invalid ticket saved filter query")
	ErrTicketSavedFilterAssigneeConflict = errors.New("domain: ticket saved filter has more than one assignee condition")
	ErrTicketSavedFilterNoCondition      = errors.New("domain: ticket saved filter has no condition")
)

// Normalize は入力を保存できる形に整え、形の誤りを返す。名前と検索語は前後の空白を落とし、
// 空文字の ID は「指定なし」（nil）に畳む（画面の選択欄は未選択を空文字で送ってくるため）。
func (f *TicketSavedFilter) Normalize() error {
	f.Name = strings.TrimSpace(f.Name)
	if f.Name == "" || utf8.RuneCountInString(f.Name) > MaxTicketSavedFilterNameLen {
		return ErrInvalidTicketSavedFilterName
	}
	f.StatusID = trimmedOrNil(f.StatusID)
	f.TypeID = trimmedOrNil(f.TypeID)
	f.LabelID = trimmedOrNil(f.LabelID)
	f.AssigneePrincipalID = trimmedOrNil(f.AssigneePrincipalID)
	f.Q = trimmedOrNil(f.Q)
	if f.Q != nil && utf8.RuneCountInString(*f.Q) > MaxTicketSavedFilterQueryLen {
		return ErrInvalidTicketSavedFilterQuery
	}
	modes := 0
	for _, on := range []bool{f.AssigneePrincipalID != nil, f.Unassigned, f.AssignedToMe} {
		if on {
			modes++
		}
	}
	if modes > 1 {
		return ErrTicketSavedFilterAssigneeConflict
	}
	if !f.HasCondition() {
		return ErrTicketSavedFilterNoCondition
	}
	return nil
}

// HasCondition は絞り込みの条件が 1 つでもあるかを返す。
func (f *TicketSavedFilter) HasCondition() bool {
	return f.StatusID != nil || f.TypeID != nil || f.LabelID != nil || f.AssigneePrincipalID != nil ||
		f.Unassigned || f.AssignedToMe || f.Overdue || f.Q != nil
}

// trimmedOrNil は前後の空白を落とし、空になれば nil を返す。
func trimmedOrNil(s *string) *string {
	if s == nil {
		return nil
	}
	v := strings.TrimSpace(*s)
	if v == "" {
		return nil
	}
	return &v
}
