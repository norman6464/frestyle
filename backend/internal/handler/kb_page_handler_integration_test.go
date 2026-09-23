//go:build integration

package handler

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// kbIntegrationTables は結合テストが触るナレッジのテーブル（TRUNCATE 対象）。
// users は他の結合テストと共有するため消さず、毎回一意なアドレスで足す。
var kbIntegrationTables = []string{
	"share_links", "page_grants", "space_grants", "workspace_grants",
	"principal_members", "principals",
	"comments", "comment_threads",
	"page_suggestions", "page_versions", "page_templates",
	// page_search / page_links は blocks / pages への CASCADE FK が
	// あるので TRUNCATE ... CASCADE で自動的に一緒に空になるが、明示しておく
	// （internal/adapter/persistence の kbTables と同じ作法）。
	"blocks", "page_paths", "page_snapshots", "page_search", "page_links", "pages", "spaces", "workspaces",
}

// kbEnv は本物の PostgreSQL・本物の repository・本番と同じルートで組んだ検証環境。
type kbEnv struct {
	pages            repository.KnowledgeBaseRepository
	permissions      repository.KnowledgeBasePermissionRepository
	shareLinks       repository.ShareLinkRepository
	provisioner      repository.WorkspaceProvisioner
	users            repository.UserRepository
	comments         repository.CommentRepository
	versions         repository.PageVersionRepository
	views            repository.PageViewRepository
	favorites        repository.PageFavoriteRepository
	templates        repository.PageTemplateRepository
	suggestions      repository.PageSuggestionRepository
	tickets          repository.TicketRepository
	txManager        repository.TxManager
	kbImagePresigner repository.KbImagePresigner
	labels           repository.LabelRepository
	invitations      repository.InvitationRepository
	notifications    repository.NotificationRepository
	workspaceID      string
	slug             string
	spaceID          string
	router           *gin.Engine
}

func newKbEnv(t *testing.T, sqlDB *sql.DB, slug string) *kbEnv {
	t.Helper()
	testsupport.TruncateAll(t, sqlDB, kbIntegrationTables...)

	env := &kbEnv{
		pages:            persistence.NewKnowledgeBaseRepository(sqlDB),
		permissions:      persistence.NewKnowledgeBasePermissionRepository(sqlDB),
		shareLinks:       persistence.NewShareLinkRepository(sqlDB),
		provisioner:      persistence.NewWorkspaceProvisioner(sqlDB),
		users:            persistence.NewUserRepository(sqlDB),
		comments:         persistence.NewCommentRepository(sqlDB),
		versions:         persistence.NewPageVersionRepository(sqlDB),
		views:            persistence.NewPageViewRepository(sqlDB),
		favorites:        persistence.NewPageFavoriteRepository(sqlDB),
		templates:        persistence.NewPageTemplateRepository(sqlDB),
		suggestions:      persistence.NewPageSuggestionRepository(sqlDB),
		tickets:          persistence.NewTicketRepository(sqlDB),
		txManager:        persistence.NewTxManager(sqlDB),
		kbImagePresigner: persistence.NewStubKbImagePresigner("stub-bucket"),
		labels:           persistence.NewLabelRepository(sqlDB),
		invitations:      persistence.NewInvitationRepository(sqlDB),
		notifications:    persistence.NewNotificationRepository(sqlDB),
		slug:             slug,
	}
	env.workspaceID = kbInsertWorkspace(t, sqlDB, slug)
	env.spaceID = kbInsertSpace(t, sqlDB, env.workspaceID, "eng")
	return env
}

// as は userID を current user としたルータを組む（本番と同じ registerKnowledgeBaseRoutesWith 経由）。
func (e *kbEnv) as(userID uint64) *kbEnv {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v2")
	g.Use(func(c *gin.Context) {
		c.Set(middleware.ContextKeyCurrentUserID, userID)
		c.Next()
	})
	registerKnowledgeBaseRoutesWith(
		g, e.pages, e.permissions, e.shareLinks, e.provisioner, e.users, e.comments, e.versions, e.views, e.favorites,
		e.templates, e.suggestions, e.tickets, e.txManager, e.kbImagePresigner, e.labels, e.invitations, e.notifications,
	)
	// 認証不要のルート（共有リンクの検証・招待の案内）は current user を注入しない group に張る。
	// 本番の NewRouter と同じ位置関係にしないと「未認証でも通ること」を確かめられない。
	registerKnowledgeBasePublicRoutesWith(r.Group("/api/v2"), e.pages, e.permissions, e.shareLinks, e.invitations)
	clone := *e
	clone.router = r
	return &clone
}

func (e *kbEnv) do(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	e.router.ServeHTTP(w, req)
	return w
}

func (e *kbEnv) spacePagesPath(spaceID string) string {
	return "/api/v2/kb/workspaces/" + e.slug + "/spaces/" + spaceID + "/pages"
}

func (e *kbEnv) pagesPath() string {
	return e.spacePagesPath(e.spaceID)
}

func (e *kbEnv) pagePath(pageID string) string {
	return "/api/v2/kb/workspaces/" + e.slug + "/pages/" + pageID
}

