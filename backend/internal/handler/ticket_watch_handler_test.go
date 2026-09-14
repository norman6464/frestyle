package handler

import (
	"net/http"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 監視は「担当」とは別物。担当は 1 人（責任の所在）、監視は何人でも（気にしている人）。
// 付け外しは望む状態を送る形にしてあるので、二度押しても意図せず外れない。
func Test_チケットの監視_付けて外すまで(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	tk := f.tickets.addTicket(domain.Ticket{
		ID: "t-watch", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "見張る仕事",
	})
	watchURL := ticketAPIBase + "/tickets/" + tk.ID + "/watch"

	w := f.do(t, http.MethodGet, watchURL, "")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"watching":false`)
	assert.Contains(t, w.Body.String(), `"count":0`)

	w = f.do(t, http.MethodPut, watchURL, `{"watching":true}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"watching":true`)
	assert.Contains(t, w.Body.String(), `"count":1`)

	// 二度押しても増えない・外れない。
	w = f.do(t, http.MethodPut, watchURL, `{"watching":true}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"count":1`)

	w = f.do(t, http.MethodPut, watchURL, `{"watching":false}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"watching":false`)
	assert.Contains(t, w.Body.String(), `"count":0`)
}

func Test_チケットの監視_無いチケットは404(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)

	w := f.do(t, http.MethodPut, ticketAPIBase+"/tickets/居ない/watch", `{"watching":true}`)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func Test_チケットの監視_壊れた本文は400(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	tk := f.tickets.addTicket(domain.Ticket{
		ID: "t-watch-bad", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "見張る仕事",
	})

	w := f.do(t, http.MethodPut, ticketAPIBase+"/tickets/"+tk.ID+"/watch", `{`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func Test_チケットの監視_未認証は401(t *testing.T) {
	f := newTicketFixture(0, "")
	assert.Equal(t, http.StatusUnauthorized, f.do(t, http.MethodGet, ticketAPIBase+"/tickets/t-1/watch", "").Code)
}

// 自分の担当はワークスペースを横断する面。プロジェクトの指定を取らず、
// 「誰の担当か」は必ず呼び出した本人になる（他人の担当を覗く口にはしない）。
func Test_自分の担当_自分の分だけが出る(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	me := f.perms.userPrincipal(kbWorkspaceID, kbUserID)
	require.NotNil(t, me, "前提: 自分の principal が解決できる")

	mine := f.tickets.addTicket(domain.Ticket{
		ID: "t-assigned-mine", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "自分の担当",
	})
	require.Equal(t, http.StatusOK, f.do(t, http.MethodPut,
		ticketAPIBase+"/tickets/"+mine.ID+"/assignee", `{"assigneePrincipalId":"`+me.ID+`"}`).Code)

	others := f.tickets.addTicket(domain.Ticket{
		ID: "t-assigned-others", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "他人の担当",
	})
	require.Equal(t, http.StatusOK, f.do(t, http.MethodPut,
		ticketAPIBase+"/tickets/"+others.ID+"/assignee", `{"assigneePrincipalId":"principal-other"}`).Code)

	f.tickets.addTicket(domain.Ticket{
		ID: "t-assigned-none", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "未割り当て",
	})

	w := f.do(t, http.MethodGet, ticketAPIBase+"/tickets/assigned", "")
	require.Equal(t, http.StatusOK, w.Code)
	got := decodeJSON[map[string][]map[string]any](t, w)
	require.Len(t, got["tickets"], 1)
	assert.Equal(t, mine.ID, got["tickets"][0]["id"])
}

func Test_自分の担当_未認証は401(t *testing.T) {
	f := newTicketFixture(0, "")
	assert.Equal(t, http.StatusUnauthorized, f.do(t, http.MethodGet, ticketAPIBase+"/tickets/assigned", "").Code)
}
