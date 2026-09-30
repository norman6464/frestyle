package handler

import (
	"context"
	"crypto/sha256"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 権限操作 API（grant / メンバー / グループ / 招待）の handler テスト。
//
// 見るのは 2 つだけ:
//
//  1. admin 以外は 1 本も通らないこと（viewer / editor / commenter / 非メンバー /
//     別ワークスペースの admin の 5 通り）
//  2. 拒否の応答が、対象が実在するかどうかで変わらないこと（存在オラクルを作らない）
//
// 実効権限そのものの規則は domain と usecase のテストが持つ。ここで固定するのは
// 「その規則が HTTP の入口で必ず適用されること」。

const (
	// kbSecondUserID は権限を張られる側のユーザー。
	kbSecondUserID = uint64(43)
	// kbOutsiderUserID はどのワークスペースにも所属しないユーザー。
	kbOutsiderUserID = uint64(97)
	// kbRivalAdminUserID は別ワークスペース（rival）の admin。acme には所属しない。
	kbRivalAdminUserID = uint64(98)
	// kbMissingID は存在しない UUID。存在オラクルの検証に使う。
	kbMissingID = "0198a000-0000-7000-8000-0000000000ff"
	// kbMissingUserID は存在しないユーザー ID。
	kbMissingUserID = "987654"
)

// kbDenied は権限操作 API の唯一の拒否応答（バイト列で固定する）。
const kbDenied = `{"error":"not_found"}`

// kbPermissionEndpoint は権限操作の 1 エンドポイント。
type kbPermissionEndpoint struct {
	name   string
	method string
	// pattern は gin に登録されるルートのパターン（登録漏れ検査の照合に使う）。
	pattern string
	// path は実リクエストのパス（プレースホルダ入り）。
	path string
	// missing は対象を存在しない ID に差し替えたパス。拒否応答が
	// 対象の実在で変わらないことを見るために使う。
	missing  []string
	body     string
	okStatus int
}

// kbPermissionEndpoints は「権限そのものを変える」全エンドポイント。
// ルートを足したらここにも足す（kb_page_handler_test.go の登録漏れ検査が照合する）。
var kbPermissionEndpoints = []kbPermissionEndpoint{
	{
		name: "ワークスペース権限付与", method: http.MethodPut,
		pattern: "/api/v2/kb/workspaces/:workspaceSlug/grants/:principalId",
		path:    "/api/v2/kb/workspaces/{slug}/grants/{target}",
		missing: []string{"/api/v2/kb/workspaces/{slug}/grants/" + kbMissingID},
		body:    `{"role":"editor"}`, okStatus: http.StatusOK,
	},
	{
		name: "ワークスペース権限取り消し", method: http.MethodDelete,
		pattern:  "/api/v2/kb/workspaces/:workspaceSlug/grants/:principalId",
		path:     "/api/v2/kb/workspaces/{slug}/grants/{target}",
		missing:  []string{"/api/v2/kb/workspaces/{slug}/grants/" + kbMissingID},
		okStatus: http.StatusNoContent,
	},
	{
		name: "スペース権限付与", method: http.MethodPut,
		pattern: "/api/v2/kb/workspaces/:workspaceSlug/spaces/:spaceId/grants/:principalId",
		path:    "/api/v2/kb/workspaces/{slug}/spaces/{space}/grants/{target}",
		missing: []string{
			"/api/v2/kb/workspaces/{slug}/spaces/" + kbMissingID + "/grants/{target}",
			"/api/v2/kb/workspaces/{slug}/spaces/{space}/grants/" + kbMissingID,
		},
		body: `{"role":"editor"}`, okStatus: http.StatusOK,
	},
	{
		name: "スペース権限取り消し", method: http.MethodDelete,
		pattern: "/api/v2/kb/workspaces/:workspaceSlug/spaces/:spaceId/grants/:principalId",
		path:    "/api/v2/kb/workspaces/{slug}/spaces/{space}/grants/{target}",
		missing: []string{
			"/api/v2/kb/workspaces/{slug}/spaces/" + kbMissingID + "/grants/{target}",
		},
		okStatus: http.StatusNoContent,
	},
	{
		// 人を招く入口は email 宛の招待（users.id を受ける口は無い）。missing は持たない — 宛先の
		// 実在は応答で分からない（無いアドレスにも 201 で招待が作られる）。
		name: "email招待", method: http.MethodPost,
		pattern:  "/api/v2/kb/workspaces/:workspaceSlug/invitations",
		path:     "/api/v2/kb/workspaces/{slug}/invitations",
		body:     `{"email":"taro@example.com","role":"editor"}`,
		okStatus: http.StatusCreated,
	},
	{
		name: "招待一覧", method: http.MethodGet,
		pattern:  "/api/v2/kb/workspaces/:workspaceSlug/invitations",
		path:     "/api/v2/kb/workspaces/{slug}/invitations",
		okStatus: http.StatusOK,
	},
	{
		name: "招待の再送", method: http.MethodPost,
		pattern:  "/api/v2/kb/workspaces/:workspaceSlug/invitations/:invitationId/resend",
		path:     "/api/v2/kb/workspaces/{slug}/invitations/{invitation}/resend",
		missing:  []string{"/api/v2/kb/workspaces/{slug}/invitations/" + kbMissingID + "/resend"},
		okStatus: http.StatusOK,
	},
	{
		name: "招待の取消", method: http.MethodDelete,
		pattern:  "/api/v2/kb/workspaces/:workspaceSlug/invitations/:invitationId",
		path:     "/api/v2/kb/workspaces/{slug}/invitations/{invitation}",
		missing:  []string{"/api/v2/kb/workspaces/{slug}/invitations/" + kbMissingID},
		okStatus: http.StatusNoContent,
	},
	{
		name: "メンバー削除", method: http.MethodDelete,
		pattern:  "/api/v2/kb/workspaces/:workspaceSlug/members/:userId",
		path:     "/api/v2/kb/workspaces/{slug}/members/" + strconv.FormatUint(kbSecondUserID, 10),
		missing:  []string{"/api/v2/kb/workspaces/{slug}/members/" + kbMissingUserID},
		okStatus: http.StatusNoContent,
	},
	{
		name: "グループ作成", method: http.MethodPost,
		pattern: "/api/v2/kb/workspaces/:workspaceSlug/groups",
		path:    "/api/v2/kb/workspaces/{slug}/groups",
		body:    `{"name":"運用チーム"}`, okStatus: http.StatusCreated,
	},
	{
		name: "グループメンバー追加", method: http.MethodPut,
		pattern:  "/api/v2/kb/workspaces/:workspaceSlug/groups/:groupPrincipalId/members/:userId",
		path:     "/api/v2/kb/workspaces/{slug}/groups/{group}/members/" + strconv.FormatUint(kbSecondUserID, 10),
		missing:  []string{"/api/v2/kb/workspaces/{slug}/groups/" + kbMissingID + "/members/" + strconv.FormatUint(kbSecondUserID, 10)},
		okStatus: http.StatusNoContent,
	},
	{
		name: "グループメンバー削除", method: http.MethodDelete,
		pattern:  "/api/v2/kb/workspaces/:workspaceSlug/groups/:groupPrincipalId/members/:userId",
		path:     "/api/v2/kb/workspaces/{slug}/groups/{group}/members/" + strconv.FormatUint(kbSecondUserID, 10),
		missing:  []string{"/api/v2/kb/workspaces/{slug}/groups/" + kbMissingID + "/members/" + strconv.FormatUint(kbSecondUserID, 10)},
		okStatus: http.StatusNoContent,
	},
	{
		name: "スペース全員主体の用意", method: http.MethodPut,
		pattern:  "/api/v2/kb/workspaces/:workspaceSlug/spaces/:spaceId/principals/everyone",
		path:     "/api/v2/kb/workspaces/{slug}/spaces/{space}/principals/everyone",
		missing:  []string{"/api/v2/kb/workspaces/{slug}/spaces/" + kbMissingID + "/principals/everyone"},
		okStatus: http.StatusOK,
	},
}

// kbPermFixture は権限操作 API の検証環境。
type kbPermFixture struct {
	kbFixture
	// callerPrincipalID は呼び出し元の主体（メンバーでなければ空）。
	callerPrincipalID string
	// targetPrincipalID は権限を張られる側（別のユーザー）の主体。
	targetPrincipalID string
	// groupPrincipalID はグループの主体。
	groupPrincipalID string
	// invitationID は発行済み（未決）の email 宛の招待。再送・取消の対象。
	invitationID string
}

// newKbPermFixture は uid の立場を作って権限操作 API を叩ける環境を返す。
// role が nil なら uid はワークスペースのメンバーにしない（非メンバーの再現）。
//
// 呼び出し元の役割を setScopeRole ではなく UpsertWorkspaceGrant で張るのは、
// 「最後の admin」の検査が grant の行を数えるため。テストだけ別経路で役割を作ると、
// その検査が本番と違う入力で動いてしまう。
func newKbPermFixture(t *testing.T, uid uint64, role *domain.GrantRole) kbPermFixture {
	t.Helper()
	f := newKbFixture(kbNoPerm, uid)
	ctx := context.Background()

	out := kbPermFixture{kbFixture: f}
	if role != nil {
		caller, err := f.perms.EnsureUserPrincipal(ctx, kbWorkspaceID, uid)
		require.NoError(t, err)
		_, err = f.perms.UpsertWorkspaceGrant(ctx, kbWorkspaceID, caller.ID, *role, uid)
		require.NoError(t, err)
		out.callerPrincipalID = caller.ID
	}

	// 権限を張られる側。呼び出し元自身を対象にすると「最後の admin」の検査に
	// ぶつかって、認可の検証と別の理由で落ちる。
	target, err := f.perms.EnsureUserPrincipal(ctx, kbWorkspaceID, kbSecondUserID)
	require.NoError(t, err)
	out.targetPrincipalID = target.ID

	group, err := f.perms.CreateGroupPrincipal(ctx, kbWorkspaceID, "開発チーム")
	require.NoError(t, err)
	out.groupPrincipalID = group.ID

	invitation, err := f.invitations.Upsert(ctx, repository.InvitationWrite{
		WorkspaceID: kbWorkspaceID, Scope: domain.InvitationScopeWorkspace, Role: domain.GrantRoleEditor,
		Email: "pending@example.com", TokenHash: kbTestTokenHash("invitation-token-for-test"),
		ActorUserID: kbUserID, ExpiresAt: time.Now().Add(7 * 24 * time.Hour), SentBefore: time.Now().Add(-10 * time.Minute),
	})
	require.NoError(t, err)
	// 再送の間隔（10 分）を空けた状態にしておく（admin の再送が 429 で落ちないように）。
	f.invitations.rows[invitation.ID].LastSentAt = time.Now().Add(-time.Hour)
	out.invitationID = invitation.ID
	return out
}

// kbTestTokenHash は usecase 側と同じ SHA-256 でトークンを縮める
// （fake に入れた招待を、本物の経路から引けるようにするため）。
func kbTestTokenHash(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

func (f kbPermFixture) fill(s string) string {
	return strings.NewReplacer(
		"{slug}", kbWorkspaceSlug,
		"{space}", kbSpaceID,
		"{page}", kbChildPageID,
		"{target}", f.targetPrincipalID,
		"{group}", f.groupPrincipalID,
		"{invitation}", f.invitationID,
	).Replace(s)
}

func (f kbPermFixture) call(t *testing.T, e kbPermissionEndpoint, path string) (int, []byte) {
	t.Helper()
	w := f.do(t, e.method, f.fill(path), f.fill(e.body))
	return w.Code, w.Body.Bytes()
}

func kbGrantRolePtr(r domain.GrantRole) *domain.GrantRole { return &r }

func Test_ナレッジ権限API_adminだけが通る(t *testing.T) {
	// admin 以外の 5 通り。どれも同じ 404 + 同じ本文で断られなければならない。
	//
	// super_admin 等のアプリ内ロールをここに 1 つも足していないことも同時に固定している
	// （fixture が注入する domain.User にロールを持たせても結果は変わらない）。
	personas := []struct {
		name  string
		uid   uint64
		role  *domain.GrantRole
		setup func(f kbPermFixture)
	}{
		{name: "viewer", uid: kbUserID, role: kbGrantRolePtr(domain.GrantRoleViewer)},
		{name: "commenter", uid: kbUserID, role: kbGrantRolePtr(domain.GrantRoleCommenter)},
		{name: "editor", uid: kbUserID, role: kbGrantRolePtr(domain.GrantRoleEditor)},
		{name: "非メンバー", uid: kbOutsiderUserID, role: nil},
		{
			name: "別ワークスペースのadmin", uid: kbRivalAdminUserID, role: nil,
			setup: func(f kbPermFixture) {
				ctx := context.Background()
				p, err := f.perms.EnsureUserPrincipal(ctx, kbOtherWorkspaceID, kbRivalAdminUserID)
				if err != nil {
					panic(err)
				}
				if _, err := f.perms.UpsertWorkspaceGrant(ctx, kbOtherWorkspaceID, p.ID, domain.GrantRoleAdmin, kbRivalAdminUserID); err != nil {
					panic(err)
				}
			},
		},
	}

	for _, persona := range personas {
		for _, e := range kbPermissionEndpoints {
			t.Run(persona.name+"/"+e.name, func(t *testing.T) {
				f := newKbPermFixture(t, persona.uid, persona.role)
				if persona.setup != nil {
					persona.setup(f)
				}
				code, body := f.call(t, e, e.path)
				assert.Equal(t, http.StatusNotFound, code)
				assert.JSONEq(t, kbDenied, string(body))
			})
		}
	}
}

func Test_ナレッジ権限API_adminは全経路を通れる(t *testing.T) {
	for _, e := range kbPermissionEndpoints {
		t.Run(e.name, func(t *testing.T) {
			f := newKbPermFixture(t, kbUserID, kbGrantRolePtr(domain.GrantRoleAdmin))
			code, body := f.call(t, e, e.path)
			assert.Equal(t, e.okStatus, code, "body=%s", string(body))
		})
	}
}

func Test_ナレッジ権限API_拒否の応答は対象の実在で変わらない(t *testing.T) {
	// 存在オラクル対策の本命。権限の無い相手から見て、実在する対象と存在しない対象の
	// 応答がバイト単位で一致することを固定する（片方だけ別の応答を返すと、ID を
	// 総当たりするだけで中身を読まずに実在を数え上げられる）。
	for _, e := range kbPermissionEndpoints {
		if len(e.missing) == 0 {
			continue // 対象 ID を受け取らない経路（グループ作成）は総当たりの的が無い
		}
		t.Run(e.name, func(t *testing.T) {
			f := newKbPermFixture(t, kbUserID, kbGrantRolePtr(domain.GrantRoleEditor))
			wantCode, wantBody := f.call(t, e, e.path)
			require.Equal(t, http.StatusNotFound, wantCode)

			for _, missing := range e.missing {
				gotCode, gotBody := f.call(t, e, missing)
				assert.Equal(t, wantCode, gotCode, "path=%s", missing)
				assert.Equal(t, wantBody, gotBody, "path=%s（本文がバイト単位で一致すること）", missing)
			}
		})
	}
}

func Test_ナレッジ権限API_未認証は通らない(t *testing.T) {
	// current user を注入しないルータ。middleware.KnowledgeBaseWorkspace が 401 を返す。
	for _, e := range kbPermissionEndpoints {
		t.Run(e.name, func(t *testing.T) {
			f := newKbPermFixture(t, 0, nil)
			w := f.do(t, e.method, f.fill(e.path), f.fill(e.body))
			assert.Equal(t, http.StatusUnauthorized, w.Code)
		})
	}
}

func Test_ナレッジ権限API_最後のadminは外せない(t *testing.T) {
	f := newKbPermFixture(t, kbUserID, kbGrantRolePtr(domain.GrantRoleAdmin))
	path := "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/grants/" + f.callerPrincipalID

	w := f.do(t, http.MethodDelete, path, "")
	assert.Equal(t, http.StatusConflict, w.Code, "取り消しで admin が 0 人になる")
	assert.JSONEq(t, `{"error":"last_workspace_admin"}`, w.Body.String())

	w = f.do(t, http.MethodPut, path, `{"role":"editor"}`)
	assert.Equal(t, http.StatusConflict, w.Code, "降格も admin を外す操作")

	w = f.do(t, http.MethodDelete,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/members/"+strconv.FormatUint(kbUserID, 10), "")
	assert.Equal(t, http.StatusConflict, w.Code, "メンバー削除でも principal ごと消える")
}

func Test_ナレッジ権限API_admin2人目が居れば外せる(t *testing.T) {
	f := newKbPermFixture(t, kbUserID, kbGrantRolePtr(domain.GrantRoleAdmin))
	ctx := context.Background()
	_, err := f.perms.UpsertWorkspaceGrant(ctx, kbWorkspaceID, f.targetPrincipalID, domain.GrantRoleAdmin, kbUserID)
	require.NoError(t, err)

	w := f.do(t, http.MethodDelete,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/grants/"+f.callerPrincipalID, "")
	assert.Equal(t, http.StatusNoContent, w.Code)
}

func Test_ナレッジ権限API_競合で断られた取り消しも409(t *testing.T) {
	// 手前の検査（CanRemoveWorkspaceAdminUseCase）は読み取りだけなので、admin 2 人を
	// ほぼ同時に外す要求は両方ともそこを通り抜ける。実際に 0 人を止めているのは
	// repository 側で、判定と書き換えを同じトランザクションに入れて断る。
	// そのときの応答が「先に断られた」ときと同じ 409 であることを固定する
	// （撃ち分けると、呼び出し側は競合かどうかで別の分岐を持たされる）。
	f := newKbPermFixture(t, kbUserID, kbGrantRolePtr(domain.GrantRoleAdmin))
	ctx := context.Background()
	_, err := f.perms.UpsertWorkspaceGrant(ctx, kbWorkspaceID, f.targetPrincipalID, domain.GrantRoleAdmin, kbUserID)
	require.NoError(t, err) // 手前の検査は通る（admin は 2 人）
	f.perms.revokeGrantErr = repository.ErrLastWorkspaceAdmin

	w := f.do(t, http.MethodDelete,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/grants/"+f.callerPrincipalID, "")
	assert.Equal(t, http.StatusConflict, w.Code)
	assert.JSONEq(t, `{"error":"last_workspace_admin"}`, w.Body.String())
}

// kbSuspendPath / kbRestorePath はアカウントの停止・復帰（段 7）。members/:userId の
// サブリソースなので、認可の軸はメンバー削除と同じ「そのワークスペースの admin」。
// pattern 版は kb_page_handler_test.go のルート登録漏れ検査（kbRoutePattern を通さず
// gin のパターンをそのまま使う。kbPermissionEndpoints.pattern と同じ作法）が使う。
const (
	kbSuspendPath    = "/api/v2/kb/workspaces/{slug}/members/" + "43" + "/suspend"
	kbRestorePath    = "/api/v2/kb/workspaces/{slug}/members/" + "43" + "/restore"
	kbSuspendPattern = "/api/v2/kb/workspaces/:workspaceSlug/members/:userId/suspend"
	kbRestorePattern = "/api/v2/kb/workspaces/:workspaceSlug/members/:userId/restore"
)

func Test_ナレッジ権限API_停止はadminだけが通る(t *testing.T) {
	f := newKbPermFixture(t, kbUserID, kbGrantRolePtr(domain.GrantRoleAdmin))
	f.users.setUserName(kbSecondUserID, "対象ユーザー")

	w := f.do(t, http.MethodPut, f.fill(kbSuspendPath), "")
	assert.Equal(t, http.StatusNoContent, w.Code, w.Body.String())
}

func Test_ナレッジ権限API_停止はeditorでは通らない(t *testing.T) {
	// requireWorkspaceAdmin は他の権限操作 API と同じく、admin 以外は理由を返さず
	// 404 に揃える（存在オラクル対策。kbDenied 参照）。
	f := newKbPermFixture(t, kbUserID, kbGrantRolePtr(domain.GrantRoleEditor))
	f.users.setUserName(kbSecondUserID, "対象ユーザー")

	w := f.do(t, http.MethodPut, f.fill(kbSuspendPath), "")
	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.JSONEq(t, kbDenied, w.Body.String())
}

func Test_ナレッジ権限API_停止は自分自身を対象にすると400(t *testing.T) {
	f := newKbPermFixture(t, kbUserID, kbGrantRolePtr(domain.GrantRoleAdmin))
	f.users.setUserName(kbUserID, "呼び出し本人")

	w := f.do(t, http.MethodPut,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/members/"+strconv.FormatUint(kbUserID, 10)+"/suspend", "")
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.JSONEq(t, `{"error":"cannot_suspend_self"}`, w.Body.String())
}

func Test_ナレッジ権限API_停止は所属していない相手には404(t *testing.T) {
	f := newKbPermFixture(t, kbUserID, kbGrantRolePtr(domain.GrantRoleAdmin))
	f.users.setUserName(kbOutsiderUserID, "非メンバー")

	w := f.do(t, http.MethodPut,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/members/"+strconv.FormatUint(kbOutsiderUserID, 10)+"/suspend", "")
	assert.Equal(t, http.StatusNotFound, w.Code,
		"対象が現に所属していないと、無関係な他人のアカウントを止められてしまう（権限境界そのもの）")
	assert.JSONEq(t, kbDenied, w.Body.String())
}

func Test_ナレッジ権限API_復帰はadminだけが通る(t *testing.T) {
	f := newKbPermFixture(t, kbUserID, kbGrantRolePtr(domain.GrantRoleAdmin))
	f.users.setUserName(kbSecondUserID, "対象ユーザー")

	w := f.do(t, http.MethodPut, f.fill(kbRestorePath), "")
	assert.Equal(t, http.StatusNoContent, w.Code, w.Body.String())
}

func Test_ナレッジ権限API_email招待はユーザー単位で頭打ちになる(t *testing.T) {
	// ワークスペースは誰でも作れて作った本人が admin になるので、放っておくと全ログインユーザーが
	// 好きな宛先へ招待を撃てる口になる（1 日の件数上限は usecase が別に持つ。ここは連打の速度）。
	// 鍵は検証済み JWT 由来のユーザー ID なので、XFF を変えても抜けられない。
	f := newKbPermFixture(t, kbUserID, kbGrantRolePtr(domain.GrantRoleAdmin))

	call := func(i int, xff string) int {
		body := `{"email":"burst-` + strconv.Itoa(i) + `@example.com","role":"viewer"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/invitations", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = "198.51.100.7:1234"
		req.Header.Set("X-Forwarded-For", xff)
		w := httptest.NewRecorder()
		f.router.ServeHTTP(w, req)
		return w.Code
	}

	for i := 0; i < kbInviteByEmailBurst; i++ {
		require.Equal(t, http.StatusCreated, call(i, "203.0.113."+strconv.Itoa(i)),
			"burst 内は通る（招待が作られる）: %d 回目", i+1)
	}
	assert.Equal(t, http.StatusTooManyRequests, call(2000, "203.0.113.200"),
		"IP を変えても同じユーザーなら頭打ちになる")
}

func Test_ナレッジ権限API_未知の役割は400(t *testing.T) {
	f := newKbPermFixture(t, kbUserID, kbGrantRolePtr(domain.GrantRoleAdmin))
	w := f.do(t, http.MethodPut,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/grants/"+f.targetPrincipalID,
		`{"role":"super_admin"}`)
	assert.Equal(t, http.StatusBadRequest, w.Code,
		"アプリ内ロールは grant の役割として通らない（権限の出どころを 2 系統にしない）")
}

func Test_ナレッジ権限API_fakeは非メンバーに既定の役割を届かせない(t *testing.T) {
	// これは fake そのものの検査。本番は主体（principals の kind='user' の行）から
	// 役割を集めるので、その行が無ければ何も集まらない。fake がそこを素通しにすると、
	// **ほかのテストが軒並み緩くなる** — 「非メンバーは 1 本も通せない」を確かめている
	// 検査が、実際には非メンバーを再現できていないまま緑になる。
	//
	// 入れ物の役割も、ページごとの上書きも、どちらも所属より先には効かないこと。
	f := newKbFixture(kbCanEdit, kbUserID) // fallback は「誰でも編集できる」
	f.perms.setScopeRole(kbSpaceID, kbSecondUserID, domain.GrantRoleAdmin)
	f.perms.setPagePermission(kbChildPageID, kbSecondUserID, kbCanEdit)

	facts, err := f.perms.PagePermissionFactsForUser(
		t.Context(), kbWorkspaceID, kbChildPageID, kbSecondUserID,
	)
	require.NoError(t, err)

	assert.False(t, facts.Member, "所属していない")
	assert.Nil(t, facts.Role, "役割は 1 つも届かない")
	assert.False(t, domain.ResolvePagePermission(*facts).CanEdit)
	assert.False(t, domain.ResolvePagePermission(*facts).CanView)
}

func Test_ナレッジ権限API_弱い付与を足しても管理の口は閉じない(t *testing.T) {
	// 権限は 2 段（ワークスペース / スペース）の付与を足し合わせ、届いた中で最も強い役割で
	// 決まる。下の段が上の段を弱めることはないので、自分自身にスペースの弱い付与を張っても、
	// ワークスペースから届いている管理権限は残る。
	//
	// 「近い段が勝つ」形へ戻すと、ここが 404 に落ちる（自分で自分の管理権限を取り上げられて
	// しまい、張った行を消す手段が本人から消える）。
	f := newKbPermFixture(t, kbUserID, kbGrantRolePtr(domain.GrantRoleAdmin))
	spaceGrants := "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/spaces/" + kbSpaceID + "/grants/"

	require.Equal(t, http.StatusOK,
		f.do(t, http.MethodPut, spaceGrants+f.callerPrincipalID, `{"role":"viewer"}`).Code,
		"自分自身に viewer のスペース付与を張る")

	assert.Equal(t, http.StatusOK,
		f.do(t, http.MethodPut, spaceGrants+f.targetPrincipalID, `{"role":"editor"}`).Code,
		"ワークスペースの admin が届いたままなので、スペースの権限の口は開いている")
}
