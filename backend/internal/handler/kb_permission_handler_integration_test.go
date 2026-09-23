//go:build integration

package handler

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ナレッジの権限操作 API を、実 PostgreSQL・本番と同じ配線で確かめる。
//
// 権限を書き換える usecase は認可を一切見ない（受け取った ID をそのまま書く）ので、
// 認可が効いているかどうかは HTTP の入口を実際に叩かないと分からない。ここで固定するのは:
//
//  1. admin 以外は 1 本も通らないこと（viewer / commenter / editor / 非メンバー /
//     別ワークスペースの admin の 5 通り）
//  2. 拒否の応答が、対象が実在するかどうかで変わらないこと（ステータスも本文もバイト単位で同じ）
//  3. admin なら通ること、そして通した結果が実効権限に反映されること
//
// fake ではなく本物の DB を通すのは、権限の解決が SQL（1 本のクエリで事実を集める）に
// 寄っているため。fake は本番より賢くも馬鹿にもなり得るので、認可の最終的な担保はこちら。

// kbPermEnv は権限操作 API の検証環境。kbEnv（ワークスペース + スペース）に、
// 役割の違う利用者・ページ・共有リンクを足したもの。
type kbPermEnv struct {
	*kbEnv
	admin     uint64
	viewer    uint64
	commenter uint64
	editor    uint64
	outsider  uint64
	// rivalAdmin は別ワークスペースの admin（このワークスペースには所属しない）。
	rivalAdmin uint64
	// target は権限を張られる側。呼び出し元自身を対象にすると「最後の admin」の検査に
	// ぶつかり、認可とは別の理由で落ちてしまう。
	target          uint64
	targetPrincipal string
	adminPrincipal  string
	groupPrincipal  string
	rootPage        string
	childPage       string
	shareLinkID     string
	shareToken      string
}

// kbSharedToken は検証経路に渡す平文トークン。usecase と同じ SHA-256 で保存する。
const kbSharedToken = "integration-share-token"

func kbTokenHash(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

func newKbPermEnv(t *testing.T, sqlDB *sql.DB) *kbPermEnv {
	t.Helper()
	env := newKbEnv(t, sqlDB, "acme")
	ctx := t.Context()

	e := &kbPermEnv{
		kbEnv:     env,
		admin:     kbInsertUser(t, sqlDB, "admin"),
		viewer:    kbInsertUser(t, sqlDB, "viewer"),
		commenter: kbInsertUser(t, sqlDB, "commenter"),
		editor:    kbInsertUser(t, sqlDB, "editor"),
		outsider:  kbInsertUser(t, sqlDB, "outsider"),
		target:    kbInsertUser(t, sqlDB, "target"),
	}
	e.adminPrincipal = env.joinWorkspace(t, e.admin, domain.GrantRoleAdmin).ID
	env.joinWorkspace(t, e.viewer, domain.GrantRoleViewer)
	env.joinWorkspace(t, e.commenter, domain.GrantRoleCommenter)
	env.joinWorkspace(t, e.editor, domain.GrantRoleEditor)
	e.targetPrincipal = env.joinWorkspace(t, e.target, domain.GrantRoleViewer).ID

	// 別ワークスペースの admin。同じ DB に居るが acme には principals の行が無い。
	e.rivalAdmin = kbInsertUser(t, sqlDB, "rival-admin")
	rivalWS := kbInsertWorkspace(t, sqlDB, "rival")
	rivalPrincipal, err := env.permissions.EnsureUserPrincipal(ctx, rivalWS, e.rivalAdmin)
	require.NoError(t, err)
	_, err = env.permissions.UpsertWorkspaceGrant(ctx, rivalWS, rivalPrincipal.ID, domain.GrantRoleAdmin, e.rivalAdmin)
	require.NoError(t, err)

	group, err := env.permissions.CreateGroupPrincipal(ctx, env.workspaceID, "開発チーム")
	require.NoError(t, err)
	e.groupPrincipal = group.ID

	e.rootPage = kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, e.admin, "a0", "root")
	e.childPage = kbInsertChildPage(t, sqlDB, env.workspaceID, env.spaceID, e.rootPage, e.admin, "a1", "child")

	e.shareToken = kbSharedToken
	link, err := env.shareLinks.Create(ctx, repository.ShareLinkWrite{
		WorkspaceID:     env.workspaceID,
		PageID:          e.childPage,
		Capability:      domain.CapabilityView,
		TokenHash:       kbTokenHash(e.shareToken),
		CreatedByUserID: e.admin,
	})
	require.NoError(t, err)
	e.shareLinkID = link.ID
	return e
}

