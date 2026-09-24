package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ticketFixture は fake repository と、本番と同じ wiring で組んだルータの組。
// ワークスペースは kb_page_handler_test.go の定数（kbWorkspaceID 等）をそのまま使う
// （同じ package handler のテストなので再宣言しない）。プロジェクトはバックログ側の
// 入れ物なので、ここで独自に持つ。
type ticketFixture struct {
	tickets *ticketFakeRepo
	pages   *kbFakePages
	perms   *kbFakePerms
	router  *gin.Engine
}

// newTicketFixture はワークスペース 2 つの下ごしらえをして、registerTicketRoutesWith で
// 本番と同じルートを張る。uid が 0 なら current user を注入せず未認証を再現する。role が
// 空なら kbUserID にはどの役割も届かない（CanView すら false — kbFakePerms.rolesAt は
// 明示的な setScopeRole が無ければ空集合を返す）。
//
// 役割はワークスペースに付ける。バックログの実効権限はワークスペース単位で、ナレッジの
// スペース付与（space_grants）は一切引かない（ticket.CheckTicketPermissionUseCase 参照）。
func newTicketFixture(uid uint64, role domain.GrantRole) ticketFixture {
	gin.SetMode(gin.TestMode)
	pages := newKbFakePages()
	pages.addWorkspace(kbWorkspaceID, kbWorkspaceSlug)
	pages.addWorkspace(kbOtherWorkspaceID, kbOtherWorkspaceSlug)

	perms := newKbFakePerms(pages, domain.PagePermission{})
	perms.addMember(kbWorkspaceID, kbUserID)
	if role != "" {
		perms.setScopeRole(kbWorkspaceID, kbUserID, role)
	}

	tickets := newTicketFakeRepo()
	users := newKbFakeUsers()
	users.setUserName(kbUserID, "テストユーザー")

	r := gin.New()
	g := r.Group("/api/v2")
	if uid != 0 {
		g.Use(func(c *gin.Context) {
			c.Set(middleware.ContextKeyCurrentUserID, uid)
			c.Set(middleware.ContextKeyCurrentUser, &domain.User{ID: uid})
			c.Next()
		})
	}
	registerTicketRoutesWith(g, tickets, tickets, tickets, tickets, tickets, perms, pages, users, &fakeNotifRepo{}, fakeTxManager{}, ticketAttachmentFakePresigner{})
	return ticketFixture{tickets: tickets, pages: pages, perms: perms, router: r}
}

func (f ticketFixture) do(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	f.router.ServeHTTP(w, req)
	return w
}

// tkProjectID はバックログの入れ物（projects.id）。ナレッジの kbSpaceID とは無関係。
const tkProjectID = "01a00000-0000-7000-8000-0000000000b1"

const (
	ticketAPIBase     = "/api/v2/workspaces/" + kbWorkspaceSlug
	ticketProjectBase = ticketAPIBase + "/projects/" + tkProjectID
)

func decodeJSON[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &v))
	return v
}

// --- 権限の撃ち分け（Get と Create の 2 入口で確かめれば、requireTicketPermission /
// requireTicketWorkspacePermission という共有ヘルパーの正しさとしては十分。同じヘルパーを
// 他の全エンドポイントも通る） ---

func Test_チケット取得_役割が無いメンバーは404(t *testing.T) {
	// メンバーではあるが、このワークスペースにどの役割も届いていない（setScopeRole 未設定 —
	// newKbFakePerms の既定は「役割 0 件」で、addMember だけでは CanView にならない）。
	f := newTicketFixture(kbUserID, "")
	ticket := f.tickets.addTicket(domain.Ticket{
		ID: "ticket-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "x",
	})

	w := f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+ticket.ID, "")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func Test_チケット取得_閲覧のみで200(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleViewer)
	ticketID := f.tickets.addTicket(domain.Ticket{
		ID: "ticket-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "本文", Number: 1,
	}).ID

	w := f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+ticketID, "")
	require.Equal(t, http.StatusOK, w.Code)
	got := decodeJSON[domain.Ticket](t, w)
	assert.Equal(t, "本文", got.Title)
}

