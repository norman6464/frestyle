package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// projectFakeRepo は repository.ProjectRepository の in-memory 実装。
// ナレッジ側の fake（kbFakePages / kbFakePerms）とは何も共有しない — projects が
// spaces に依存しないことが、この fake が独立して成り立つことにも表れている。
type projectFakeRepo struct {
	projects map[string]*domain.Project
	nextID   int
}

func newProjectFakeRepo() *projectFakeRepo {
	return &projectFakeRepo{projects: map[string]*domain.Project{}}
}

var _ repository.ProjectRepository = (*projectFakeRepo)(nil)

func (f *projectFakeRepo) CreateProject(_ context.Context, p *domain.Project) error {
	for _, existing := range f.projects {
		if existing.WorkspaceID == p.WorkspaceID && strings.EqualFold(existing.Key, p.Key) {
			return repository.ErrProjectKeyTaken
		}
	}
	f.nextID++
	p.ID = "project-" + string(rune('a'+f.nextID-1))
	stored := *p
	f.projects[p.ID] = &stored
	return nil
}

func (f *projectFakeRepo) ListProjects(_ context.Context, workspaceID string) ([]domain.Project, error) {
	out := []domain.Project{}
	for _, p := range f.projects {
		if p.WorkspaceID == workspaceID {
			out = append(out, *p)
		}
	}
	return out, nil
}

func (f *projectFakeRepo) FindProject(_ context.Context, workspaceID, projectID string) (*domain.Project, error) {
	p, ok := f.projects[projectID]
	if !ok || p.WorkspaceID != workspaceID {
		return nil, repository.ErrProjectNotFound
	}
	cp := *p
	return &cp, nil
}

func (f *projectFakeRepo) FindProjectByKey(_ context.Context, workspaceID, key string) (*domain.Project, error) {
	for _, p := range f.projects {
		if p.WorkspaceID == workspaceID && strings.EqualFold(p.Key, key) {
			cp := *p
			return &cp, nil
		}
	}
	return nil, repository.ErrProjectNotFound
}

func (f *projectFakeRepo) RenameProject(_ context.Context, workspaceID, projectID, name string) error {
	p, ok := f.projects[projectID]
	if !ok || p.WorkspaceID != workspaceID {
		return repository.ErrProjectNotFound
	}
	p.Name = name
	return nil
}

type projectFixture struct {
	projects *projectFakeRepo
	router   *gin.Engine
}

// newProjectFixture は本番と同じ wiring（registerProjectRoutesWith）でルータを組む。
// role はワークスペースでの役割 — 入れ物を増やす操作は admin（CanManage）だけに許す。
func newProjectFixture(uid uint64, role domain.GrantRole) projectFixture {
	gin.SetMode(gin.TestMode)
	pages := newKbFakePages()
	pages.addWorkspace(kbWorkspaceID, kbWorkspaceSlug)
	pages.addWorkspace(kbOtherWorkspaceID, kbOtherWorkspaceSlug)

	perms := newKbFakePerms(pages, domain.PagePermission{})
	perms.addMember(kbWorkspaceID, kbUserID)
	if role != "" {
		perms.setScopeRole(kbWorkspaceID, kbUserID, role)
	}

	projects := newProjectFakeRepo()

	r := gin.New()
	g := r.Group("/api/v2")
	if uid != 0 {
		g.Use(func(c *gin.Context) {
			c.Set(middleware.ContextKeyCurrentUserID, uid)
			c.Set(middleware.ContextKeyCurrentUser, &domain.User{ID: uid})
			c.Next()
		})
	}
	registerProjectRoutesWith(g, projects, perms, pages)
	return projectFixture{projects: projects, router: r}
}

func (f projectFixture) do(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	f.router.ServeHTTP(w, req)
	return w
}

const projectAPIBase = "/api/v2/workspaces/" + kbWorkspaceSlug + "/projects"

