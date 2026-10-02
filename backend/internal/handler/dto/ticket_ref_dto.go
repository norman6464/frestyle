package dto

import "github.com/norman6464/frestyle/backend/internal/domain"

// TicketRefCandidateResponse は本文エディタの `#` の候補 1 件（GET .../tickets/search?q=）。
// 表示キーはサーバーで組み立てて返す（本文の ticketRef の attrs.key と同じ形。画面は
// 候補の値をそのまま参照の写しに入れる）。
type TicketRefCandidateResponse struct {
	ID             string `json:"id"`
	Key            string `json:"key"`
	Title          string `json:"title"`
	StatusName     string `json:"statusName"`
	StatusCategory string `json:"statusCategory"`
}

// TicketRefCandidateListResponse は候補の応答。並びはサーバーが決めた順（表示キーの一致 →
// 更新の新しい順）のまま出す。
type TicketRefCandidateListResponse struct {
	Tickets []TicketRefCandidateResponse `json:"tickets"`
}

// TicketRefCandidateListFromDomain は domain の行を応答へ変換する。0 件でも tickets は空配列。
func TicketRefCandidateListFromDomain(rows []domain.TicketRefFact) TicketRefCandidateListResponse {
	out := make([]TicketRefCandidateResponse, 0, len(rows))
	for _, r := range rows {
		out = append(out, TicketRefCandidateResponse{
			ID: r.ID, Key: domain.FormatTicketKey(r.ProjectKey, r.Number), Title: r.Title,
			StatusName: r.StatusName, StatusCategory: string(r.StatusCategory),
		})
	}
	return TicketRefCandidateListResponse{Tickets: out}
}
