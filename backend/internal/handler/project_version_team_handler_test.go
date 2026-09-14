package handler

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// versionFakeRepo は repository.ProjectVersionRepository の in-memory 実装。
// 同名の拒否（大文字小文字を無視）だけは本物と同じ規則にする —— handler が
// 409 に畳めるかを見るため。
type versionFakeRepo struct {
	versions map[string]*domain.ProjectVersion
	fix      map[string][]string // ticketID -> versionIDs
	nextID   int
}

func newVersionFakeRepo() *versionFakeRepo {
	return &versionFakeRepo{versions: map[string]*domain.ProjectVersion{}, fix: map[string][]string{}}
}

var _ repository.ProjectVersionRepository = (*versionFakeRepo)(nil)

func (f *versionFakeRepo) CreateProjectVersion(
	_ context.Context, workspaceID, projectID, name, position string,
) (*domain.ProjectVersion, error) {
	for _, v := range f.versions {
		if v.ProjectID == projectID && strings.EqualFold(v.Name, name) {
			return nil, repository.ErrProjectVersionNameTaken
		}
	}
	f.nextID++
	v := &domain.ProjectVersion{
		ID: fmt.Sprintf("version-%d", f.nextID), WorkspaceID: workspaceID,
		ProjectID: projectID, Name: name, Position: position,
	}
	f.versions[v.ID] = v
	cp := *v
	return &cp, nil
}

func (f *versionFakeRepo) ListProjectVersions(
	_ context.Context, workspaceID, projectID string, includeArchived bool,
) ([]domain.ProjectVersion, error) {
	out := []domain.ProjectVersion{}
	for _, v := range f.versions {
		if v.WorkspaceID != workspaceID || v.ProjectID != projectID {
			continue
		}
		if v.ArchivedAt != nil && !includeArchived {
			continue
		}
		out = append(out, *v)
	}
	return out, nil
}

func (f *versionFakeRepo) GetProjectVersion(
	_ context.Context, workspaceID, projectID, versionID string,
) (*domain.ProjectVersion, error) {
	v, ok := f.versions[versionID]
	if !ok || v.WorkspaceID != workspaceID || v.ProjectID != projectID {
		return nil, repository.ErrProjectVersionNotFound
	}
	cp := *v
	return &cp, nil
}

func (f *versionFakeRepo) UpdateProjectVersion(
	_ context.Context, workspaceID, projectID, versionID string, in repository.ProjectVersionUpdate,
) (*domain.ProjectVersion, error) {
	v, ok := f.versions[versionID]
	if !ok || v.WorkspaceID != workspaceID || v.ProjectID != projectID {
		return nil, repository.ErrProjectVersionNotFound
	}
	v.Name, v.ReleasedAt = in.Name, in.ReleasedAt
	cp := *v
	return &cp, nil
}

func (f *versionFakeRepo) ArchiveProjectVersion(_ context.Context, workspaceID, projectID, versionID string) error {
	v, ok := f.versions[versionID]
	if !ok || v.WorkspaceID != workspaceID || v.ProjectID != projectID {
		return repository.ErrProjectVersionNotFound
	}
	now := time.Now()
	v.ArchivedAt = &now
	return nil
}

func (f *versionFakeRepo) RestoreProjectVersion(
	_ context.Context, workspaceID, projectID, versionID, position string,
) error {
	v, ok := f.versions[versionID]
	if !ok || v.WorkspaceID != workspaceID || v.ProjectID != projectID {
		return repository.ErrProjectVersionNotFound
	}
	v.ArchivedAt, v.Position = nil, position
	return nil
}

func (f *versionFakeRepo) LastProjectVersionPosition(_ context.Context, _, _ string) (string, error) {
	return "", nil
}

func (f *versionFakeRepo) AddTicketFixVersion(_ context.Context, _, ticketID, versionID string) error {
	for _, id := range f.fix[ticketID] {
		if id == versionID {
			return nil // 二度押しても増えない
		}
	}
	f.fix[ticketID] = append(f.fix[ticketID], versionID)
	return nil
}

func (f *versionFakeRepo) RemoveTicketFixVersion(_ context.Context, _, ticketID, versionID string) error {
	kept := f.fix[ticketID][:0]
	for _, id := range f.fix[ticketID] {
		if id != versionID {
			kept = append(kept, id)
		}
	}
	f.fix[ticketID] = kept
	return nil
}

