package handler

import (
	"net/http"
	"strings"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Test_添付一式_発行記録一覧ダウンロードURL削除 は添付（段 4）の一連の流れを HTTP 経由で
// 確かめる。usecase 層の単体テスト（attachment_usecase_test.go）は認可以外のふるまいを
// 直接見ているので、ここでは handler の配線に絞る。
func Test_添付一式_発行記録一覧ダウンロードURL削除(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	target := f.tickets.addTicket(domain.Ticket{ID: "ticket-attachments-1", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "対象チケット"})
	base := ticketAPIBase + "/tickets/" + target.ID + "/attachments"

	// 1) アップロード URL の発行。
	w := f.do(t, http.MethodPost, base+"/upload-url", `{"contentType":"application/pdf","size":1024}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	issued := decodeJSON[map[string]any](t, w)
	key, ok := issued["key"].(string)
	require.True(t, ok)
	assert.True(t, strings.HasPrefix(key, "tickets/"+kbWorkspaceID+"/"+target.ID+"/"), "keyはチケットに閉じた接頭辞を持つ")
	assert.NotEmpty(t, issued["url"])

	// 2) メタデータの記録。
	w = f.do(t, http.MethodPost, base,
		`{"key":"`+key+`","filename":"資料.pdf","contentType":"application/pdf","sizeBytes":1024}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	created := decodeJSON[map[string]any](t, w)
	attachmentID, ok := created["id"].(string)
	require.True(t, ok)
	assert.Equal(t, "資料.pdf", created["filename"])
	_, keyLeaked := created["key"]
	assert.False(t, keyLeaked, "内部のオブジェクトキーは応答に出さない")

	// 3) 一覧。
	w = f.do(t, http.MethodGet, base, "")
	require.Equal(t, http.StatusOK, w.Code)
	list := decodeJSON[map[string][]map[string]any](t, w)
	require.Len(t, list["attachments"], 1)

	// 4) ダウンロード URL の発行。
	w = f.do(t, http.MethodGet, base+"/"+attachmentID+"/download-url", "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	dl := decodeJSON[map[string]any](t, w)
	assert.NotEmpty(t, dl["url"])

	// 5) 削除。
	w = f.do(t, http.MethodDelete, base+"/"+attachmentID, "")
	require.Equal(t, http.StatusNoContent, w.Code)
	w = f.do(t, http.MethodGet, base, "")
	require.Equal(t, http.StatusOK, w.Code)
	afterDelete := decodeJSON[map[string][]map[string]any](t, w)
	assert.Empty(t, afterDelete["attachments"])
}

func Test_添付_閲覧のみではアップロードURL発行403だが一覧は見える(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleViewer)
	target := f.tickets.addTicket(domain.Ticket{ID: "ticket-attachments-viewer", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "x"})
	base := ticketAPIBase + "/tickets/" + target.ID + "/attachments"

	w := f.do(t, http.MethodPost, base+"/upload-url", `{"contentType":"application/pdf","size":1024}`)
	assert.Equal(t, http.StatusForbidden, w.Code)

	w = f.do(t, http.MethodGet, base, "")
	assert.Equal(t, http.StatusOK, w.Code, "閲覧できれば一覧は読める")
}

// 閲覧のみでは記録・削除・ダウンロードURL発行も含め編集系はすべて403になる。
func Test_添付_閲覧のみでは記録も削除も403(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleViewer)
	target := f.tickets.addTicket(domain.Ticket{ID: "ticket-attachments-viewer2", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "x"})
	base := ticketAPIBase + "/tickets/" + target.ID + "/attachments"

	w := f.do(t, http.MethodPost, base, `{"key":"tickets/`+kbWorkspaceID+`/`+target.ID+`/1.bin","filename":"x.pdf","contentType":"application/pdf","sizeBytes":1024}`)
	assert.Equal(t, http.StatusForbidden, w.Code)
	w = f.do(t, http.MethodDelete, base+"/no-such-id", "")
	assert.Equal(t, http.StatusForbidden, w.Code, "編集権限の判定が先に立つため対象の実在は問わない")
}

// 存在しない添付のダウンロードURL発行・削除は404になる。
func Test_添付_存在しない添付のダウンロードURL発行削除は404(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	target := f.tickets.addTicket(domain.Ticket{ID: "ticket-attachments-404", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "x"})
	base := ticketAPIBase + "/tickets/" + target.ID + "/attachments"

	w := f.do(t, http.MethodGet, base+"/no-such-id/download-url", "")
	assert.Equal(t, http.StatusNotFound, w.Code)
	w = f.do(t, http.MethodDelete, base+"/no-such-id", "")
	assert.Equal(t, http.StatusNotFound, w.Code)
}

// 存在しないチケットへのアップロードURL発行は404になる（requireTicketPermission の
// エラー分岐 — CheckTicketPermissionUseCase の FindTicket が失敗する経路）。
func Test_添付_存在しないチケットへのアップロードURL発行は404(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	w := f.do(t, http.MethodPost, ticketAPIBase+"/tickets/no-such-ticket/attachments/upload-url",
		`{"contentType":"application/pdf","size":1024}`)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func Test_添付_許可リスト外のContentTypeは拒否(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	target := f.tickets.addTicket(domain.Ticket{ID: "ticket-attachments-2", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "x"})

	w := f.do(t, http.MethodPost, ticketAPIBase+"/tickets/"+target.ID+"/attachments/upload-url",
		`{"contentType":"application/x-msdownload","size":1024}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	body := decodeJSON[map[string]any](t, w)
	assert.Equal(t, "unsupported_content_type", body["error"])
}

func Test_添付_上限を超えるサイズと空のファイル名は拒否(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	target := f.tickets.addTicket(domain.Ticket{ID: "ticket-attachments-5", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "x"})
	base := ticketAPIBase + "/tickets/" + target.ID + "/attachments"

	w := f.do(t, http.MethodPost, base+"/upload-url",
		`{"contentType":"application/pdf","size":30000000}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	body := decodeJSON[map[string]any](t, w)
	assert.Equal(t, "attachment_too_large", body["error"])

	key := "tickets/" + kbWorkspaceID + "/" + target.ID + "/1.bin"
	w = f.do(t, http.MethodPost, base, `{"key":"`+key+`","filename":"","contentType":"application/pdf","sizeBytes":1024}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	body = decodeJSON[map[string]any](t, w)
	assert.Equal(t, "invalid_request", body["error"])
}

// 他チケット由来の key をそのまま記録しようとすると拒否される
// （CreateTicketAttachmentUseCase の防御。attachment_usecase_test.go の直接テストと対で、
// ここでは handler がエラーを正しく 400 へ写像することを確かめる）。
func Test_添付_他チケット由来のkeyは記録できない(t *testing.T) {
	f := newTicketFixture(kbUserID, domain.GrantRoleEditor)
	target := f.tickets.addTicket(domain.Ticket{ID: "ticket-attachments-3", WorkspaceID: kbWorkspaceID, ProjectID: tkProjectID, Title: "x"})

	foreignKey := "tickets/" + kbWorkspaceID + "/some-other-ticket/123.bin"
	w := f.do(t, http.MethodPost, ticketAPIBase+"/tickets/"+target.ID+"/attachments",
		`{"key":"`+foreignKey+`","filename":"x.pdf","contentType":"application/pdf","sizeBytes":1024}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	body := decodeJSON[map[string]any](t, w)
	assert.Equal(t, "invalid_attachment_key", body["error"])
}
