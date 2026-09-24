package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ticketFixtureSameRepo は base と同じ tickets/pages/perms（＝同じデータ）を共有したまま、
// 別ユーザー・別役割で叩くための router を新しく組む。「本人か CanManage か」の認可は
// current user が誰かに依存するので、同じチケット・同じ発言に対して複数ユーザーからの
// アクセスを確かめるにはデータを共有しつつ router だけ分ける必要がある。
func ticketFixtureSameRepo(t *testing.T, base ticketFixture, uid uint64, role domain.GrantRole) ticketFixture {
	t.Helper()
	base.perms.addMember(kbWorkspaceID, uid)
	if role != "" {
		base.perms.setScopeRole(kbWorkspaceID, uid, role)
	}
	users := newKbFakeUsers()
	r := gin.New()
	g := r.Group("/api/v2")
	g.Use(func(c *gin.Context) {
		c.Set(middleware.ContextKeyCurrentUserID, uid)
		c.Set(middleware.ContextKeyCurrentUser, &domain.User{ID: uid})
		c.Next()
	})
	registerTicketRoutesWith(g, base.tickets, base.tickets, base.tickets, base.tickets, base.tickets, base.perms, base.pages, users, &fakeNotifRepo{}, fakeTxManager{}, ticketAttachmentFakePresigner{})
	return ticketFixture{tickets: base.tickets, pages: base.pages, perms: base.perms, router: r}
}

