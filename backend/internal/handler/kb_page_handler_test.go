package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
	"github.com/norman6464/frestyle/backend/internal/usecase/user"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	kbWorkspaceID        = "0198a000-0000-7000-8000-000000000001"
	kbWorkspaceSlug      = "acme"
	kbOtherWorkspaceID   = "0198a000-0000-7000-8000-0000000000f1"
	kbOtherWorkspaceSlug = "rival"
	kbSpaceID            = "0198a000-0000-7000-8000-000000000002"
	kbRootPageID         = "0198a000-0000-7000-8000-000000000003"
	kbChildPageID        = "0198a000-0000-7000-8000-000000000004"
	kbDestPageID         = "0198a000-0000-7000-8000-000000000005"
	kbUserID             = uint64(42)
	kbLabelID            = "0198a000-0000-7000-8000-000000000006"
	kbOtherWsLabelID     = "0198a000-0000-7000-8000-000000000007"
)

const kbValidDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"本文"}]}]}`

var (
	kbCanEdit = domain.PagePermission{CanView: true, CanEdit: true}
	kbCanView = domain.PagePermission{CanView: true}
	kbNoPerm  = domain.PagePermission{}
)

// kbFixture は fake repository と、本番と同じ wiring で組んだルータの組。
type kbFixture struct {
	pages         *kbFakePages
	perms         *kbFakePerms
	provisioner   *kbFakeProvisioner
	users         *kbFakeUsers
	comments      *kbFakeComments
	versions      *kbFakePageVersions
	views         *kbFakePageViews
	favorites     *kbFakePageFavorites
	templates     *kbFakePageTemplates
	suggestions   *kbFakePageSuggestions
	presigner     *kbFakeImagePresigner
	tickets       *ticketFakeRepo
	invitations   *kbFakeInvitations
	notifications *kbFakeNotifications
	router        *gin.Engine
}

// newKbFixture はワークスペース 2 つ・スペース 1 つ・ページ 3 つ（root / child / dest）の
// 下ごしらえをして、registerKnowledgeBaseRoutesWith で本番と同じルートを張る。
// uid が 0 なら current user を注入せず未認証を再現する。
func newKbFixture(fallback domain.PagePermission, uid uint64) kbFixture {
	gin.SetMode(gin.TestMode)
	pages := newKbFakePages()
	pages.addWorkspace(kbWorkspaceID, kbWorkspaceSlug)
	pages.addWorkspace(kbOtherWorkspaceID, kbOtherWorkspaceSlug)
	pages.addSpace(kbWorkspaceID, kbSpaceID)
	pages.addPage(domain.Page{
		ID: kbRootPageID, WorkspaceID: kbWorkspaceID, SpaceID: kbSpaceID,
		Position: "a0", Title: "root", CreatedByUserID: kbUserID,
	})
	rootID := kbRootPageID
	pages.addPage(domain.Page{
		ID: kbChildPageID, WorkspaceID: kbWorkspaceID, SpaceID: kbSpaceID, ParentID: &rootID,
		Position: "a1", Title: "child", CreatedByUserID: kbUserID,
	})
	pages.addPage(domain.Page{
		ID: kbDestPageID, WorkspaceID: kbWorkspaceID, SpaceID: kbSpaceID,
		Position: "a2", Title: "dest", CreatedByUserID: kbUserID,
	})

	perms := newKbFakePerms(pages, fallback)
	// 所属しているのは本命ワークスペースだけ（もう片方は「他社のテナント」）。
	perms.addMember(kbWorkspaceID, kbUserID)

	r := gin.New()
	g := r.Group("/api/v2")
	if uid != 0 {
		g.Use(func(c *gin.Context) {
			c.Set(middleware.ContextKeyCurrentUserID, uid)
			c.Set(middleware.ContextKeyCurrentUser, &domain.User{ID: uid})
			c.Next()
		})
	}
	provisioner := newKbFakeProvisioner(pages, perms)
	users := newKbFakeUsers()
	comments := newKbFakeComments()
	versions := newKbFakePageVersions(pages)
	views := newKbFakePageViews()
	favorites := newKbFakePageFavorites()
	templates := newKbFakePageTemplates()
	suggestions := newKbFakePageSuggestions()
	presigner := &kbFakeImagePresigner{}
	tickets := newTicketFakeRepo()
	// ラベル付け外しの endpoint（kbEndpoints）が使う実在のラベル。語彙はワークスペース単位。
	tickets.labels[kbLabelID] = &domain.Label{
		ID: kbLabelID, WorkspaceID: kbWorkspaceID, Name: "重要", Color: "#4a90d9",
	}
	// 別ワークスペースのラベル（Test_ナレッジAPI_入力の検証 の 404 ケース用）。
	tickets.labels[kbOtherWsLabelID] = &domain.Label{
		ID: kbOtherWsLabelID, WorkspaceID: "0198a000-0000-7000-8000-0000000000fe",
		Name: "別ワークスペース", Color: "#888888",
	}
	invitations := newKbFakeInvitations(pages, perms, users)
	notifications := newKbFakeNotifications()
	registerKnowledgeBaseRoutesWith(
		g, pages, perms, perms, provisioner, users, comments, versions, views, favorites, templates, suggestions, tickets, fakeTxManager{}, presigner, tickets,
		invitations, notifications,
	)
	// 認証不要のルート（共有リンクの検証・招待の案内）は current user を注入しない group に張る。
	// 本番の NewRouter と同じく認証 middleware の外側なので、ここでも外側に置かないと
	// 「未認証でも通ること」を検証できない。
	registerKnowledgeBasePublicRoutesWith(r.Group("/api/v2"), pages, perms, perms, invitations)
	return kbFixture{
		pages: pages, perms: perms, provisioner: provisioner, users: users,
		comments: comments, versions: versions, views: views, favorites: favorites,
		templates: templates, suggestions: suggestions,
		presigner: presigner, tickets: tickets, invitations: invitations, notifications: notifications, router: r,
	}
}

func (f kbFixture) do(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
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

// kbEndpoint は 1 エンドポイントと、それが要求するケイパビリティ。
// {slug} はワークスペースの slug、{page} は「権限の判定対象になるページ」に置換する
// （作成だけは判定対象が親ページなので、body 側に {page} が入る）。
type kbEndpoint struct {
	name       string
	method     string
	path       string
	body       string
	capability domain.Capability
	okStatus   int
}

// kbEndpoints は認可を配線すべき全エンドポイント。
// ルートを足したらここにも足す（この表が「配線漏れが無いこと」の担保になる）。
var kbEndpoints = []kbEndpoint{
	{
		name: "ページ作成", method: http.MethodPost,
		path:       "/api/v2/kb/workspaces/{slug}/spaces/" + kbSpaceID + "/pages",
		body:       `{"parentId":"{page}","title":"新しいページ"}`,
		capability: domain.CapabilityEdit, okStatus: http.StatusCreated,
	},
	{
		name: "ページ取得", method: http.MethodGet,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}",
		capability: domain.CapabilityView, okStatus: http.StatusOK,
	},
	{
		name: "逆リンク", method: http.MethodGet,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}/backlinks",
		capability: domain.CapabilityView, okStatus: http.StatusOK,
	},
	{
		name: "チケットからの逆参照", method: http.MethodGet,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}/ticket-backlinks",
		capability: domain.CapabilityView, okStatus: http.StatusOK,
	},
	{
		name: "お気に入りに付ける", method: http.MethodPut,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}/favorite",
		capability: domain.CapabilityView, okStatus: http.StatusCreated,
	},
	{
		name: "お気に入りから外す", method: http.MethodDelete,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}/favorite",
		capability: domain.CapabilityView, okStatus: http.StatusNoContent,
	},
	{
		name: "ページ削除", method: http.MethodDelete,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}",
		capability: domain.CapabilityEdit, okStatus: http.StatusNoContent,
	},
	{
		name: "ページ改名", method: http.MethodPatch,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}",
		body:       `{"title":"改訂"}`,
		capability: domain.CapabilityEdit, okStatus: http.StatusOK,
	},
	{
		name: "ページ移動", method: http.MethodPost,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}/move",
		body:       `{"parentId":"` + kbDestPageID + `"}`,
		capability: domain.CapabilityEdit, okStatus: http.StatusOK,
	},
	{
		name: "ページアーカイブ", method: http.MethodPost,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}/archive",
		capability: domain.CapabilityEdit, okStatus: http.StatusNoContent,
	},
	{
		name: "ページ復帰", method: http.MethodPost,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}/unarchive",
		capability: domain.CapabilityEdit, okStatus: http.StatusOK,
	},
	{
		name: "本文置き換え", method: http.MethodPut,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}/content",
		body:       `{"doc":` + kbValidDoc + `}`,
		capability: domain.CapabilityEdit, okStatus: http.StatusOK,
	},
	{
		name: "アイコン設定", method: http.MethodPut,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}/icon",
		body:       `{"type":"emoji","value":"📘"}`,
		capability: domain.CapabilityEdit, okStatus: http.StatusOK,
	},
	{
		name: "アイコン解除", method: http.MethodDelete,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}/icon",
		capability: domain.CapabilityEdit, okStatus: http.StatusOK,
	},
	{
		name: "画像アップロードURL発行", method: http.MethodPost,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}/images/upload-url",
		body:       `{"contentType":"image/png","size":1024}`,
		capability: domain.CapabilityEdit, okStatus: http.StatusOK,
	},
	{
		// key はこのページ自身のもの（kb/<workspaceId>/{page}/...）に固定してある。
		// 別ワークスペースの slug で叩くテストは、この key の workspace 部分と食い違うために
		// なる 404 ではなく、requirePagePermission がページ不在で 404 にする側で通る
		// （テナントが変われば {page} 自体がそのワークスペースには実在しないため）。
		name: "画像ダウンロードURL発行", method: http.MethodGet,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}/images/download-url?key=kb/" + kbWorkspaceID + "/{page}/test.bin",
		capability: domain.CapabilityView, okStatus: http.StatusOK,
	},
	{
		name: "カバー設定", method: http.MethodPut,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}/cover",
		body:       `{"type":"file","key":"kb/` + kbWorkspaceID + `/{page}/test.bin"}`,
		capability: domain.CapabilityEdit, okStatus: http.StatusOK,
	},
	{
		name: "カバー解除", method: http.MethodDelete,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}/cover",
		capability: domain.CapabilityEdit, okStatus: http.StatusOK,
	},
	{
		name: "公開範囲設定", method: http.MethodPut,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}/visibility",
		body:       `{"visibility":"private"}`,
		capability: domain.CapabilityEdit, okStatus: http.StatusOK,
	},
	{
		name: "ラベルを付ける", method: http.MethodPut,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}/labels/" + kbLabelID,
		capability: domain.CapabilityEdit, okStatus: http.StatusNoContent,
	},
	{
		name: "ラベルを外す", method: http.MethodDelete,
		path:       "/api/v2/kb/workspaces/{slug}/pages/{page}/labels/" + kbLabelID,
		capability: domain.CapabilityEdit, okStatus: http.StatusNoContent,
	},
}

// kbTreePath はツリー取得のパス（単一ページを名指ししないので kbEndpoints とは別扱い）。
const kbTreePath = "/api/v2/kb/workspaces/{slug}/spaces/" + kbSpaceID + "/pages"

// ページを名指ししない（＝ 判定対象がページではない）エンドポイント。
// kbEndpoints の表はページ 1 枚の権限を軸に回すので、こちらは別に持って個別に検証する。
const (
	// kbWorkspacesPath は所属ワークスペースの一覧と作成。テナントを URL に持たない。
	kbWorkspacesPath = "/api/v2/kb/workspaces"
	// kbSpacesPath はスペース作成。判定はワークスペース単位。
	kbSpacesPath = "/api/v2/kb/workspaces/{slug}/spaces"
	// kbSpacePatchPath はスペースの表示名変更。判定はスペース単位（管理）。
	kbSpacePatchPath = "/api/v2/kb/workspaces/{slug}/spaces/" + kbSpaceID
	// kbSpaceMembersPath はスペースメンバーの読み取り（段9）。判定はスペース単位（CanView）。
	kbSpaceMembersPath = "/api/v2/kb/workspaces/{slug}/spaces/" + kbSpaceID + "/members"
	// kbSearchPath は題名検索。判定は所属 + 可視のふるい（結果に出るかどうか）。
	kbSearchPath = "/api/v2/kb/workspaces/{slug}/search"
	// kbWorkspacePath はワークスペースの削除。判定はワークスペース単位（管理）。
	kbWorkspacePath = "/api/v2/kb/workspaces/{slug}"
)

func kbFill(s, slug, pageID string) string {
	return strings.NewReplacer("{slug}", slug, "{page}", pageID).Replace(s)
}

func (e kbEndpoint) request(f kbFixture, t *testing.T, slug, pageID string) *httptest.ResponseRecorder {
	t.Helper()
	return f.do(t, e.method, kbFill(e.path, slug, pageID), kbFill(e.body, slug, pageID))
}

// kbRoutePattern は表のパスを gin に登録されるパターンへ戻す（照合用）。
// クエリ文字列（? 以降）は gin のルート表に出てこないので、比較の前に切り落とす
// （画像ダウンロード URL 発行が ?key=... を持つため）。
func kbRoutePattern(p string) string {
	if i := strings.IndexByte(p, '?'); i != -1 {
		p = p[:i]
	}
	return strings.NewReplacer(
		"{slug}", ":workspaceSlug",
		"{page}", ":pageId",
		"{thread}", ":threadId",
		"{seq}", ":seq",
		kbSpaceID, ":spaceId",
		kbLabelID, ":labelId",
	).Replace(p)
}

// 認可テストの表に載っていないルートが増えていないかを見る。
// 表に足し忘れたエンドポイントは認可の検証をすり抜けてしまうので、ここで機械的に塞ぐ。
// 登録されているナレッジのルートが、1 本残らず認可テストの表に載っていることを見る。
//
// # なぜ結合テストではなく単体テストに置いているのか
//
// 探しているのは「認可を通さないルートが増えたこと」で、それは**ルートの一覧**を見れば
// 分かる（実際に叩いて確かめる必要が無い）。結合テストに置くと、DB が要るぶん
// 開発者の手元では skip され得るし、CI でも専用ジョブでしか走らない。
// 配線の穴は書いた直後に落ちてほしいので、`go test ./...` で必ず走る側に置く。
//
// # この検査が守っている連鎖
//
// gin に登録されたルート ⊆ 表（kbEndpoints / kbPermissionEndpoints）で、その表は
// そのまま「admin 以外は通らない」「拒否の応答は対象の実在で変わらない」「変更操作は
// 監査ログに残る」の各テストが総当たりする入力になっている。つまり **認可も監査も
// 掛けずにルートを 1 本生やすと、まずここで落ちる**（表に足せば、今度は他のテストが
// その 1 本を実際に叩いて落とす）。
//
// # 限界（これで拾えないもの）
//
// gin のルート表からは middleware が見えないので、「このルートに audit を挟んだか」は
// ここでは分からない。それを見ているのは表を総当たりする側のテスト
// （Test_ナレッジ権限API_権限を変える経路は全て監査ログに残る）で、この検査は
// 「新しいルートを必ずその表へ載せさせる」ことでそちらへ橋渡ししている。
func Test_ナレッジAPI_登録済みルートは全て認可テストの対象になっている(t *testing.T) {
	covered := map[string]bool{
		http.MethodGet + " " + kbRoutePattern(kbTreePath):    true,
		http.MethodGet + " " + kbWorkspacesPath:              true,
		http.MethodPost + " " + kbWorkspacesPath:             true,
		http.MethodGet + " " + kbRoutePattern(kbSpacesPath):  true,
		http.MethodPost + " " + kbRoutePattern(kbSpacesPath): true,
		// 下 2 本は Test_ナレッジAPI_スペース改名の認可 / 題名検索 が直接叩く。
		http.MethodPatch + " " + kbRoutePattern(kbSpacePatchPath): true,
		http.MethodGet + " " + kbRoutePattern(kbSearchPath):       true,
		// ワークスペース削除。Test_ナレッジAPI_ワークスペース削除 が直接叩く。
		http.MethodDelete + " " + kbRoutePattern(kbWorkspacePath): true,
		// アカウントの停止・復帰（段 7）。usecase 側で users.FindByID を読むため
		// kbFakeUsers に名前を設定した専用の fixture が要り、共有の kbPermissionEndpoints
		// では賄えない。kb_permission_handler_test.go の Test_ナレッジ権限API_停止*・
		// Test_ナレッジ権限API_復帰* が直接叩く。
		http.MethodPut + " " + kbSuspendPattern: true,
		http.MethodPut + " " + kbRestorePattern: true,
		// ワークスペースの人の一覧。判定は所属のみ（役割を見ない）ので表にせず、
		// Test_ナレッジAPI_人の一覧は* が直接叩く。
		http.MethodGet + " " + kbRoutePattern(kbMembersPath): true,
		// お気に入り一覧（段7）。判定は所属のみ（自分の分しか返さないため）なので表にせず、
		// Test_ナレッジAPI_お気に入り一覧は* が直接叩く。
		http.MethodGet + " " + kbRoutePattern(kbFavoritesPath): true,
		// スペースメンバーの読み取り（段9）。判定が CanView で kbEndpoints（ページ単位）とは
		// 軸が違うので表にせず、Test_ナレッジAPI_スペースメンバーは* が直接叩く。
		http.MethodGet + " " + kbRoutePattern(kbSpaceMembersPath): true,
		// 自分がアクセスできるスペースの一覧（段14）。判定は所属のみ（自分自身の grants しか
		// 見ないため）なので表にせず、Test_ナレッジAPI_自分のスペース一覧は* が直接叩く。
		http.MethodGet + " " + kbRoutePattern(kbMySpacesPath): true,
		// 所属・権限の変更履歴（段 6・監査）。判定が admin（CanManage）で他の GET と軸が違うので
		// 表にせず、Test_ナレッジAPI_変更履歴は* が直接叩く。
		http.MethodGet + " " + kbRoutePattern(kbMembershipEventsPath): true,
		// メンバー管理画面向けの一覧（段 7）。判定は変更履歴と同じ admin（CanManage）なので
		// 表にせず、Test_ナレッジAPI_管理者向け一覧は* が直接叩く。
		http.MethodGet + " " + kbRoutePattern(kbAdminMembersPath): true,
		// 自分宛の招待（段 2）。認証だけで所属は問わない特殊な経路（受諾するまで
		// 非メンバーが叩く）ので表にせず、kb_invitation_handler_test.go の
		// Test_招待API_* が直接叩く。
		http.MethodGet + " /api/v2/kb/invitations":                        true,
		http.MethodPost + " /api/v2/kb/invitations/:invitationId/accept":  true,
		http.MethodPost + " /api/v2/kb/invitations/:invitationId/decline": true,
		// 招待 URL の案内。未認証で、認可はトークンが担う（kb_invitation_handler_test.go）。
		http.MethodPost + " /api/v2/kb/invitations/preview": true,
		// /p/{pageId} の解決。Test_ナレッジAPI_IDだけでの解決 が直接叩く。
		http.MethodGet + " /api/v2/kb/pages/:pageId": true,
		// 自分の最近見たページ（段2）。認証だけで所属は問わない特殊な経路（ワークスペース
		// 横断）なので表にせず、Test_ナレッジAPI_最近見たページ* が直接叩く。
		http.MethodGet + " /api/v2/kb/me/recent-pages": true,
		// ページの雛形 API。判定の軸がそれぞれ違う
		// （一覧=所属のみ、保存・削除=ワークスペース全体のCanEdit、使用=既存のページ作成と
		// 同じ分岐）ため表にせず個別に列挙する。page_template_handler_test.go の
		// Test_雛形API_* が直接叩く。
		http.MethodGet + " /api/v2/kb/workspaces/:workspaceSlug/templates":                            true,
		http.MethodPost + " /api/v2/kb/workspaces/:workspaceSlug/pages/:pageId/templates":             true,
		http.MethodDelete + " /api/v2/kb/workspaces/:workspaceSlug/templates/:templateId":             true,
		http.MethodPost + " /api/v2/kb/workspaces/:workspaceSlug/spaces/:spaceId/pages/from-template": true,
		// 提案 API。作成=CanComment、一覧=CanView、採用・却下=CanEdit と
		// エンドポイントごとに判定の軸が違うため表にせず個別に列挙する。
		// page_suggestion_handler_test.go の Test_提案API_* が直接叩く。
		http.MethodPost + " /api/v2/kb/workspaces/:workspaceSlug/pages/:pageId/suggestions":                      true,
		http.MethodGet + " /api/v2/kb/workspaces/:workspaceSlug/pages/:pageId/suggestions":                       true,
		http.MethodPost + " /api/v2/kb/workspaces/:workspaceSlug/pages/:pageId/suggestions/:suggestionId/accept": true,
		http.MethodPost + " /api/v2/kb/workspaces/:workspaceSlug/pages/:pageId/suggestions/:suggestionId/reject": true,
	}
	for _, e := range kbEndpoints {
		covered[e.method+" "+kbRoutePattern(e.path)] = true
	}
	// 権限操作 API は判定の軸が違う（ページ 1 枚のケイパビリティではなく admin か）ので
	// 表を分けてある。足したら kbPermissionEndpoints 側に足す。
	for _, e := range kbPermissionEndpoints {
		covered[e.method+" "+e.pattern] = true
	}
	// コメント API も判定の軸が違う（domain.Capability の view/edit ではなく
	// domain.PagePermission.CanComment）ので表を分けてある。足したら
	// comment_handler_test.go の kbCommentEndpoints 側に足す。
	for _, e := range kbCommentEndpoints {
		covered[e.method+" "+kbRoutePattern(e.path)] = true
	}
	// ページ本文の版 API も判定の軸は domain.Capability だが、
	// {seq} という kbEndpoints に無いプレースホルダを要るため表を分けてある
	// （page_version_handler_test.go の kbVersionEndpoints）。足したらそちら側に足す。
	for _, e := range kbVersionEndpoints {
		covered[e.method+" "+kbRoutePattern(e.path)] = true
	}
	covered[http.MethodPost+" "+kbShareLinkVerifyPath] = true

	f := newKbFixture(kbCanEdit, kbUserID)
	registered := map[string]bool{}
	for _, r := range f.router.Routes() {
		if !strings.HasPrefix(r.Path, "/api/v2/kb/") {
			continue
		}
		key := r.Method + " " + r.Path
		registered[key] = true
		assert.True(t, covered[key], "認可テストの表に無いルート: %s", key)
	}
	for key := range covered {
		assert.True(t, registered[key], "表にあるのに登録されていないルート: %s", key)
	}
}

func Test_ナレッジAPI_編集できるユーザーは全経路を通れる(t *testing.T) {
	for _, e := range kbEndpoints {
		t.Run(e.name, func(t *testing.T) {
			f := newKbFixture(kbCanEdit, kbUserID)
			w := e.request(f, t, kbWorkspaceSlug, kbChildPageID)
			assert.Equal(t, e.okStatus, w.Code, "body=%s", w.Body.String())
		})
	}
}

func Test_ナレッジAPI_権限が無いユーザーは全経路で404(t *testing.T) {
	for _, e := range kbEndpoints {
		t.Run(e.name, func(t *testing.T) {
			f := newKbFixture(kbNoPerm, kbUserID)
			w := e.request(f, t, kbWorkspaceSlug, kbChildPageID)
			assert.Equal(t, http.StatusNotFound, w.Code)
			assert.JSONEq(t, `{"error":"not_found"}`, w.Body.String(),
				"閲覧できないページは存在しないページと同じ応答にする")
		})
	}
	t.Run("ツリー取得", func(t *testing.T) {
		f := newKbFixture(kbNoPerm, kbUserID)
		w := f.do(t, http.MethodGet, kbFill(kbTreePath, kbWorkspaceSlug, ""), "")
		assert.Equal(t, http.StatusOK, w.Code)
		assert.JSONEq(t, `{"pages":[],"hasHiddenChildren":false}`, w.Body.String(),
			"1 件も見えないスペースは空のツリー。伏せた印も返さない（存在しないスペースと\n\t\t\t\t撃ち分けると、応答の差から実在が分かるため）")
	})
}

func Test_ナレッジAPI_閲覧だけのユーザーは書き込み経路で403(t *testing.T) {
	for _, e := range kbEndpoints {
		t.Run(e.name, func(t *testing.T) {
			f := newKbFixture(kbCanView, kbUserID)
			w := e.request(f, t, kbWorkspaceSlug, kbChildPageID)
			if e.capability == domain.CapabilityView {
				assert.Equal(t, e.okStatus, w.Code, "閲覧経路は通る")
				return
			}
			assert.Equal(t, http.StatusForbidden, w.Code, "body=%s", w.Body.String())
			assert.JSONEq(t, `{"error":"forbidden"}`, w.Body.String())
		})
	}
}

func Test_ナレッジAPI_別ワークスペースのslugは全経路で404(t *testing.T) {
	for _, e := range kbEndpoints {
		t.Run(e.name, func(t *testing.T) {
			// 権限は最強にしておく。それでも所属していないテナントには触れないことを見る。
			f := newKbFixture(kbCanEdit, kbUserID)
			w := e.request(f, t, kbOtherWorkspaceSlug, kbChildPageID)
			assert.Equal(t, http.StatusNotFound, w.Code)
			assert.JSONEq(t, `{"error":"not_found"}`, w.Body.String())
		})
	}
	t.Run("ツリー取得", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		w := f.do(t, http.MethodGet, kbFill(kbTreePath, kbOtherWorkspaceSlug, ""), "")
		assert.Equal(t, http.StatusNotFound, w.Code)
	})
}

func Test_ナレッジAPI_存在しないslugは所属していないslugと区別できない(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	unknown := f.do(t, http.MethodGet,
		kbFill("/api/v2/kb/workspaces/{slug}/pages/{page}", "no-such-workspace", kbChildPageID), "")
	foreign := f.do(t, http.MethodGet,
		kbFill("/api/v2/kb/workspaces/{slug}/pages/{page}", kbOtherWorkspaceSlug, kbChildPageID), "")

	assert.Equal(t, http.StatusNotFound, unknown.Code)
	assert.Equal(t, foreign.Code, unknown.Code)
	assert.Equal(t, foreign.Body.String(), unknown.Body.String(),
		"slug の総当たりでテナントの実在が分からないこと")
}

func Test_ナレッジAPI_未認証は全経路で401(t *testing.T) {
	for _, e := range kbEndpoints {
		t.Run(e.name, func(t *testing.T) {
			f := newKbFixture(kbCanEdit, 0)
			w := e.request(f, t, kbWorkspaceSlug, kbChildPageID)
			assert.Equal(t, http.StatusUnauthorized, w.Code)
		})
	}
}

func Test_ナレッジAPI_存在しないページと権限の無いページは区別できない(t *testing.T) {
	const missingPageID = "0198a000-0000-7000-8000-00000000dead"
	for _, e := range kbEndpoints {
		t.Run(e.name, func(t *testing.T) {
			// 権限は最強のまま、対象ページだけを存在しない ID にする。
			existing := newKbFixture(kbCanEdit, kbUserID)
			missing := e.request(existing, t, kbWorkspaceSlug, missingPageID)

			// ページは実在するが、そのページだけ閲覧できない。
			hidden := newKbFixture(kbCanEdit, kbUserID)
			hidden.perms.setPagePermission(kbChildPageID, kbUserID, kbNoPerm)
			denied := e.request(hidden, t, kbWorkspaceSlug, kbChildPageID)

			assert.Equal(t, http.StatusNotFound, missing.Code)
			assert.Equal(t, missing.Code, denied.Code)
			assert.Equal(t, missing.Body.String(), denied.Body.String(),
				"ID の総当たりで隠したページの実在が分からないこと")
		})
	}
}

func Test_ナレッジツリー_見えない親の子は根に浮かない(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	// root(見えない) → child(見える) → grandchild(見える)、dest(見える) の形にする。
	childID := kbChildPageID
	f.pages.addPage(domain.Page{
		ID: "0198a000-0000-7000-8000-000000000006", WorkspaceID: kbWorkspaceID, SpaceID: kbSpaceID,
		ParentID: &childID, Position: "a15", Title: "grandchild", CreatedByUserID: kbUserID,
	})
	f.perms.setPagePermission(kbRootPageID, kbUserID, kbNoPerm)

	w := f.do(t, http.MethodGet, kbFill(kbTreePath, kbWorkspaceSlug, ""), "")
	require.Equal(t, http.StatusOK, w.Code)

	var body kbPageTreeRootResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	tree := body.Pages
	require.Len(t, tree, 1, "見えない root の配下は子孫ごとツリーに現れない")
	assert.Equal(t, kbDestPageID, tree[0].Page.ID)
	assert.Empty(t, tree[0].Children)
}

func Test_ナレッジツリー_見える親の下に子がぶら下がる(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	w := f.do(t, http.MethodGet, kbFill(kbTreePath, kbWorkspaceSlug, ""), "")
	require.Equal(t, http.StatusOK, w.Code)

	var body kbPageTreeRootResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	tree := body.Pages
	require.Len(t, tree, 2, "root と dest が根")
	assert.Equal(t, kbRootPageID, tree[0].Page.ID)
	require.Len(t, tree[0].Children, 1)
	assert.Equal(t, kbChildPageID, tree[0].Children[0].Page.ID)
	assert.Equal(t, kbDestPageID, tree[1].Page.ID)
}

func Test_ナレッジツリー_アーカイブ済みページは現れない(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	at := time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC)
	f.pages.pages[kbChildPageID].ArchivedAt = &at

	w := f.do(t, http.MethodGet, kbFill(kbTreePath, kbWorkspaceSlug, ""), "")
	require.Equal(t, http.StatusOK, w.Code)

	var body kbPageTreeRootResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	tree := body.Pages
	require.Len(t, tree, 2)
	assert.Empty(t, tree[0].Children)
}

func Test_ナレッジツリー_見えない子は有無だけ返す(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	// 応答に混ざっていないことを確かめたいので、schema の項目名と衝突しない題名にする
	// （既定の "child" は children 項目に含まれてしまい、検査が素通りする）。
	f.pages.pages[kbChildPageID].Title = "機密の議事録"
	f.perms.setPagePermission(kbChildPageID, kbUserID, kbNoPerm)

	w := f.do(t, http.MethodGet, kbFill(kbTreePath, kbWorkspaceSlug, ""), "")
	require.Equal(t, http.StatusOK, w.Code)

	var body kbPageTreeRootResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	require.Len(t, body.Pages, 2, "root と dest が根")

	assert.Equal(t, kbRootPageID, body.Pages[0].Page.ID)
	assert.Empty(t, body.Pages[0].Children, "見えない子はツリーに現れない")
	assert.True(t, body.Pages[0].HasHiddenChildren, "現れない代わりに、在ることだけ出す")
	assert.False(t, body.HasHiddenChildren, "根の段では伏せていない")
	// 枚数が載る余地が無いことを、応答の形そのもので確かめる。
	// 中身の substring で数字を探すのは無意味（UUID や日時にも数字が入る）。
	assert.NotContains(t, w.Body.String(), "hiddenChildCount", "枚数を返す項目が復活していないこと")
	assert.Contains(t, w.Body.String(), `"hasHiddenChildren":true`)

	assert.NotContains(t, w.Body.String(), "機密の議事録", "題名は応答のどこにも出さない")
}

func Test_ナレッジツリー_スペース直下の見えないページも印に出る(t *testing.T) {
	// 段ごとに「見えない子が居る」と示す以上、いちばん上の段だけ黙るのは筋が通らない。
	// 1 枚でも見えていればスペースの実在は既に分かっているので、実在は新たに漏れない。
	f := newKbFixture(kbCanEdit, kbUserID)
	f.perms.setPagePermission(kbDestPageID, kbUserID, kbNoPerm)

	w := f.do(t, http.MethodGet, kbFill(kbTreePath, kbWorkspaceSlug, ""), "")
	require.Equal(t, http.StatusOK, w.Code)

	var body kbPageTreeRootResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	require.Len(t, body.Pages, 1, "見える根は root だけ")
	assert.Equal(t, kbRootPageID, body.Pages[0].Page.ID)
	assert.True(t, body.HasHiddenChildren, "スペース直下で伏せた分を印に出す")
}

func Test_ナレッジツリー_見える根が無いときは存在しないスペースと同じ応答(t *testing.T) {
	// 根が非公開で、その子だけ閲覧できる形。木には 1 行も出ない。
	// このとき印を返すと、存在しないスペースと撃ち分けられて実在が漏れる。
	f := newKbFixture(kbCanEdit, kbUserID)
	f.perms.setPagePermission(kbRootPageID, kbUserID, kbNoPerm)
	f.perms.setPagePermission(kbDestPageID, kbUserID, kbNoPerm)

	w := f.do(t, http.MethodGet, kbFill(kbTreePath, kbWorkspaceSlug, ""), "")
	require.Equal(t, http.StatusOK, w.Code)

	missing := f.do(t, http.MethodGet,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/spaces/0198a000-0000-7000-8000-00000000beef/pages", "")

	assert.JSONEq(t, `{"pages":[],"hasHiddenChildren":false}`, w.Body.String())
	assert.Equal(t, missing.Body.String(), w.Body.String(),
		"存在しないスペースの応答と 1 バイトも変わらないこと")
}

func Test_ナレッジツリー_並び順のキーを応答に出さない(t *testing.T) {
	// 分数インデックスの整数部は末尾追加のたびに 1 ずつ増える。a0 と a3 が見えて
	// a1 a2 が見えなければ、その間に 2 枚あることがそのまま読める。
	// hasHiddenChildren を有無に落として枚数を伏せた意味が、この 1 項目で消える。
	f := newKbFixture(kbCanEdit, kbUserID)

	w := f.do(t, http.MethodGet, kbFill(kbTreePath, kbWorkspaceSlug, ""), "")
	require.Equal(t, http.StatusOK, w.Code)

	assert.NotContains(t, w.Body.String(), `"position"`)
	// fixture は a0 / a2 を使っている（間が空いている＝伏せた 1 枚が読める形）。
	assert.NotContains(t, w.Body.String(), `"a0"`)
	assert.NotContains(t, w.Body.String(), `"a2"`)
}

func Test_ナレッジ作成_URLのスペースが実在するかを応答から読めない(t *testing.T) {
	// 親を指定して作るとき、URL の spaceId は「親のスペースと同じか」の比較にしか使わない。
	// スペースを引いて確かめると、実在しない ID は 404、実在する別の ID は 400 になり、
	// 応答の差からそのスペースが在るかどうかが分かってしまう。
	const existingOtherSpace = "0198a000-0000-7000-8000-0000000000c1"
	const missingSpace = "0198a000-0000-7000-8000-00000000beef"
	body := `{"parentId":"` + kbRootPageID + `","title":"別スペースの親"}`

	post := func(t *testing.T, spaceID string) *httptest.ResponseRecorder {
		t.Helper()
		f := newKbFixture(kbCanEdit, kbUserID)
		// 一方だけスペースを実在させる。ここが唯一の違い。
		if spaceID == existingOtherSpace {
			f.pages.addSpace(kbWorkspaceID, existingOtherSpace)
		}
		return f.do(t, http.MethodPost,
			"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/spaces/"+spaceID+"/pages", body)
	}

	onExisting := post(t, existingOtherSpace)
	onMissing := post(t, missingSpace)

	assert.Equal(t, onExisting.Code, onMissing.Code, "実在の有無でステータスを変えない")
	assert.Equal(t, onExisting.Body.String(), onMissing.Body.String(),
		"実在の有無で本文を変えない（1 バイトも）")
	assert.Equal(t, http.StatusBadRequest, onExisting.Code)
	assert.JSONEq(t, `{"error":"parent_space_mismatch"}`, onExisting.Body.String())
}

func Test_ナレッジツリー_アーカイブ済みの一覧(t *testing.T) {
	at := time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC)
	archivedPath := kbFill(kbTreePath, kbWorkspaceSlug, "") + "?archived=true"

	t.Run("既定では現役だけを返す", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.pages.pages[kbDestPageID].ArchivedAt = &at

		w := f.do(t, http.MethodGet, kbFill(kbTreePath, kbWorkspaceSlug, ""), "")
		require.Equal(t, http.StatusOK, w.Code)

		var body kbPageTreeRootResponse
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		require.Len(t, body.Pages, 1)
		assert.Equal(t, kbRootPageID, body.Pages[0].Page.ID)
	})

	t.Run("アーカイブの根は、親が現役でも一覧に出る", func(t *testing.T) {
		// アーカイブの根の親は現役なので、この一覧には入らない＝必ず孤児になる。
		// 現役の一覧と同じく落としてしまうと、1 件も出なくなる。
		f := newKbFixture(kbCanEdit, kbUserID)
		f.pages.pages[kbChildPageID].ArchivedAt = &at

		w := f.do(t, http.MethodGet, archivedPath, "")
		require.Equal(t, http.StatusOK, w.Code)

		var body kbPageTreeRootResponse
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		require.Len(t, body.Pages, 1)
		assert.Equal(t, kbChildPageID, body.Pages[0].Page.ID)
		assert.False(t, body.Pages[0].ParentArchived, "親が現役なので復帰できる側")
	})

	t.Run("一緒にアーカイブされた子孫は根の下に入り、親がアーカイブ済みだと分かる", func(t *testing.T) {
		// 何を巻き込んで復帰するのかが、開けば分かる。
		f := newKbFixture(kbCanEdit, kbUserID)
		f.pages.pages[kbRootPageID].ArchivedAt = &at
		f.pages.pages[kbChildPageID].ArchivedAt = &at

		w := f.do(t, http.MethodGet, archivedPath, "")
		require.Equal(t, http.StatusOK, w.Code)

		var body kbPageTreeRootResponse
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		require.Len(t, body.Pages, 1)
		assert.Equal(t, kbRootPageID, body.Pages[0].Page.ID)
		assert.False(t, body.Pages[0].ParentArchived, "根は復帰できる")
		require.Len(t, body.Pages[0].Children, 1)
		assert.Equal(t, kbChildPageID, body.Pages[0].Children[0].Page.ID)
		assert.True(t, body.Pages[0].Children[0].ParentArchived, "子だけを復帰させることはできない")
	})

	t.Run("権限の見方は現役とまったく同じ", func(t *testing.T) {
		// 別のクエリにすると、片方だけ直して食い違う形をわざわざ作ることになる。
		f := newKbFixture(kbCanEdit, kbUserID)
		f.pages.pages[kbChildPageID].ArchivedAt = &at
		f.perms.setPagePermission(kbChildPageID, kbUserID, kbNoPerm)

		w := f.do(t, http.MethodGet, archivedPath, "")
		require.Equal(t, http.StatusOK, w.Code)

		assert.JSONEq(t, `{"pages":[],"hasHiddenChildren":false}`, w.Body.String(),
			"見えないページはアーカイブ済みでも出ない")
	})
}

func Test_ナレッジ移動_親を省くとスペース直下へ戻る(t *testing.T) {
	movePath := "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/move"

	// snapshot は「断ったら何も書き換わらない」を確かめるための控え。ParentID だけを見ると、
	// 親が別のページに変わっても position がずれても通ってしまう。
	type snapshot struct {
		parentID string
		spaceID  string
		position string
	}
	take := func(f kbFixture) snapshot {
		p := f.pages.pages[kbChildPageID]
		parent := ""
		if p.ParentID != nil {
			parent = *p.ParentID
		}
		return snapshot{parentID: parent, spaceID: p.SpaceID, position: p.Position}
	}

	t.Run("親を省くとスペース直下へ移る", func(t *testing.T) {
		// 入れ子になったページを最上段へ戻すのはドラッグの基本操作。これが無いと
		// 「入れることはできるが出せない」ドラッグになる。
		f := newKbFixture(kbCanEdit, kbUserID)
		// スペース直下へ戻す判断はスペースの権限で行うので、そちらも editor にする。
		f.perms.scopeRoles[kbScopeKey{scopeID: kbSpaceID, userID: kbUserID}] = domain.GrantRoleEditor
		require.NotNil(t, f.pages.pages[kbChildPageID].ParentID)

		w := f.do(t, http.MethodPost, movePath, `{}`)

		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Nil(t, f.pages.pages[kbChildPageID].ParentID, "スペース直下へ移っている")
		assert.Equal(t, kbSpaceID, f.pages.pages[kbChildPageID].SpaceID, "スペースは変わらない")
	})

	// スペース直下へ戻す先はページではないので、そこはスペースの権限が正しい単位。
	deniedCases := []struct {
		name string
		role domain.GrantRole
	}{
		{"閲覧しかできない", domain.GrantRoleViewer},
		{"コメントしかできない", domain.GrantRoleCommenter},
	}
	for _, tc := range deniedCases {
		t.Run("スペースを編集できなければ断る／"+tc.name, func(t *testing.T) {
			f := newKbFixture(kbCanEdit, kbUserID)
			f.perms.scopeRoles[kbScopeKey{scopeID: kbSpaceID, userID: kbUserID}] = tc.role
			before := take(f)

			w := f.do(t, http.MethodPost, movePath, `{}`)

			assert.Equal(t, http.StatusForbidden, w.Code)
			assert.Equal(t, before, take(f), "断ったら親・スペース・並び順のどれも書き換わらない")
		})
	}
}

func Test_ナレッジ移動_落とした位置に置く(t *testing.T) {
	movePath := func(pageID string) string {
		return "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + pageID + "/move"
	}
	// 兄弟を 3 枚（a0 / a1 / a2）用意して、その中へ dest を差し込む。
	setup := func(t *testing.T) kbFixture {
		t.Helper()
		f := newKbFixture(kbCanEdit, kbUserID)
		for i, id := range []string{"sib-a", "sib-b", "sib-c"} {
			parent := kbRootPageID
			f.pages.addPage(domain.Page{
				ID: id, WorkspaceID: kbWorkspaceID, SpaceID: kbSpaceID, ParentID: &parent,
				Position: "a" + string(rune('1'+i)), Title: id, CreatedByUserID: kbUserID,
			})
		}
		return f
	}
	positionOf := func(f kbFixture, id string) string { return f.pages.pages[id].Position }

	t.Run("指定した兄弟の直後に入る", func(t *testing.T) {
		f := setup(t)
		body := `{"parentId":"` + kbRootPageID + `","afterPageId":"sib-a"}`

		w := f.do(t, http.MethodPost, movePath(kbDestPageID), body)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())

		got := positionOf(f, kbDestPageID)
		assert.Greater(t, got, positionOf(f, "sib-a"))
		assert.Less(t, got, positionOf(f, "sib-b"))
	})

	t.Run("指定した兄弟の手前に入る（先頭もこれで表す）", func(t *testing.T) {
		f := setup(t)
		body := `{"parentId":"` + kbRootPageID + `","beforePageId":"sib-a"}`

		w := f.do(t, http.MethodPost, movePath(kbDestPageID), body)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())

		assert.Less(t, positionOf(f, kbDestPageID), positionOf(f, "sib-a"))
	})

	t.Run("他の兄弟のキーは書き換えない", func(t *testing.T) {
		// 分数インデックスの効能そのもの。整数の連番なら以降を全部ずらすことになる。
		f := setup(t)
		before := map[string]string{
			"sib-a": positionOf(f, "sib-a"),
			"sib-b": positionOf(f, "sib-b"),
			"sib-c": positionOf(f, "sib-c"),
		}

		w := f.do(t, http.MethodPost, movePath(kbDestPageID),
			`{"parentId":"`+kbRootPageID+`","afterPageId":"sib-a"}`)
		require.Equal(t, http.StatusOK, w.Code)

		for id, pos := range before {
			assert.Equal(t, pos, positionOf(f, id), "動くのは 1 行だけ: %s", id)
		}
	})

	t.Run("位置を指定しなければ末尾（これまでの挙動）", func(t *testing.T) {
		f := setup(t)

		w := f.do(t, http.MethodPost, movePath(kbDestPageID), `{"parentId":"`+kbRootPageID+`"}`)
		require.Equal(t, http.StatusOK, w.Code)

		assert.Greater(t, positionOf(f, kbDestPageID), positionOf(f, "sib-c"))
	})

	t.Run("前後の両方を指定したら断る", func(t *testing.T) {
		// どちらを採ったかで結果が変わるのに、呼び出し側からは分からない。
		f := setup(t)
		body := `{"parentId":"` + kbRootPageID + `","afterPageId":"sib-a","beforePageId":"sib-b"}`

		w := f.do(t, http.MethodPost, movePath(kbDestPageID), body)

		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.JSONEq(t, `{"error":"invalid_request"}`, w.Body.String())
	})

	t.Run("兄弟でないページを隣に指定したら断る（末尾へ落とさない）", func(t *testing.T) {
		// 黙って末尾へ落とすと、利用者が落とした場所と違う場所に入り、しかも成功に見える。
		f := setup(t)
		before := positionOf(f, kbDestPageID)

		// root 自身は root の子ではない（スペース直下）ので、移動先 root の兄弟ではない。
		body := `{"parentId":"` + kbRootPageID + `","afterPageId":"` + kbRootPageID + `"}`
		w := f.do(t, http.MethodPost, movePath(kbDestPageID), body)

		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.JSONEq(t, `{"error":"anchor_not_sibling"}`, w.Body.String())
		assert.Equal(t, before, positionOf(f, kbDestPageID), "断ったら何も書き換わらない")
	})

	t.Run("自分自身を隣に指定したら断る", func(t *testing.T) {
		// 動かす当人は隣人の計算から必ず除く。除かないと自分自身との中間値を計算し、
		// 「自分の隣に自分を置く」という意味のない成功になる。
		f := setup(t)
		body := `{"parentId":"` + kbRootPageID + `","afterPageId":"sib-a"}`
		require.Equal(t, http.StatusOK, f.do(t, http.MethodPost, movePath("sib-b"), body).Code)

		w := f.do(t, http.MethodPost, movePath("sib-b"),
			`{"parentId":"`+kbRootPageID+`","afterPageId":"sib-b"}`)

		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.JSONEq(t, `{"error":"anchor_not_sibling"}`, w.Body.String())
	})

	t.Run("閲覧できないページを隣に指定したら404", func(t *testing.T) {
		// 確かめずに通すと、「その ID が移動先の子か」を成功と 400 の差で言い当てられる。
		f := setup(t)
		f.perms.setPagePermission("sib-a", kbUserID, kbNoPerm)
		body := `{"parentId":"` + kbRootPageID + `","afterPageId":"sib-a"}`

		w := f.do(t, http.MethodPost, movePath(kbDestPageID), body)

		assert.Equal(t, http.StatusNotFound, w.Code)
		assert.JSONEq(t, `{"error":"not_found"}`, w.Body.String())
	})
}

func Test_ナレッジツリー_存在しないスペースは空のツリー(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	w := f.do(t, http.MethodGet,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/spaces/0198a000-0000-7000-8000-00000000beef/pages", "")

	assert.Equal(t, http.StatusOK, w.Code)
	assert.JSONEq(t, `{"pages":[],"hasHiddenChildren":false}`, w.Body.String(),
		"存在しないスペースと中身が見えないスペースを撃ち分けない")
}

func Test_ナレッジ移動_移動先の親の権限も見る(t *testing.T) {
	movePath := "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/move"
	body := `{"parentId":"` + kbDestPageID + `"}`

	t.Run("移動先が閲覧だけなら403", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setPagePermission(kbDestPageID, kbUserID, kbCanView)
		w := f.do(t, http.MethodPost, movePath, body)
		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("移動先が見えないなら404", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setPagePermission(kbDestPageID, kbUserID, kbNoPerm)
		w := f.do(t, http.MethodPost, movePath, body)
		assert.Equal(t, http.StatusNotFound, w.Code)
		assert.JSONEq(t, `{"error":"not_found"}`, w.Body.String())
	})

	t.Run("自分の子孫の下へは移せない", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		w := f.do(t, http.MethodPost,
			"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbRootPageID+"/move",
			`{"parentId":"`+kbChildPageID+`"}`)
		assert.Equal(t, http.StatusConflict, w.Code)
		assert.JSONEq(t, `{"error":"page_cycle"}`, w.Body.String())
	})
}

func Test_ナレッジAPI_アーカイブ済みページの変更は409(t *testing.T) {
	at := time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{"改名", http.MethodPatch, "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID, `{"title":"改訂"}`},
		{"本文置き換え", http.MethodPut, "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/content", `{"doc":` + kbValidDoc + `}`},
		{"アイコン設定", http.MethodPut, "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/icon", `{"type":"emoji","value":"📘"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newKbFixture(kbCanEdit, kbUserID)
			f.pages.pages[kbChildPageID].ArchivedAt = &at
			w := f.do(t, tc.method, tc.path, tc.body)
			assert.Equal(t, http.StatusConflict, w.Code)
			assert.JSONEq(t, `{"error":"page_archived"}`, w.Body.String())
		})
	}
}