func kbNewUUID() string { return uuid.Must(uuid.NewV7()).String() }

func kbInsertWorkspace(t *testing.T, db *sql.DB, slug string) string {
	t.Helper()
	id := kbNewUUID()
	_, err := db.Exec(`INSERT INTO workspaces (id, slug, name) VALUES ($1, $2, $3)`, id, slug, slug)
	require.NoError(t, err)
	return id
}

func kbInsertSpace(t *testing.T, db *sql.DB, workspaceID, key string) string {
	t.Helper()
	id := kbNewUUID()
	_, err := db.Exec(`INSERT INTO spaces (id, workspace_id, "key", name) VALUES ($1, $2, $3, $3)`,
		id, workspaceID, key)
	require.NoError(t, err)
	return id
}

// kbInsertPrivateSpace は visibility='private' のスペースを入れる。
//
// ワークスペース全体の役割はこのスペースへ届かない（届くのはスペース付与とページ付与だけ）。
// 権限は 3 段の付与を足し合わせて最も強い役割で決まり、弱める層はどこにも無いので、
// **同じスペースの中で 1 枚だけ隠すことはできない。見せたくないものはこちらへ置く。**
func kbInsertPrivateSpace(t *testing.T, db *sql.DB, workspaceID, key string) string {
	t.Helper()
	id := kbNewUUID()
	_, err := db.Exec(
		`INSERT INTO spaces (id, workspace_id, "key", name, visibility) VALUES ($1, $2, $3, $3, 'private')`,
		id, workspaceID, key,
	)
	require.NoError(t, err)
	return id
}

// kbInsertUser は users に 1 行入れて id を返す。principals が users へ FK を持つため、
// 権限を伴う結合テストは実在するユーザーを前提にする。
//
// id はシーケンスに任せず MAX(id)+1 で採番する。ほかの結合テストが users を
// TRUNCATE ... RESTART IDENTITY したり、id を明示して INSERT したりするため、
// シーケンスが実データより手前に取り残されていることがある（そのまま nextval を使うと
// 既存 id と衝突する）。結合テストは testsupport 側の advisory lock で直列化されているので、
// MAX(id)+1 が競合することはない。
//
// 逆に、明示採番した行を残すと今度は他のテストの nextval とぶつかるので、
// テスト終了時に必ず消す（users は共有テーブルなので TRUNCATE しない）。段 1 で users.id への
// 記録用 FK（RESTRICT）が増えたため、削除前にこのユーザーを参照する行だけを個別に消す
// （kbIntegrationTables を丸ごと TRUNCATE すると、1 サブテストが複数ユーザーを作るたびに
// 重複実行されてテスト全体が極端に遅くなる。実測で 10 分のタイムアウトに達した）。
func kbInsertUser(t *testing.T, db *sql.DB, name string) uint64 {
	t.Helper()
	var id uint64
	require.NoError(t, db.QueryRow(
		`INSERT INTO users (id, email, name, created_at, updated_at)
		 VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM users), $1, $2, now(), now())
		 RETURNING id`,
		name+"+"+kbNewUUID()+"@example.test", name,
	).Scan(&id))
	t.Cleanup(func() {
		kbDeleteUserReferences(t, db, id)
		if _, err := db.Exec(`DELETE FROM users WHERE id = $1`, id); err != nil {
			t.Errorf("テストユーザーの後始末に失敗: %v", err)
		}
	})
	return id
}

// kbDeleteUserReferences は、このパッケージの結合テストが触りうる範囲で users.id への
// 記録 FK（RESTRICT。段 1）を持つ列から、指定ユーザーを参照する行だけを消す。
// pages を消せば CASCADE で page_paths/page_versions/page_snapshots/blocks/… も
// 一緒に片付くが、pages を経由しない参照（別ページの page_versions.author_user_id 等）は
// 個別に消す必要があるので、表ごとに明示する。
func kbDeleteUserReferences(t *testing.T, db *sql.DB, userID uint64) {
	t.Helper()
	for _, stmt := range []string{
		`DELETE FROM pages WHERE created_by_user_id = $1 OR last_edited_by_user_id = $1`,
		`DELETE FROM page_versions WHERE author_user_id = $1`,
		`DELETE FROM page_templates WHERE created_by_user_id = $1`,
		`DELETE FROM page_suggestions WHERE author_user_id = $1 OR resolved_by_user_id = $1`,
		`DELETE FROM comment_threads WHERE created_by_user_id = $1 OR resolved_by_user_id = $1`,
		`DELETE FROM comments WHERE author_user_id = $1`,
		// 段 6: 所属・権限の変更履歴。target / actor どちらの記録 FK も RESTRICT。
		`DELETE FROM membership_events WHERE target_user_id = $1 OR actor_user_id = $1`,
	} {
		if _, err := db.Exec(stmt, userID); err != nil {
			t.Errorf("テストユーザーの参照行の後始末に失敗（%s）: %v", stmt, err)
		}
	}
}