// kbInsertChildPage は親を持つページを直接入れる（closure も張る）。
func kbInsertChildPage(t *testing.T, db *sql.DB, workspaceID, spaceID, parentID string, createdBy uint64, position, title string) string {
	t.Helper()
	id := kbNewUUID()
	_, err := db.Exec(
		`INSERT INTO pages (id, workspace_id, space_id, parent_id, "position", title, created_by_user_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		id, workspaceID, spaceID, parentID, position, title, createdBy,
	)
	require.NoError(t, err)
	// closure は「自分自身（depth 0）+ 親の経路を 1 段ずらしたもの」。
	// UUID 列と比べるパラメータは明示的にキャストする（テキストのまま推論されると
	// uuid = text で落ちる）。
	_, err = db.Exec(
		`INSERT INTO page_paths (workspace_id, page_id, ancestor_id, depth)
		 SELECT $1::uuid, $2::uuid, $2::uuid, 0
		 UNION ALL
		 SELECT $1::uuid, $2::uuid, ancestor_id, depth + 1 FROM page_paths
		 WHERE workspace_id = $1::uuid AND page_id = $3::uuid`,
		workspaceID, id, parentID,
	)
	require.NoError(t, err)
	return id
}

// kbDeniedBody は権限操作 API の唯一の拒否応答。バイト列で固定する。
const kbDeniedBody = `{"error":"not_found"}`

func TestKnowledgeBasePermissionAPI_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)

	t.Run("付与した権限がそのまま実効権限になる", func(t *testing.T) {
		// 認可を通したあとの書き込みが本当に効いているか（配線だけして書けていない、を防ぐ）。
		env := newKbPermEnv(t, sqlDB)
		admin := env.as(env.admin)
		target := env.as(env.target)

		// 前提: target は viewer なので改名できない。
		renamePath := "/api/v2/kb/workspaces/" + env.slug + "/pages/" + env.childPage
		require.Equal(t, http.StatusForbidden,
			target.do(t, http.MethodPatch, renamePath, `{"title":"改訂"}`).Code)

		granted := admin.do(t, http.MethodPut,
			"/api/v2/kb/workspaces/"+env.slug+"/grants/"+env.targetPrincipal, `{"role":"editor"}`)
		require.Equal(t, http.StatusOK, granted.Code, granted.Body.String())

		assert.Equal(t, http.StatusOK,
			target.do(t, http.MethodPatch, renamePath, `{"title":"改訂"}`).Code,
			"editor へ上げたら改名できる")

		// 弱い付与を下の段に足しても、上から届いている役割は下がらない。
		// 3 段（ワークスペース / スペース / ページ）は足し算で、最も強いものが実効になる。
		weaker := admin.do(t, http.MethodPut,
			"/api/v2/kb/workspaces/"+env.slug+"/pages/"+env.childPage+"/grants/"+env.targetPrincipal,
			`{"role":"viewer"}`)
		require.Equal(t, http.StatusOK, weaker.Code, weaker.Body.String())
		assert.Equal(t, http.StatusOK,
			target.do(t, http.MethodPatch, renamePath, `{"title":"再改訂"}`).Code,
			"ページに viewer を足してもワークスペースの editor は残る")

		// 逆に強い付与をページに足すと、そのページから下だけ強くなる。
		stronger := admin.do(t, http.MethodPut,
			"/api/v2/kb/workspaces/"+env.slug+"/pages/"+env.childPage+"/grants/"+env.targetPrincipal,
			`{"role":"admin"}`)
		require.Equal(t, http.StatusOK, stronger.Code, stronger.Body.String())
		assert.Equal(t, http.StatusOK,
			target.do(t, http.MethodGet,
				"/api/v2/kb/workspaces/"+env.slug+"/pages/"+env.childPage+"/grants", "").Code,
			"ページの admin になったので、そのページの権限を見られる")
	})

	t.Run("スペースadminは自分のスペースだけを変えられる", func(t *testing.T) {
		// スペースの admin は「そのスペースで権限を変えられる」だけで、
		// ワークスペース全体の grant やメンバーの出入りには手が届かない。
		env := newKbPermEnv(t, sqlDB)
		spaceAdmin := kbInsertUser(t, sqlDB, "space-admin")
		principal := env.joinWorkspace(t, spaceAdmin, domain.GrantRoleViewer)
		_, err := env.permissions.UpsertSpaceGrant(
			t.Context(), env.workspaceID, env.spaceID, principal.ID, domain.GrantRoleAdmin,
		)
		require.NoError(t, err)
		e := env.as(spaceAdmin)

		assert.Equal(t, http.StatusOK,
			e.do(t, http.MethodPut,
				"/api/v2/kb/workspaces/"+env.slug+"/spaces/"+env.spaceID+"/grants/"+env.targetPrincipal,
				`{"role":"editor"}`).Code,
			"自分のスペースの grant は変えられる")

		w := e.do(t, http.MethodPut,
			"/api/v2/kb/workspaces/"+env.slug+"/grants/"+env.targetPrincipal, `{"role":"admin"}`)
		assert.Equal(t, http.StatusNotFound, w.Code, "ワークスペース全体の grant には届かない")
		assert.Equal(t, kbDeniedBody, w.Body.String())

		w = e.do(t, http.MethodPost,
			"/api/v2/kb/workspaces/"+env.slug+"/invitations", `{"email":"outsider@example.test","role":"viewer"}`)
		assert.Equal(t, http.StatusNotFound, w.Code, "人を招く（ワークスペース全体の操作）にも届かない")
		assert.Equal(t, kbDeniedBody, w.Body.String(), "拒否の本文は他の権限操作と同じ")
	})

	t.Run("別スペースのスペースadminは他スペースの権限を変えられない", func(t *testing.T) {
		env := newKbPermEnv(t, sqlDB)
		otherSpace := kbInsertSpace(t, sqlDB, env.workspaceID, "ops")
		spaceAdmin := kbInsertUser(t, sqlDB, "ops-admin")
		principal := env.joinWorkspace(t, spaceAdmin, domain.GrantRoleViewer)
		_, err := env.permissions.UpsertSpaceGrant(
			t.Context(), env.workspaceID, otherSpace, principal.ID, domain.GrantRoleAdmin,
		)
		require.NoError(t, err)

		w := env.as(spaceAdmin).do(t, http.MethodPut,
			"/api/v2/kb/workspaces/"+env.slug+"/spaces/"+env.spaceID+"/grants/"+env.targetPrincipal,
			`{"role":"editor"}`)
		assert.Equal(t, http.StatusNotFound, w.Code)
		assert.Equal(t, kbDeniedBody, w.Body.String())
	})

	t.Run("グループ宛てのadminは最後の1人として数えない", func(t *testing.T) {
		// メンバーが 0 人のグループが「最後の admin」として残ると、結局誰も権限を
		// 変えられなくなる。grant の行からは中身が分からないので数に入れない。
		env := newKbPermEnv(t, sqlDB)
		e := env.as(env.admin)
		_, err := env.permissions.UpsertWorkspaceGrant(
			t.Context(), env.workspaceID, env.groupPrincipal, domain.GrantRoleAdmin, env.admin,
		)
		require.NoError(t, err)

		w := e.do(t, http.MethodDelete,
			"/api/v2/kb/workspaces/"+env.slug+"/grants/"+env.adminPrincipal, "")
		assert.Equal(t, http.StatusConflict, w.Code, "グループの admin では代わりにならない")
	})

	t.Run("グループ名の重複は500ではなく409", func(t *testing.T) {
		env := newKbPermEnv(t, sqlDB)
		e := env.as(env.admin)
		path := "/api/v2/kb/workspaces/" + env.slug + "/groups"
		require.Equal(t, http.StatusCreated, e.do(t, http.MethodPost, path, `{"name":"運用"}`).Code)
		w := e.do(t, http.MethodPost, path, `{"name":"運用"}`)
		assert.Equal(t, http.StatusConflict, w.Code)
		assert.JSONEq(t, `{"error":"group_name_taken"}`, w.Body.String())
	})
}

func TestKnowledgeBaseShareLinkAPI_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)

	t.Run("パスワード付きは合致するまで通らない", func(t *testing.T) {
		env := newKbPermEnv(t, sqlDB)
		e := env.as(env.admin)
		anonymous := env.as(0)
		verifyPath := "/api/v2/kb/share-links/verify"

		issued := e.do(t, http.MethodPost,
			"/api/v2/kb/workspaces/"+env.slug+"/pages/"+env.childPage+"/share-links",
			`{"capability":"view","password":"s3cret"}`)
		require.Equal(t, http.StatusCreated, issued.Code, issued.Body.String())
		var out kbIssuedShareLinkResponse
		require.NoError(t, json.Unmarshal(issued.Body.Bytes(), &out))
		assert.True(t, out.Link.RequiresPassword)
		assert.NotContains(t, issued.Body.String(), "s3cret", "パスワードを応答へ反射しない")

		w := anonymous.do(t, http.MethodPost, verifyPath, `{"token":"`+out.Token+`"}`)
		assert.Equal(t, http.StatusUnauthorized, w.Code)
		assert.JSONEq(t, `{"error":"password_required"}`, w.Body.String())

		w = anonymous.do(t, http.MethodPost, verifyPath, `{"token":"`+out.Token+`","password":"wrong"}`)
		assert.Equal(t, http.StatusUnauthorized, w.Code)
		assert.JSONEq(t, `{"error":"password_mismatch"}`, w.Body.String())

		w = anonymous.do(t, http.MethodPost, verifyPath, `{"token":"`+out.Token+`","password":"s3cret"}`)
		assert.Equal(t, http.StatusOK, w.Code, w.Body.String())
	})
}

// ページに admin を張られた相手が、その枝だけを管理できることを実 PostgreSQL で確かめる。
//
// # なぜこれが要るのか
//
// 既定は 3 段（ワークスペース / スペース / ページ）から届く。page_grants を入れるまで
// 「ページに対する管理者」は存在し得なかったので、権限操作の入口はスペースの admin だけを
// 見ていた。その前提のまま page_grants を足すと、**admin を与えられた本人がその権限を
// 一切行使できない**。与えられるのに使えない、という一番たちの悪い壊れ方になる
// （画面には権限があるように見える）。
//
// 併せて、その枝から外へはみ出さないことも固定する。付与は経路をさかのぼって効くので
// 子孫には届き、祖先には届かない。ここが崩れると、下位ページの管理者が親ごと乗っ取れる。
func TestKnowledgeBasePageGrantAPI_ページのadminはその枝だけを管理できる_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	env := newKbPermEnv(t, sqlDB)
	grandchild := kbInsertChildPage(t, sqlDB, env.workspaceID, env.spaceID, env.childPage, env.admin, "a2", "孫")

	grantsOf := func(pageID string) string {
		return "/api/v2/kb/workspaces/" + env.slug + "/pages/" + pageID + "/grants"
	}

	admin := env.as(env.admin)
	// target はワークスペースでは viewer。まだどのページの権限も触れない。
	target := env.as(env.target)
	require.Equal(t, http.StatusNotFound, target.do(t, http.MethodGet, grantsOf(env.childPage), "").Code,
		"前提: 付与の前は子ページの権限を見られない")

	granted := admin.do(t, http.MethodPut, grantsOf(env.childPage)+"/"+env.targetPrincipal, `{"role":"admin"}`)
	require.Equal(t, http.StatusOK, granted.Code, granted.Body.String())

	t.Run("張られたページを管理できる", func(t *testing.T) {
		w := target.do(t, http.MethodGet, grantsOf(env.childPage), "")
		assert.Equal(t, http.StatusOK, w.Code, w.Body.String())
	})

	t.Run("取り消すと元の立場へ戻る", func(t *testing.T) {
		w := admin.do(t, http.MethodDelete, grantsOf(env.childPage)+"/"+env.targetPrincipal, "")
		require.Equal(t, http.StatusNoContent, w.Code)

		assert.Equal(t, http.StatusNotFound, target.do(t, http.MethodGet, grantsOf(env.childPage), "").Code)
		assert.Equal(t, http.StatusNotFound, target.do(t, http.MethodGet, grantsOf(grandchild), "").Code,
			"子孫の分も一緒に消える（張ったのは 1 行だけ）")
	})
}