func Test_ナレッジAPI_アーカイブは冪等で復帰すると現役に戻る(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	base := "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbRootPageID

	require.Equal(t, http.StatusNoContent, f.do(t, http.MethodPost, base+"/archive", "").Code)
	require.Equal(t, http.StatusNoContent, f.do(t, http.MethodPost, base+"/archive", "").Code)
	assert.NotNil(t, f.pages.pages[kbChildPageID].ArchivedAt, "子孫もまとめてアーカイブされる")

	w := f.do(t, http.MethodPost, base+"/unarchive", "")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Nil(t, f.pages.pages[kbRootPageID].ArchivedAt)
	assert.Nil(t, f.pages.pages[kbChildPageID].ArchivedAt, "一緒にアーカイブした子孫も戻る")
}

func Test_ナレッジAPI_入力の検証(t *testing.T) {
	cases := []struct {
		name   string
		method string
		path   string
		body   string
		status int
		// errorCode は応答の "error" フィールド。空なら status だけを見る
		// （invalid_icon と invalid_request のように、同じ 400 でも理由を撃ち分けたい場合に使う）。
		errorCode string
	}{
		{
			name: "作成にtitleが無ければ400", method: http.MethodPost,
			path:   "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/spaces/" + kbSpaceID + "/pages",
			body:   `{"parentId":"` + kbRootPageID + `"}`,
			status: http.StatusBadRequest,
		},
		{
			name: "ワークスペース作成のslugが不正なら400", method: http.MethodPost,
			path:   kbWorkspacesPath,
			body:   `{"slug":"Acme Inc","name":"Acme"}`,
			status: http.StatusBadRequest,
		},
		{
			name: "タイトルが201文字なら400", method: http.MethodPatch,
			path:   "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID,
			body:   `{"title":"` + strings.Repeat("あ", 201) + `"}`,
			status: http.StatusBadRequest,
		},
		{
			name: "本文がdocでなければ400", method: http.MethodPut,
			path:   "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/content",
			body:   `{"doc":{"type":"paragraph"}}`,
			status: http.StatusBadRequest,
		},
		{
			name: "本文に未知のノードがあれば400", method: http.MethodPut,
			path:   "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/content",
			body:   `{"doc":{"type":"doc","content":[{"type":"未知のノード"}]}}`,
			status: http.StatusBadRequest,
		},
		{
			name: "アイコンが空文字ならinvalid_icon", method: http.MethodPut,
			path:      "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/icon",
			body:      `{"type":"emoji","value":""}`,
			status:    http.StatusBadRequest,
			errorCode: "invalid_icon",
		},
		{
			name: "アイコンの種類がemoji以外ならinvalid_icon", method: http.MethodPut,
			path:      "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/icon",
			body:      `{"type":"url","value":"📘"}`,
			status:    http.StatusBadRequest,
			errorCode: "invalid_icon",
		},
		{
			name: "アイコンが17runeならinvalid_icon", method: http.MethodPut,
			path:      "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/icon",
			body:      `{"type":"emoji","value":"` + strings.Repeat("a", 17) + `"}`,
			status:    http.StatusBadRequest,
			errorCode: "invalid_icon",
		},
		{
			name: "アイコンのtypeが欠落していればinvalid_request", method: http.MethodPut,
			path:      "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/icon",
			body:      `{"value":"📘"}`,
			status:    http.StatusBadRequest,
			errorCode: "invalid_request",
		},
		{
			name: "画像アップロードURL発行でsizeが欠落していればinvalid_request", method: http.MethodPost,
			path:      "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/images/upload-url",
			body:      `{"contentType":"image/png"}`,
			status:    http.StatusBadRequest,
			errorCode: "invalid_request",
		},
		{
			name: "画像アップロードURL発行でsizeが数値でなければinvalid_request", method: http.MethodPost,
			path:      "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/images/upload-url",
			body:      `{"contentType":"image/png","size":"1024"}`,
			status:    http.StatusBadRequest,
			errorCode: "invalid_request",
		},
		{
			name: "画像アップロードURL発行でcontentTypeが欠落していればinvalid_request", method: http.MethodPost,
			path:      "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/images/upload-url",
			body:      `{"size":1024}`,
			status:    http.StatusBadRequest,
			errorCode: "invalid_request",
		},
		{
			name: "画像アップロードURL発行で許可リスト外のcontentTypeはunsupported_content_type", method: http.MethodPost,
			path:      "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/images/upload-url",
			body:      `{"contentType":"image/svg+xml","size":1024}`,
			status:    http.StatusBadRequest,
			errorCode: "unsupported_content_type",
		},
		{
			name: "画像アップロードURL発行でサイズ超過はimage_too_large", method: http.MethodPost,
			path:      "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/images/upload-url",
			body:      `{"contentType":"image/png","size":99999999}`,
			status:    http.StatusBadRequest,
			errorCode: "image_too_large",
		},
		{
			name: "画像ダウンロードURL発行でkeyが無ければinvalid_request", method: http.MethodGet,
			path:      "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/images/download-url",
			status:    http.StatusBadRequest,
			errorCode: "invalid_request",
		},
		{
			name: "画像ダウンロードURL発行で他ページのkeyは404", method: http.MethodGet,
			path:   "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/images/download-url?key=kb/" + kbWorkspaceID + "/" + kbRootPageID + "/x.bin",
			status: http.StatusNotFound,
		},
		{
			name: "カバー設定でtypeが欠落していればinvalid_request", method: http.MethodPut,
			path:      "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/cover",
			body:      `{"key":"kb/` + kbWorkspaceID + `/` + kbChildPageID + `/x.bin"}`,
			status:    http.StatusBadRequest,
			errorCode: "invalid_request",
		},
		{
			name: "カバー設定でkeyが欠落していればinvalid_request", method: http.MethodPut,
			path:      "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/cover",
			body:      `{"type":"file"}`,
			status:    http.StatusBadRequest,
			errorCode: "invalid_request",
		},
		{
			name: "カバー設定でtypeがfile以外ならinvalid_request", method: http.MethodPut,
			path:      "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/cover",
			body:      `{"type":"url","key":"kb/` + kbWorkspaceID + `/` + kbChildPageID + `/x.bin"}`,
			status:    http.StatusBadRequest,
			errorCode: "invalid_request",
		},
		{
			name: "カバー設定で他ページのkeyはinvalid_cover_key", method: http.MethodPut,
			path:      "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/cover",
			body:      `{"type":"file","key":"kb/` + kbWorkspaceID + `/` + kbRootPageID + `/x.bin"}`,
			status:    http.StatusBadRequest,
			errorCode: "invalid_cover_key",
		},
		{
			name: "公開範囲設定でvisibilityが欠落していればinvalid_request", method: http.MethodPut,
			path:      "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/visibility",
			body:      `{}`,
			status:    http.StatusBadRequest,
			errorCode: "invalid_request",
		},
		{
			name: "公開範囲設定でvisibilityが未知の値ならinvalid_visibility", method: http.MethodPut,
			path:      "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/visibility",
			body:      `{"visibility":"secret"}`,
			status:    http.StatusBadRequest,
			errorCode: "invalid_visibility",
		},
		{
			name: "ラベル付けで別ワークスペースのラベルは404", method: http.MethodPut,
			path:   "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/labels/" + kbOtherWsLabelID,
			status: http.StatusNotFound,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newKbFixture(kbCanEdit, kbUserID)
			w := f.do(t, tc.method, tc.path, tc.body)
			assert.Equal(t, tc.status, w.Code, "body=%s", w.Body.String())
			if tc.errorCode != "" {
				assert.JSONEq(t, `{"error":"`+tc.errorCode+`"}`, w.Body.String())
			}
		})
	}
}