// kbInsertRootPage はスペース直下のページを直接入れる（HTTP からは親付きしか作れないため）。
func kbInsertRootPage(t *testing.T, db *sql.DB, workspaceID, spaceID string, createdBy uint64, position, title string) string {
	t.Helper()
	id := kbNewUUID()
	_, err := db.Exec(
		`INSERT INTO pages (id, workspace_id, space_id, parent_id, "position", title, created_by_user_id)
		 VALUES ($1, $2, $3, NULL, $4, $5, $6)`,
		id, workspaceID, spaceID, position, title, createdBy,
	)
	require.NoError(t, err)
	_, err = db.Exec(
		`INSERT INTO page_paths (workspace_id, page_id, ancestor_id, depth) VALUES ($1, $2, $2, 0)`,
		workspaceID, id,
	)
	require.NoError(t, err)
	return id
}

// joinWorkspace はユーザーをワークスペースに所属させ、既定の役割を与える。
func (e *kbEnv) joinWorkspace(t *testing.T, userID uint64, role domain.GrantRole) *domain.Principal {
	t.Helper()
	principal, err := e.permissions.EnsureUserPrincipal(t.Context(), e.workspaceID, userID)
	require.NoError(t, err)
	_, err = e.permissions.UpsertWorkspaceGrant(t.Context(), e.workspaceID, principal.ID, role, userID)
	require.NoError(t, err)
	return principal
}

// joinWorkspaceWithoutRole は所属だけさせて役割を 1 つも与えない。
//
// ページ付与だけが届く相手を作るのに使う。ワークスペースの役割があると、それが配下の
// 全ページへ届いてしまい「このページとその子孫にだけ届く」ことを確かめられない。
func (e *kbEnv) joinWorkspaceWithoutRole(t *testing.T, userID uint64) *domain.Principal {
	t.Helper()
	principal, err := e.permissions.EnsureUserPrincipal(t.Context(), e.workspaceID, userID)
	require.NoError(t, err)
	return principal
}

// grantPage はページとその子孫に届く役割を与える（付与の 3 段目）。
func (e *kbEnv) grantPage(t *testing.T, pageID, principalID string, role domain.GrantRole) {
	t.Helper()
	_, err := e.permissions.UpsertPageGrant(t.Context(), e.workspaceID, pageID, principalID, role)
	require.NoError(t, err)
}

// grantSpace はスペース 1 つに届く役割を与える（private のスペースへ届く唯一の入れ物の段）。
func (e *kbEnv) grantSpace(t *testing.T, spaceID, principalID string, role domain.GrantRole) {
	t.Helper()
	_, err := e.permissions.UpsertSpaceGrant(t.Context(), e.workspaceID, spaceID, principalID, role)
	require.NoError(t, err)
}

