package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/dto"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// kbInvitee は招かれるが、まだ所属していないユーザー。kbUserID（f.perms.addMember 済み）
// とは別に用意する — 招待の本質は「まだ principal が無い」ことなので、既存メンバーの ID を
// 使うと検証にならない。
const (
	kbInvitee      = uint64(900)
	kbInviteeEmail = "invitee@example.com"
	kbInvitePath   = "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/invitations"
	kbPreviewPath  = "/api/v2/kb/invitations/preview"
)

// kbAdminFixture は kbUserID を acme の admin にした環境（招く側）。
func kbAdminFixture(t *testing.T) kbPermFixture {
	t.Helper()
	return newKbPermFixture(t, kbUserID, kbGrantRolePtr(domain.GrantRoleAdmin))
}

// kbInviteeFixture は kbInvitee（確認済み email あり・非メンバー）としてログインした環境（招かれる側）。
// inviterIsAdmin なら kbUserID を admin にしておく（承諾は招いた人が今も admin であることを要求する）。
func kbInviteeFixture(t *testing.T, inviterIsAdmin bool) kbFixture {
	t.Helper()
	f := newKbFixture(kbCanEdit, kbInvitee)
	f.users.setUserName(kbInvitee, "招かれる人")
	f.users.setUserEmail(kbInvitee, kbInviteeEmail)
	if inviterIsAdmin {
		ctx := context.Background()
		admin, err := f.perms.EnsureUserPrincipal(ctx, kbWorkspaceID, kbUserID)
		require.NoError(t, err)
		_, err = f.perms.UpsertWorkspaceGrant(ctx, kbWorkspaceID, admin.ID, domain.GrantRoleAdmin, kbUserID)
		require.NoError(t, err)
	}
	return f
}

// seedInvitation は fake に招待を 1 件入れる（HTTP を通さない下ごしらえ）。平文トークンも返す。
func seedInvitation(t *testing.T, f kbFixture, email string, inviter uint64, expiresAt time.Time) (*domain.Invitation, string) {
	t.Helper()
	token := "token-for-" + email
	inv, err := f.invitations.Upsert(context.Background(), repository.InvitationWrite{
		WorkspaceID: kbWorkspaceID, Scope: domain.InvitationScopeWorkspace, Role: domain.GrantRoleEditor,
		Email: email, InviteeName: "招かれる人", TokenHash: kbTestTokenHash(token), ActorUserID: inviter,
		ExpiresAt: expiresAt, SentBefore: time.Now().Add(-10 * time.Minute),
	})
	require.NoError(t, err)
	return inv, token
}

func decodeIssued(t *testing.T, body []byte) dto.KbIssuedInvitationResponse {
	t.Helper()
	var got dto.KbIssuedInvitationResponse
	require.NoError(t, json.Unmarshal(body, &got))
	return got
}

func decodePreview(t *testing.T, body []byte) dto.KbInvitationPreviewResponse {
	t.Helper()
	var got dto.KbInvitationPreviewResponse
	require.NoError(t, json.Unmarshal(body, &got))
	return got
}

func Test_招待API_adminはemailで招きトークンが1回だけ返る(t *testing.T) {
	f := kbAdminFixture(t)
	w := f.do(t, http.MethodPost, kbInvitePath, `{"email":" Invitee@Example.com ","name":" 招かれる人 ","role":"editor"}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	got := decodeIssued(t, w.Body.Bytes())
	assert.Equal(t, kbInviteeEmail, got.Invitation.Email, "宛先は正規形で保存する")
	assert.Equal(t, "招かれる人", got.Invitation.InviteeName)
	assert.Equal(t, "editor", got.Invitation.Role)
	assert.Equal(t, "pending", got.Invitation.Status)
	assert.Equal(t, kbWorkspaceSlug, got.Invitation.WorkspaceSlug)
	assert.Equal(t, kbUserID, got.Invitation.InvitedByUserID)
	assert.Equal(t, 1, got.Invitation.SendCount)
	assert.NotEmpty(t, got.Token)
	assert.NotContains(t, w.Body.String(), `"tokenHash"`, "SHA-256 は応答に出さない")

	// 招待 URL を開いた人（未認証）への案内はトークンで引ける。
	public := newKbFixture(kbCanEdit, 0)
	public.invitations = f.invitations // 同じ fake を読む（別の router から）
	registerKnowledgeBasePublicRoutesWith(public.router.Group("/api/v2/again"), public.pages, public.perms, public.perms, f.invitations)
	pw := public.do(t, http.MethodPost, "/api/v2/again/kb/invitations/preview", `{"token":"`+got.Token+`"}`)
	require.Equal(t, http.StatusOK, pw.Code, pw.Body.String())
	preview := decodePreview(t, pw.Body.Bytes())
	assert.Equal(t, "pending", preview.Status)
	assert.Equal(t, f.pages.workspaces[kbWorkspaceSlug].Name, preview.WorkspaceName)
	assert.Equal(t, kbInviteeEmail, preview.Email)
	assert.Equal(t, "editor", preview.Role)
	assert.Equal(t, "workspace", preview.Scope)

	// 招待だけでは通知も所属も発生しない（宛先にアカウントが無い）。
	assert.Empty(t, f.notifications.created)
}

func Test_招待API_既にアカウントのある宛先にはアプリ内通知を出す(t *testing.T) {
	f := kbAdminFixture(t)
	f.users.setUserName(kbUserID, "管理者")
	f.users.setUserName(kbInvitee, "招かれる人")
	f.users.setUserEmail(kbInvitee, kbInviteeEmail)

	w := f.do(t, http.MethodPost, kbInvitePath, `{"email":"`+kbInviteeEmail+`","role":"viewer"}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())

	require.Len(t, f.notifications.created, 1)
	n := f.notifications.created[0]
	assert.Equal(t, kbInvitee, n.UserID)
	assert.Equal(t, domain.NotificationTypeWorkspaceInvitation, n.Type)
	assert.Equal(t, "/invitations", n.LinkPath)
	assert.Contains(t, n.Title, "管理者")
	assert.Contains(t, n.Title, "「"+f.pages.workspaces[kbWorkspaceSlug].Name+"」")
	assert.Nil(t, f.perms.userPrincipal(kbWorkspaceID, kbInvitee), "招待だけでは所属しない")
}