func (f *versionFakeRepo) ListTicketFixVersions(
	_ context.Context, _, ticketID string,
) ([]domain.ProjectVersion, error) {
	out := []domain.ProjectVersion{}
	for _, id := range f.fix[ticketID] {
		if v, ok := f.versions[id]; ok {
			out = append(out, *v)
		}
	}
	return out, nil
}

// teamFakeRepo は repository.TeamRepository の in-memory 実装。
type teamFakeRepo struct {
	teams   map[string]*domain.Team
	members map[string][]domain.TeamMember
	cleared []string // ClearTicketsTeam を呼ばれたチーム
	nextID  int
}

func newTeamFakeRepo() *teamFakeRepo {
	return &teamFakeRepo{teams: map[string]*domain.Team{}, members: map[string][]domain.TeamMember{}}
}

var _ repository.TeamRepository = (*teamFakeRepo)(nil)

func (f *teamFakeRepo) CreateTeam(_ context.Context, workspaceID, projectID, name string) (*domain.Team, error) {
	for _, t := range f.teams {
		if t.ProjectID == projectID && strings.EqualFold(t.Name, name) {
			return nil, repository.ErrTeamNameTaken
		}
	}
	f.nextID++
	t := &domain.Team{
		ID: fmt.Sprintf("team-%d", f.nextID), WorkspaceID: workspaceID, ProjectID: projectID, Name: name,
	}
	f.teams[t.ID] = t
	cp := *t
	return &cp, nil
}

func (f *teamFakeRepo) ListTeams(_ context.Context, workspaceID, projectID string) ([]domain.Team, error) {
	out := []domain.Team{}
	for _, t := range f.teams {
		if t.WorkspaceID == workspaceID && t.ProjectID == projectID {
			out = append(out, *t)
		}
	}
	return out, nil
}

func (f *teamFakeRepo) GetTeam(_ context.Context, workspaceID, projectID, teamID string) (*domain.Team, error) {
	t, ok := f.teams[teamID]
	if !ok || t.WorkspaceID != workspaceID || t.ProjectID != projectID {
		return nil, repository.ErrTeamNotFound
	}
	cp := *t
	return &cp, nil
}

func (f *teamFakeRepo) UpdateTeam(_ context.Context, workspaceID, projectID, teamID, name string) (*domain.Team, error) {
	t, ok := f.teams[teamID]
	if !ok || t.WorkspaceID != workspaceID || t.ProjectID != projectID {
		return nil, repository.ErrTeamNotFound
	}
	t.Name = name
	cp := *t
	return &cp, nil
}

func (f *teamFakeRepo) ClearTicketsTeam(_ context.Context, _, teamID string) error {
	f.cleared = append(f.cleared, teamID)
	return nil
}

func (f *teamFakeRepo) DeleteTeam(_ context.Context, workspaceID, projectID, teamID string) error {
	t, ok := f.teams[teamID]
	if !ok || t.WorkspaceID != workspaceID || t.ProjectID != projectID {
		return repository.ErrTeamNotFound
	}
	delete(f.teams, teamID)
	return nil
}

func (f *teamFakeRepo) AddTeamMember(_ context.Context, _, teamID string, userID uint64) error {
	for _, m := range f.members[teamID] {
		if m.UserID == userID {
			return nil
		}
	}
	f.members[teamID] = append(f.members[teamID], domain.TeamMember{UserID: userID, Name: "誰か"})
	return nil
}

func (f *teamFakeRepo) RemoveTeamMember(_ context.Context, _, teamID string, userID uint64) error {
	kept := f.members[teamID][:0]
	for _, m := range f.members[teamID] {
		if m.UserID != userID {
			kept = append(kept, m)
		}
	}
	f.members[teamID] = kept
	return nil
}

func (f *teamFakeRepo) ListTeamMembers(_ context.Context, _, teamID string) ([]domain.TeamMember, error) {
	out := []domain.TeamMember{}
	out = append(out, f.members[teamID]...)
	return out, nil
}

// SetTicketTeam は差し替えたチケットを返す。domain.Ticket は team を持たないので
// （下の「担当チームは応答に出ない」参照）、返せるのは id までになる。
func (f *teamFakeRepo) SetTicketTeam(_ context.Context, _, ticketID, teamID string) (*domain.Ticket, error) {
	if teamID == "" {
		return &domain.Ticket{ID: ticketID}, nil
	}
	if _, ok := f.teams[teamID]; !ok {
		return nil, repository.ErrTeamNotFound
	}
	return &domain.Ticket{ID: ticketID}, nil
}

type versionTeamFixture struct {
	versions *versionFakeRepo
	teams    *teamFakeRepo
	router   *gin.Engine
}