func TestKnowledgeBasePageAPI_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)

	t.Run("編集者はページを作って本文を保存し取得できる", func(t *testing.T) {
		env := newKbEnv(t, sqlDB, "acme")
		alice := kbInsertUser(t, sqlDB, "alice")
		env.joinWorkspace(t, alice, domain.GrantRoleEditor)
		root := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, alice, "a0", "root")
		e := env.as(alice)

		created := e.do(t, http.MethodPost, e.pagesPath(),
			`{"parentId":"`+root+`","title":"設計メモ"}`)
		require.Equal(t, http.StatusCreated, created.Code, created.Body.String())
		var page kbPageResponse
		require.NoError(t, json.Unmarshal(created.Body.Bytes(), &page))

		saved := e.do(t, http.MethodPut, e.pagePath(page.ID)+"/content",
			`{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"本文"}]}]}}`)
		require.Equal(t, http.StatusOK, saved.Code, saved.Body.String())

		got := e.do(t, http.MethodGet, e.pagePath(page.ID), "")
		require.Equal(t, http.StatusOK, got.Code)
		var doc kbPageDocResponse
		require.NoError(t, json.Unmarshal(got.Body.Bytes(), &doc))
		assert.Contains(t, string(doc.Doc), "本文")

		tree := e.do(t, http.MethodGet, e.pagesPath(), "")
		require.Equal(t, http.StatusOK, tree.Code)
		var body kbPageTreeRootResponse
		require.NoError(t, json.Unmarshal(tree.Body.Bytes(), &body))
		nodes := body.Pages
		require.Len(t, nodes, 1)
		require.Len(t, nodes[0].Children, 1)
		assert.Equal(t, page.ID, nodes[0].Children[0].Page.ID)
	})

	t.Run("本文保存で最終編集者の名前が解決に載り、アイコンの設定が取得に映る", func(t *testing.T) {
		env := newKbEnv(t, sqlDB, "acme")
		alice := kbInsertUser(t, sqlDB, "alice")
		env.joinWorkspace(t, alice, domain.GrantRoleEditor)
		root := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, alice, "a0", "root")
		e := env.as(alice)

		saved := e.do(t, http.MethodPut, e.pagePath(root)+"/content",
			`{"doc":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"本文"}]}]}}`)
		require.Equal(t, http.StatusOK, saved.Code, saved.Body.String())
		var content kbPageContentResponse
		require.NoError(t, json.Unmarshal(saved.Body.Bytes(), &content))
		require.NotNil(t, content.LastEditedBy)
		assert.Equal(t, alice, content.LastEditedBy.UserID)
		assert.Equal(t, "alice", content.LastEditedBy.Name)

		resolved := e.do(t, http.MethodGet, "/api/v2/kb/pages/"+root, "")
		require.Equal(t, http.StatusOK, resolved.Code, resolved.Body.String())
		var res kbResolvedPageResponse
		require.NoError(t, json.Unmarshal(resolved.Body.Bytes(), &res))
		require.NotNil(t, res.LastEditedBy)
		assert.Equal(t, "alice", res.LastEditedBy.Name, "解決 API にも保存した人の名前が載る")
		require.NotNil(t, res.LastEditedAt)

		iconSet := e.do(t, http.MethodPut, e.pagePath(root)+"/icon", `{"type":"emoji","value":"📘"}`)
		require.Equal(t, http.StatusOK, iconSet.Code, iconSet.Body.String())

		got := e.do(t, http.MethodGet, e.pagePath(root), "")
		require.Equal(t, http.StatusOK, got.Code)
		var doc kbPageDocResponse
		require.NoError(t, json.Unmarshal(got.Body.Bytes(), &doc))
		require.NotNil(t, doc.Page.Icon, "設定したアイコンが取得に映る")
		assert.Equal(t, "📘", doc.Page.Icon.Value)
	})

	t.Run("閲覧だけの役割は書き込みが403で読み取りは通る", func(t *testing.T) {
		env := newKbEnv(t, sqlDB, "acme")
		alice := kbInsertUser(t, sqlDB, "alice")
		bob := kbInsertUser(t, sqlDB, "bob")
		env.joinWorkspace(t, alice, domain.GrantRoleEditor)
		env.joinWorkspace(t, bob, domain.GrantRoleViewer)
		root := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, alice, "a0", "root")
		e := env.as(bob)

		assert.Equal(t, http.StatusOK, e.do(t, http.MethodGet, e.pagePath(root), "").Code)
		assert.Equal(t, http.StatusForbidden,
			e.do(t, http.MethodPatch, e.pagePath(root), `{"title":"改訂"}`).Code)
		assert.Equal(t, http.StatusForbidden,
			e.do(t, http.MethodPost, e.pagePath(root)+"/archive", "").Code)
	})

	t.Run("所属していないワークスペースは404", func(t *testing.T) {
		env := newKbEnv(t, sqlDB, "acme")
		alice := kbInsertUser(t, sqlDB, "alice")
		env.joinWorkspace(t, alice, domain.GrantRoleAdmin)
		root := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, alice, "a0", "root")

		// 同じ DB に別テナントを作り、alice はそちらには所属させない。
		otherWS := kbInsertWorkspace(t, sqlDB, "rival")
		otherSpace := kbInsertSpace(t, sqlDB, otherWS, "eng")
		e := env.as(alice)

		w := e.do(t, http.MethodGet, "/api/v2/kb/workspaces/rival/pages/"+root, "")
		assert.Equal(t, http.StatusNotFound, w.Code)
		assert.JSONEq(t, `{"error":"not_found"}`, w.Body.String())

		w = e.do(t, http.MethodGet, "/api/v2/kb/workspaces/rival/spaces/"+otherSpace+"/pages", "")
		assert.Equal(t, http.StatusNotFound, w.Code)
	})

	t.Run("役割が届かない親も、その子もツリーに現れない", func(t *testing.T) {
		// bob にはワークスペースの役割が無く、片方のルートページにだけ付与がある。
		// 付与はそのページと子孫にしか届かないので、もう一方のルートは配下ごと見えない。
		env := newKbEnv(t, sqlDB, "acme")
		alice := kbInsertUser(t, sqlDB, "alice")
		bob := kbInsertUser(t, sqlDB, "bob")
		env.joinWorkspace(t, alice, domain.GrantRoleAdmin)
		bobPrincipal := env.joinWorkspaceWithoutRole(t, bob)

		secret := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, alice, "a0", "秘密")
		open := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, alice, "a5", "公開")

		adminEnv := env.as(alice)
		secretChild := kbCreateChild(t, adminEnv, secret, "秘密の子")
		openChild := kbCreateChild(t, adminEnv, open, "公開の子")

		env.grantPage(t, open, bobPrincipal.ID, domain.GrantRoleViewer)

		e := env.as(bob)
		tree := e.do(t, http.MethodGet, e.pagesPath(), "")
		require.Equal(t, http.StatusOK, tree.Code)
		var body kbPageTreeRootResponse
		require.NoError(t, json.Unmarshal(tree.Body.Bytes(), &body))
		nodes := body.Pages
		require.Len(t, nodes, 1, "付与の届かない親も、その子も根に浮かない")
		assert.Equal(t, open, nodes[0].Page.ID)
		require.Len(t, nodes[0].Children, 1, "付与は子孫まで降りるので子は見える")
		assert.Equal(t, openChild, nodes[0].Children[0].Page.ID)
		assert.True(t, body.HasHiddenChildren, "スペース直下に見えないページが在ることだけは知らせる")

		// 直リンクでも開けない（子は親までの経路に付与が無い）。
		assert.Equal(t, http.StatusNotFound, e.do(t, http.MethodGet, e.pagePath(secret), "").Code)
		assert.Equal(t, http.StatusNotFound, e.do(t, http.MethodGet, e.pagePath(secretChild), "").Code)
		assert.Equal(t, http.StatusOK, e.do(t, http.MethodGet, e.pagePath(openChild), "").Code)
	})

	t.Run("届かないスペースのページと存在しないページの応答が同じ", func(t *testing.T) {
		env := newKbEnv(t, sqlDB, "acme")
		alice := kbInsertUser(t, sqlDB, "alice")
		bob := kbInsertUser(t, sqlDB, "bob")
		alicePrincipal := env.joinWorkspace(t, alice, domain.GrantRoleAdmin)
		// bob はワークスペース全体では編集者。それでも private のスペースには届かない。
		env.joinWorkspace(t, bob, domain.GrantRoleEditor)

		vault := kbInsertPrivateSpace(t, sqlDB, env.workspaceID, "vault")
		env.grantSpace(t, vault, alicePrincipal.ID, domain.GrantRoleAdmin)
		page := kbInsertRootPage(t, sqlDB, env.workspaceID, vault, alice, "a0", "人事の記録")

		e := env.as(bob)
		hidden := e.do(t, http.MethodGet, e.pagePath(page), "")
		missing := e.do(t, http.MethodGet, e.pagePath(kbNewUUID()), "")

		assert.Equal(t, http.StatusNotFound, hidden.Code)
		assert.Equal(t, hidden.Code, missing.Code)
		assert.Equal(t, hidden.Body.String(), missing.Body.String())

		tree := e.do(t, http.MethodGet, e.spacePagesPath(vault), "")
		require.Equal(t, http.StatusOK, tree.Code)
		assert.JSONEq(t, `{"pages":[],"hasHiddenChildren":false}`, tree.Body.String(),
			"存在しないスペースと同じ応答（スペース ID の総当たりで実在を数えられないように）")

		// スペース付与を持つ alice には見える（private でも入れ物の段は届く）。
		assert.Equal(t, http.StatusOK, env.as(alice).do(t, http.MethodGet, env.pagePath(page), "").Code)
	})

	t.Run("ページに閲覧の役割だけ張った相手は改名できないが閲覧はできる", func(t *testing.T) {
		env := newKbEnv(t, sqlDB, "acme")
		alice := kbInsertUser(t, sqlDB, "alice")
		bob := kbInsertUser(t, sqlDB, "bob")
		env.joinWorkspace(t, alice, domain.GrantRoleAdmin)
		bobPrincipal := env.joinWorkspaceWithoutRole(t, bob)
		page := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, alice, "a0", "共有")
		env.grantPage(t, page, bobPrincipal.ID, domain.GrantRoleViewer)

		e := env.as(bob)
		assert.Equal(t, http.StatusOK, e.do(t, http.MethodGet, e.pagePath(page), "").Code)
		assert.Equal(t, http.StatusForbidden,
			e.do(t, http.MethodPatch, e.pagePath(page), `{"title":"改訂"}`).Code)
	})

	t.Run("移動元を編集できなければ移せない", func(t *testing.T) {
		// 移動には動かすページと移動先の親の両方の編集権限が要る。ここは移動元が足りない側
		// （移動先が足りない側は TestKnowledgeBaseMovePermission_Integration が見ている）。
		env := newKbEnv(t, sqlDB, "acme")
		alice := kbInsertUser(t, sqlDB, "alice")
		bob := kbInsertUser(t, sqlDB, "bob")
		env.joinWorkspace(t, alice, domain.GrantRoleAdmin)
		bobPrincipal := env.joinWorkspaceWithoutRole(t, bob)
		src := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, alice, "a0", "移動元")
		dest := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, alice, "a5", "移動先")
		// 移動先は編集できるが、移動元は閲覧しかできない。
		env.grantPage(t, src, bobPrincipal.ID, domain.GrantRoleViewer)
		env.grantPage(t, dest, bobPrincipal.ID, domain.GrantRoleEditor)

		e := env.as(bob)
		w := e.do(t, http.MethodPost, e.pagePath(src)+"/move", `{"parentId":"`+dest+`"}`)
		assert.Equal(t, http.StatusForbidden, w.Code, "移動先だけ編集できても移せない")
		assert.JSONEq(t, `{"error":"forbidden"}`, w.Body.String())

		// alice（管理者）なら移せる。
		admin := env.as(alice)
		ok := admin.do(t, http.MethodPost, admin.pagePath(src)+"/move", `{"parentId":"`+dest+`"}`)
		assert.Equal(t, http.StatusOK, ok.Code, ok.Body.String())
	})

	t.Run("アーカイブした子孫はツリーから消え復帰で戻る", func(t *testing.T) {
		env := newKbEnv(t, sqlDB, "acme")
		alice := kbInsertUser(t, sqlDB, "alice")
		env.joinWorkspace(t, alice, domain.GrantRoleAdmin)
		root := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, alice, "a0", "root")
		e := env.as(alice)

		created := e.do(t, http.MethodPost, e.pagesPath(), `{"parentId":"`+root+`","title":"子"}`)
		require.Equal(t, http.StatusCreated, created.Code)

		require.Equal(t, http.StatusNoContent, e.do(t, http.MethodPost, e.pagePath(root)+"/archive", "").Code)
		tree := e.do(t, http.MethodGet, e.pagesPath(), "")
		require.Equal(t, http.StatusOK, tree.Code)
		assert.JSONEq(t, `{"pages":[],"hasHiddenChildren":false}`, tree.Body.String())

		require.Equal(t, http.StatusOK, e.do(t, http.MethodPost, e.pagePath(root)+"/unarchive", "").Code)
		tree = e.do(t, http.MethodGet, e.pagesPath(), "")
		var body kbPageTreeRootResponse
		require.NoError(t, json.Unmarshal(tree.Body.Bytes(), &body))
		nodes := body.Pages
		require.Len(t, nodes, 1)
		assert.Len(t, nodes[0].Children, 1, "一緒にアーカイブした子も戻る")
	})

	t.Run("スペース全員宛てのページ付与が残るサブツリーの別スペースへの移動は409", func(t *testing.T) {
		env := newKbEnv(t, sqlDB, "acme")
		alice := kbInsertUser(t, sqlDB, "alice")
		env.joinWorkspace(t, alice, domain.GrantRoleAdmin)
		parent := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, alice, "a0", "親")
		e := env.as(alice)
		child := kbCreateChild(t, e, parent, "子")

		// 「このスペースの全員」宛ての付与。別スペースへ移ると行だけが残って評価されなくなる
		// （権限の解決は、ページがいま居るスペースの「全員」しか自分の主体に取らない）。
		// 付与は誰かを弱めないので、張った本人が締め出されることはない。それでも
		// 権限設定画面に見えている行が効かなくなるので、移動そのものを断る。
		everyone, err := env.permissions.EnsureSpaceEveryonePrincipal(t.Context(), env.workspaceID, env.spaceID)
		require.NoError(t, err)
		env.grantPage(t, child, everyone.ID, domain.GrantRoleViewer)

		otherSpace := kbInsertSpace(t, sqlDB, env.workspaceID, "ops")
		dest := kbInsertRootPage(t, sqlDB, env.workspaceID, otherSpace, alice, "a0", "移動先")

		before := kbDumpTreeState(t, sqlDB, env.workspaceID)
		w := e.do(t, http.MethodPost, e.pagePath(parent)+"/move", `{"parentId":"`+dest+`"}`)
		require.Equal(t, http.StatusConflict, w.Code, w.Body.String())
		assert.JSONEq(t, `{"error":"space_grant_voided"}`, w.Body.String(),
			"正当な業務エラーであって DB 障害ではない（500 だとクライアントが再試行してよいと誤解する）")
		assert.Equal(t, before, kbDumpTreeState(t, sqlDB, env.workspaceID),
			"repository の同一トランザクションで断るので、移動はロールバックされている")

		got := e.do(t, http.MethodGet, e.pagePath(parent), "")
		require.Equal(t, http.StatusOK, got.Code)
		var page kbPageDocResponse
		require.NoError(t, json.Unmarshal(got.Body.Bytes(), &page))
		assert.Equal(t, env.spaceID, page.Page.SpaceID)
	})

	t.Run("親に張った編集の役割は子孫まで届きサブツリーごとアーカイブできる", func(t *testing.T) {
		// アーカイブ / 復帰はサブツリー全体の編集権限を要求する。役割が親から子へ届いて
		// いなければ、その検査（subtree_forbidden）で断られる。**根の付与が子孫まで
		// 降りることを、事実を集めるクエリごと確かめる**のがこのテスト。
		env := newKbEnv(t, sqlDB, "acme")
		alice := kbInsertUser(t, sqlDB, "alice")
		bob := kbInsertUser(t, sqlDB, "bob")
		env.joinWorkspace(t, alice, domain.GrantRoleAdmin)
		bobPrincipal := env.joinWorkspaceWithoutRole(t, bob)
		parent := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, alice, "a0", "親")

		adminEnv := env.as(alice)
		child := kbCreateChild(t, adminEnv, parent, "子")
		grandchild := kbCreateChild(t, adminEnv, child, "孫")

		// bob に与えるのは親 1 枚への editor だけ。
		env.grantPage(t, parent, bobPrincipal.ID, domain.GrantRoleEditor)

		e := env.as(bob)
		require.Equal(t, http.StatusOK, e.do(t, http.MethodGet, e.pagePath(grandchild), "").Code,
			"孫まで届く")
		require.Equal(t, http.StatusOK,
			e.do(t, http.MethodPatch, e.pagePath(grandchild), `{"title":"改訂"}`).Code,
			"編集の役割も同じだけ降りる")

		require.Equal(t, http.StatusNoContent,
			e.do(t, http.MethodPost, e.pagePath(parent)+"/archive", "").Code,
			"配下に編集できないページが 1 枚も無いので通る")
		tree := e.do(t, http.MethodGet, e.pagesPath(), "")
		require.Equal(t, http.StatusOK, tree.Code)
		assert.JSONEq(t, `{"pages":[],"hasHiddenChildren":false}`, tree.Body.String())

		require.Equal(t, http.StatusOK,
			e.do(t, http.MethodPost, e.pagePath(parent)+"/unarchive", "").Code,
			"復帰も同じ判定を通る（片側だけ厳しくしない）")
		tree = e.do(t, http.MethodGet, e.pagesPath(), "")
		var body kbPageTreeRootResponse
		require.NoError(t, json.Unmarshal(tree.Body.Bytes(), &body))
		require.Len(t, body.Pages, 1)
		require.Len(t, body.Pages[0].Children, 1)
		assert.Equal(t, child, body.Pages[0].Children[0].Page.ID)
	})

	t.Run("役割が無いメンバーは何も見えない", func(t *testing.T) {
		env := newKbEnv(t, sqlDB, "acme")
		alice := kbInsertUser(t, sqlDB, "alice")
		carol := kbInsertUser(t, sqlDB, "carol")
		env.joinWorkspace(t, alice, domain.GrantRoleAdmin)
		// carol は所属だけ（grant なし）。
		env.joinWorkspaceWithoutRole(t, carol)
		root := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, alice, "a0", "root")

		e := env.as(carol)
		assert.Equal(t, http.StatusNotFound, e.do(t, http.MethodGet, e.pagePath(root), "").Code)
		tree := e.do(t, http.MethodGet, e.pagesPath(), "")
		require.Equal(t, http.StatusOK, tree.Code)
		assert.JSONEq(t, `{"pages":[],"hasHiddenChildren":false}`, tree.Body.String())
	})
}