// slug 無しの解決（/kb/tickets/:ticketId）は URL にワークスペースを持たない。
// 通知の導線・本文中の ticketRef・ブックマークからの再訪がここを通るので、
// ID だけで開けて、応答の workspaceSlug で以降の API を呼べることを固定する。
func Test_チケットslug無し解決_workspaceSlugを返す(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	tk := f.tickets.addTicket(domain.Ticket{
		ID: "ticket-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "解決される", Number: 1,
	})

	w := f.do(t, http.MethodGet, "/api/v2/tickets/"+tk.ID, "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	got := decodeJSON[map[string]any](t, w)
	assert.Equal(t, kbWorkspaceSlug, got["workspaceSlug"])
	assert.Equal(t, true, got["canEdit"])
	ticketObj, ok := got["ticket"].(map[string]any)
	require.True(t, ok, "ticket が入れ子で返る")
	assert.Equal(t, "解決される", ticketObj["title"])
}

func Test_チケットslug無し解決_閲覧できなければ404(t *testing.T) {
	// メンバーではあるが、このワークスペースにどの役割も届いていない。
	f := newTicketFixture(kbUserID, "")
	tk := f.tickets.addTicket(domain.Ticket{
		ID: "ticket-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "見えない",
	})

	w := f.do(t, http.MethodGet, "/api/v2/tickets/"+tk.ID, "")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

// Test_チケットslug無し解決_停止中ワークスペースは404 は、id だけの解決経路
// （/kb/tickets/:ticketId）が slug 経由の入口（middleware.KnowledgeBaseWorkspace）を
// 通らないため、is_active を別途確かめないと停止後も id さえ控えていれば読み続けられて
// しまうことの修正を固定する。
//
// 変異確認: ResolveTicketLocationUseCase.Execute の !ws.IsActive 分岐を外すと、
// このテストの 404 判定が落ちる。
func Test_チケットslug無し解決_停止中ワークスペースは404(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	tk := f.tickets.addTicket(domain.Ticket{
		ID: "ticket-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "停止後",
	})
	f.pages.workspaces[kbWorkspaceSlug].IsActive = false

	w := f.do(t, http.MethodGet, "/api/v2/tickets/"+tk.ID, "")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func Test_チケット取得_他ワークスペースのチケットは404(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	other := f.tickets.addTicket(domain.Ticket{ID: "ticket-x", WorkspaceID: kbOtherWorkspaceID, ProjectID: "other-space", Title: "x"})

	w := f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+other.ID, "")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func Test_チケット作成_閲覧だけでは403(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleViewer)
	f.tickets.addType(domain.TicketType{ID: "type-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Name: "タスク", IsDefault: true})
	f.tickets.addStatus(domain.TicketStatus{ID: "status-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Name: "To Do", Category: domain.TicketStatusCategoryTodo, IsInitial: true})

	w := f.do(t, http.MethodPost, ticketProjectBase+"/tickets", `{"title":"新規"}`)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func Test_チケット削除_閲覧だけでは403(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleViewer)
	target := f.tickets.addTicket(domain.Ticket{ID: "ticket-del", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "x"})

	w := f.do(t, http.MethodDelete, ticketAPIBase+"/tickets/"+target.ID, "")
	assert.Equal(t, http.StatusForbidden, w.Code)
}

func Test_チケット削除_他ワークスペースのチケットは404(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	other := f.tickets.addTicket(domain.Ticket{ID: "ticket-other-del", WorkspaceID: kbOtherWorkspaceID, ProjectID: "other-space", Title: "x"})

	w := f.do(t, http.MethodDelete, ticketAPIBase+"/tickets/"+other.ID, "")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

// RestoreDeleted は requireTicketPermission（FindTicket 経由）を使わない別経路
// （FindDeletedTicketUseCase → requireTicketWorkspacePermission）なので、境界を独立して確かめる。
func Test_復元削除_他ワークスペースの削除済みチケットは404(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	now := time.Now()
	other := f.tickets.addTicket(domain.Ticket{
		ID: "ticket-other-restore", WorkspaceID: kbOtherWorkspaceID, ProjectID: "other-space",
		Title: "x", DeletedAt: &now,
	})

	w := f.do(t, http.MethodPost, ticketAPIBase+"/tickets/"+other.ID+"/restore-deleted", "")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func Test_復元削除_閲覧だけでは403(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleViewer)
	now := time.Now()
	target := f.tickets.addTicket(domain.Ticket{
		ID: "ticket-restore-viewer", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID,
		Title: "x", DeletedAt: &now,
	})

	w := f.do(t, http.MethodPost, ticketAPIBase+"/tickets/"+target.ID+"/restore-deleted", "")
	assert.Equal(t, http.StatusForbidden, w.Code)
}

// --- チケットのライフサイクル一式 ---

func Test_チケット一式_有効化から作成取得一覧更新状態変更移動担当履歴まで(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)

	// 1) 有効化（既定の雛形）。
	w := f.do(t, http.MethodPost, ticketProjectBase+"/tickets/enable", "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	statuses, err := f.tickets.ListTicketStatuses(context.Background(), kbWorkspaceID, tkProjectID, false)
	require.NoError(t, err)
	require.Len(t, statuses, 5)
	types, err := f.tickets.ListTicketTypes(context.Background(), kbWorkspaceID, tkProjectID, false)
	require.NoError(t, err)
	require.Len(t, types, 3)

	// 2 度目の有効化は 409。
	w = f.do(t, http.MethodPost, ticketProjectBase+"/tickets/enable", "")
	assert.Equal(t, http.StatusConflict, w.Code)

	// 2) 作成（既定の種別・状態を解決）。
	w = f.do(t, http.MethodPost, ticketProjectBase+"/tickets", `{"title":"最初のチケット"}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	created := decodeJSON[domain.Ticket](t, w)
	assert.Equal(t, "最初のチケット", created.Title)
	assert.EqualValues(t, 1, created.Number)
	assert.EqualValues(t, domain.TicketPriorityDefault, created.Priority)

	// 3) 取得。詳細レスポンスには報告者の表示（段 5）が載る。
	w = f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+created.ID, "")
	require.Equal(t, http.StatusOK, w.Code)
	withCreatedBy := decodeJSON[ticketResponse](t, w)
	require.NotNil(t, withCreatedBy.CreatedBy)
	assert.Equal(t, kbUserID, withCreatedBy.CreatedBy.UserID)
	assert.Equal(t, "テストユーザー", withCreatedBy.CreatedBy.Name)

	// 表示キーからの解決。キー自体がプロジェクトの key を含むので URL にプロジェクトを取らない
	// （projectKey はこの fake では projectID と同一視する）。
	w = f.do(t, http.MethodGet, ticketAPIBase+"/tickets/by-key/"+strings.ToUpper(tkProjectID)+"-1", "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	// 4) 一覧。
	w = f.do(t, http.MethodGet, ticketProjectBase+"/tickets", "")
	require.Equal(t, http.StatusOK, w.Code)
	list := decodeJSON[ticketListResponse](t, w)
	require.Len(t, list.Tickets, 1)

	// 5) 更新（PUT 相当。現在値を全部送る）。
	w = f.do(t, http.MethodPut, ticketAPIBase+"/tickets/"+created.ID,
		`{"title":"更新後","doc":{"type":"doc","content":[]},"typeId":"`+created.TypeID+`","priority":1}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	updated := decodeJSON[domain.Ticket](t, w)
	assert.Equal(t, "更新後", updated.Title)
	assert.EqualValues(t, domain.TicketPriorityHigh, updated.Priority)

	// 履歴に 2 項目（title・priority）が積まれている。
	w = f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+created.ID+"/history", "")
	require.Equal(t, http.StatusOK, w.Code)
	hist := decodeJSON[ticketHistoryResponse](t, w)
	require.Len(t, hist.Groups, 1)
	assert.Len(t, hist.Groups[0].Items, 2)
	assert.Equal(t, kbUserID, hist.Groups[0].Actor.UserID, "実行者の表示も段 5 の読み取り経路で解決される")
	assert.Equal(t, "テストユーザー", hist.Groups[0].Actor.Name)

	// 6) 状態変更。
	doneStatus, err := f.tickets.FindTicketStatus(context.Background(), kbWorkspaceID, tkProjectID, statusIDByCategory(statuses, domain.TicketStatusCategoryDone))
	require.NoError(t, err)
	w = f.do(t, http.MethodPost, ticketAPIBase+"/tickets/"+created.ID+"/status", `{"statusId":"`+doneStatus.ID+`"}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	closed := decodeJSON[domain.Ticket](t, w)
	require.NotNil(t, closed.ClosedAt)
	require.NotNil(t, closed.Resolution)
	assert.Equal(t, domain.TicketResolutionDone, *closed.Resolution)

	// 7) 2 件目を作って並び替え（1 件目の直後へ）。
	w = f.do(t, http.MethodPost, ticketProjectBase+"/tickets", `{"title":"2件目"}`)
	require.Equal(t, http.StatusCreated, w.Code)
	second := decodeJSON[domain.Ticket](t, w)
	w = f.do(t, http.MethodPost, ticketAPIBase+"/tickets/"+second.ID+"/move", `{"anchorTicketId":"`+created.ID+`","anchorAfter":false}`)
	require.Equal(t, http.StatusNoContent, w.Code, w.Body.String())

	// 8) 担当の設定・解除。
	w = f.do(t, http.MethodPut, ticketAPIBase+"/tickets/"+created.ID+"/assignee", `{"assigneePrincipalId":"principal-1"}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assignment := decodeJSON[domain.TicketAssignment](t, w)
	assert.Equal(t, "principal-1", assignment.AssigneePrincipalID)
	// 担当を付けたら、詳細・一覧・変更系の応答すべてに同じ形（assigneePrincipalId）で載る。
	// 画面は応答の出どころで型を出し分けなくてよい（設計 Ⅶ の「詳細（… 担当 …）」）。
	w = f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+created.ID, "")
	require.Equal(t, http.StatusOK, w.Code)
	withAssignee := decodeJSON[map[string]any](t, w)
	assert.Equal(t, "principal-1", withAssignee["assigneePrincipalId"], "詳細に担当が載る")

	w = f.do(t, http.MethodGet, ticketProjectBase+"/tickets", "")
	require.Equal(t, http.StatusOK, w.Code)
	listed := decodeJSON[map[string][]map[string]any](t, w)
	assignedInList := 0
	for _, row := range listed["tickets"] {
		if row["assigneePrincipalId"] == "principal-1" {
			assignedInList++
		}
	}
	assert.Equal(t, 1, assignedInList, "一覧にも担当が載る（LEFT JOIN で N+1 にしない）")

	w = f.do(t, http.MethodDelete, ticketAPIBase+"/tickets/"+created.ID+"/assignee", "")
	require.Equal(t, http.StatusNoContent, w.Code)

	// 外したら詳細から消える（omitempty なのでキー自体が無くなる）。
	w = f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+created.ID, "")
	require.Equal(t, http.StatusOK, w.Code)
	afterUnassign := decodeJSON[map[string]any](t, w)
	_, has := afterUnassign["assigneePrincipalId"]
	assert.False(t, has, "担当を外したらキーごと出ない")

	// 9) アーカイブ・復元。
	w = f.do(t, http.MethodPost, ticketAPIBase+"/tickets/"+created.ID+"/archive", "")
	require.Equal(t, http.StatusOK, w.Code)
	archived := decodeJSON[domain.Ticket](t, w)
	require.NotNil(t, archived.ArchivedAt)
	w = f.do(t, http.MethodPost, ticketAPIBase+"/tickets/"+created.ID+"/restore", "")
	require.Equal(t, http.StatusOK, w.Code)
	restored := decodeJSON[domain.Ticket](t, w)
	assert.Nil(t, restored.ArchivedAt)

	// 10) 削除・復元（設計 Ⅳ-J。archived_at とは別の独立した口）。
	w = f.do(t, http.MethodDelete, ticketAPIBase+"/tickets/"+created.ID, "")
	require.Equal(t, http.StatusNoContent, w.Code)

	// 削除済みは通常の取得・一覧・移動・アーカイブから消える（存在しないのと同じ 404）。
	w = f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+created.ID, "")
	assert.Equal(t, http.StatusNotFound, w.Code, "削除済みは取得できない")
	w = f.do(t, http.MethodGet, ticketProjectBase+"/tickets", "")
	require.Equal(t, http.StatusOK, w.Code)
	afterDelete := decodeJSON[ticketListResponse](t, w)
	for _, row := range afterDelete.Tickets {
		assert.NotEqual(t, created.ID, row.ID, "削除済みは一覧に出ない")
	}
	w = f.do(t, http.MethodPost, ticketAPIBase+"/tickets/"+created.ID+"/archive", "")
	assert.Equal(t, http.StatusNotFound, w.Code, "削除済みはアーカイブできない")

	// 二重削除は 404（冪等な失敗）。
	w = f.do(t, http.MethodDelete, ticketAPIBase+"/tickets/"+created.ID, "")
	assert.Equal(t, http.StatusNotFound, w.Code)

	// 復元（restore-deleted）で戻る。
	w = f.do(t, http.MethodPost, ticketAPIBase+"/tickets/"+created.ID+"/restore-deleted", "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	undeleted := decodeJSON[domain.Ticket](t, w)
	assert.Nil(t, undeleted.DeletedAt)
	w = f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+created.ID, "")
	assert.Equal(t, http.StatusOK, w.Code, "復元後は通常どおり取得できる")

	// 現役チケットに restore-deleted を呼んでも 404（削除されていない）。
	w = f.do(t, http.MethodPost, ticketAPIBase+"/tickets/"+created.ID+"/restore-deleted", "")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func statusIDByCategory(statuses []domain.TicketStatus, category domain.TicketStatusCategory) string {
	for _, s := range statuses {
		if s.Category == category {
			return s.ID
		}
	}
	return ""
}

// --- 親子・入力検証 ---

func Test_チケット作成_担当が存在しなければ400(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	f.tickets.addType(domain.TicketType{ID: "type-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Name: "タスク", IsDefault: true})
	f.tickets.addStatus(domain.TicketStatus{ID: "status-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Name: "To Do", Category: domain.TicketStatusCategoryTodo, IsInitial: true})
	created := postTicket(t, f, `{"title":"x"}`)

	w := f.do(t, http.MethodPut, ticketAPIBase+"/tickets/"+created.ID+"/assignee", `{"assigneePrincipalId":"`+ticketFakeMissingPrincipalID+`"}`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
	var body errorResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, "invalid_assignee", body.Error)
}

func Test_チケット作成_開始日が期限より後なら400(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	f.tickets.addType(domain.TicketType{ID: "type-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Name: "タスク", IsDefault: true})
	f.tickets.addStatus(domain.TicketStatus{ID: "status-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Name: "To Do", Category: domain.TicketStatusCategoryTodo, IsInitial: true})

	w := f.do(t, http.MethodPost, ticketProjectBase+"/tickets",
		`{"title":"x","startDate":"2026-09-10","dueDate":"2026-09-01"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	var body errorResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, "invalid_date_range", body.Error)
}

func Test_チケット作成_日付の形式が不正なら400(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	f.tickets.addType(domain.TicketType{ID: "type-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Name: "タスク", IsDefault: true})
	f.tickets.addStatus(domain.TicketStatus{ID: "status-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Name: "To Do", Category: domain.TicketStatusCategoryTodo, IsInitial: true})

	w := f.do(t, http.MethodPost, ticketProjectBase+"/tickets", `{"title":"x","dueDate":"2026/09/10"}`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func Test_チケット作成_優先度が範囲外なら400(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	f.tickets.addType(domain.TicketType{ID: "type-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Name: "タスク", IsDefault: true})
	f.tickets.addStatus(domain.TicketStatus{ID: "status-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Name: "To Do", Category: domain.TicketStatusCategoryTodo, IsInitial: true})

	w := f.do(t, http.MethodPost, ticketProjectBase+"/tickets", `{"title":"x","priority":9}`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func Test_チケット親子_階層規則に反すると409(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	subType := f.tickets.addType(domain.TicketType{ID: "type-sub", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Name: "小作業", HierarchyLevel: -1})
	f.tickets.addStatus(domain.TicketStatus{ID: "status-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Name: "To Do", Category: domain.TicketStatusCategoryTodo, IsInitial: true})
	parent := f.tickets.addTicket(domain.Ticket{ID: "parent-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, TypeID: subType.ID, Title: "親", Number: 1})

	w := f.do(t, http.MethodPost, ticketProjectBase+"/tickets",
		`{"title":"子","parentId":"`+parent.ID+`","typeId":"`+subType.ID+`"}`)
	assert.Equal(t, http.StatusConflict, w.Code)
}

func postTicket(t *testing.T, f ticketFixture, body string) domain.Ticket {
	t.Helper()
	w := f.do(t, http.MethodPost, ticketProjectBase+"/tickets", body)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	return decodeJSON[domain.Ticket](t, w)
}

// --- 状態・種別マスタの管理 ---

func Test_状態マスタ_作成更新初期化アーカイブ復元(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)

	w := f.do(t, http.MethodPost, ticketProjectBase+"/ticket-statuses",
		`{"name":"レビュー中","category":"in_progress","color":"#2f6b47"}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	status := decodeJSON[domain.TicketStatus](t, w)

	w = f.do(t, http.MethodPut, ticketProjectBase+"/ticket-statuses/"+status.ID,
		`{"name":"レビュー中2","category":"in_progress","color":"#a0661a"}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	w = f.do(t, http.MethodPost, ticketProjectBase+"/ticket-statuses/"+status.ID+"/set-initial", "")
	require.Equal(t, http.StatusNoContent, w.Code)

	w = f.do(t, http.MethodGet, ticketProjectBase+"/ticket-statuses", "")
	require.Equal(t, http.StatusOK, w.Code)
	list := decodeJSON[ticketStatusListResponse](t, w)
	require.Len(t, list.Statuses, 1)
	assert.True(t, list.Statuses[0].IsInitial)

	// 現役チケットが参照していれば 409。
	f.tickets.addTicket(domain.Ticket{ID: "t-in-use", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, StatusID: status.ID, TypeID: "type-x", Title: "使用中"})
	w = f.do(t, http.MethodPost, ticketProjectBase+"/ticket-statuses/"+status.ID+"/archive", "")
	assert.Equal(t, http.StatusConflict, w.Code)

	delete(f.tickets.tickets, "t-in-use")
	w = f.do(t, http.MethodPost, ticketProjectBase+"/ticket-statuses/"+status.ID+"/archive", "")
	require.Equal(t, http.StatusNoContent, w.Code)

	w = f.do(t, http.MethodPost, ticketProjectBase+"/ticket-statuses/"+status.ID+"/restore", "")
	require.Equal(t, http.StatusNoContent, w.Code)
}

func Test_種別マスタ_作成更新既定アーカイブ復元(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)

	w := f.do(t, http.MethodPost, ticketProjectBase+"/ticket-types",
		`{"name":"バグ","hierarchyLevel":0,"color":"#9a3b2e"}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	typ := decodeJSON[domain.TicketType](t, w)

	w = f.do(t, http.MethodPut, ticketProjectBase+"/ticket-types/"+typ.ID,
		`{"name":"バグ2","hierarchyLevel":1,"color":"#2f6b47"}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	w = f.do(t, http.MethodPost, ticketProjectBase+"/ticket-types/"+typ.ID+"/set-default", "")
	require.Equal(t, http.StatusNoContent, w.Code)

	w = f.do(t, http.MethodGet, ticketProjectBase+"/ticket-types", "")
	require.Equal(t, http.StatusOK, w.Code)
	list := decodeJSON[ticketTypeListResponse](t, w)
	require.Len(t, list.Types, 1)
	assert.True(t, list.Types[0].IsDefault)

	w = f.do(t, http.MethodPost, ticketProjectBase+"/ticket-types/"+typ.ID+"/archive", "")
	require.Equal(t, http.StatusNoContent, w.Code)
	w = f.do(t, http.MethodPost, ticketProjectBase+"/ticket-types/"+typ.ID+"/restore", "")
	require.Equal(t, http.StatusNoContent, w.Code)
}

// 管理表の「使用中 N 件」。アーカイブが 409 になるかを押す前に見せるための数で、
// 現役のチケットだけを数える（アーカイブ済みは状態のアーカイブを妨げない）。
func Test_状態種別一覧_使用中の件数を返す(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	w := f.do(t, http.MethodPost, ticketProjectBase+"/tickets/enable", "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	statuses, err := f.tickets.ListTicketStatuses(context.Background(), kbWorkspaceID, tkProjectID, false)
	require.NoError(t, err)
	types, err := f.tickets.ListTicketTypes(context.Background(), kbWorkspaceID, tkProjectID, false)
	require.NoError(t, err)
	initial := statuses[0].ID

	// 2 件作って、片方をアーカイブする。
	w = f.do(t, http.MethodPost, ticketProjectBase+"/tickets", `{"title":"1件目"}`)
	require.Equal(t, http.StatusCreated, w.Code)
	first := decodeJSON[domain.Ticket](t, w)
	w = f.do(t, http.MethodPost, ticketProjectBase+"/tickets", `{"title":"2件目"}`)
	require.Equal(t, http.StatusCreated, w.Code)
	second := decodeJSON[domain.Ticket](t, w)
	w = f.do(t, http.MethodPost, ticketAPIBase+"/tickets/"+second.ID+"/archive", "")
	require.Equal(t, http.StatusOK, w.Code)

	countOf := func(path, key, id string) float64 {
		res := f.do(t, http.MethodGet, ticketProjectBase+"/"+path, "")
		require.Equal(t, http.StatusOK, res.Code, res.Body.String())
		body := decodeJSON[map[string][]map[string]any](t, res)
		for _, row := range body[key] {
			if row["id"] == id {
				n, ok := row["activeTicketCount"].(float64)
				require.True(t, ok, "activeTicketCount が数で返る: %v", row["activeTicketCount"])
				return n
			}
		}
		t.Fatalf("%s に %s が無い", key, id)
		return -1
	}

	assert.EqualValues(t, 1, countOf("ticket-statuses", "statuses", initial),
		"アーカイブ済みは数えない（現役 1 件だけ）")
	assert.EqualValues(t, 1, countOf("ticket-types", "types", first.TypeID))

	// 使っていない状態は 0 件（対応表に現れないものは 0 に畳む）。
	assert.EqualValues(t, 0, countOf("ticket-statuses", "statuses", statuses[len(statuses)-1].ID))
	assert.EqualValues(t, 0, countOf("ticket-types", "types", types[len(types)-1].ID))
}

func Test_状態作成_不正な色は400(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	w := f.do(t, http.MethodPost, ticketProjectBase+"/ticket-statuses",
		`{"name":"x","category":"todo","color":"not-a-color"}`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func Test_種別作成_範囲外のhierarchyLevelは400(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	w := f.do(t, http.MethodPost, ticketProjectBase+"/ticket-types",
		`{"name":"x","hierarchyLevel":5,"color":"#2f6b47"}`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func Test_状態種別マスタ_閲覧のみでは編集操作に403(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleViewer)
	w := f.do(t, http.MethodPost, ticketProjectBase+"/ticket-statuses",
		`{"name":"x","category":"todo","color":"#2f6b47"}`)
	assert.Equal(t, http.StatusForbidden, w.Code)

	w = f.do(t, http.MethodPost, ticketProjectBase+"/ticket-types",
		`{"name":"x","hierarchyLevel":0,"color":"#2f6b47"}`)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

// Test_チケット一覧_期日での絞り込み は ?dueBefore= / ?startAfter=（段 4）を固定する。
// 壊れた形式は DB の ::date キャストで 500 になる前に 400 で断る。
func Test_チケット一覧_期日での絞り込み(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	due, start := "2026-01-10", "2026-01-01"
	inRange := f.tickets.addTicket(domain.Ticket{
		ID: "ticket-due-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "対象",
		DueDate: &due, StartDate: &start,
	})
	dueLate, startLate := "2026-03-10", "2026-03-01"
	f.tickets.addTicket(domain.Ticket{
		ID: "ticket-due-2", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "対象外",
		DueDate: &dueLate, StartDate: &startLate,
	})

	w := f.do(t, http.MethodGet, ticketProjectBase+"/tickets?dueBefore=2026-02-01", "")
	require.Equal(t, http.StatusOK, w.Code)
	byDue := decodeJSON[map[string][]map[string]any](t, w)
	require.Len(t, byDue["tickets"], 1)
	assert.Equal(t, inRange.ID, byDue["tickets"][0]["id"])

	w = f.do(t, http.MethodGet, ticketProjectBase+"/tickets?startAfter=2026-02-01", "")
	require.Equal(t, http.StatusOK, w.Code)
	byStart := decodeJSON[map[string][]map[string]any](t, w)
	require.Len(t, byStart["tickets"], 1)
	assert.NotEqual(t, inRange.ID, byStart["tickets"][0]["id"])

	w = f.do(t, http.MethodGet, ticketProjectBase+"/tickets?dueBefore=not-a-date", "")
	assert.Equal(t, http.StatusBadRequest, w.Code, "壊れた形式は400")

	w = f.do(t, http.MethodGet, ticketProjectBase+"/tickets?startAfter=2026/01/01", "")
	assert.Equal(t, http.StatusBadRequest, w.Code, "区切りが違う形式も400")
}

// Test_チケット一覧_保存した絞り込み は unassigned / assignedToMe / overdue / q の 4 つを固定する。
func Test_チケット一覧_保存した絞り込み(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	me := f.perms.userPrincipal(kbWorkspaceID, kbUserID)
	require.NotNil(t, me, "前提: 自分の principal が解決できる")

	unassigned := f.tickets.addTicket(domain.Ticket{ID: "t-unassigned", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "未割り当て"})
	mine := f.tickets.addTicket(domain.Ticket{ID: "t-mine", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "自分の担当"})
	w := f.do(t, http.MethodPut, ticketAPIBase+"/tickets/"+mine.ID+"/assignee", `{"assigneePrincipalId":"`+me.ID+`"}`)
	require.Equal(t, http.StatusOK, w.Code)
	others := f.tickets.addTicket(domain.Ticket{ID: "t-others", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "他人の担当"})
	w = f.do(t, http.MethodPut, ticketAPIBase+"/tickets/"+others.ID+"/assignee", `{"assigneePrincipalId":"principal-other"}`)
	require.Equal(t, http.StatusOK, w.Code)

	w = f.do(t, http.MethodGet, ticketProjectBase+"/tickets?unassigned=true", "")
	require.Equal(t, http.StatusOK, w.Code)
	got := decodeJSON[map[string][]map[string]any](t, w)
	require.Len(t, got["tickets"], 1)
	assert.Equal(t, unassigned.ID, got["tickets"][0]["id"])

	w = f.do(t, http.MethodGet, ticketProjectBase+"/tickets?assignedToMe=true", "")
	require.Equal(t, http.StatusOK, w.Code)
	got = decodeJSON[map[string][]map[string]any](t, w)
	require.Len(t, got["tickets"], 1)
	assert.Equal(t, mine.ID, got["tickets"][0]["id"])

	w = f.do(t, http.MethodGet, ticketProjectBase+"/tickets?q=担当", "")
	require.Equal(t, http.StatusOK, w.Code)
	got = decodeJSON[map[string][]map[string]any](t, w)
	assert.Len(t, got["tickets"], 2, "「自分の担当」「他人の担当」の2件がタイトルで引っかかる")

	// unassigned・assignedToMe・assigneePrincipalId は互いに排他。同時指定は400。
	w = f.do(t, http.MethodGet, ticketProjectBase+"/tickets?unassigned=true&assignedToMe=true", "")
	assert.Equal(t, http.StatusBadRequest, w.Code, "unassignedとassignedToMeの同時指定は400")
	w = f.do(t, http.MethodGet, ticketProjectBase+"/tickets?unassigned=true&assigneePrincipalId="+me.ID, "")
	assert.Equal(t, http.StatusBadRequest, w.Code, "unassignedとassigneePrincipalIdの同時指定も400")
}

// Test_チケット件数 はサイドバー「保存した絞り込み」の件数バッジ（GET .../tickets/counts）を固定する。
func Test_チケット件数(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	me := f.perms.userPrincipal(kbWorkspaceID, kbUserID)
	require.NotNil(t, me)

	f.tickets.addStatus(domain.TicketStatus{ID: "status-todo", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Category: domain.TicketStatusCategoryTodo})
	overdueDate := "2020-01-01"
	f.tickets.addTicket(domain.Ticket{ID: "t-overdue", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "期限切れ", DueDate: &overdueDate, StatusID: "status-todo"})
	mine := f.tickets.addTicket(domain.Ticket{ID: "t-mine-2", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "自分の担当2"})
	w := f.do(t, http.MethodPut, ticketAPIBase+"/tickets/"+mine.ID+"/assignee", `{"assigneePrincipalId":"`+me.ID+`"}`)
	require.Equal(t, http.StatusOK, w.Code)
	f.tickets.addTicket(domain.Ticket{ID: "t-unassigned-2", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "未割り当て2"})

	w = f.do(t, http.MethodGet, ticketProjectBase+"/tickets/counts", "")
	require.Equal(t, http.StatusOK, w.Code)
	got := decodeJSON[ticketCountsResponse](t, w)
	assert.Equal(t, int64(3), got.Total)
	assert.Equal(t, int64(1), got.AssignedToMe)
	assert.Equal(t, int64(1), got.Overdue)
	assert.Equal(t, int64(2), got.Unassigned)
}

// Test_チケット詳細_祖先列を根から順に返す は ancestors フィールド（段 5・パンくず用）を固定する。
func Test_チケット詳細_祖先列を根から順に返す(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleViewer)
	root := f.tickets.addTicket(domain.Ticket{ID: "anc-root", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "根"})
	child := f.tickets.addTicket(domain.Ticket{ID: "anc-child", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "子", ParentID: &root.ID})
	grand := f.tickets.addTicket(domain.Ticket{ID: "anc-grand", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "孫", ParentID: &child.ID})

	w := f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+grand.ID, "")
	require.Equal(t, http.StatusOK, w.Code)
	got := decodeJSON[ticketResponse](t, w)
	require.Len(t, got.Ancestors, 2, "根から順に2件")
	assert.Equal(t, root.ID, got.Ancestors[0].ID)
	assert.Equal(t, child.ID, got.Ancestors[1].ID)

	// ルート自身には祖先が無い。
	w = f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+root.ID, "")
	require.Equal(t, http.StatusOK, w.Code)
	gotRoot := decodeJSON[ticketResponse](t, w)
	assert.Empty(t, gotRoot.Ancestors)
}

// Test_チケット子一覧 は /tickets/:id/children が直下の子だけを並び順で返すことを固定する
// （孫・アーカイブ済み・他チケットの子は含まない）。
func Test_チケット子一覧(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleViewer)
	parent := f.tickets.addTicket(domain.Ticket{ID: "ch-parent", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "親"})
	second := f.tickets.addTicket(domain.Ticket{ID: "ch-2", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "子2", ParentID: &parent.ID, Position: "a1"})
	first := f.tickets.addTicket(domain.Ticket{ID: "ch-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "子1", ParentID: &parent.ID, Position: "a0"})
	f.tickets.addTicket(domain.Ticket{ID: "ch-grand", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "孫", ParentID: &first.ID, Position: "a0"})
	archived := time.Now()
	f.tickets.addTicket(domain.Ticket{ID: "ch-archived", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "アーカイブ済みの子", ParentID: &parent.ID, Position: "a2", ArchivedAt: &archived})
	f.tickets.addTicket(domain.Ticket{ID: "ch-unrelated", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "無関係"})

	w := f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+parent.ID+"/children", "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	got := decodeJSON[ticketListResponse](t, w)
	require.Len(t, got.Tickets, 2, "孫・アーカイブ済み・無関係は含まない")
	assert.Equal(t, first.ID, got.Tickets[0].ID, "position 順で子1が先")
	assert.Equal(t, second.ID, got.Tickets[1].ID)

	w = f.do(t, http.MethodGet, ticketAPIBase+"/tickets/does-not-exist/children", "")
	assert.Equal(t, http.StatusNotFound, w.Code, "親自体が存在しなければ404")
}

// Test_チケットのページ逆参照 は /tickets/:id/page-backlinks の権限配線を固定する
// （中身の可視判定そのものは persistence の結合テストが固定する）。
func Test_チケットのページ逆参照(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleViewer)
	target := f.tickets.addTicket(domain.Ticket{ID: "ref-target", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "対象"})

	w := f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+target.ID+"/page-backlinks", "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	pages := decodeJSON[[]domain.Page](t, w)
	assert.Empty(t, pages, "fakeは空配列を返す設定 — 200であること自体が配線の確認")

	w = f.do(t, http.MethodGet, ticketAPIBase+"/tickets/does-not-exist/page-backlinks", "")
	assert.Equal(t, http.StatusNotFound, w.Code, "存在しないチケットは404")
}

// 詳細の応答に載る実効権限。画面はこれを見て「発言できるか」「他人の発言を消せるか」を
// 出し分ける。編集できること（CanEdit）とは別の段なので、CanEdit だけでは判断できない。
func Test_チケット取得_役割ごとの実効権限を応答に載せる(t *testing.T) {
	cases := []struct {
		role       domain.GrantRole
		canComment bool
		canEdit    bool
		canManage  bool
	}{
		{domain.GrantRoleViewer, false, false, false},
		{domain.GrantRoleCommenter, true, false, false},
		{domain.GrantRoleEditor, true, true, false},
		{domain.GrantRoleAdmin, true, true, true},
	}
	for _, tc := range cases {
		t.Run(string(tc.role), func(t *testing.T) {
			f := newTicketFixture(kbUserID, tc.role)
			tk := f.tickets.addTicket(domain.Ticket{
				ID: "ticket-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "x", Number: 1,
			})

			w := f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+tk.ID, "")

			require.Equal(t, http.StatusOK, w.Code, w.Body.String())
			got := decodeJSON[struct {
				Permission *domain.ScopePermission `json:"permission"`
			}](t, w)
			require.NotNil(t, got.Permission, "詳細の応答には必ず権限が載る")
			assert.True(t, got.Permission.CanView)
			assert.Equal(t, tc.canComment, got.Permission.CanComment)
			assert.Equal(t, tc.canEdit, got.Permission.CanEdit)
			assert.Equal(t, tc.canManage, got.Permission.CanManage)
		})
	}
}

// 一覧には載せない。実効権限はプロジェクト単位で行ごとに変わらないので、同じ値が全行に並ぶだけ。
func Test_チケット一覧_実効権限は載せない(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	f.tickets.addTicket(domain.Ticket{
		ID: "ticket-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "x", Number: 1,
	})

	w := f.do(t, http.MethodGet, ticketProjectBase+"/tickets", "")

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.NotContains(t, w.Body.String(), `"permission"`)
}