// newVersionTeamFixture は本番と同じ wiring（registerProjectVersionRoutesWith）で組む。
// 版とチームは同じ登録関数に相乗りしているので、fixture も 1 つで足りる。
func newVersionTeamFixture(uid uint64, role domain.GrantRole) versionTeamFixture {
	gin.SetMode(gin.TestMode)
	pages := newKbFakePages()
	pages.addWorkspace(kbWorkspaceID, kbWorkspaceSlug)
	pages.addWorkspace(kbOtherWorkspaceID, kbOtherWorkspaceSlug)

	perms := newKbFakePerms(pages, domain.PagePermission{})
	perms.addMember(kbWorkspaceID, kbUserID)
	if role != "" {
		perms.setScopeRole(kbWorkspaceID, kbUserID, role)
	}

	versions, teams := newVersionFakeRepo(), newTeamFakeRepo()

	r := gin.New()
	g := r.Group("/api/v2")
	if uid != 0 {
		g.Use(func(c *gin.Context) {
			c.Set(middleware.ContextKeyCurrentUserID, uid)
			c.Set(middleware.ContextKeyCurrentUser, &domain.User{ID: uid})
			c.Next()
		})
	}
	registerProjectVersionRoutesWith(g, versions, teams, perms, pages, fakeTxManager{})
	return versionTeamFixture{versions: versions, teams: teams, router: r}
}

func (f versionTeamFixture) do(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	f.router.ServeHTTP(w, req)
	return w
}

const (
	pvProjectID = "project-1"
	pvWSBase    = "/api/v2/workspaces/" + kbWorkspaceSlug
	versionBase = pvWSBase + "/projects/" + pvProjectID + "/versions"
	teamBase    = pvWSBase + "/projects/" + pvProjectID + "/teams"
)

// --- 版 ---

func Test_版_作成から更新畳む戻すまで(t *testing.T) {
	f := newVersionTeamFixture(kbUserID, domain.GrantRoleAdmin)

	w := f.do(t, http.MethodGet, versionBase, "")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Empty(t, decodeJSON[projectVersionListResponse](t, w).Versions)

	w = f.do(t, http.MethodPost, versionBase, `{"name":"1.2.0"}`)
	require.Equal(t, http.StatusCreated, w.Code)
	created := decodeJSON[domain.ProjectVersion](t, w)
	require.NotEmpty(t, created.ID)
	assert.Nil(t, created.ReleasedAt, "作った直後はまだ出していない")

	// リリース日は RFC3339。出した日そのものに意味があるので真偽値には畳まない。
	w = f.do(t, http.MethodPatch, versionBase+"/"+created.ID, `{"name":"1.2.0","releasedAt":"2026-09-14T00:00:00Z"}`)
	require.Equal(t, http.StatusOK, w.Code)
	require.NotNil(t, decodeJSON[domain.ProjectVersion](t, w).ReleasedAt)

	// 畳むと既定の一覧から消え、archived=1 でだけ出る。
	w = f.do(t, http.MethodPost, versionBase+"/"+created.ID+"/archive", "")
	require.Equal(t, http.StatusNoContent, w.Code)
	assert.Empty(t, decodeJSON[projectVersionListResponse](t, f.do(t, http.MethodGet, versionBase, "")).Versions)
	assert.Len(t, decodeJSON[projectVersionListResponse](t, f.do(t, http.MethodGet, versionBase+"?archived=1", "")).Versions, 1)

	w = f.do(t, http.MethodPost, versionBase+"/"+created.ID+"/restore", "")
	require.Equal(t, http.StatusNoContent, w.Code)
	assert.Len(t, decodeJSON[projectVersionListResponse](t, f.do(t, http.MethodGet, versionBase, "")).Versions, 1)
}

func Test_版_同名は409で壊れた入力は400(t *testing.T) {
	f := newVersionTeamFixture(kbUserID, domain.GrantRoleAdmin)
	require.Equal(t, http.StatusCreated, f.do(t, http.MethodPost, versionBase, `{"name":"1.0.0"}`).Code)

	w := f.do(t, http.MethodPost, versionBase, `{"name":"1.0.0"}`)
	require.Equal(t, http.StatusConflict, w.Code)
	assert.Equal(t, "version_name_taken", decodeJSON[errorResponse](t, w).Error)

	// 大文字小文字の違いは同じ名前として扱う。
	assert.Equal(t, http.StatusConflict, f.do(t, http.MethodPost, versionBase, `{"name":"1.0.0 "}`).Code)

	assert.Equal(t, http.StatusBadRequest, f.do(t, http.MethodPost, versionBase, `{"name":""}`).Code)
	assert.Equal(t, http.StatusBadRequest, f.do(t, http.MethodPost, versionBase, `{`).Code)
}