func Test_ナレッジAPI_取得は本文と作成したページを返す(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)

	created := f.do(t, http.MethodPost,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/spaces/"+kbSpaceID+"/pages",
		`{"parentId":"`+kbRootPageID+`","title":"新しいページ"}`)
	require.Equal(t, http.StatusCreated, created.Code)

	var page kbPageResponse
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &page))
	assert.Equal(t, "新しいページ", page.Title)
	require.NotNil(t, page.ParentID)
	assert.Equal(t, kbRootPageID, *page.ParentID)
	assert.NotContains(t, created.Body.String(), kbWorkspaceID, "workspaceId は返さない")

	saved := f.do(t, http.MethodPut,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+page.ID+"/content",
		`{"doc":`+kbValidDoc+`}`)
	require.Equal(t, http.StatusOK, saved.Code)

	got := f.do(t, http.MethodGet, "/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+page.ID, "")
	require.Equal(t, http.StatusOK, got.Code)

	var doc kbPageDocResponse
	require.NoError(t, json.Unmarshal(got.Body.Bytes(), &doc))
	assert.Equal(t, page.ID, doc.Page.ID)
	assert.Contains(t, string(doc.Doc), "本文")
}

// Test_ナレッジアイコン_設定と解除が取得に映る は PUT/DELETE icon の結果がその後の
// GET に反映されることを固定する（handler の応答と再取得の両方で見る）。
func Test_ナレッジアイコン_設定と解除が取得に映る(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	base := "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID

	set := f.do(t, http.MethodPut, base+"/icon", `{"type":"emoji","value":"📘"}`)
	require.Equal(t, http.StatusOK, set.Code)
	var setResp kbPageResponse
	require.NoError(t, json.Unmarshal(set.Body.Bytes(), &setResp))
	require.NotNil(t, setResp.Icon)
	assert.Equal(t, "📘", setResp.Icon.Value)

	got := f.do(t, http.MethodGet, base, "")
	require.Equal(t, http.StatusOK, got.Code)
	var doc kbPageDocResponse
	require.NoError(t, json.Unmarshal(got.Body.Bytes(), &doc))
	require.NotNil(t, doc.Page.Icon, "設定したアイコンが取得にも映る")
	assert.Equal(t, "📘", doc.Page.Icon.Value)

	cleared := f.do(t, http.MethodDelete, base+"/icon", "")
	require.Equal(t, http.StatusOK, cleared.Code, "204 ではなく 200 + ページ本体を返す")
	var clearedResp kbPageResponse
	require.NoError(t, json.Unmarshal(cleared.Body.Bytes(), &clearedResp))
	assert.Nil(t, clearedResp.Icon, "解除後は icon が省かれる")

	gotAfterClear := f.do(t, http.MethodGet, base, "")
	require.Equal(t, http.StatusOK, gotAfterClear.Code)
	var docAfterClear kbPageDocResponse
	require.NoError(t, json.Unmarshal(gotAfterClear.Body.Bytes(), &docAfterClear))
	assert.Nil(t, docAfterClear.Page.Icon, "解除が取得にも映る")
}

