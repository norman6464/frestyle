package dto

import "github.com/norman6464/frestyle/backend/internal/domain"

// TicketReferenceResponse はページを参照しているチケット 1 件（GET .../pages/:pageId/ticket-backlinks）。
// 表示キー（PRJ-12 の形）は projectKey と number から画面が組み立てる。開くときは id で
// /tickets/:ticketId を引く。
type TicketReferenceResponse struct {
	ID         string `json:"id"`
	ProjectKey string `json:"projectKey"`
	Number     int64  `json:"number"`
	Title      string `json:"title"`
}

// TicketReferenceListResponse は逆参照の応答。並びはサーバーが決めた順（更新の新しい順）のまま出す。
type TicketReferenceListResponse struct {
	Tickets []TicketReferenceResponse `json:"tickets"`
}

// TicketReferenceListFromDomain は domain の行を応答へ変換する。0 件でも tickets は空配列。
func TicketReferenceListFromDomain(rows []domain.TicketReference) TicketReferenceListResponse {
	out := make([]TicketReferenceResponse, 0, len(rows))
	for _, t := range rows {
		out = append(out, TicketReferenceResponse{ID: t.ID, ProjectKey: t.ProjectKey, Number: t.Number, Title: t.Title})
	}
	return TicketReferenceListResponse{Tickets: out}
}