func Test_版_リリース日がRFC3339でなければ400(t *testing.T) {
	f := newVersionTeamFixture(kbUserID, domain.GrantRoleAdmin)
	w := f.do(t, http.MethodPost, versionBase, `{"name":"1.0.0"}`)
	require.Equal(t, http.StatusCreated, w.Code)
	v := decodeJSON[domain.ProjectVersion](t, w)

	w = f.do(t, http.MethodPatch, versionBase+"/"+v.ID, `{"name":"1.0.0","releasedAt":"2026-09-14"}`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func Test_版_チケットへの付け外し(t *testing.T) {
	f := newVersionTeamFixture(kbUserID, domain.GrantRoleAdmin)
	w := f.do(t, http.MethodPost, versionBase, `{"name":"1.0.0"}`)
	require.Equal(t, http.StatusCreated, w.Code)
	v := decodeJSON[domain.ProjectVersion](t, w)
	fixBase := pvWSBase + "/tickets/t-1/fix-versions"

	assert.Empty(t, decodeJSON[projectVersionListResponse](t, f.do(t, http.MethodGet, fixBase, "")).Versions)

	w = f.do(t, http.MethodPut, fixBase, `{"versionId":"`+v.ID+`","attach":true}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Len(t, decodeJSON[projectVersionListResponse](t, w).Versions, 1)

	// 「切り替え」ではなく望む状態を送るので、二度押しても増えない・外れない。
	w = f.do(t, http.MethodPut, fixBase, `{"versionId":"`+v.ID+`","attach":true}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Len(t, decodeJSON[projectVersionListResponse](t, w).Versions, 1)

	w = f.do(t, http.MethodPut, fixBase, `{"versionId":"`+v.ID+`"}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Empty(t, decodeJSON[projectVersionListResponse](t, w).Versions)

	assert.Equal(t, http.StatusBadRequest, f.do(t, http.MethodPut, fixBase, `{}`).Code, "版の指定は必須")
}

func Test_版_作成はadminだけで読みはメンバー(t *testing.T) {
	f := newVersionTeamFixture(kbUserID, domain.GrantRoleEditor)

	assert.Equal(t, http.StatusForbidden, f.do(t, http.MethodPost, versionBase, `{"name":"1.0.0"}`).Code)
	assert.Equal(t, http.StatusOK, f.do(t, http.MethodGet, versionBase, "").Code)
	// 付け外しは編集できれば通る（版そのものを増やすのとは重みが違う）。
	assert.Equal(t, http.StatusOK,
		f.do(t, http.MethodPut, pvWSBase+"/tickets/t-1/fix-versions", `{"versionId":"居ない","attach":false}`).Code)
}

func Test_版_未認証は401で無い版は404(t *testing.T) {
	assert.Equal(t, http.StatusUnauthorized, newVersionTeamFixture(0, "").do(t, http.MethodGet, versionBase, "").Code)

	f := newVersionTeamFixture(kbUserID, domain.GrantRoleAdmin)
	w := f.do(t, http.MethodPatch, versionBase+"/居ない", `{"name":"1.0.0"}`)
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "not_found", decodeJSON[errorResponse](t, w).Error)
	assert.Equal(t, http.StatusNotFound, f.do(t, http.MethodPost, versionBase+"/居ない/archive", "").Code)
}

// --- チーム ---

func Test_チーム_作成から改名所属削除まで(t *testing.T) {
	f := newVersionTeamFixture(kbUserID, domain.GrantRoleAdmin)

	w := f.do(t, http.MethodGet, teamBase, "")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Empty(t, decodeJSON[teamListResponse](t, w).Teams)

	w = f.do(t, http.MethodPost, teamBase, `{"name":"基盤"}`)
	require.Equal(t, http.StatusCreated, w.Code)
	created := decodeJSON[domain.Team](t, w)
	require.NotEmpty(t, created.ID)

	w = f.do(t, http.MethodPatch, teamBase+"/"+created.ID, `{"name":"基盤チーム"}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "基盤チーム", decodeJSON[domain.Team](t, w).Name)

	// 所属は「どちらにしたいか」を送る。二度押しても外れない。
	w = f.do(t, http.MethodPut, teamBase+"/"+created.ID+"/members", `{"userId":7,"member":true}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Len(t, decodeJSON[teamMemberListResponse](t, w).Members, 1)
	w = f.do(t, http.MethodPut, teamBase+"/"+created.ID+"/members", `{"userId":7,"member":true}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Len(t, decodeJSON[teamMemberListResponse](t, w).Members, 1)

	// 一覧には所属まで詰めて返す（画面が 1 回で描けるように）。
	w = f.do(t, http.MethodGet, teamBase, "")
	require.Equal(t, http.StatusOK, w.Code)
	teams := decodeJSON[teamListResponse](t, w).Teams
	require.Len(t, teams, 1)
	assert.Len(t, teams[0].Members, 1)

	w = f.do(t, http.MethodPut, teamBase+"/"+created.ID+"/members", `{"userId":7,"member":false}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Empty(t, decodeJSON[teamMemberListResponse](t, w).Members)

	w = f.do(t, http.MethodDelete, teamBase+"/"+created.ID, "")
	require.Equal(t, http.StatusNoContent, w.Code)
	// 消す前にチケットの印を外していること（複合 FK が無効な組を指したまま残らない）。
	assert.Contains(t, f.teams.cleared, created.ID)
}

func Test_チーム_同名は409で壊れた入力は400(t *testing.T) {
	f := newVersionTeamFixture(kbUserID, domain.GrantRoleAdmin)
	require.Equal(t, http.StatusCreated, f.do(t, http.MethodPost, teamBase, `{"name":"基盤"}`).Code)

	w := f.do(t, http.MethodPost, teamBase, `{"name":"基盤"}`)
	require.Equal(t, http.StatusConflict, w.Code)
	assert.Equal(t, "team_name_taken", decodeJSON[errorResponse](t, w).Error)

	assert.Equal(t, http.StatusBadRequest, f.do(t, http.MethodPost, teamBase, `{"name":""}`).Code)
	assert.Equal(t, http.StatusBadRequest, f.do(t, http.MethodPost, teamBase, `{`).Code)
	assert.Equal(t, http.StatusBadRequest,
		f.do(t, http.MethodPut, teamBase+"/team-1/members", `{"member":true}`).Code, "誰を入れるかは必須")
}

func Test_チケットの担当チーム_空なら外す(t *testing.T) {
	f := newVersionTeamFixture(kbUserID, domain.GrantRoleEditor)
	ticketTeam := pvWSBase + "/tickets/t-1/team"

	w := f.do(t, http.MethodPut, ticketTeam, `{"teamId":""}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "t-1", decodeJSON[domain.Ticket](t, w).ID)

	w = f.do(t, http.MethodPut, ticketTeam, `{"teamId":"居ない"}`)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

// 担当チームは **応答に出ない**。domain.Ticket に team の欄が無いため、付け替えは
// 成功しても返ってくる JSON には出てこない（DB の tickets.team_id には入る）。
// 画面が付け替えた結果をその場で描けないので、欄を足すまでは片道の操作になる。
func Test_チケットの担当チーム_応答にはまだ出てこない(t *testing.T) {
	f := newVersionTeamFixture(kbUserID, domain.GrantRoleAdmin)
	w := f.do(t, http.MethodPost, teamBase, `{"name":"基盤"}`)
	require.Equal(t, http.StatusCreated, w.Code)
	created := decodeJSON[domain.Team](t, w)

	w = f.do(t, http.MethodPut, pvWSBase+"/tickets/t-1/team", `{"teamId":"`+created.ID+`"}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.NotContains(t, w.Body.String(), "teamId",
		"欄を足したらこの検査は外して、付け替えた結果が返ることを見ること")
}

func Test_チーム_作るのはadminだけ(t *testing.T) {
	f := newVersionTeamFixture(kbUserID, domain.GrantRoleEditor)

	assert.Equal(t, http.StatusForbidden, f.do(t, http.MethodPost, teamBase, `{"name":"基盤"}`).Code)
	assert.Equal(t, http.StatusForbidden, f.do(t, http.MethodDelete, teamBase+"/team-1", "").Code)
	assert.Equal(t, http.StatusOK, f.do(t, http.MethodGet, teamBase, "").Code)
}

func Test_チーム_無いチームは404(t *testing.T) {
	f := newVersionTeamFixture(kbUserID, domain.GrantRoleAdmin)

	w := f.do(t, http.MethodPatch, teamBase+"/居ない", `{"name":"基盤"}`)
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "not_found", decodeJSON[errorResponse](t, w).Error)
	assert.Equal(t, http.StatusNotFound, f.do(t, http.MethodDelete, teamBase+"/居ない", "").Code)
}