// Test_ナレッジ画像_アップロードURL発行からカバー設定解除までの一連の流れ は、
// ページに閉じた画像の読み取り経路（アップロード URL 発行 → そのキーでカバー設定 →
// ダウンロード URL 発行 → 解除）を端から端まで固定する。
func Test_ナレッジ画像_アップロードURL発行からカバー設定解除までの一連の流れ(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	base := "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID

	// 1. アップロード URL 発行。key はこのページに閉じた形（kb/<workspaceId>/<pageId>/...）。
	upload := f.do(t, http.MethodPost, base+"/images/upload-url", `{"contentType":"image/png","size":1024}`)
	require.Equal(t, http.StatusOK, upload.Code)
	var uploadResp kbImageUploadURLResponse
	require.NoError(t, json.Unmarshal(upload.Body.Bytes(), &uploadResp))
	assert.NotEmpty(t, uploadResp.URL)
	assert.True(t, strings.HasPrefix(uploadResp.Key, "kb/"+kbWorkspaceID+"/"+kbChildPageID+"/"), "key はこのページに閉じた形: %s", uploadResp.Key)
	assert.Greater(t, uploadResp.ExpiresIn, 0)

	// 2. そのキーでダウンロード URL も発行できる（自ページの key は無条件で許可）。
	download := f.do(t, http.MethodGet, base+"/images/download-url?key="+uploadResp.Key, "")
	require.Equal(t, http.StatusOK, download.Code)
	var downloadResp kbImageDownloadURLResponse
	require.NoError(t, json.Unmarshal(download.Body.Bytes(), &downloadResp))
	assert.NotEmpty(t, downloadResp.URL)

	// 3. そのキーをカバーに設定する。応答にページ本体と解決済みカバー URL の両方が載る。
	setCover := f.do(t, http.MethodPut, base+"/cover", `{"type":"file","key":"`+uploadResp.Key+`"}`)
	require.Equal(t, http.StatusOK, setCover.Code, "body=%s", setCover.Body.String())
	var setCoverResp kbPageWithCoverResponse
	require.NoError(t, json.Unmarshal(setCover.Body.Bytes(), &setCoverResp))
	assert.Equal(t, kbChildPageID, setCoverResp.Page.ID)
	require.NotNil(t, setCoverResp.Cover)
	assert.Equal(t, "file", setCoverResp.Cover.Type)
	assert.NotEmpty(t, setCoverResp.Cover.URL)

	// 4. GET / ResolveByID の両方にカバーが映る。
	got := f.do(t, http.MethodGet, base, "")
	require.Equal(t, http.StatusOK, got.Code)
	var doc kbPageDocResponse
	require.NoError(t, json.Unmarshal(got.Body.Bytes(), &doc))
	assert.NotContains(t, got.Body.String(), `"cover"`, "kbPageResponse（Get）にはカバーを含めない — N+1 回避のため")

	resolved := f.do(t, http.MethodGet, "/api/v2/kb/pages/"+kbChildPageID, "")
	require.Equal(t, http.StatusOK, resolved.Code)
	var resolvedResp kbResolvedPageResponse
	require.NoError(t, json.Unmarshal(resolved.Body.Bytes(), &resolvedResp))
	require.NotNil(t, resolvedResp.Cover, "ResolveByID にはカバーが解決済みで載る")
	assert.Equal(t, "file", resolvedResp.Cover.Type)
	assert.NotEmpty(t, resolvedResp.Cover.URL)

	// 5. 解除すると cover は null になる。
	cleared := f.do(t, http.MethodDelete, base+"/cover", "")
	require.Equal(t, http.StatusOK, cleared.Code)
	var clearedResp kbPageWithCoverResponse
	require.NoError(t, json.Unmarshal(cleared.Body.Bytes(), &clearedResp))
	assert.Nil(t, clearedResp.Cover)

	resolvedAfterClear := f.do(t, http.MethodGet, "/api/v2/kb/pages/"+kbChildPageID, "")
	require.Equal(t, http.StatusOK, resolvedAfterClear.Code)
	var resolvedAfterClearResp kbResolvedPageResponse
	require.NoError(t, json.Unmarshal(resolvedAfterClear.Body.Bytes(), &resolvedAfterClearResp))
	assert.Nil(t, resolvedAfterClearResp.Cover, "解除が ResolveByID にも映る")
}

