package handler

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/dto"
)

const meAssignedPath = "/api/v2/me/assigned-tickets"

func Test_自分の担当横断API_未ログインは401(t *testing.T) {
	f := newTicketFixture(0, domain.GrantRoleViewer)

	w := f.do(t, http.MethodGet, meAssignedPath, "")

	assert.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Empty(t, f.tickets.assignedAcrossCalls)
}

// どのワークスペースを見てよいかは役割で決まる。所属していても役割の無いワークスペースと、
// 所属していないワークスペースは repository に渡さない。
func Test_自分の担当横断API_見てよいワークスペースだけを既定の件数で問い合わせる(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleViewer)
	// もう片方のワークスペースには所属だけさせ、役割は張らない。
	f.perms.addMember(kbOtherWorkspaceID, kbUserID)
	due := "2026-09-30"
	f.tickets.assignedAcross = []domain.AssignedTicketSummary{{
		ID: "t-1", WorkspaceSlug: kbWorkspaceSlug, WorkspaceName: "Acme",
		ProjectID: tkProjectID, ProjectKey: "FRE", ProjectName: "Product",
		Number: 143, Title: "招待フローの案内文を確認する", TypeName: "タスク",
		StatusName: "進行中", StatusCategory: domain.TicketStatusCategoryInProgress, StatusColor: "#2563eb",
		Priority: domain.TicketPriorityDefault, DueDate: &due,
	}, {
		ID: "t-2", WorkspaceSlug: kbWorkspaceSlug, WorkspaceName: "Acme",
		ProjectID: tkProjectID, ProjectKey: "FRE", ProjectName: "Product",
		Number: 150, Title: "期限の無い担当", StatusCategory: domain.TicketStatusCategoryTodo,
	}}

	w := f.do(t, http.MethodGet, meAssignedPath, "")

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.Len(t, f.tickets.assignedAcrossCalls, 1)
	call := f.tickets.assignedAcrossCalls[0]
	assert.Equal(t, kbUserID, call.userID)
	assert.Equal(t, []string{kbWorkspaceID}, call.workspaceIDs, "役割の無い所属は渡さない")
	assert.Equal(t, 3, call.limit, "省くとホームの既定の 3 件")

	got := decodeJSON[dto.AssignedTicketSummaryListResponse](t, w)
	require.Len(t, got.Tickets, 2)
	assert.Equal(t, "t-1", got.Tickets[0].ID)
	assert.Equal(t, kbWorkspaceSlug, got.Tickets[0].WorkspaceSlug)
	assert.Equal(t, "Acme", got.Tickets[0].WorkspaceName)
	assert.Equal(t, "FRE", got.Tickets[0].ProjectKey)
	assert.Equal(t, int64(143), got.Tickets[0].Number)
	assert.Equal(t, "in_progress", got.Tickets[0].StatusCategory)
	require.NotNil(t, got.Tickets[0].DueDate)
	assert.Equal(t, "2026-09-30", *got.Tickets[0].DueDate)
	assert.NotContains(t, w.Body.String(), `"dueDate":null`, "期限が無ければ項目ごと省く")
	assert.Nil(t, got.Tickets[1].DueDate)
}

func Test_自分の担当横断API_件数を指定できる(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleViewer)

	w := f.do(t, http.MethodGet, meAssignedPath+"?limit=2", "")

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.Len(t, f.tickets.assignedAcrossCalls, 1)
	assert.Equal(t, 2, f.tickets.assignedAcrossCalls[0].limit)
	assert.JSONEq(t, `{"tickets":[]}`, w.Body.String(), "0 件は空配列（null にしない）")
}

func Test_自分の担当横断API_件数が範囲外なら400(t *testing.T) {
	for _, q := range []string{"0", "21", "-1", "abc", ""} {
		t.Run("limit="+q, func(t *testing.T) {
			f := newTicketFixture(kbUserID, domain.GrantRoleViewer)

			w := f.do(t, http.MethodGet, meAssignedPath+"?limit="+q, "")

			assert.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
			assert.JSONEq(t, `{"error":"invalid_limit"}`, w.Body.String())
			assert.Empty(t, f.tickets.assignedAcrossCalls)
		})
	}
}

func Test_自分の担当横断API_見てよいワークスペースが無ければ問い合わせずに0件(t *testing.T) {
	// 所属はしているが役割が 1 つも届いていない。
	f := newTicketFixture(kbUserID, "")

	w := f.do(t, http.MethodGet, meAssignedPath, "")

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.JSONEq(t, `{"tickets":[]}`, w.Body.String())
	assert.Empty(t, f.tickets.assignedAcrossCalls)
}