// kbCreateChild は parentID の下にページを 1 枚作って ID を返す（e の current user の権限で）。
//
// 根は kbInsertRootPage で直接入れる。スペース直下の作成も HTTP からできる（parentId を
// 省いた POST が 201 になることは別のテストが固定している）が、作成者・position・題名を
// テストごとに固定したいので、前提データは HTTP を通さず用意する。
func kbCreateChild(t *testing.T, e *kbEnv, parentID, title string) string {
	t.Helper()
	created := e.do(t, http.MethodPost, e.pagesPath(), `{"parentId":"`+parentID+`","title":"`+title+`"}`)
	require.Equal(t, http.StatusCreated, created.Code, created.Body.String())
	var page kbPageResponse
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &page))
	return page.ID
}

// kbDumpTreeState はサブツリーの配置を決める列を丸ごと写し取る。
//
// 移動が書き換えるのは pages.parent_id / pages."position" / pages.space_id と
// closure（page_paths）の 4 つだけなので、この文字列が前後で一致すれば
// 「何も書き換わっていない」と言える。個別に assert を並べるより、
// 見落としが起きにくい（列が増えたらここへ足す）。
func kbDumpTreeState(t *testing.T, db *sql.DB, workspaceID string) string {
	t.Helper()
	var pages string
	require.NoError(t, db.QueryRow(
		`SELECT COALESCE(string_agg(
		     id::text || '|' || COALESCE(parent_id::text, '-') || '|' || "position" || '|' || space_id::text,
		     E'\n' ORDER BY id), '')
		 FROM pages WHERE workspace_id = $1`, workspaceID,
	).Scan(&pages))
	var paths string
	require.NoError(t, db.QueryRow(
		`SELECT COALESCE(string_agg(
		     page_id::text || '|' || ancestor_id::text || '|' || depth::text,
		     E'\n' ORDER BY page_id, depth), '')
		 FROM page_paths WHERE workspace_id = $1`, workspaceID,
	).Scan(&paths))
	return pages + "\n--\n" + paths
}

