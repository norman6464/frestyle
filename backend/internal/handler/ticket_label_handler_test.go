package handler

import (
	"net/http"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Test_ラベル一式_作成一覧更新削除付け外し はラベルの一連の流れを HTTP 経由で確かめる。
// usecase 層の単体テスト（label_usecase_test.go）は認可以外のふるまいを直接見ているので、
// ここでは handler の配線（ルーティング・JSON バインド・応答の形）に絞る。
//
// ラベルの語彙はワークスペース単位なので、管理の口も /workspaces/:slug/labels に付く
// （プロジェクトの下ではない）。
func Test_ラベル一式_作成一覧更新削除付け外し(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	labelBase := ticketAPIBase

	// 1) 作成。
	w := f.do(t, http.MethodPost, labelBase+"/labels", `{"name":"緊急","color":"#FF0000"}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	created := decodeJSON[map[string]any](t, w)
	labelID, ok := created["id"].(string)
	require.True(t, ok)
	assert.Equal(t, "緊急", created["name"])
	assert.Equal(t, "#ff0000", created["color"], "色は正規化して返る")

	// 2) 同名（空白・大文字小文字違い）は拒否。
	w = f.do(t, http.MethodPost, labelBase+"/labels", `{"name":"  緊急  ","color":"#00ff00"}`)
	assert.Equal(t, http.StatusConflict, w.Code, "空白・大文字小文字違いの重複は409")

	// 3) 一覧。
	w = f.do(t, http.MethodGet, labelBase+"/labels", "")
	require.Equal(t, http.StatusOK, w.Code)
	list := decodeJSON[map[string][]map[string]any](t, w)
	require.Len(t, list["labels"], 1)

	// 4) 更新。
	w = f.do(t, http.MethodPut, labelBase+"/labels/"+labelID, `{"name":"重大","color":"#0000ff"}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	updated := decodeJSON[map[string]any](t, w)
	assert.Equal(t, "重大", updated["name"])

	// 5) チケットへ付与し、詳細応答に載る。
	target := f.tickets.addTicket(domain.Ticket{ID: "ticket-labels-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "対象チケット"})
	w = f.do(t, http.MethodPut, ticketAPIBase+"/tickets/"+target.ID+"/labels/"+labelID, "")
	require.Equal(t, http.StatusNoContent, w.Code, w.Body.String())

	w = f.do(t, http.MethodGet, ticketAPIBase+"/tickets/"+target.ID, "")
	require.Equal(t, http.StatusOK, w.Code)
	got := decodeJSON[map[string]any](t, w)
	labels, _ := got["labels"].([]any)
	require.Len(t, labels, 1, "詳細応答にラベルが載る")

	// 6) 一覧応答にも載り、?label= で絞り込める。
	w = f.do(t, http.MethodGet, ticketProjectBase+"/tickets", "")
	require.Equal(t, http.StatusOK, w.Code)
	listTickets := decodeJSON[map[string][]map[string]any](t, w)
	found := false
	for _, tk := range listTickets["tickets"] {
		if tk["id"] == target.ID {
			ls, _ := tk["labels"].([]any)
			found = len(ls) == 1
		}
	}
	assert.True(t, found, "一覧応答にもラベルが載る")

	w = f.do(t, http.MethodGet, ticketProjectBase+"/tickets?label="+labelID, "")
	require.Equal(t, http.StatusOK, w.Code)
	filtered := decodeJSON[map[string][]map[string]any](t, w)
	require.Len(t, filtered["tickets"], 1, "?label= で絞り込める")

	w = f.do(t, http.MethodGet, ticketProjectBase+"/tickets?label=00000000-0000-0000-0000-000000000000", "")
	require.Equal(t, http.StatusOK, w.Code)
	none := decodeJSON[map[string][]map[string]any](t, w)
	assert.Empty(t, none["tickets"], "付いていないラベルで絞ると0件")

	// 7) 除去は冪等。
	w = f.do(t, http.MethodDelete, ticketAPIBase+"/tickets/"+target.ID+"/labels/"+labelID, "")
	require.Equal(t, http.StatusNoContent, w.Code)
	w = f.do(t, http.MethodDelete, ticketAPIBase+"/tickets/"+target.ID+"/labels/"+labelID, "")
	assert.Equal(t, http.StatusNoContent, w.Code, "付いていないラベルを外しても成功する")

	// 8) 削除。
	w = f.do(t, http.MethodDelete, labelBase+"/labels/"+labelID, "")
	require.Equal(t, http.StatusNoContent, w.Code)
	w = f.do(t, http.MethodGet, labelBase+"/labels", "")
	require.Equal(t, http.StatusOK, w.Code)
	afterDelete := decodeJSON[map[string][]map[string]any](t, w)
	assert.Empty(t, afterDelete["labels"])
}

func Test_ラベル_閲覧のみでは作成403だが一覧は見える(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleViewer)
	labelBase := ticketAPIBase

	w := f.do(t, http.MethodPost, labelBase+"/labels", `{"name":"x","color":"#2f6b47"}`)
	assert.Equal(t, http.StatusForbidden, w.Code)

	w = f.do(t, http.MethodGet, labelBase+"/labels", "")
	assert.Equal(t, http.StatusOK, w.Code, "閲覧できれば一覧は読める")
}

// 閲覧のみでは更新・削除・チケットへの付け外しもすべて403になる（作成と同じ判定を通る）。
func Test_ラベル_閲覧のみでは更新削除付け外しも403(t *testing.T) {
	editor := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	labelBase := ticketAPIBase
	w := editor.do(t, http.MethodPost, labelBase+"/labels", `{"name":"x","color":"#2f6b47"}`)
	require.Equal(t, http.StatusCreated, w.Code)
	created := decodeJSON[map[string]any](t, w)
	labelID := created["id"].(string)
	target := editor.tickets.addTicket(domain.Ticket{ID: "ticket-labels-viewer", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "x"})

	viewer := ticketFixtureSameRepo(t, editor, kbUserID+1, domain.GrantRoleViewer)

	w = viewer.do(t, http.MethodPut, labelBase+"/labels/"+labelID, `{"name":"y","color":"#2f6b47"}`)
	assert.Equal(t, http.StatusForbidden, w.Code)
	w = viewer.do(t, http.MethodDelete, labelBase+"/labels/"+labelID, "")
	assert.Equal(t, http.StatusForbidden, w.Code)
	w = viewer.do(t, http.MethodPut, ticketAPIBase+"/tickets/"+target.ID+"/labels/"+labelID, "")
	assert.Equal(t, http.StatusForbidden, w.Code)
	w = viewer.do(t, http.MethodDelete, ticketAPIBase+"/tickets/"+target.ID+"/labels/"+labelID, "")
	assert.Equal(t, http.StatusForbidden, w.Code)
}

// 存在しないラベルの更新・削除は404になる。
func Test_ラベル_存在しないラベルの更新削除は404(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	labelBase := ticketAPIBase

	w := f.do(t, http.MethodPut, labelBase+"/labels/no-such-label", `{"name":"y","color":"#2f6b47"}`)
	assert.Equal(t, http.StatusNotFound, w.Code)
	w = f.do(t, http.MethodDelete, labelBase+"/labels/no-such-label", "")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

// 存在しないチケットへの付け外しは404になる（CheckTicketPermissionUseCase の FindTicket が
// 失敗する経路。requireTicketPermission のエラー分岐を通す）。
func Test_ラベル_存在しないチケットへの付け外しは404(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	w := f.do(t, http.MethodPut, ticketAPIBase+"/tickets/no-such-ticket/labels/no-such-label", "")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

// 別ワークスペースのラベルをチケットへ付けようとすると「無い」と同じ扱い（404）になる。
func Test_ラベル_別ワークスペースのラベルはチケットへ付けられない(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	target := f.tickets.addTicket(domain.Ticket{ID: "ticket-labels-2", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "x"})
	f.tickets.labels["label-other"] = &domain.Label{
		ID: "label-other", WorkspaceID: kbOtherWorkspaceID, Name: "別ワークスペース", Color: "#2f6b47",
	}

	w := f.do(t, http.MethodPut, ticketAPIBase+"/tickets/"+target.ID+"/labels/label-other", "")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

// Test_ラベル_別ワークスペースのラベルは更新も削除もできない は、URL の workspaceSlug に対する
// 権限しか確かめない handler を悪用して、別テナントのラベルを改名・削除できないことを固定する。
// 攻撃者は「相手ワークスペースの編集権限」を一切持たない（ラベルの実在すら知らなくてよい）。
//
// 変異確認: UpdateLabel / DeleteLabel の SQL から workspace_id の条件を外すと、
// このテストの 404 判定・「行はそのまま残っている」判定が落ちる。
func Test_ラベル_別ワークスペースのラベルは更新も削除もできない(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	labelBase := ticketAPIBase
	f.tickets.labels["label-other"] = &domain.Label{
		ID: "label-other", WorkspaceID: kbOtherWorkspaceID, Name: "別テナントの名前", Color: "#2f6b47",
	}

	w := f.do(t, http.MethodPut, labelBase+"/labels/label-other", `{"name":"乗っ取り","color":"#ff0000"}`)
	assert.Equal(t, http.StatusNotFound, w.Code, w.Body.String())
	w = f.do(t, http.MethodDelete, labelBase+"/labels/label-other", "")
	assert.Equal(t, http.StatusNotFound, w.Code, w.Body.String())

	assert.Equal(t, "別テナントの名前", f.tickets.labels["label-other"].Name, "書き換えられていない")
}
