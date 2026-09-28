//go:build integration

package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/handler/dto"
	"github.com/norman6464/frestyle/backend/internal/handler/middleware"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestProjectResolveAPI_Integration は URL にワークスペースを出さないプロジェクトの解決
// （/projects/{projectId}）を実 PostgreSQL・本番と同じ配線（registerProjectRoutesWith）で確かめる。
//
// この口は slug の middleware を通らない。プロジェクトを ID だけで引いたあと、そのワークスペースで
// 所属を確かめるのが越境を防ぐ唯一の砦なので、所属の事実（principals の行）を本物の DB で確かめる。
func TestProjectResolveAPI_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	testsupport.TruncateAll(t, sqlDB, append([]string{"projects"}, kbIntegrationTables...)...)
	ctx := t.Context()

	projects := persistence.NewProjectRepository(sqlDB)
	permissions := persistence.NewKnowledgeBasePermissionRepository(sqlDB)
	workspaces := persistence.NewKnowledgeBaseRepository(sqlDB)

	acme := kbInsertWorkspace(t, sqlDB, "acme")
	rival := kbInsertWorkspace(t, sqlDB, "rival")
	mine := &domain.Project{WorkspaceID: acme, Key: "eng", Name: "開発"}
	require.NoError(t, projects.CreateProject(ctx, mine))
	theirs := &domain.Project{WorkspaceID: rival, Key: "secret", Name: "他社の開発"}
	require.NoError(t, projects.CreateProject(ctx, theirs))

	// 所属だけさせて、役割は張らない（プロジェクトの一覧・取得と同じく、所属していれば引ける）。
	bob := kbInsertUser(t, sqlDB, "bob")
	_, err := permissions.EnsureUserPrincipal(ctx, acme, bob)
	require.NoError(t, err)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v2")
	g.Use(func(c *gin.Context) {
		c.Set(middleware.ContextKeyCurrentUserID, bob)
		c.Next()
	})
	registerProjectRoutesWith(g, projects, permissions, workspaces)
	resolve := func(t *testing.T, projectID string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v2/projects/"+projectID, strings.NewReader("")))
		return w
	}

	t.Run("所属しているワークスペースのプロジェクトはワークスペースと中身を返す", func(t *testing.T) {
		w := resolve(t, mine.ID)

		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var got dto.ResolvedProjectResponse
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
		assert.Equal(t, "acme", got.WorkspaceSlug)
		assert.Equal(t, mine.ID, got.Project.ID)
		assert.Equal(t, "eng", got.Project.Key)
	})

	t.Run("所属していないワークスペースのプロジェクトは存在しないIDと同じ404", func(t *testing.T) {
		foreign := resolve(t, theirs.ID)
		missing := resolve(t, "00000000-0000-7000-8000-00000000dead")

		require.Equal(t, http.StatusNotFound, foreign.Code, foreign.Body.String())
		require.Equal(t, http.StatusNotFound, missing.Code)
		assert.Equal(t, missing.Body.String(), foreign.Body.String(), "他社のプロジェクトの実在を教えない")
		assert.NotContains(t, foreign.Body.String(), "rival")
		assert.NotContains(t, foreign.Body.String(), "secret")
	})
}
