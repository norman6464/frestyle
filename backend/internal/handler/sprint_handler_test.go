package handler

import (
	"context"
	"fmt"
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

// sprintFakeRepo は repository.SprintRepository の in-memory 実装。
// 並び（rank）は「入っている順」をそのまま保つスライスで表す — 位置キーの採番規則は
// usecase 側のテストで見ているので、ここは handler の配線と応答だけを見る。
type sprintFakeRepo struct {
	sprints map[string]*domain.Sprint
	ranks   []repository.SprintTicketRank
	nextID  int
}

func newSprintFakeRepo() *sprintFakeRepo {
	return &sprintFakeRepo{sprints: map[string]*domain.Sprint{}}
}

var _ repository.SprintRepository = (*sprintFakeRepo)(nil)

func (f *sprintFakeRepo) CreateSprint(_ context.Context, s *domain.Sprint) error {
	f.nextID++
	s.ID = fmt.Sprintf("sprint-%d", f.nextID)
	stored := *s
	f.sprints[s.ID] = &stored
	return nil
}

func (f *sprintFakeRepo) FindSprint(_ context.Context, workspaceID, sprintID string) (*domain.Sprint, error) {
	s, ok := f.sprints[sprintID]
	if !ok || s.WorkspaceID != workspaceID {
		return nil, repository.ErrSprintNotFound
	}
	cp := *s
	return &cp, nil
}

func (f *sprintFakeRepo) ListSprints(_ context.Context, workspaceID, projectID string) ([]domain.Sprint, error) {
	out := []domain.Sprint{}
	for _, s := range f.sprints {
		if s.WorkspaceID == workspaceID && s.ProjectID == projectID {
			out = append(out, *s)
		}
	}
	return out, nil
}

func (f *sprintFakeRepo) LastSprintPosition(_ context.Context, _, _ string) (string, error) {
	return "", nil
}

func (f *sprintFakeRepo) UpdateSprint(
	_ context.Context, workspaceID, sprintID, name string, startDate, endDate *string,
) (*domain.Sprint, error) {
	s, ok := f.sprints[sprintID]
	if !ok || s.WorkspaceID != workspaceID {
		return nil, repository.ErrSprintNotFound
	}
	s.Name, s.StartDate, s.EndDate = name, startDate, endDate
	cp := *s
	return &cp, nil
}

func (f *sprintFakeRepo) ChangeSprintState(
	_ context.Context, workspaceID, sprintID string, state domain.SprintState,
) (*domain.Sprint, error) {
	s, ok := f.sprints[sprintID]
	if !ok || s.WorkspaceID != workspaceID {
		return nil, repository.ErrSprintNotFound
	}
	s.State = state
	cp := *s
	return &cp, nil
}

func (f *sprintFakeRepo) DeleteSprint(_ context.Context, workspaceID, sprintID string) error {
	s, ok := f.sprints[sprintID]
	if !ok || s.WorkspaceID != workspaceID {
		return repository.ErrSprintNotFound
	}
	delete(f.sprints, sprintID)
	return nil
}

func (f *sprintFakeRepo) CountActiveSprints(_ context.Context, workspaceID, projectID string) (int64, error) {
	var n int64
	for _, s := range f.sprints {
		if s.WorkspaceID == workspaceID && s.ProjectID == projectID && s.State == domain.SprintStateActive {
			n++
		}
	}
	return n, nil
}

func (f *sprintFakeRepo) AddTicketToSprint(_ context.Context, workspaceID, sprintID, ticketID, position string) error {
	f.removeTicket(ticketID)
	f.ranks = append(f.ranks, repository.SprintTicketRank{SprintID: sprintID, TicketID: ticketID, Position: position})
	_ = workspaceID
	return nil
}

func (f *sprintFakeRepo) removeTicket(ticketID string) {
	kept := f.ranks[:0]
	for _, r := range f.ranks {
		if r.TicketID != ticketID {
			kept = append(kept, r)
		}
	}
	f.ranks = kept
}

func (f *sprintFakeRepo) RemoveTicketFromSprint(_ context.Context, _, ticketID string) error {
	f.removeTicket(ticketID)
	return nil
}

func (f *sprintFakeRepo) LastTicketSprintRankPosition(_ context.Context, _, _ string) (string, error) {
	return "", nil
}

func (f *sprintFakeRepo) ListSprintTicketIDs(_ context.Context, _, sprintID string) ([]string, error) {
	var out []string
	for _, r := range f.ranks {
		if r.SprintID == sprintID {
			out = append(out, r.TicketID)
		}
	}
	return out, nil
}

func (f *sprintFakeRepo) ListSprintTicketRanks(
	_ context.Context, _, sprintID string,
) ([]repository.SprintTicketRank, error) {
	out := []repository.SprintTicketRank{}
	for _, r := range f.ranks {
		if r.SprintID == sprintID {
			out = append(out, r)
		}
	}
	return out, nil
}

func (f *sprintFakeRepo) FindTicketSprint(
	_ context.Context, _, ticketID string,
) (*repository.SprintTicketRank, error) {
	for _, r := range f.ranks {
		if r.TicketID == ticketID {
			cp := r
			return &cp, nil
		}
	}
	return nil, repository.ErrSprintTicketNotFound
}

func (f *sprintFakeRepo) MoveTicketSprintRank(_ context.Context, _, ticketID, position string) error {
	for i := range f.ranks {
		if f.ranks[i].TicketID == ticketID {
			f.ranks[i].Position = position
			return nil
		}
	}
	return repository.ErrSprintTicketNotFound
}

func (f *sprintFakeRepo) CountSprintTickets(_ context.Context, _, sprintID string) (int64, error) {
	var n int64
	for _, r := range f.ranks {
		if r.SprintID == sprintID {
			n++
		}
	}
	return n, nil
}

type sprintFixture struct {
	sprints *sprintFakeRepo
	router  *gin.Engine
}

// newSprintFixture は本番と同じ wiring（registerSprintRoutesWith）でルータを組む。
func newSprintFixture(uid uint64, role domain.GrantRole) sprintFixture {
	gin.SetMode(gin.TestMode)
	pages := newKbFakePages()
	pages.addWorkspace(kbWorkspaceID, kbWorkspaceSlug)
	pages.addWorkspace(kbOtherWorkspaceID, kbOtherWorkspaceSlug)

	perms := newKbFakePerms(pages, domain.PagePermission{})
	perms.addMember(kbWorkspaceID, kbUserID)
	if role != "" {
		perms.setScopeRole(kbWorkspaceID, kbUserID, role)
	}

	sprints := newSprintFakeRepo()

	r := gin.New()
	g := r.Group("/api/v2")
	if uid != 0 {
		g.Use(func(c *gin.Context) {
			c.Set(middleware.ContextKeyCurrentUserID, uid)
			c.Set(middleware.ContextKeyCurrentUser, &domain.User{ID: uid})
			c.Next()
		})
	}
	registerSprintRoutesWith(g, sprints, perms, pages)
	return sprintFixture{sprints: sprints, router: r}
}

func (f sprintFixture) do(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
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
	sprintProjectID = "project-1"
	sprintWSBase    = "/api/v2/workspaces/" + kbWorkspaceSlug
	sprintAPIBase   = sprintWSBase + "/projects/" + sprintProjectID + "/sprints"
)

func Test_スプリント_作成から一覧更新削除まで(t *testing.T) {
	f := newSprintFixture(kbUserID, domain.GrantRoleAdmin)

	w := f.do(t, http.MethodGet, sprintAPIBase, "")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Empty(t, decodeJSON[sprintListResponse](t, w).Sprints)

	w = f.do(t, http.MethodPost, sprintAPIBase, `{"name":"スプリント 1","startDate":"2026-09-01","endDate":"2026-09-14"}`)
	require.Equal(t, http.StatusCreated, w.Code)
	created := decodeJSON[sprintResponse](t, w)
	require.NotEmpty(t, created.ID)
	// 作った直後は必ず計画中（開始は別の口）。
	assert.Equal(t, domain.SprintStatePlanned, created.State)

	w = f.do(t, http.MethodPatch, sprintWSBase+"/sprints/"+created.ID, `{"name":"スプリント 一"}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "スプリント 一", decodeJSON[sprintResponse](t, w).Name)

	w = f.do(t, http.MethodGet, sprintAPIBase, "")
	require.Equal(t, http.StatusOK, w.Code)
	list := decodeJSON[sprintListResponse](t, w)
	require.Len(t, list.Sprints, 1)
	assert.EqualValues(t, 0, list.Sprints[0].TicketCount, "件数は一覧で添える")

	w = f.do(t, http.MethodDelete, sprintWSBase+"/sprints/"+created.ID, "")
	require.Equal(t, http.StatusNoContent, w.Code)

	w = f.do(t, http.MethodGet, sprintAPIBase, "")
	assert.Empty(t, decodeJSON[sprintListResponse](t, w).Sprints)
}

func Test_スプリント_期間が逆なら400(t *testing.T) {
	f := newSprintFixture(kbUserID, domain.GrantRoleAdmin)

	w := f.do(t, http.MethodPost, sprintAPIBase, `{"name":"s","startDate":"2026-09-14","endDate":"2026-09-01"}`)
	assert.Equal(t, http.StatusBadRequest, w.Code)

	w = f.do(t, http.MethodPost, sprintAPIBase, `{"name":""}`)
	assert.Equal(t, http.StatusBadRequest, w.Code, "名前は必須")

	w = f.do(t, http.MethodPost, sprintAPIBase, `{`)
	assert.Equal(t, http.StatusBadRequest, w.Code, "壊れた JSON")
}

func Test_スプリント_進行中は1つまでで409(t *testing.T) {
	f := newSprintFixture(kbUserID, domain.GrantRoleAdmin)

	w := f.do(t, http.MethodPost, sprintAPIBase, `{"name":"s1"}`)
	require.Equal(t, http.StatusCreated, w.Code)
	first := decodeJSON[sprintResponse](t, w)
	w = f.do(t, http.MethodPost, sprintAPIBase, `{"name":"s2"}`)
	require.Equal(t, http.StatusCreated, w.Code)
	second := decodeJSON[sprintResponse](t, w)

	w = f.do(t, http.MethodPut, sprintWSBase+"/sprints/"+first.ID+"/state", `{"state":"active"}`)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, domain.SprintStateActive, decodeJSON[sprintResponse](t, w).State)

	w = f.do(t, http.MethodPut, sprintWSBase+"/sprints/"+second.ID+"/state", `{"state":"active"}`)
	require.Equal(t, http.StatusConflict, w.Code)
	assert.Equal(t, "active_sprint_exists", decodeJSON[errorResponse](t, w).Error)

	// 終わらせれば次を始められる。
	w = f.do(t, http.MethodPut, sprintWSBase+"/sprints/"+first.ID+"/state", `{"state":"completed"}`)
	require.Equal(t, http.StatusOK, w.Code)
	w = f.do(t, http.MethodPut, sprintWSBase+"/sprints/"+second.ID+"/state", `{"state":"active"}`)
	assert.Equal(t, http.StatusOK, w.Code)
}

func Test_スプリント_戻す向きの状態変更は409(t *testing.T) {
	f := newSprintFixture(kbUserID, domain.GrantRoleAdmin)
	w := f.do(t, http.MethodPost, sprintAPIBase, `{"name":"s1"}`)
	require.Equal(t, http.StatusCreated, w.Code)
	s := decodeJSON[sprintResponse](t, w)

	w = f.do(t, http.MethodPut, sprintWSBase+"/sprints/"+s.ID+"/state", `{"state":"completed"}`)
	require.Equal(t, http.StatusConflict, w.Code, "計画中からいきなり完了へは飛ばせない")
	assert.Equal(t, "invalid_state_transition", decodeJSON[errorResponse](t, w).Error)

	w = f.do(t, http.MethodPut, sprintWSBase+"/sprints/"+s.ID+"/state", `{"state":"なんとなく"}`)
	assert.Equal(t, http.StatusConflict, w.Code, "知らない状態も断る")
}

func Test_スプリント_チケットの出し入れと並べ替え(t *testing.T) {
	f := newSprintFixture(kbUserID, domain.GrantRoleAdmin)
	w := f.do(t, http.MethodPost, sprintAPIBase, `{"name":"s1"}`)
	require.Equal(t, http.StatusCreated, w.Code)
	s := decodeJSON[sprintResponse](t, w)
	base := sprintWSBase + "/sprints/" + s.ID + "/tickets"

	w = f.do(t, http.MethodGet, base, "")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"ticketIds":[]`, "0 件でも null にしない")

	w = f.do(t, http.MethodPost, base, `{"ticketId":"t-1"}`)
	require.Equal(t, http.StatusNoContent, w.Code)
	w = f.do(t, http.MethodPost, base, `{"ticketId":"t-2"}`)
	require.Equal(t, http.StatusNoContent, w.Code)

	w = f.do(t, http.MethodGet, base, "")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"t-1"`)

	// どのスプリントに入っているかは読む口がある（詳細でスプリント名を出すため）。
	w = f.do(t, http.MethodGet, sprintWSBase+"/tickets/t-1/sprint", "")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"name":"s1"`)

	// 並べ替え。隣を指さなければ末尾へ。
	w = f.do(t, http.MethodPut, sprintWSBase+"/tickets/t-1/sprint/position", `{}`)
	assert.Equal(t, http.StatusNoContent, w.Code)

	// 同じスプリントに居ない隣を指したら断る（黙って末尾へ落とさない）。
	w = f.do(t, http.MethodPut, sprintWSBase+"/tickets/t-1/sprint/position", `{"anchorTicketId":"居ない人"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "anchor_not_sibling", decodeJSON[errorResponse](t, w).Error)

	w = f.do(t, http.MethodDelete, sprintWSBase+"/tickets/t-1/sprint", "")
	require.Equal(t, http.StatusNoContent, w.Code)

	w = f.do(t, http.MethodGet, sprintWSBase+"/tickets/t-1/sprint", "")
	require.Equal(t, http.StatusOK, w.Code)
	// 入っていないことは異常ではないので 200 + null（404 だと取得失敗と区別できない）。
	assert.Contains(t, w.Body.String(), `"sprint":null`)
}

func Test_スプリント_終わったスプリントには入れられず409(t *testing.T) {
	f := newSprintFixture(kbUserID, domain.GrantRoleAdmin)
	w := f.do(t, http.MethodPost, sprintAPIBase, `{"name":"s1"}`)
	require.Equal(t, http.StatusCreated, w.Code)
	s := decodeJSON[sprintResponse](t, w)
	require.Equal(t, http.StatusOK,
		f.do(t, http.MethodPut, sprintWSBase+"/sprints/"+s.ID+"/state", `{"state":"active"}`).Code)
	require.Equal(t, http.StatusOK,
		f.do(t, http.MethodPut, sprintWSBase+"/sprints/"+s.ID+"/state", `{"state":"completed"}`).Code)

	w = f.do(t, http.MethodPost, sprintWSBase+"/sprints/"+s.ID+"/tickets", `{"ticketId":"t-9"}`)
	require.Equal(t, http.StatusConflict, w.Code)
	assert.Equal(t, "sprint_completed", decodeJSON[errorResponse](t, w).Error)
}

// 作る・直す・開始する・消すは admin だけ。チーム全体の進み方を変える操作のため。
func Test_スプリント_書き換えはadminだけ(t *testing.T) {
	f := newSprintFixture(kbUserID, domain.GrantRoleEditor)

	assert.Equal(t, http.StatusForbidden, f.do(t, http.MethodPost, sprintAPIBase, `{"name":"s"}`).Code)
	assert.Equal(t, http.StatusForbidden,
		f.do(t, http.MethodDelete, sprintWSBase+"/sprints/sprint-1", "").Code)
	// 読み取りはメンバーなら通る。
	assert.Equal(t, http.StatusOK, f.do(t, http.MethodGet, sprintAPIBase, "").Code)
}

func Test_スプリント_未認証は401(t *testing.T) {
	f := newSprintFixture(0, "")
	assert.Equal(t, http.StatusUnauthorized, f.do(t, http.MethodGet, sprintAPIBase, "").Code)
}

func Test_スプリント_無いスプリントは404(t *testing.T) {
	f := newSprintFixture(kbUserID, domain.GrantRoleAdmin)

	w := f.do(t, http.MethodPatch, sprintWSBase+"/sprints/居ない", `{"name":"s"}`)
	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "not_found", decodeJSON[errorResponse](t, w).Error)

	assert.Equal(t, http.StatusNotFound, f.do(t, http.MethodDelete, sprintWSBase+"/sprints/居ない", "").Code)
}