// Test_ナレッジ画像ダウンロード_他ページ由来のキーは同一ワークスペースでも404 は、
// 別ページ由来の key は、開いているページの本文に貼られていても許可しないことを
// HTTP 経路の端から端まで固定する。画像はページに閉じた持ち物で、他ページの key を
// 自分の本文に書き込むだけで読めてしまう自作自演の穴を塞いだ側を確かめる。
func Test_ナレッジ画像ダウンロード_他ページ由来のキーは同一ワークスペースでも404(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	// kbRootPageID がアップロードした体の key を、権限は持っている kbChildPageID から
	// 読もうとする。
	key := "kb/" + kbWorkspaceID + "/" + kbRootPageID + "/1.bin"

	w := f.do(t, http.MethodGet,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID+"/images/download-url?key="+key, "")
	assert.Equal(t, http.StatusNotFound, w.Code, "body=%s", w.Body.String())
}

// Test_ナレッジAPI_本文保存でブロックID衝突は409 は、repository.ErrBlockIDConflict
// （他ページ・他ワークスペースの block id を新規ブロックとして乗っ取ろうとする保存の拒否）を
// handler が 409 block_id_conflict へ翻訳することを固定する。差分 UPSERT（ReplacePageBlocks）
// が実 DB で検出するこのセンチネルの handler 側の写像はここでしか検証していない。
func Test_ナレッジAPI_本文保存でブロックID衝突は409(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.pages.replaceBlocksErr = repository.ErrBlockIDConflict
	base := "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID

	w := f.do(t, http.MethodPut, base+"/content", `{"doc":`+kbValidDoc+`}`)

	assert.Equal(t, http.StatusConflict, w.Code,
		"他人の行を乗っ取ろうとする保存はDB障害(500)ではなく業務上の衝突(409)")
	assert.JSONEq(t, `{"error":"block_id_conflict"}`, w.Body.String())
}

// Test_ナレッジAPI_本文を保存した人が最終編集者になる は、本文を保存した人が
// pages.last_edited_by_user_id として記録され、改名では変わらないことを固定する
// （TouchPageLastEditedBy は ReplacePageBlocksUseCase だけが呼ぶ — 既知のリスク参照）。
func Test_ナレッジAPI_本文を保存した人が最終編集者になる(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	base := "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID

	saved := f.do(t, http.MethodPut, base+"/content", `{"doc":`+kbValidDoc+`}`)
	require.Equal(t, http.StatusOK, saved.Code)
	var content kbPageContentResponse
	require.NoError(t, json.Unmarshal(saved.Body.Bytes(), &content))
	require.NotNil(t, content.LastEditedBy, "保存の応答に最終編集者が載る")
	assert.Equal(t, kbUserID, content.LastEditedBy.UserID)
	require.NotNil(t, content.LastEditedAt)

	got := f.do(t, http.MethodGet, base, "")
	require.Equal(t, http.StatusOK, got.Code)
	var doc kbPageDocResponse
	require.NoError(t, json.Unmarshal(got.Body.Bytes(), &doc))
	require.NotNil(t, doc.Page.LastEditedByUserID)
	assert.Equal(t, kbUserID, *doc.Page.LastEditedByUserID)

	renamed := f.do(t, http.MethodPatch, base, `{"title":"改訂"}`)
	require.Equal(t, http.StatusOK, renamed.Code)
	var renamedPage kbPageResponse
	require.NoError(t, json.Unmarshal(renamed.Body.Bytes(), &renamedPage))
	require.NotNil(t, renamedPage.LastEditedByUserID, "改名では最終編集者は変わらない（消えない）")
	assert.Equal(t, kbUserID, *renamedPage.LastEditedByUserID)
}

// ページ参照（pageRef）は本文のインライン内容として往復し、読み出し時に
// 読み手が閲覧できる参照だけ現在の題名へ差し替わる（正本は pages.title）。
func Test_ナレッジAPI_本文のページ参照は読み出し時に現在の題名になる(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)

	refDoc := `{"type":"doc","content":[{"type":"paragraph","content":[` +
		`{"type":"pageRef","attrs":{"pageId":"` + kbChildPageID + `","title":"無題"}}]}]}`
	saved := f.do(t, http.MethodPut,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbRootPageID+"/content",
		`{"doc":`+refDoc+`}`)
	require.Equal(t, http.StatusOK, saved.Code)

	got := f.do(t, http.MethodGet, "/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbRootPageID, "")
	require.Equal(t, http.StatusOK, got.Code)
	var doc kbPageDocResponse
	require.NoError(t, json.Unmarshal(got.Body.Bytes(), &doc))
	child := f.pages.pages[kbChildPageID]
	assert.Contains(t, string(doc.Doc), `"title":"`+child.Title+`"`,
		"参照の題名が保存時の「無題」ではなく現在の題名になっている")
	assert.NotContains(t, string(doc.Doc), `"title":"無題"`)
}