func Test_招待API_入力の誤りは400(t *testing.T) {
	f := kbAdminFixture(t)
	for name, body := range map[string]string{
		"emailの形でない":  `{"email":"taro","role":"editor"}`,
		"表示名付きのemail": `{"email":"山田 <taro@example.com>","role":"editor"}`,
		"役割が未知":       `{"email":"taro@example.com","role":"owner"}`,
		"役割が無い":       `{"email":"taro@example.com"}`,
		"本文が無い":       ``,
	} {
		t.Run(name, func(t *testing.T) {
			w := f.do(t, http.MethodPost, kbInvitePath, body)
			assert.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
		})
	}
}

func Test_招待API_同じ宛先への連投は再送の間隔で断る(t *testing.T) {
	f := kbAdminFixture(t)
	body := `{"email":"` + kbInviteeEmail + `","role":"editor"}`
	require.Equal(t, http.StatusCreated, f.do(t, http.MethodPost, kbInvitePath, body).Code)
	w := f.do(t, http.MethodPost, kbInvitePath, body)
	assert.Equal(t, http.StatusTooManyRequests, w.Code)
	assert.JSONEq(t, `{"error":"resend_too_soon"}`, w.Body.String())
}

func Test_招待API_一覧と再送と取消(t *testing.T) {
	f := kbAdminFixture(t)
	created := decodeIssued(t, f.do(t, http.MethodPost, kbInvitePath, `{"email":"`+kbInviteeEmail+`","role":"editor"}`).Body.Bytes())
	id := created.Invitation.ID

	// 一覧: fixture が用意した pending@example.com と、今作った 2 件。
	w := f.do(t, http.MethodGet, kbInvitePath, "")
	require.Equal(t, http.StatusOK, w.Code)
	var list []dto.KbInvitationResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &list))
	require.Len(t, list, 2)
	assert.Equal(t, id, list[0].ID, "新しい順")
	assert.Equal(t, "pending", list[0].Status)

	// 再送: 直後は間隔が空いていない。
	w = f.do(t, http.MethodPost, kbInvitePath+"/"+id+"/resend", "")
	assert.Equal(t, http.StatusTooManyRequests, w.Code)
	assert.JSONEq(t, `{"error":"resend_too_soon"}`, w.Body.String())

	// 間隔が空けばトークンが差し替わり、前のトークンの案内は使えなくなる。
	f.invitations.rows[id].LastSentAt = time.Now().Add(-time.Hour)
	w = f.do(t, http.MethodPost, kbInvitePath+"/"+id+"/resend", "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	resent := decodeIssued(t, w.Body.Bytes())
	assert.NotEqual(t, created.Token, resent.Token)
	assert.Equal(t, 2, resent.Invitation.SendCount)
	assert.Equal(t, id, resent.Invitation.ID, "同じ行を更新する（新しい行は作らない）")
	public := newKbFixture(kbCanEdit, 0)
	registerKnowledgeBasePublicRoutesWith(public.router.Group("/api/v2/again"), public.pages, public.perms, public.perms, f.invitations)
	assert.Equal(t, "unavailable", decodePreview(t, public.do(t, http.MethodPost, "/api/v2/again/kb/invitations/preview", `{"token":"`+created.Token+`"}`).Body.Bytes()).Status)
	assert.Equal(t, "pending", decodePreview(t, public.do(t, http.MethodPost, "/api/v2/again/kb/invitations/preview", `{"token":"`+resent.Token+`"}`).Body.Bytes()).Status)

	// 取消は冪等。取消後は再送できず、一覧には revoked として残る。
	require.Equal(t, http.StatusNoContent, f.do(t, http.MethodDelete, kbInvitePath+"/"+id, "").Code)
	assert.Equal(t, http.StatusNoContent, f.do(t, http.MethodDelete, kbInvitePath+"/"+id, "").Code, "2 回目も成功")
	w = f.do(t, http.MethodPost, kbInvitePath+"/"+id+"/resend", "")
	assert.Equal(t, http.StatusConflict, w.Code)
	assert.JSONEq(t, `{"error":"invitation_not_open"}`, w.Body.String())
	w = f.do(t, http.MethodGet, kbInvitePath, "")
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &list))
	assert.Equal(t, "revoked", list[0].Status)
	assert.NotNil(t, list[0].RevokedAt)
	assert.Equal(t, "unavailable", decodePreview(t, public.do(t, http.MethodPost, "/api/v2/again/kb/invitations/preview", `{"token":"`+resent.Token+`"}`).Body.Bytes()).Status)

	// 無い id は 404。
	assert.Equal(t, http.StatusNotFound, f.do(t, http.MethodDelete, kbInvitePath+"/"+kbMissingID, "").Code)
	assert.Equal(t, http.StatusNotFound, f.do(t, http.MethodPost, kbInvitePath+"/"+kbMissingID+"/resend", "").Code)
}