// TestKnowledgeBaseMovePermission_Integration は「移動は根 1 枚の権限しか見ていない」
// 穴が塞がっていることを実 PostgreSQL で確かめる。
//
// 移動はサブツリーごと動くので、子孫それぞれの祖先の並びが変わる。ページ付与は経路の上から
// 降りてくるため、祖先が変われば子孫に届く役割も変わる。操作者から見えない子孫の権限が
// 本人の知らないうちに変わる、というのが塞ぐ相手（「移動すると移動先に張った役割が
// 子孫まで届く」がその変化そのものを見ている）。
//
// **いまの権限モデルでは、サブツリーの検査が断ることは無い。** 役割は 3 段の付与を
// 足し合わせて最も強いものが実効になり、子の経路は親の経路を含むので、木を下るほど
// 弱くなることがない（handler の requireSubtreeEditPermission の doc も同じことを言う）。
// したがってここで確かめるのは「通るべき移動が通ること」と「断ったときに何も
// 書き換わらないこと」の 2 つで、closure まで見るので結合テストに置く
// （page_paths は fake が持っていない）。
func TestKnowledgeBaseMovePermission_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)

	// seed は 親(root) → 子(child) と、移動先(dest) を alice（管理者）の権限で用意する。
	seed := func(t *testing.T, env *kbEnv, alice uint64) (root, child, dest string) {
		t.Helper()
		root = kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, alice, "a0", "移動元")
		dest = kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, alice, "a2", "移動先")
		child = kbCreateChild(t, env.as(alice), root, "子")
		return root, child, dest
	}

	t.Run("移動先を編集できない相手は移せず何も書き換わらない", func(t *testing.T) {
		env := newKbEnv(t, sqlDB, "acme")
		alice := kbInsertUser(t, sqlDB, "alice")
		bob := kbInsertUser(t, sqlDB, "bob")
		env.joinWorkspace(t, alice, domain.GrantRoleAdmin)
		bobPrincipal := env.joinWorkspaceWithoutRole(t, bob)
		root, child, dest := seed(t, env, alice)

		// bob は移動元（と子）を編集でき、移動先は閲覧しかできない。
		env.grantPage(t, root, bobPrincipal.ID, domain.GrantRoleEditor)
		env.grantPage(t, dest, bobPrincipal.ID, domain.GrantRoleViewer)

		before := kbDumpTreeState(t, sqlDB, env.workspaceID)
		e := env.as(bob)
		w := e.do(t, http.MethodPost, e.pagePath(root)+"/move", `{"parentId":"`+dest+`"}`)

		assert.Equal(t, http.StatusForbidden, w.Code, w.Body.String())
		assert.JSONEq(t, `{"error":"forbidden"}`, w.Body.String())
		assert.Equal(t, before, kbDumpTreeState(t, sqlDB, env.workspaceID),
			"断ったなら parent_id / position / page_paths のどれも動かない")

		// 移動先の役割を editor に上げれば通り、closure も張り替わる
		// （移動が常に失敗する締め方にはしない）。
		env.grantPage(t, dest, bobPrincipal.ID, domain.GrantRoleEditor)
		ok := e.do(t, http.MethodPost, e.pagePath(root)+"/move", `{"parentId":"`+dest+`"}`)
		require.Equal(t, http.StatusOK, ok.Code, ok.Body.String())

		var parentID string
		require.NoError(t, sqlDB.QueryRow(
			`SELECT parent_id::text FROM pages WHERE workspace_id = $1 AND id = $2`,
			env.workspaceID, root,
		).Scan(&parentID))
		assert.Equal(t, dest, parentID)

		// 子の祖先に移動先が加わる（＝ 継承の経路が変わる）。これがそのまま
		// 「見えない子孫に届く役割が変わる」の中身で、だから移動でも子孫を見る。
		var depth int
		require.NoError(t, sqlDB.QueryRow(
			`SELECT depth FROM page_paths WHERE workspace_id = $1 AND page_id = $2 AND ancestor_id = $3`,
			env.workspaceID, child, dest,
		).Scan(&depth))
		assert.Equal(t, 2, depth, "子から見て移動先は 2 段上の祖先になる")
	})

	t.Run("移動すると移動先に張った役割が子孫まで届く", func(t *testing.T) {
		// 同じスペースの中で親を付け替えるだけの移動でも、子孫に届く役割は変わる。
		// 操作者（alice）には carol の視界が見えないまま、carol の権限が動く。
		env := newKbEnv(t, sqlDB, "acme")
		alice := kbInsertUser(t, sqlDB, "alice")
		carol := kbInsertUser(t, sqlDB, "carol")
		env.joinWorkspace(t, alice, domain.GrantRoleAdmin)
		carolPrincipal := env.joinWorkspaceWithoutRole(t, carol)
		root, child, dest := seed(t, env, alice)

		// carol の役割は移動先にしかない。
		env.grantPage(t, dest, carolPrincipal.ID, domain.GrantRoleEditor)

		c := env.as(carol)
		require.Equal(t, http.StatusNotFound, c.do(t, http.MethodGet, c.pagePath(root), "").Code,
			"移動前は移動元にも子にも届いていない")
		require.Equal(t, http.StatusNotFound, c.do(t, http.MethodGet, c.pagePath(child), "").Code)

		adminEnv := env.as(alice)
		require.Equal(t, http.StatusOK,
			adminEnv.do(t, http.MethodPost, adminEnv.pagePath(root)+"/move", `{"parentId":"`+dest+`"}`).Code)

		assert.Equal(t, http.StatusOK, c.do(t, http.MethodGet, c.pagePath(root), "").Code,
			"移動先の下に入ったので届くようになる")
		assert.Equal(t, http.StatusOK, c.do(t, http.MethodGet, c.pagePath(child), "").Code,
			"子孫にも同じだけ降りる")
		assert.Equal(t, http.StatusOK,
			c.do(t, http.MethodPatch, c.pagePath(child), `{"title":"改訂"}`).Code,
			"編集の役割も降りる（見えるだけではない）")
	})
}