func Test_ナレッジAPI_閲覧できない参照の題名は差し替えない(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	// 参照先を、自分の役割が届かない private スペースへ移して見えなくする
	// （本文を読む側のページは見えたまま）。同じスペースの中で 1 枚だけ隠すことはできないので、
	// 見せたくないものは別のスペースへ置く、という本番の運用をそのまま写す。
	// fixture の既定はどのページにも届く役割なので、移した先には届かないことも併せて指定する。
	f.perms.hideInOwnPrivateSpace(kbWorkspaceID, kbChildPageID)
	f.perms.setPagePermission(kbChildPageID, kbUserID, kbNoPerm)

	refDoc := `{"type":"doc","content":[{"type":"paragraph","content":[` +
		`{"type":"pageRef","attrs":{"pageId":"` + kbChildPageID + `","title":"無題"}}]}]}`
	saved := f.do(t, http.MethodPut,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbRootPageID+"/content",
		`{"doc":`+refDoc+`}`)
	require.Equal(t, http.StatusOK, saved.Code)

	got := f.do(t, http.MethodGet, "/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbRootPageID, "")
	require.Equal(t, http.StatusOK, got.Code)
	// 題名は出ない。保存時に title は剥がされており（読み手ごとの派生値なので保存しない）、
	// 読み出しの解決も閲覧できない参照には題名を入れない。現在の題名は漏れない。
	child := f.pages.pages[kbChildPageID]
	assert.NotContains(t, got.Body.String(), `"title":"`+child.Title+`"`)
	assert.NotContains(t, got.Body.String(), `"title":"無題"`)
}

// 題名の焼き込み（解決済みの題名が編集者の保存で本文に残り、閲覧できない読み手へ
// 漏れる）を塞ぐ回帰: 解決済み title 入りの doc を保存しても、保存側には残らない。
func Test_ナレッジAPI_解決済みの題名を保存しても本文に焼き込まれない(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	child := f.pages.pages[kbChildPageID]

	// 編集者の画面から返ってくる形（サーバーが解決した現在の題名が title に入っている）。
	enriched := `{"type":"doc","content":[{"type":"paragraph","content":[` +
		`{"type":"pageRef","attrs":{"pageId":"` + kbChildPageID + `","title":"` + child.Title + `"}}]}]}`
	saved := f.do(t, http.MethodPut,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbRootPageID+"/content",
		`{"doc":`+enriched+`}`)
	require.Equal(t, http.StatusOK, saved.Code)

	// 以後この読み手から参照先が見えなくなっても、保存された文字としての題名は残っていない。
	// 参照先を自分の役割が届かない private スペースへ移し、既定も届かない状態にする。
	f.perms.hideInOwnPrivateSpace(kbWorkspaceID, kbChildPageID)
	f.perms.setPagePermission(kbChildPageID, kbUserID, kbNoPerm)

	got := f.do(t, http.MethodGet, "/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbRootPageID, "")
	require.Equal(t, http.StatusOK, got.Code)
	assert.NotContains(t, got.Body.String(), `"title":"`+child.Title+`"`)
}

// 削除は子孫ごと消え、木にも残らない（アーカイブと違い戻す口も無い）。
func Test_ナレッジAPI_削除は子孫ごと消える(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	created := f.do(t, http.MethodPost,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/spaces/"+kbSpaceID+"/pages",
		`{"parentId":"`+kbChildPageID+`","title":"孫ページ"}`)
	require.Equal(t, http.StatusCreated, created.Code)
	var grandchild kbPageResponse
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &grandchild))

	deleted := f.do(t, http.MethodDelete,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID, "")
	require.Equal(t, http.StatusNoContent, deleted.Code)

	// 根も孫も消えている（開けない・木にも出ない）。
	assert.Equal(t, http.StatusNotFound,
		f.do(t, http.MethodGet, "/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID, "").Code)
	assert.Equal(t, http.StatusNotFound,
		f.do(t, http.MethodGet, "/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+grandchild.ID, "").Code)
	tree := f.do(t, http.MethodGet,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/spaces/"+kbSpaceID+"/pages", "")
	require.Equal(t, http.StatusOK, tree.Code)
	assert.NotContains(t, tree.Body.String(), kbChildPageID)
	assert.NotContains(t, tree.Body.String(), grandchild.ID)
}

// 削除は戻せないので、配下に 1 枚でも編集できないページがあれば何もしない
// （アーカイブと同じ二択: 全部できるか、何もしないか）。
//
// 役割は木を下るほど弱くならないので、この状態は本番では起こらない。
// fake でだけ作れる形をわざと作って、サブツリー検査がまだ働くことを確かめる
// （事実を集めるクエリが経路を取り違えたときに気づける最後の網）。
func Test_ナレッジAPI_配下に編集できないページがあれば削除しない(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	created := f.do(t, http.MethodPost,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/spaces/"+kbSpaceID+"/pages",
		`{"parentId":"`+kbChildPageID+`","title":"守られる孫"}`)
	require.Equal(t, http.StatusCreated, created.Code)
	var grandchild kbPageResponse
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &grandchild))
	f.perms.setPagePermission(grandchild.ID, kbUserID, kbCanView)

	w := f.do(t, http.MethodDelete,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID, "")

	assert.Equal(t, http.StatusForbidden, w.Code)
	assert.JSONEq(t, `{"error":"subtree_forbidden"}`, w.Body.String())
	// 何も消えていない（部分的な削除をしない）。
	assert.NotNil(t, f.pages.pages[kbChildPageID])
	assert.NotNil(t, f.pages.pages[grandchild.ID])
}

// アーカイブ済みのページも（権限があれば）直接削除できる。「隠してから完全に消す」
// という自然な片付けの経路を API の水準で保つ（UI の入口は現役の行のみ）。
func Test_ナレッジAPI_アーカイブ済みのページも削除できる(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	archived := f.do(t, http.MethodPost,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID+"/archive", "")
	require.Equal(t, http.StatusNoContent, archived.Code)

	w := f.do(t, http.MethodDelete,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID, "")

	assert.Equal(t, http.StatusNoContent, w.Code)
	assert.Nil(t, f.pages.pages[kbChildPageID])
}

func Test_ナレッジAPI_削除のrepository失敗は500(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.pages.failWith = errors.New("db down")

	w := f.do(t, http.MethodDelete,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID, "")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	assert.JSONEq(t, `{"error":"internal_error"}`, w.Body.String())
}

// パンくず: 解決応答に閲覧できる祖先が根から順に載り、閲覧できない祖先は行ごと消える
// （題名どころか実在も知らせない — 木と同じ規則）。
func Test_ナレッジAPI_IDだけの解決にパンくずが載る(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	// 3 段の木: root → child → grandchild。
	created := f.do(t, http.MethodPost,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/spaces/"+kbSpaceID+"/pages",
		`{"parentId":"`+kbChildPageID+`","title":"孫ページ"}`)
	require.Equal(t, http.StatusCreated, created.Code)
	var grandchild kbPageResponse
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &grandchild))

	got := f.do(t, http.MethodGet, "/api/v2/kb/pages/"+grandchild.ID, "")
	require.Equal(t, http.StatusOK, got.Code)
	var res struct {
		WorkspaceName string `json:"workspaceName"`
		Ancestors     []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"ancestors"`
	}
	require.NoError(t, json.Unmarshal(got.Body.Bytes(), &res))
	assert.NotEmpty(t, res.WorkspaceName)
	require.Len(t, res.Ancestors, 2, "祖先が根から順に載る")
	assert.Equal(t, kbRootPageID, res.Ancestors[0].ID)
	assert.Equal(t, kbChildPageID, res.Ancestors[1].ID)

	// 祖先が見えないなら、その配下の孫も見えない（役割は木を下るほど弱くならない）ので、
	// この経路で「祖先だけ消える」形は作れない。見えない祖先が行ごと落ちること・
	// 並びが closure の順であることは usecase の単体テストが固定する。
}

// Test_ナレッジAPI_IDだけの解決に最終編集者の名前が載る は ResolveByID の応答に
// lastEditedBy.name が載ることを固定する（LookupUserNameUseCase 経由）。
func Test_ナレッジAPI_IDだけの解決に最終編集者の名前が載る(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.users.setUserName(kbUserID, "山田太郎")

	saved := f.do(t, http.MethodPut,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID+"/content",
		`{"doc":`+kbValidDoc+`}`)
	require.Equal(t, http.StatusOK, saved.Code)

	got := f.do(t, http.MethodGet, "/api/v2/kb/pages/"+kbChildPageID, "")
	require.Equal(t, http.StatusOK, got.Code)
	var res kbResolvedPageResponse
	require.NoError(t, json.Unmarshal(got.Body.Bytes(), &res))
	require.NotNil(t, res.LastEditedBy)
	assert.Equal(t, kbUserID, res.LastEditedBy.UserID)
	assert.Equal(t, "山田太郎", res.LastEditedBy.Name)
	require.NotNil(t, res.LastEditedAt)
}

// Test_ナレッジAPI_IDだけの解決にcanCommentが載る は ResolveByID の応答の canComment が
// domain.PagePermission.CanComment をそのまま映すことを固定する（フロントの書き込み系 UI
// の出し分けが依存するフィールド。CheckPagePermissionUseCase が計算する値と handler が
// JSON へ出す値がずれていないかをここで確かめる）。
func Test_ナレッジAPI_IDだけの解決にcanCommentが載る(t *testing.T) {
	t.Run("editor(CanEdit) は commenter 以上なので true で出る", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)

		got := f.do(t, http.MethodGet, "/api/v2/kb/pages/"+kbChildPageID, "")
		require.Equal(t, http.StatusOK, got.Code)
		var res kbResolvedPageResponse
		require.NoError(t, json.Unmarshal(got.Body.Bytes(), &res))
		assert.True(t, res.CanComment)
	})

	t.Run("viewer(CanView だけ) は commenter 未満なので false で出る", func(t *testing.T) {
		f := newKbFixture(kbCanView, kbUserID)

		got := f.do(t, http.MethodGet, "/api/v2/kb/pages/"+kbChildPageID, "")
		require.Equal(t, http.StatusOK, got.Code)
		var res kbResolvedPageResponse
		require.NoError(t, json.Unmarshal(got.Body.Bytes(), &res))
		assert.False(t, res.CanComment)
	})
}

// Test_ナレッジAPI_IDだけの解決にworkspaceCanEditが載る は、ページ単位の canEdit
// （付与の合成）とワークスペース全体への CanEdit（CheckWorkspacePermissionUseCase）が
// 別軸であることを固定する。ページ/スペース限定の編集権限しか持たない人は canEdit=true でも
// workspaceCanEdit=false になり得る（雛形の作成・削除はワークスペース全体の CanEdit で
// 判定するため、フロントはこちらを見て「押せるが403になる」ボタンを出さないようにする）。
func Test_ナレッジAPI_IDだけの解決にworkspaceCanEditが載る(t *testing.T) {
	t.Run("ワークスペース全体の役割が無ければfalse（ページ単位のcanEditがtrueでも）", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)

		got := f.do(t, http.MethodGet, "/api/v2/kb/pages/"+kbChildPageID, "")
		require.Equal(t, http.StatusOK, got.Code)
		var res kbResolvedPageResponse
		require.NoError(t, json.Unmarshal(got.Body.Bytes(), &res))
		assert.True(t, res.CanEdit, "ページ単位はfallbackのkbCanEditでtrue")
		assert.False(t, res.WorkspaceCanEdit, "ワークスペース全体の役割は別途設定していないのでfalse")
	})

	t.Run("ワークスペース全体でeditor以上ならtrue", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleEditor)

		got := f.do(t, http.MethodGet, "/api/v2/kb/pages/"+kbChildPageID, "")
		require.Equal(t, http.StatusOK, got.Code)
		var res kbResolvedPageResponse
		require.NoError(t, json.Unmarshal(got.Body.Bytes(), &res))
		assert.True(t, res.WorkspaceCanEdit)
	})
}

// Test_ナレッジAPI_IDだけの解決で不明なユーザーは名前が空文字 は、名前が引けなくても
// 200 のまま返し、name だけが空文字に落ちることを固定する（LookupUserNameUseCase の doc）。
func Test_ナレッジAPI_IDだけの解決で不明なユーザーは名前が空文字(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	// 名前を設定しない（kbFakeUsers に登録が無い = 引けないユーザー）。

	saved := f.do(t, http.MethodPut,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID+"/content",
		`{"doc":`+kbValidDoc+`}`)
	require.Equal(t, http.StatusOK, saved.Code)

	got := f.do(t, http.MethodGet, "/api/v2/kb/pages/"+kbChildPageID, "")
	require.Equal(t, http.StatusOK, got.Code, "名前が引けなくても 200 のまま")
	var res kbResolvedPageResponse
	require.NoError(t, json.Unmarshal(got.Body.Bytes(), &res))
	require.NotNil(t, res.LastEditedBy)
	assert.Empty(t, res.LastEditedBy.Name)
}

// ResolveByID（/p の入口）は Get と別経路で WorkspaceID / UserID を組み立てるため、
// 題名解決が挟まっていることをこちらでも独立に固定する。
func Test_ナレッジAPI_IDだけの解決でも参照の題名が現在の値になる(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)

	refDoc := `{"type":"doc","content":[{"type":"paragraph","content":[` +
		`{"type":"pageRef","attrs":{"pageId":"` + kbChildPageID + `","title":"無題"}}]}]}`
	saved := f.do(t, http.MethodPut,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbRootPageID+"/content",
		`{"doc":`+refDoc+`}`)
	require.Equal(t, http.StatusOK, saved.Code)

	got := f.do(t, http.MethodGet, "/api/v2/kb/pages/"+kbRootPageID, "")
	require.Equal(t, http.StatusOK, got.Code)
	child := f.pages.pages[kbChildPageID]
	assert.Contains(t, got.Body.String(), `"title":"`+child.Title+`"`)
}

func Test_ナレッジAPI_所属判定が失敗したら500(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.perms.membersErr = errors.New("db down")

	w := f.do(t, http.MethodGet, "/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID, "")

	assert.Equal(t, http.StatusInternalServerError, w.Code,
		"DB 障害を 404 に潰すと、落ちていることに気づけない")
}

func Test_ナレッジAPI_repositoryの失敗は500(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.pages.failWith = errors.New("db down")

	w := f.do(t, http.MethodPatch,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID, `{"title":"改訂"}`)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	assert.JSONEq(t, `{"error":"internal_error"}`, w.Body.String())
}

// ワークスペース解決 middleware を通さずにルートを生やす配線ミスを想定した安全網。
// テナント未確定のまま handler が動くと全テナントに触れてしまうので、必ず落ちること。
// kbScope のワークスペース未確定ガードそのものを見る。
//
// handler 越しに「middleware を通らないルート」を叩く形だと、ガードを消しても
// usecase 側の必須チェック（workspaceID is required）で同じ 500 になり、
// ガードが在るか無いかを区別できない。ここでは kbScope を直接呼び、
// ガードを外したときに後続へ進んでしまうことまで見る。
func Test_ナレッジAPI_ワークスペース未確定ならkbScopeが止める(t *testing.T) {
	gin.SetMode(gin.TestMode)

	run := func(t *testing.T, withWorkspace bool) (*httptest.ResponseRecorder, bool) {
		t.Helper()
		reached := false
		r := gin.New()
		r.GET("/scope", func(c *gin.Context) {
			c.Set(middleware.ContextKeyCurrentUserID, kbUserID)
			if withWorkspace {
				c.Set(middleware.ContextKeyKnowledgeBaseWorkspace, &domain.Workspace{ID: kbWorkspaceID})
			}
			if _, ok := kbScope(c); !ok {
				return
			}
			reached = true
			c.Status(http.StatusOK)
		})
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/scope", nil))
		return w, reached
	}

	t.Run("未確定なら止まる", func(t *testing.T) {
		w, reached := run(t, false)
		assert.False(t, reached, "テナント未確定のまま後続へ進んではいけない")
		assert.Equal(t, http.StatusInternalServerError, w.Code)
		assert.JSONEq(t, `{"error":"internal_error"}`, w.Body.String())
	})

	t.Run("確定していれば通る", func(t *testing.T) {
		w, reached := run(t, true)
		assert.True(t, reached, "middleware を通っていれば素通しする（常に止めるガードではない）")
		assert.Equal(t, http.StatusOK, w.Code)
	})
}

// 配線のミス（middleware を通さない group への登録）が「成功する経路」にならないことを
// 端から端まで見る。どの層で止まるかまでは固定しない（kbScope のガード自体は上のテスト）。
func Test_ナレッジAPI_middlewareを通らないルートは成功しない(t *testing.T) {
	gin.SetMode(gin.TestMode)
	pages := newKbFakePages()
	perms := newKbFakePerms(pages, kbCanEdit)
	users := newKbFakeUsers()
	h := NewKnowledgeBasePageHandler(
		kb.NewCheckPagePermissionUseCase(perms),
		kb.NewCheckWorkspacePermissionUseCase(perms),
		kb.NewResolvePageLocationUseCase(pages),
		kb.NewCheckSpacePermissionUseCase(perms),
		kb.NewCanEditPageSubtreeUseCase(perms),
		kb.NewListViewablePagesUseCase(perms),
		kb.NewGetPageUseCase(pages),
		kb.NewFindPageUseCase(pages),
		kb.NewCreatePageUseCase(pages),
		kb.NewRenamePageUseCase(pages),
		kb.NewMovePageUseCase(pages),
		kb.NewArchivePageUseCase(pages),
		kb.NewUnarchivePageUseCase(pages),
		kb.NewReplacePageBlocksUseCase(pages, fakeTxManager{}, newKbFakePageVersions(pages)),
		kb.NewResolvePageRefTitlesUseCase(perms),
		kb.NewListViewableAncestorsUseCase(pages, perms),
		kb.NewDeletePageUseCase(pages),
		kb.NewSetPageIconUseCase(pages),
		user.NewLookupUserDisplayUseCase(users),
		kb.NewIssuePageImageUploadURLUseCase(pages, &kbFakeImagePresigner{}),
		kb.NewIssuePageImageDownloadURLUseCase(pages, &kbFakeImagePresigner{}),
		kb.NewSetPageCoverUseCase(pages),
		kb.NewResolveCoverURLUseCase(&kbFakeImagePresigner{}),
		kb.NewListPageBacklinksUseCase(perms),
		ticket.NewListTicketsReferencingPageUseCase(newTicketFakeRepo()),
		kb.NewRecordPageViewUseCase(newKbFakePageViews()),
		kb.NewAddPageFavoriteUseCase(newKbFakePageFavorites()),
		kb.NewRemovePageFavoriteUseCase(newKbFakePageFavorites()),
		kb.NewIsPageFavoriteUseCase(newKbFakePageFavorites()),
		kb.NewSetPageVisibilityUseCase(pages),
		kb.NewAddPageLabelUseCase(newTicketFakeRepo(), pages),
		kb.NewRemovePageLabelUseCase(newTicketFakeRepo()),
		kb.NewListLabelsForPageUseCase(newTicketFakeRepo()),
	)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(middleware.ContextKeyCurrentUserID, kbUserID)
		c.Next()
	})
	r.GET("/unwired/:pageId", h.Get)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/unwired/"+kbChildPageID, nil))

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func Test_ナレッジツリー_事実の収集が失敗したら500(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.perms.listFactsErr = errors.New("db down")

	w := f.do(t, http.MethodGet, kbFill(kbTreePath, kbWorkspaceSlug, ""), "")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func Test_ナレッジアーカイブ_repositoryの失敗は500(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.pages.failWith = errors.New("db down")

	w := f.do(t, http.MethodPost,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID+"/archive", "")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func Test_ナレッジ移動_スペース全員宛ての付与が失効する移動は409(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	// 移動先スペース以外の「そのスペースの全員」宛てページ付与がサブツリーに残っている状態を
	// repository が同一トランザクションで検出して中止する経路。move handler は NewSpaceID を
	// 渡さないので、別スペースのページを親に指定するだけでここへ来る。
	f.pages.moveErr = repository.ErrPageMoveVoidsSpaceGrant

	w := f.do(t, http.MethodPost,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID+"/move",
		`{"parentId":"`+kbDestPageID+`"}`)

	assert.Equal(t, http.StatusConflict, w.Code,
		"権限設定と両立しないという業務上の衝突であって、DB 障害ではない")
	assert.JSONEq(t, `{"error":"space_grant_voided"}`, w.Body.String())
}

func Test_ナレッジアーカイブ_配下に編集できないページがあれば何もせず403(t *testing.T) {
	// 子を直接 rename すれば 403 になる相手が、親のアーカイブ経由なら書き換えられる
	// （見えない子まで巻き込む）状態を塞ぐ。
	//
	// 役割は木を下るほど弱くならないので、親より弱い子は本番では起こらない。
	// fake でだけ作れる形をわざと作って、サブツリー検査がまだ働くことを確かめる。
	cases := map[string]domain.PagePermission{
		"閲覧しか届かない子": kbCanView,
		"何も届かない子":   kbNoPerm,
	}
	for name, perm := range cases {
		t.Run(name, func(t *testing.T) {
			f := newKbFixture(kbCanEdit, kbUserID)
			f.perms.setPagePermission(kbChildPageID, kbUserID, perm)

			w := f.do(t, http.MethodPost,
				"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbRootPageID+"/archive", "")

			assert.Equal(t, http.StatusForbidden, w.Code)
			assert.JSONEq(t, `{"error":"subtree_forbidden"}`, w.Body.String())
			assert.Nil(t, f.pages.pages[kbRootPageID].ArchivedAt, "根は書き換わらない")
			assert.Nil(t, f.pages.pages[kbChildPageID].ArchivedAt, "触れない子も書き換わらない")
		})
	}
}

func Test_ナレッジアーカイブ_子孫まで編集できるなら通る(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)

	w := f.do(t, http.MethodPost,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbRootPageID+"/archive", "")

	require.Equal(t, http.StatusNoContent, w.Code, "根を編集できれば子孫も編集できるので、通常の運用は止めない")
	assert.NotNil(t, f.pages.pages[kbRootPageID].ArchivedAt)
	assert.NotNil(t, f.pages.pages[kbChildPageID].ArchivedAt)
}

// アーカイブと同じく、本番では起こらない「親より弱い子」を fake で作って、
// 戻す側でもサブツリー検査が働くことを確かめる。
func Test_ナレッジ復帰_配下に編集できないページがあれば何もせず403(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	at := time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC)
	f.pages.pages[kbRootPageID].ArchivedAt = &at
	f.pages.pages[kbChildPageID].ArchivedAt = &at
	f.perms.setPagePermission(kbChildPageID, kbUserID, kbCanView)

	w := f.do(t, http.MethodPost,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbRootPageID+"/unarchive", "")

	assert.Equal(t, http.StatusForbidden, w.Code, "戻す側も同じ判定にする（片側だけ緩いと結局動かせる）")
	assert.JSONEq(t, `{"error":"subtree_forbidden"}`, w.Body.String())
	assert.NotNil(t, f.pages.pages[kbRootPageID].ArchivedAt, "アーカイブ済みのまま")
}

func Test_ナレッジアーカイブ_サブツリーの権限確認が失敗したら500(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.perms.subtreeFactsErr = errors.New("db down")

	w := f.do(t, http.MethodPost,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbRootPageID+"/archive", "")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	assert.Nil(t, f.pages.pages[kbRootPageID].ArchivedAt, "確認できないなら書き換えない")
}

func Test_ナレッジ作成_アーカイブ済みの親の下には作れない(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	at := time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC)
	f.pages.pages[kbRootPageID].ArchivedAt = &at

	w := f.do(t, http.MethodPost,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/spaces/"+kbSpaceID+"/pages",
		`{"parentId":"`+kbRootPageID+`","title":"迷子"}`)

	assert.Equal(t, http.StatusConflict, w.Code)
	assert.JSONEq(t, `{"error":"parent_archived"}`, w.Body.String())
}

func Test_ナレッジ作成_親が別スペースなら400(t *testing.T) {
	const otherSpaceID = "0198a000-0000-7000-8000-0000000000c1"
	f := newKbFixture(kbCanEdit, kbUserID)
	f.pages.addSpace(kbWorkspaceID, otherSpaceID)

	w := f.do(t, http.MethodPost,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/spaces/"+otherSpaceID+"/pages",
		`{"parentId":"`+kbRootPageID+`","title":"別スペースの親"}`)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.JSONEq(t, `{"error":"parent_space_mismatch"}`, w.Body.String())
}

func Test_ナレッジ復帰_親がアーカイブ中なら409(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	at := time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC)
	f.pages.pages[kbRootPageID].ArchivedAt = &at
	childArchivedAt := at.Add(time.Hour)
	f.pages.pages[kbChildPageID].ArchivedAt = &childArchivedAt

	w := f.do(t, http.MethodPost,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID+"/unarchive", "")

	assert.Equal(t, http.StatusConflict, w.Code)
	assert.JSONEq(t, `{"error":"parent_archived"}`, w.Body.String())
}

func Test_ナレッジ取得_本文が未保存でも空のdocを返す(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)

	w := f.do(t, http.MethodGet, "/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID, "")

	require.Equal(t, http.StatusOK, w.Code)
	var doc kbPageDocResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &doc))
	assert.JSONEq(t, `{"type":"doc","content":[]}`, string(doc.Doc))
}

// --- 付与の届き方（workspace / space / page の 3 段）---
//
// ここから下は「どの段に張った付与が、どこまで届くか」を API 越しに見る。
// 打ち消す層は無く、届いた中で最も強い役割がそのページの実効になる。

// kbGetStatus はページ取得の HTTP ステータス（見えれば 200、見えなければ 404）。
func kbGetStatus(t *testing.T, f kbFixture, pageID string) int {
	t.Helper()
	return f.do(t, http.MethodGet, "/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+pageID, "").Code
}

// kbTreeIDs はツリー取得に現れるページ ID を親子まとめて返す。
func kbTreeIDs(t *testing.T, f kbFixture) []string {
	t.Helper()
	w := f.do(t, http.MethodGet, kbFill(kbTreePath, kbWorkspaceSlug, ""), "")
	require.Equal(t, http.StatusOK, w.Code)
	var body kbPageTreeRootResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	tree := body.Pages
	ids := make([]string, 0, 4)
	var walk func(nodes []kbPageTreeResponse)
	walk = func(nodes []kbPageTreeResponse) {
		for _, n := range nodes {
			ids = append(ids, n.Page.ID)
			walk(n.Children)
		}
	}
	walk(tree)
	return ids
}

// ページ付与は張った段から子孫へ降りる。スペースの役割が 1 つも届いていない相手でも、
// 子に付与を張ればその子と子孫だけが開く。1 ページの解決と一覧が同じ事実を通ることも
// ここで見る（片方だけ別の畳み方をすると「開けるのに一覧に出ない」ずれが生まれる）。
func Test_ナレッジ権限_ページ付与は張った段から子孫へ届く(t *testing.T) {
	f := newKbFixture(kbNoPerm, kbUserID)
	const grandchildID = "0198a000-0000-7000-8000-000000000007"
	childID := kbChildPageID
	f.pages.addPage(domain.Page{
		ID: grandchildID, WorkspaceID: kbWorkspaceID, SpaceID: kbSpaceID, ParentID: &childID,
		Position: "a1a", Title: "grandchild", CreatedByUserID: kbUserID,
	})
	me := f.perms.userPrincipal(kbWorkspaceID, kbUserID)
	require.NotNil(t, me)
	_, err := f.perms.UpsertPageGrant(
		context.Background(), kbWorkspaceID, kbChildPageID, me.ID, domain.GrantRoleEditor,
	)
	require.NoError(t, err)

	assert.Equal(t, http.StatusNotFound, kbGetStatus(t, f, kbRootPageID),
		"付与を張った段より上には届かない")
	assert.Equal(t, http.StatusOK, kbGetStatus(t, f, kbChildPageID))
	assert.Equal(t, http.StatusOK, kbGetStatus(t, f, grandchildID), "子孫にも降りる")
	assert.Empty(t, kbTreeIDs(t, f),
		"開ける child も、届いていない root の配下なのでツリーには出ない（解決と一覧で畳み方が食い違わない）")
}

// 付与は足し合わせて最も強い役割になるだけで、下るほど強くはならない。
// 根に viewer を張っても、その配下で書けるようにはならない。
func Test_ナレッジ権限_祖先へのviewer付与は子孫でも閲覧どまり(t *testing.T) {
	f := newKbFixture(kbNoPerm, kbUserID)
	me := f.perms.userPrincipal(kbWorkspaceID, kbUserID)
	require.NotNil(t, me)
	_, err := f.perms.UpsertPageGrant(
		context.Background(), kbWorkspaceID, kbRootPageID, me.ID, domain.GrantRoleViewer,
	)
	require.NoError(t, err)

	assert.Equal(t, http.StatusOK, kbGetStatus(t, f, kbChildPageID), "根に張った viewer は子にも届く")
	w := f.do(t, http.MethodPatch,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID, `{"title":"改訂"}`)
	assert.Equal(t, http.StatusForbidden, w.Code, "viewer のままなので子でも書き込めない")
}

func Test_ナレッジ移動_配下に編集できないページがあれば何も書き換えず403(t *testing.T) {
	// 移動はサブツリーごと動くので、子孫の祖先の並びが変わる ＝ そこから継承される
	// 権限が変わる。操作者から見えない子孫の権限が、本人の知らないうちに書き換わる状態を塞ぐ。
	// アーカイブと同じ判定に揃えてある（片方だけ緩いと、結局そちらから同じ結果を作れる）。
	//
	// 親より弱い子は本番では起こらない。fake でだけ作れる形をわざと作って、
	// サブツリー検査がまだ働くことを確かめる。
	cases := map[string]domain.PagePermission{
		"閲覧しか届かない子": kbCanView,
		"何も届かない子":   kbNoPerm,
	}
	for name, perm := range cases {
		t.Run(name, func(t *testing.T) {
			f := newKbFixture(kbCanEdit, kbUserID)
			f.perms.setPagePermission(kbChildPageID, kbUserID, perm)

			w := f.do(t, http.MethodPost,
				"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbRootPageID+"/move",
				`{"parentId":"`+kbDestPageID+`"}`)

			assert.Equal(t, http.StatusForbidden, w.Code)
			assert.JSONEq(t, `{"error":"subtree_forbidden"}`, w.Body.String())
			// 断ったなら何も書き換わっていないこと。移動が触るのは parent_id / position
			// （と closure）だけなので、その 2 つが元のままであることを見る。
			assert.Nil(t, f.pages.pages[kbRootPageID].ParentID, "根はスペース直下のまま")
			assert.Equal(t, "a0", f.pages.pages[kbRootPageID].Position, "並び順も動かない")
			assert.Equal(t, kbRootPageID, *f.pages.pages[kbChildPageID].ParentID,
				"触れない子の親も動かない")
		})
	}
}

func Test_ナレッジ移動_子孫まで編集できるなら通る(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)

	w := f.do(t, http.MethodPost,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbRootPageID+"/move",
		`{"parentId":"`+kbDestPageID+`"}`)

	require.Equal(t, http.StatusOK, w.Code, "根を編集できれば子孫も編集できるので、通常の運用は止めない")
	require.NotNil(t, f.pages.pages[kbRootPageID].ParentID)
	assert.Equal(t, kbDestPageID, *f.pages.pages[kbRootPageID].ParentID)
}

func Test_ナレッジ移動_サブツリーの権限確認が失敗したら500で何も書き換えない(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	f.perms.subtreeFactsErr = errors.New("db down")

	w := f.do(t, http.MethodPost,
		"/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbRootPageID+"/move",
		`{"parentId":"`+kbDestPageID+`"}`)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	assert.Nil(t, f.pages.pages[kbRootPageID].ParentID, "確認できないなら動かさない")
}

// スペース改名は「入れ物そのもの」の変更なので、ページのケイパビリティではなく
// スペースの管理権限で判定する。拒否の畳み方は他の口と同じ:
// 見えない相手には 404（実在を教えない）、見えるが管理できない相手には 403。
func Test_ナレッジAPI_スペース改名の認可(t *testing.T) {
	patch := func(f kbFixture, t *testing.T, spaceID string) *httptest.ResponseRecorder {
		t.Helper()
		path := "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/spaces/" + spaceID
		return f.do(t, http.MethodPatch, path, `{"name":"技術部"}`)
	}

	t.Run("スペースの admin は変えられる", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbSpaceID, kbUserID, domain.GrantRoleAdmin)
		w := patch(f, t, kbSpaceID)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Contains(t, w.Body.String(), "技術部")
	})

	t.Run("viewer は 403（見えているので理由を返してよい）", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbSpaceID, kbUserID, domain.GrantRoleViewer)
		w := patch(f, t, kbSpaceID)
		require.Equal(t, http.StatusForbidden, w.Code, w.Body.String())
	})

	t.Run("役割の無い相手には、実在するスペースも存在しない ID も同じ 404", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		real := patch(f, t, kbSpaceID)
		missing := patch(f, t, "00000000-0000-7000-8000-00000000dead")
		require.Equal(t, http.StatusNotFound, real.Code)
		require.Equal(t, http.StatusNotFound, missing.Code)
		// 本文まで同じバイト列であること（差があると実在が読める）。
		assert.Equal(t, missing.Body.String(), real.Body.String())
	})

	t.Run("admin でも空の名前は 400", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.perms.setScopeRole(kbSpaceID, kbUserID, domain.GrantRoleAdmin)
		path := "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/spaces/" + kbSpaceID
		w := f.do(t, http.MethodPatch, path, `{"name":""}`)
		require.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
	})
}

// 題名検索は「見えるページだけが結果に出る」ことが認可のすべて。
// ふるいは木と同じ判定（usecase 側でテスト済み）なので、ここでは配線を確かめる:
// 役割があれば一致した分が返り、無ければ空、q 無しは 400。
func Test_ナレッジAPI_題名検索(t *testing.T) {
	search := func(f kbFixture, t *testing.T, query string) *httptest.ResponseRecorder {
		t.Helper()
		path := "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/search"
		if query != "" {
			path += "?q=" + query
		}
		return f.do(t, http.MethodGet, path, "")
	}

	t.Run("閲覧できる相手には題名の一致した分が返る", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		w := search(f, t, "root")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Contains(t, w.Body.String(), "root")
		assert.NotContains(t, w.Body.String(), "child")
	})

	t.Run("閲覧できない相手には一致していても空", func(t *testing.T) {
		f := newKbFixture(domain.PagePermission{}, kbUserID)
		w := search(f, t, "root")
		require.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "[]", strings.TrimSpace(w.Body.String()))
	})

	t.Run("役割の届かないスペースのページは出ない（一覧と同じ事実で判定される）", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		// dest は子を持たないので、自分の役割が届かない private スペースへ移せる
		// （fixture の既定はどのページにも届くので、移した先に届かないことも指定する）。
		f.perms.hideInOwnPrivateSpace(kbWorkspaceID, kbDestPageID)
		f.perms.setPagePermission(kbDestPageID, kbUserID, kbNoPerm)
		w := search(f, t, "dest")
		require.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "[]", strings.TrimSpace(w.Body.String()))
	})

	t.Run("q 無しは 400（空で全件を返す口にしない）", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		w := search(f, t, "")
		require.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
	})
}

// /p/{pageId} は URL にテナントを持たない解決の口。判定は解決後に必ず通るので、
// 「所属していないワークスペースのページ」と「存在しない ID」が同じ応答であることが要点。
func Test_ナレッジAPI_IDだけでの解決(t *testing.T) {
	resolve := func(f kbFixture, t *testing.T, pageID string) *httptest.ResponseRecorder {
		t.Helper()
		return f.do(t, http.MethodGet, "/api/v2/kb/pages/"+pageID, "")
	}

	t.Run("閲覧できる相手には所属スラッグと編集可否が返る", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		w := resolve(f, t, kbRootPageID)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Contains(t, w.Body.String(), `"workspaceSlug":"`+kbWorkspaceSlug+`"`)
		assert.Contains(t, w.Body.String(), `"canEdit":true`)
	})

	t.Run("閲覧できない相手には、実在も不在も同じ 404", func(t *testing.T) {
		f := newKbFixture(domain.PagePermission{}, kbUserID)
		real := resolve(f, t, kbRootPageID)
		missing := resolve(f, t, "00000000-0000-7000-8000-00000000dead")
		require.Equal(t, http.StatusNotFound, real.Code)
		require.Equal(t, http.StatusNotFound, missing.Code)
		assert.Equal(t, missing.Body.String(), real.Body.String())
	})

	// 停止中のワークスペースは id 経由でも無いものとして扱う。slug 経由の入口
	// （middleware.KnowledgeBaseWorkspace）はこの経路を通らないため、
	// ResolvePageLocationUseCase 側で別途確かめていないと、停止後も id さえ控えていれば
	// 読み続けられてしまう。
	//
	// 変異確認: ResolvePageLocationUseCase.Execute の !ws.IsActive 分岐を外すと、
	// このテストの 404 判定が落ちる。
	t.Run("停止中のワークスペースは404", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		f.pages.workspaces[kbWorkspaceSlug].IsActive = false
		w := resolve(f, t, kbRootPageID)
		assert.Equal(t, http.StatusNotFound, w.Code)
	})

	// 段2: 開くたびに upsert されるので、同じ人が同じページを何度開いても viewCount は
	// 増えない（延べ回数ではなく「見たことのある人数」）。
	//
	// 変異確認: RecordPageViewUseCase.Execute が RecordView を呼ばなくなると、
	// この viewCount が 0 のまま止まりテストが落ちる。
	t.Run("開くたびに閲覧を記録するが同じ人では増えない", func(t *testing.T) {
		f := newKbFixture(kbCanView, kbUserID)
		w1 := resolve(f, t, kbRootPageID)
		require.Equal(t, http.StatusOK, w1.Code, w1.Body.String())
		assert.Contains(t, w1.Body.String(), `"viewCount":1`)

		w2 := resolve(f, t, kbRootPageID)
		require.Equal(t, http.StatusOK, w2.Code, w2.Body.String())
		assert.Contains(t, w2.Body.String(), `"viewCount":1`)
	})

	// 段7: isFavorite は付ける/外すの実際の状態を映す。
	t.Run("isFavoriteはお気に入りの状態を映す", func(t *testing.T) {
		f := newKbFixture(kbCanView, kbUserID)
		before := resolve(f, t, kbRootPageID)
		require.Equal(t, http.StatusOK, before.Code, before.Body.String())
		assert.Contains(t, before.Body.String(), `"isFavorite":false`)

		put := f.do(t, http.MethodPut, "/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbRootPageID+"/favorite", "")
		require.Equal(t, http.StatusCreated, put.Code, put.Body.String())

		after := resolve(f, t, kbRootPageID)
		require.Equal(t, http.StatusOK, after.Code, after.Body.String())
		assert.Contains(t, after.Body.String(), `"isFavorite":true`)
	})
}

// Test_チケットからの逆参照_ワークスペースが見えるときだけ返す は TicketBacklinks の可視判定を
// 固定する。チケットには pages のような個票の権限が無く、実効権限はワークスペース単位なので、
// ページが（個票の付与などで）見えていても、バックログ側の可否はワークスペースの役割で別に
// 決まる。
func Test_チケットからの逆参照_ワークスペースが見えるときだけ返す(t *testing.T) {
	setup := func(t *testing.T) (kbFixture, string) {
		t.Helper()
		f := newKbFixture(kbCanView, kbUserID)
		linked := f.tickets.addTicket(domain.Ticket{
			ID: "tb-linked", WorkspaceID: kbWorkspaceID, ProjectID: "tb-project", Title: "紐づく",
		})
		f.tickets.pageLinks[linked.ID] = []string{kbRootPageID}
		return f, linked.ID
	}
	const path = "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbRootPageID + "/ticket-backlinks"

	t.Run("ワークスペースの役割が届いていれば返す", func(t *testing.T) {
		f, linkedID := setup(t)
		f.perms.setScopeRole(kbWorkspaceID, kbUserID, domain.GrantRoleViewer)

		w := f.do(t, http.MethodGet, path, "")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		got := decodeJSON[[]domain.Ticket](t, w)
		require.Len(t, got, 1)
		assert.Equal(t, linkedID, got[0].ID)
	})

	t.Run("ワークスペースの役割が無ければ空", func(t *testing.T) {
		f, _ := setup(t)
		// ページ自体は fallback(kbCanView) で見えるが、ワークスペースの役割は付けない。
		w := f.do(t, http.MethodGet, path, "")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.Empty(t, decodeJSON[[]domain.Ticket](t, w), "バックログ側は見せない")
	})
}