func Test_招待API_自分宛の一覧は未認証を401にする(t *testing.T) {
	f := newKbFixture(kbCanEdit, 0)
	assert.Equal(t, http.StatusUnauthorized, f.do(t, http.MethodGet, "/api/v2/kb/invitations", "").Code)
	assert.Equal(t, http.StatusUnauthorized, f.do(t, http.MethodPost, "/api/v2/kb/invitations/"+kbMissingID+"/accept", "").Code)
	assert.Equal(t, http.StatusUnauthorized, f.do(t, http.MethodPost, "/api/v2/kb/invitations/"+kbMissingID+"/decline", "").Code)
}

func Test_招待API_自分宛の一覧は確認済みemailが要り自分の宛先だけ返す(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbInvitee)
	f.users.setUserName(kbInvitee, "招かれる人")
	w := f.do(t, http.MethodGet, "/api/v2/kb/invitations", "")
	assert.Equal(t, http.StatusForbidden, w.Code)
	assert.JSONEq(t, `{"error":"email_not_verified"}`, w.Body.String())

	f.users.setUserEmail(kbInvitee, kbInviteeEmail)
	mine, _ := seedInvitation(t, f, kbInviteeEmail, kbUserID, time.Now().Add(24*time.Hour))
	seedInvitation(t, f, "someone-else@example.com", kbUserID, time.Now().Add(24*time.Hour))
	seedInvitation(t, f, "expired@example.com", kbUserID, time.Now().Add(-time.Minute))

	w = f.do(t, http.MethodGet, "/api/v2/kb/invitations", "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var got []dto.KbInvitationResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
	require.Len(t, got, 1)
	assert.Equal(t, mine.ID, got[0].ID)
	assert.Equal(t, kbWorkspaceSlug, got[0].WorkspaceSlug)
	assert.Equal(t, f.pages.workspaces[kbWorkspaceSlug].Name, got[0].WorkspaceName)
}

