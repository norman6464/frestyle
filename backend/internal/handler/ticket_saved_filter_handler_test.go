package handler

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const tkSavedFilterBase = ticketProjectBase + "/saved-filters"

// seedSavedFilterTickets は状態 2 つ（To Do / Done）とチケット 3 件を置く。To Do の 2 件のうち
// 1 件（ticket-1）は自分の担当。件数バッジの検証に使う。
func seedSavedFilterTickets(f ticketFixture) {
	f.tickets.addStatus(domain.TicketStatus{
		ID: "status-todo", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Name: "To Do",
		Category: domain.TicketStatusCategoryTodo, IsInitial: true,
	})
	f.tickets.addStatus(domain.TicketStatus{
		ID: "status-done", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Name: "Done",
		Category: domain.TicketStatusCategoryDone,
	})
	f.tickets.addTicket(domain.Ticket{
		ID: "ticket-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "ログイン画面が崩れる",
		StatusID: "status-todo", Number: 1, Position: "a0",
	})
	f.tickets.addTicket(domain.Ticket{
		ID: "ticket-2", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "検索が遅い",
		StatusID: "status-todo", Number: 2, Position: "a1",
	})
	f.tickets.addTicket(domain.Ticket{
		ID: "ticket-3", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "終わった作業",
		StatusID: "status-done", Number: 3, Position: "a2",
	})
	me := f.perms.userPrincipal(kbWorkspaceID, kbUserID)
	f.tickets.assignments["ticket-1"] = &domain.TicketAssignment{
		WorkspaceID: kbWorkspaceID, TicketID: "ticket-1", AssigneePrincipalID: me.ID, AssignedByUserID: kbUserID,
	}
}

func Test_保存した絞り込み一式_作成一覧更新削除(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	seedSavedFilterTickets(f)

	// 1) 作成。件数はその条件に合う現役チケット数。
	w := f.do(t, http.MethodPost, tkSavedFilterBase, `{"name":"未完了","statusId":"status-todo"}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	created := decodeJSON[dto.TicketSavedFilterResponse](t, w)
	require.NotEmpty(t, created.ID)
	assert.Equal(t, "未完了", created.Name)
	require.NotNil(t, created.StatusID)
	assert.Equal(t, "status-todo", *created.StatusID)
	assert.Equal(t, int64(2), created.Count)

	// 2) 「自分の担当」は本人の主体で数える（フロントエンドは主体 ID を知らない）。
	w = f.do(t, http.MethodPost, tkSavedFilterBase, `{"name":"自分の未完了","statusId":"status-todo","assignedToMe":true}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	mine := decodeJSON[dto.TicketSavedFilterResponse](t, w)
	assert.Equal(t, int64(1), mine.Count)
	assert.True(t, mine.AssignedToMe)

	// 3) 一覧は作った順、件数付き。
	w = f.do(t, http.MethodGet, tkSavedFilterBase, "")
	require.Equal(t, http.StatusOK, w.Code)
	list := decodeJSON[dto.TicketSavedFilterListResponse](t, w)
	require.Len(t, list.SavedFilters, 2)
	assert.Equal(t, []string{"未完了", "自分の未完了"}, []string{list.SavedFilters[0].Name, list.SavedFilters[1].Name})
	assert.Equal(t, []int64{2, 1}, []int64{list.SavedFilters[0].Count, list.SavedFilters[1].Count})

	// 4) 更新は名前と条件を丸ごと差し替え、件数も数え直す。
	w = f.do(t, http.MethodPut, tkSavedFilterBase+"/"+created.ID, `{"name":"未完了の検索","statusId":"status-todo","q":"検索"}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	updated := decodeJSON[dto.TicketSavedFilterResponse](t, w)
	assert.Equal(t, created.ID, updated.ID)
	assert.Equal(t, "未完了の検索", updated.Name)
	require.NotNil(t, updated.Q)
	assert.Equal(t, "検索", *updated.Q)
	assert.Equal(t, int64(1), updated.Count)

	// 5) 削除。2 回目は「無い」。
	w = f.do(t, http.MethodDelete, tkSavedFilterBase+"/"+created.ID, "")
	assert.Equal(t, http.StatusNoContent, w.Code)
	w = f.do(t, http.MethodGet, tkSavedFilterBase, "")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Len(t, decodeJSON[dto.TicketSavedFilterListResponse](t, w).SavedFilters, 1)
	w = f.do(t, http.MethodDelete, tkSavedFilterBase+"/"+created.ID, "")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func Test_保存した絞り込み_一覧が0件なら空配列(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleViewer)
	w := f.do(t, http.MethodGet, tkSavedFilterBase, "")
	require.Equal(t, http.StatusOK, w.Code)
	assert.JSONEq(t, `{"savedFilters":[]}`, w.Body.String())
}

func Test_保存した絞り込み_同名は大文字小文字違いでも409(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	w := f.do(t, http.MethodPost, tkSavedFilterBase, `{"name":"Bugs","overdue":true}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())

	w = f.do(t, http.MethodPost, tkSavedFilterBase, `{"name":"bugs","unassigned":true}`)
	require.Equal(t, http.StatusConflict, w.Code, w.Body.String())
	assert.Equal(t, "saved_filter_name_taken", decodeJSON[errorResponse](t, w).Error)
}

func Test_保存した絞り込み_入力の誤りは理由ごとに400(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	cases := []struct{ name, body, want string }{
		{"名前が無い", `{"overdue":true}`, "invalid_request"},
		{"名前が空白だけ", `{"name":"  ","overdue":true}`, "invalid_filter_name"},
		{"条件が無い", `{"name":"すべて"}`, "filter_has_no_condition"},
		{"担当の条件が2つ", `{"name":"担当","assignedToMe":true,"unassigned":true}`, "assignee_mode_conflict"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := f.do(t, http.MethodPost, tkSavedFilterBase, tc.body)
			require.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
			assert.Equal(t, tc.want, decodeJSON[errorResponse](t, w).Error)
		})
	}
}

