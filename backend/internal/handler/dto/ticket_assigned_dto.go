package dto

import "github.com/norman6464/frestyle/backend/internal/domain"

// AssignedTicketSummaryResponse は GET /me/assigned-tickets の 1 行（全ワークスペース横断の
// 自分の担当）。項目名は 1 ワークスペースの担当一覧（GET /workspaces/:slug/tickets/assigned）の
// 行とそろえ、どのワークスペースの仕事かを見分ける workspaceSlug / workspaceName を足す。
// 表示キー（PRJ-12 の形）は projectKey と number から画面が組み立てる。
type AssignedTicketSummaryResponse struct {
	ID             string `json:"id"`
	WorkspaceSlug  string `json:"workspaceSlug"`
	WorkspaceName  string `json:"workspaceName"`
	ProjectID      string `json:"projectId"`
	ProjectKey     string `json:"projectKey"`
	ProjectName    string `json:"projectName"`
	Number         int64  `json:"number"`
	Title          string `json:"title"`
	TypeName       string `json:"typeName"`
	StatusName     string `json:"statusName"`
	StatusCategory string `json:"statusCategory"`
	StatusColor    string `json:"statusColor"`
	Priority       int    `json:"priority"`
	// DueDate は 'YYYY-MM-DD'。期限が無ければ省く。
	DueDate *string `json:"dueDate,omitempty"`
}

// AssignedTicketSummaryListResponse は GET /me/assigned-tickets の応答。並びはサーバーが決めた
// 順（期限の近い順・期限なしは最後）のまま画面に出す。
type AssignedTicketSummaryListResponse struct {
	Tickets []AssignedTicketSummaryResponse `json:"tickets"`
}

// AssignedTicketSummaryListFromDomain は domain の行を応答へ変換する。0 件でも tickets は空配列
// （null にしない）。
func AssignedTicketSummaryListFromDomain(rows []domain.AssignedTicketSummary) AssignedTicketSummaryListResponse {
	out := make([]AssignedTicketSummaryResponse, 0, len(rows))
	for _, t := range rows {
		out = append(out, AssignedTicketSummaryResponse{
			ID: t.ID, WorkspaceSlug: t.WorkspaceSlug, WorkspaceName: t.WorkspaceName,
			ProjectID: t.ProjectID, ProjectKey: t.ProjectKey, ProjectName: t.ProjectName,
			Number: t.Number, Title: t.Title, TypeName: t.TypeName,
			StatusName: t.StatusName, StatusCategory: string(t.StatusCategory), StatusColor: t.StatusColor,
			Priority: int(t.Priority), DueDate: t.DueDate,
		})
	}
	return AssignedTicketSummaryListResponse{Tickets: out}
}