// Test_チケット発言一式_投稿一覧編集履歴削除反応 はチケットへの発言（段 3）の一連の流れを
// HTTP 経由で確かめる。usecase 層の単体テスト（comment_usecase_test.go）は認可・通知の
// 送り分けを直接見ているので、ここでは handler の配線（ルーティング・JSON バインド・
// 応答の形）に絞る。
func Test_チケット発言一式_投稿一覧編集履歴削除反応(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	target := f.tickets.addTicket(domain.Ticket{ID: "ticket-comments-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "対象チケット"})

	// 1) 投稿。
	w := f.do(t, http.MethodPost, ticketAPIBase+"/tickets/"+target.ID+"/comments",
		`{"body":[{"type":"text","text":"最初の発言"}]}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	created := decodeJSON[map[string]any](t, w)
	commentID, ok := created["id"].(string)
	require.True(t, ok)
	assert.Equal(t, false, created["edited"])

	// 2) 返信。
	w = f.do(t, http.MethodPost, ticketAPIBase+"/tickets/"+target.ID+"/comments",
		`{"parentCommentId":"`+commentID+`","body":[{"type":"text","text":"返信です"}]}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	reply := decodeJSON[map[string]any](t, w)
	assert.Equal(t, commentID, reply["parentCommentId"])

	// 3) 一覧（親・返信の2件）。
	w = f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+target.ID+"/comments", "")
	require.Equal(t, http.StatusOK, w.Code)
	list := decodeJSON[map[string][]map[string]any](t, w)
	require.Len(t, list["comments"], 2)

	// 4) 編集。
	w = f.do(t, http.MethodPut, ticketAPIBase+"/tickets/"+target.ID+"/comments/"+commentID,
		`{"body":[{"type":"text","text":"書き直した"}]}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	updated := decodeJSON[map[string]any](t, w)
	assert.Equal(t, true, updated["edited"])
	var body []map[string]string
	require.NoError(t, json.Unmarshal([]byte(`[{"type":"text","text":"書き直した"}]`), &body))

	// 5) 編集履歴。
	w = f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+target.ID+"/comments/"+commentID+"/edits", "")
	require.Equal(t, http.StatusOK, w.Code)
	edits := decodeJSON[map[string][]map[string]any](t, w)
	require.Len(t, edits["edits"], 1, "編集前の本文が1件退避されている")

	// 6) 反応の付け外し。
	w = f.do(t, http.MethodPut, ticketAPIBase+"/tickets/"+target.ID+"/comments/"+commentID+"/reactions/%F0%9F%91%8D", "")
	require.Equal(t, http.StatusNoContent, w.Code, w.Body.String())
	w = f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+target.ID+"/comments", "")
	require.Equal(t, http.StatusOK, w.Code)
	afterReact := decodeJSON[map[string][]map[string]any](t, w)
	found := false
	for _, c := range afterReact["comments"] {
		if c["id"] == commentID {
			reactions, _ := c["reactions"].([]any)
			found = len(reactions) == 1
		}
	}
	assert.True(t, found, "反応が一覧の応答に載る")

	w = f.do(t, http.MethodDelete, ticketAPIBase+"/tickets/"+target.ID+"/comments/"+commentID+"/reactions/%F0%9F%91%8D", "")
	require.Equal(t, http.StatusNoContent, w.Code)

	// 7) 削除（投稿者本人）。
	w = f.do(t, http.MethodDelete, ticketAPIBase+"/tickets/"+target.ID+"/comments/"+commentID, "")
	require.Equal(t, http.StatusNoContent, w.Code, w.Body.String())
	w = f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+target.ID+"/comments", "")
	require.Equal(t, http.StatusOK, w.Code)
	afterDelete := decodeJSON[map[string][]map[string]any](t, w)
	for _, c := range afterDelete["comments"] {
		assert.NotEqual(t, commentID, c["id"], "削除済みは一覧に出ない")
	}
}

func Test_チケット発言_閲覧のみでは投稿403だが一覧は見える(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleViewer)
	target := f.tickets.addTicket(domain.Ticket{ID: "ticket-comments-viewer", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "x"})

	w := f.do(t, http.MethodPost, ticketAPIBase+"/tickets/"+target.ID+"/comments", `{"body":[{"type":"text","text":"x"}]}`)
	assert.Equal(t, http.StatusForbidden, w.Code)

	w = f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+target.ID+"/comments", "")
	assert.Equal(t, http.StatusOK, w.Code, "閲覧できれば一覧は読める")
}

// 投稿者本人でも CanManage でもない相手は編集・削除できない（403）。CanManage
// （GrantRoleAdmin）なら他人の発言も編集・削除できる。
func Test_チケット発言_他人の発言は本人かCanManageでなければ編集削除できない(t *testing.T) {
	author := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	target := author.tickets.addTicket(domain.Ticket{ID: "ticket-comments-authz", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "x"})
	w := author.do(t, http.MethodPost, ticketAPIBase+"/tickets/"+target.ID+"/comments", `{"body":[{"type":"text","text":"本人の発言"}]}`)
	require.Equal(t, http.StatusCreated, w.Code)
	created := decodeJSON[map[string]any](t, w)
	commentID := created["id"].(string)

	// 別ユーザー（editor）が同じ fake repo を共有する fixture を作れないため、同じ
	// ticketFakeRepo を使い回して別ユーザー ID で叩く（handler は ActorUserID を
	// current user から取るので、fixture のユーザー ID だけ変えれば「別人」を再現できる）。
	other := ticketFixtureSameRepo(t, author, kbUserID+1, domain.GrantRoleEditor)
	w = other.do(t, http.MethodPut, ticketAPIBase+"/tickets/"+target.ID+"/comments/"+commentID,
		`{"body":[{"type":"text","text":"横取り"}]}`)
	assert.Equal(t, http.StatusForbidden, w.Code, "投稿者本人でもCanManageでもない")

	admin := ticketFixtureSameRepo(t, author, kbUserID+2, domain.GrantRoleAdmin)
	w = admin.do(t, http.MethodPut, ticketAPIBase+"/tickets/"+target.ID+"/comments/"+commentID,
		`{"body":[{"type":"text","text":"管理者が修正"}]}`)
	assert.Equal(t, http.StatusOK, w.Code, "CanManageなら他人の発言も編集できる")
}