func Test_招待API_承諾するとメンバーになり役割が届く(t *testing.T) {
	f := kbInviteeFixture(t, true)
	inv, _ := seedInvitation(t, f, kbInviteeEmail, kbUserID, time.Now().Add(24*time.Hour))
	require.Nil(t, f.perms.userPrincipal(kbWorkspaceID, kbInvitee), "前提: まだ非メンバー")

	w := f.do(t, http.MethodPost, "/api/v2/kb/invitations/"+inv.ID+"/accept", "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var got dto.KbAcceptedInvitationResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
	assert.Equal(t, kbWorkspaceSlug, got.WorkspaceSlug)
	assert.Equal(t, "workspace", got.Scope)
	require.NotNil(t, f.perms.userPrincipal(kbWorkspaceID, kbInvitee), "承諾すると principal ができる")
	facts, err := f.perms.PagePermissionFactsForUser(context.Background(), kbWorkspaceID, kbRootPageID, kbInvitee)
	require.NoError(t, err)
	assert.True(t, domain.ResolvePagePermission(*facts).CanEdit, "招待の役割（editor）が届く")

	// 承諾済みは二度使えず、自分宛の一覧からも消える。
	w = f.do(t, http.MethodPost, "/api/v2/kb/invitations/"+inv.ID+"/accept", "")
	assert.Equal(t, http.StatusConflict, w.Code)
	assert.JSONEq(t, `{"error":"invitation_not_open"}`, w.Body.String())
	w = f.do(t, http.MethodGet, "/api/v2/kb/invitations", "")
	assert.JSONEq(t, `[]`, w.Body.String())
}

func Test_招待API_宛先が違う招待は無いのと同じ404(t *testing.T) {
	f := kbInviteeFixture(t, true)
	inv, _ := seedInvitation(t, f, "someone-else@example.com", kbUserID, time.Now().Add(24*time.Hour))
	w := f.do(t, http.MethodPost, "/api/v2/kb/invitations/"+inv.ID+"/accept", "")
	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.JSONEq(t, `{"error":"not_found"}`, w.Body.String())
	assert.Equal(t, http.StatusNotFound, f.do(t, http.MethodPost, "/api/v2/kb/invitations/"+inv.ID+"/decline", "").Code)
	assert.Equal(t, http.StatusNotFound, f.do(t, http.MethodPost, "/api/v2/kb/invitations/"+kbMissingID+"/accept", "").Code, "無い id も同じ応答")
	assert.Nil(t, f.perms.userPrincipal(kbWorkspaceID, kbInvitee))
}

func Test_招待API_確認済みemailが無いと承諾も辞退もできない(t *testing.T) {
	f := kbInviteeFixture(t, true)
	f.users.emails = map[uint64]string{}
	inv, _ := seedInvitation(t, f, kbInviteeEmail, kbUserID, time.Now().Add(24*time.Hour))
	w := f.do(t, http.MethodPost, "/api/v2/kb/invitations/"+inv.ID+"/accept", "")
	assert.Equal(t, http.StatusForbidden, w.Code)
	assert.JSONEq(t, `{"error":"email_not_verified"}`, w.Body.String())
	assert.Equal(t, http.StatusForbidden, f.do(t, http.MethodPost, "/api/v2/kb/invitations/"+inv.ID+"/decline", "").Code)
}

func Test_招待API_招いた人がadminでなくなった招待は承諾できない(t *testing.T) {
	f := kbInviteeFixture(t, false)
	inv, _ := seedInvitation(t, f, kbInviteeEmail, kbUserID, time.Now().Add(24*time.Hour))
	w := f.do(t, http.MethodPost, "/api/v2/kb/invitations/"+inv.ID+"/accept", "")
	assert.Equal(t, http.StatusConflict, w.Code)
	assert.JSONEq(t, `{"error":"invitation_not_open"}`, w.Body.String())
	assert.Nil(t, f.perms.userPrincipal(kbWorkspaceID, kbInvitee))
}

func Test_招待API_期限切れは承諾できない(t *testing.T) {
	f := kbInviteeFixture(t, true)
	inv, _ := seedInvitation(t, f, kbInviteeEmail, kbUserID, time.Now().Add(-time.Minute))
	w := f.do(t, http.MethodPost, "/api/v2/kb/invitations/"+inv.ID+"/accept", "")
	assert.Equal(t, http.StatusConflict, w.Code)
	assert.JSONEq(t, `{"error":"invitation_not_open"}`, w.Body.String())
	// 期限切れでも辞退（片付け）はできる。
	assert.Equal(t, http.StatusNoContent, f.do(t, http.MethodPost, "/api/v2/kb/invitations/"+inv.ID+"/decline", "").Code)
}

func Test_招待API_辞退すると一覧から消え非メンバーのまま(t *testing.T) {
	f := kbInviteeFixture(t, true)
	inv, _ := seedInvitation(t, f, kbInviteeEmail, kbUserID, time.Now().Add(24*time.Hour))

	require.Equal(t, http.StatusNoContent, f.do(t, http.MethodPost, "/api/v2/kb/invitations/"+inv.ID+"/decline", "").Code)
	assert.Nil(t, f.perms.userPrincipal(kbWorkspaceID, kbInvitee), "辞退してもメンバーにはならない")
	w := f.do(t, http.MethodPost, "/api/v2/kb/invitations/"+inv.ID+"/accept", "")
	assert.Equal(t, http.StatusConflict, w.Code, "辞退済みは承諾できない")
	assert.JSONEq(t, `[]`, f.do(t, http.MethodGet, "/api/v2/kb/invitations", "").Body.String())
}

func Test_招待API_案内は未認証で通り使えない招待は理由を伏せる(t *testing.T) {
	f := newKbFixture(kbCanEdit, 0)
	w := f.do(t, http.MethodPost, kbPreviewPath, `{"token":"no-such-token"}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.JSONEq(t, `{"status":"unavailable"}`, w.Body.String(), "無いトークンでも 404 にしない")
	assert.Equal(t, http.StatusBadRequest, f.do(t, http.MethodPost, kbPreviewPath, `{}`).Code)
}