func Test_プロジェクト_作成から一覧取得改名まで(t *testing.T) {
	f := newProjectFixture(kbUserID, domain.GrantRoleAdmin)

	// 最初は空。
	w := f.do(t, http.MethodGet, projectAPIBase, "")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Empty(t, decodeJSON[projectListResponse](t, w).Projects)

	// key を省略するとサーバーが自動採番する。
	w = f.do(t, http.MethodPost, projectAPIBase, `{"name":"FreStyle 開発"}`)
	require.Equal(t, http.StatusCreated, w.Code)
	created := decodeJSON[domain.Project](t, w)
	require.NotEmpty(t, created.ID)
	assert.True(t, domain.ValidProjectKey(created.Key))

	w = f.do(t, http.MethodGet, projectAPIBase+"/"+created.ID, "")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "FreStyle 開発", decodeJSON[domain.Project](t, w).Name)

	// 改名は名前だけ。key は変わらない（既に外へ貼られた表示キーの指す先を失わない）。
	w = f.do(t, http.MethodPatch, projectAPIBase+"/"+created.ID, `{"name":"FreStyle 本体"}`)
	require.Equal(t, http.StatusOK, w.Code)
	renamed := decodeJSON[domain.Project](t, w)
	assert.Equal(t, "FreStyle 本体", renamed.Name)
	assert.Equal(t, created.Key, renamed.Key)

	w = f.do(t, http.MethodGet, projectAPIBase, "")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Len(t, decodeJSON[projectListResponse](t, w).Projects, 1)
}

func Test_プロジェクト_keyの重複は409(t *testing.T) {
	f := newProjectFixture(kbUserID, domain.GrantRoleAdmin)

	w := f.do(t, http.MethodPost, projectAPIBase, `{"key":"eng","name":"開発"}`)
	require.Equal(t, http.StatusCreated, w.Code)

	w = f.do(t, http.MethodPost, projectAPIBase, `{"key":"eng","name":"開発2"}`)
	assert.Equal(t, http.StatusConflict, w.Code)
}

func Test_プロジェクト_壊れたkeyは400(t *testing.T) {
	f := newProjectFixture(kbUserID, domain.GrantRoleAdmin)

	w := f.do(t, http.MethodPost, projectAPIBase, `{"key":"Bad Key","name":"開発"}`)
	assert.Equal(t, http.StatusBadRequest, w.Code)

	w = f.do(t, http.MethodPost, projectAPIBase, `{"name":""}`)
	assert.Equal(t, http.StatusBadRequest, w.Code, "名前は必須")
}

// 入れ物が増える操作は admin だけ。editor は見えるが作れない
// （チームスペースの作成と同じ非対称。権限はワークスペースの役割だけで決める）。
func Test_プロジェクト_作成改名はadminだけ(t *testing.T) {
	f := newProjectFixture(kbUserID, domain.GrantRoleEditor)

	w := f.do(t, http.MethodPost, projectAPIBase, `{"name":"開発"}`)
	assert.Equal(t, http.StatusForbidden, w.Code)

	// 読み取りはメンバーなら通る。
	w = f.do(t, http.MethodGet, projectAPIBase, "")
	assert.Equal(t, http.StatusOK, w.Code)
}

func Test_プロジェクト_未認証は401(t *testing.T) {
	f := newProjectFixture(0, "")
	w := f.do(t, http.MethodGet, projectAPIBase, "")
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func Test_プロジェクト_別ワークスペースのIDは404(t *testing.T) {
	f := newProjectFixture(kbUserID, domain.GrantRoleAdmin)
	w := f.do(t, http.MethodPost, projectAPIBase, `{"name":"開発"}`)
	require.Equal(t, http.StatusCreated, w.Code)
	created := decodeJSON[domain.Project](t, w)

	// 所属していないワークスペース経由では、そもそもワークスペース解決で 404 になる。
	other := "/api/v2/workspaces/" + kbOtherWorkspaceSlug + "/projects/" + created.ID
	w = f.do(t, http.MethodGet, other, "")
	assert.Equal(t, http.StatusNotFound, w.Code)
}
