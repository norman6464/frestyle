package domain

import "time"

type Notification struct {
	ID     uint64 `json:"id"`
	UserID uint64 `json:"userId"`
	Type   string `json:"type"`
	Title  string `json:"title"`
	Body   string `json:"body"`
	IsRead bool   `json:"isRead"`
	// LinkPath は通知の飛び先（アプリ内のパス。"/tickets/<id>" 等）。空文字は「飛び先なし」。
	// 外部 URL は入れない（形は DB の CHECK 制約が守る）。
	LinkPath  string    `json:"linkPath"`
	CreatedAt time.Time `json:"createdAt"`
}
