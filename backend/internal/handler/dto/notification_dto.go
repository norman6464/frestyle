// Package dto は handler が受け取る・返す JSON の形（request / response）を置く。
// domain の構造体をそのまま JSON にしない —— 内部の項目（userId 等）が応答に漏れ、
// domain を直すたびに API の形が変わってしまうため。dto は domain だけを import する。
package dto

import (
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// NotificationResponse は GET /notifications の 1 行。
type NotificationResponse struct {
	ID     uint64 `json:"id"`
	Type   string `json:"type"`
	Title  string `json:"title"`
	Body   string `json:"body"`
	IsRead bool   `json:"isRead"`
	// LinkPath は通知の飛び先（アプリ内のパス）。空文字は「飛び先なし」で、フロントは文字だけを出す。
	LinkPath  string    `json:"linkPath"`
	CreatedAt time.Time `json:"createdAt"`
}

// NotificationFromDomain は domain.Notification を応答の形にする。userId は本人の一覧なので返さない。
func NotificationFromDomain(n domain.Notification) NotificationResponse {
	return NotificationResponse{
		ID:        n.ID,
		Type:      n.Type,
		Title:     n.Title,
		Body:      n.Body,
		IsRead:    n.IsRead,
		LinkPath:  n.LinkPath,
		CreatedAt: n.CreatedAt,
	}
}

// NotificationsFromDomain は一覧をまとめて変換する。0 件は null ではなく [] を返す
// （呼び出し側が配列として扱えるように）。
func NotificationsFromDomain(ns []domain.Notification) []NotificationResponse {
	out := make([]NotificationResponse, 0, len(ns))
	for _, n := range ns {
		out = append(out, NotificationFromDomain(n))
	}
	return out
}