func Test_保存した絞り込み_存在しない状態を指せば404(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	w := f.do(t, http.MethodPost, tkSavedFilterBase, `{"name":"x","statusId":"status-nope"}`)
	require.Equal(t, http.StatusNotFound, w.Code, w.Body.String())
	assert.Equal(t, "not_found", decodeJSON[errorResponse](t, w).Error)
}

func Test_保存した絞り込み_他人の分は見えず書き換えられず消せない(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	other := f.tickets.addSavedFilter(domain.TicketSavedFilter{
		ID: "filter-other", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, UserID: kbUserID + 1,
		Name: "他人の絞り込み", Overdue: true,
	})

	w := f.do(t, http.MethodGet, tkSavedFilterBase, "")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Empty(t, decodeJSON[dto.TicketSavedFilterListResponse](t, w).SavedFilters)

	w = f.do(t, http.MethodPut, tkSavedFilterBase+"/"+other.ID, `{"name":"乗っ取り","overdue":true}`)
	assert.Equal(t, http.StatusNotFound, w.Code, w.Body.String())
	w = f.do(t, http.MethodDelete, tkSavedFilterBase+"/"+other.ID, "")
	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "他人の絞り込み", f.tickets.savedFilters[other.ID].Name, "他人の行は変わらない")
}

func Test_保存した絞り込み_閲覧だけの役割でも自分の分は作れる_役割が無ければ404(t *testing.T) {
	viewer := newTicketFixture(kbUserID, domain.GrantRoleViewer)
	w := viewer.do(t, http.MethodPost, tkSavedFilterBase, `{"name":"期限切れ","overdue":true}`)
	assert.Equal(t, http.StatusCreated, w.Code, w.Body.String())

	none := newTicketFixture(kbUserID, "")
	w = none.do(t, http.MethodGet, tkSavedFilterBase, "")
	assert.Equal(t, http.StatusNotFound, w.Code)
	w = none.do(t, http.MethodPost, tkSavedFilterBase, `{"name":"期限切れ","overdue":true}`)
	assert.Equal(t, http.StatusNotFound, w.Code)

	anon := newTicketFixture(0, domain.GrantRoleEditor)
	w = anon.do(t, http.MethodGet, tkSavedFilterBase, "")
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func Test_保存した絞り込み_上限に達したら409(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	for i := 0; i < domain.MaxTicketSavedFiltersPerProject; i++ {
		f.tickets.addSavedFilter(domain.TicketSavedFilter{
			ID: "filter-" + strconv.Itoa(i), WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, UserID: kbUserID,
			Name: "絞り込み " + strconv.Itoa(i), Overdue: true,
		})
	}
	w := f.do(t, http.MethodPost, tkSavedFilterBase, `{"name":"21 個目","overdue":true}`)
	require.Equal(t, http.StatusConflict, w.Code, w.Body.String())
	assert.Equal(t, "saved_filter_limit_reached", decodeJSON[errorResponse](t, w).Error)
}
