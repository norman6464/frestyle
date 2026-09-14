package domain

import (
	"errors"
	"time"
)

// Label はワークスペースごとのラベル（名前 + 色）。ページとチケットが同じ語彙を引く。
//
// 同名は空白・大文字小文字違いも含めてワークスペース内で作れない（uq_labels_workspace_name。
// DB 側は既にトリム済みの name しか受け付けない — 呼び出し側が保存前に strings.TrimSpace を
// 通す分担は ticket_statuses/ticket_types と同じ）。
type Label struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"-"`
	Name        string    `json:"name"`
	Color       string    `json:"color"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// MaxLabelNameLen は名前の列幅（character varying(64)）。
const MaxLabelNameLen = 64

var (
	ErrInvalidLabelName  = errors.New("domain: invalid label name")
	ErrInvalidLabelColor = errors.New("domain: invalid label color")
)
