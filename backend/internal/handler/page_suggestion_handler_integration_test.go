//go:build integration

package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestPageSuggestionAPI_Integration は提案 API を実 PostgreSQL・本物のルータ
// （registerKnowledgeBaseRoutesWith 経由）で end-to-end に固定する。
//
// 中心の確認: viewer は提案できない、commenter は提案できるが採用・却下や本文の直接書き換えは
// できない、admin（editor 以上）が採用すると本文が変わり版が増える、却下すると本文は変わらない。
func TestPageSuggestionAPI_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	env := newKbEnv(t, sqlDB, "sugg")
	admin := kbInsertUser(t, sqlDB, "admin")
	env.joinWorkspace(t, admin, domain.GrantRoleAdmin)
	rootPage := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, admin, "a0", "root")

	viewer := kbInsertUser(t, sqlDB, "viewer")
	env.joinWorkspace(t, viewer, domain.GrantRoleViewer)
	commenter := kbInsertUser(t, sqlDB, "commenter")
	env.joinWorkspace(t, commenter, domain.GrantRoleCommenter)

	asAdmin := env.as(admin)
	asCommenter := env.as(commenter)

	suggestionsPath := "/api/v2/kb/workspaces/" + env.slug + "/pages/" + rootPage + "/suggestions"
	const suggestedDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"commenterの提案"}]}]}`

	var suggestionID string
	t.Run("commenterが保存すると本文ではなく提案として積まれる", func(t *testing.T) {
		w := asCommenter.do(t, http.MethodPost, suggestionsPath, `{"doc":`+suggestedDoc+`}`)
		require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
		var got kbPageSuggestionResponse
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
		assert.Equal(t, "open", got.Status)
		suggestionID = got.ID

		page := asCommenter.do(t, http.MethodGet, env.pagePath(rootPage), "")
		require.Equal(t, http.StatusOK, page.Code)
		assert.NotContains(t, page.Body.String(), "commenterの提案", "本文はまだ変わっていない")
	})

	t.Run("commenterは自分の提案を採用できない", func(t *testing.T) {
		w := asCommenter.do(t, http.MethodPost, suggestionsPath+"/"+suggestionID+"/accept", "")
		assert.Equal(t, http.StatusForbidden, w.Code, w.Body.String())
	})

	t.Run("adminが採用すると本文が変わり版が増える", func(t *testing.T) {
		versionsBefore := asAdmin.do(t, http.MethodGet, "/api/v2/kb/workspaces/"+env.slug+"/pages/"+rootPage+"/versions", "")
		require.Equal(t, http.StatusOK, versionsBefore.Code)
		var before []pageVersionSummaryResponse
		require.NoError(t, json.Unmarshal(versionsBefore.Body.Bytes(), &before))

		w := asAdmin.do(t, http.MethodPost, suggestionsPath+"/"+suggestionID+"/accept", "")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var got kbPageSuggestionResponse
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
		assert.Equal(t, "accepted", got.Status)
		require.NotNil(t, got.ResolvedBy)
		assert.Equal(t, admin, got.ResolvedBy.UserID)

		page := asAdmin.do(t, http.MethodGet, env.pagePath(rootPage), "")
		require.Equal(t, http.StatusOK, page.Code)
		assert.Contains(t, page.Body.String(), "commenterの提案", "採用した提案が本文へ反映される")

		versionsAfter := asAdmin.do(t, http.MethodGet, "/api/v2/kb/workspaces/"+env.slug+"/pages/"+rootPage+"/versions", "")
		require.Equal(t, http.StatusOK, versionsAfter.Code)
		var after []pageVersionSummaryResponse
		require.NoError(t, json.Unmarshal(versionsAfter.Body.Bytes(), &after))
		assert.Len(t, after, len(before)+1, "採用は10分規則を無視して必ず版を1つ切る")
	})

	t.Run("却下すると本文は変わらない", func(t *testing.T) {
		before := asAdmin.do(t, http.MethodGet, env.pagePath(rootPage), "")
		require.Equal(t, http.StatusOK, before.Code)

		const rejectedDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"却下される提案"}]}]}`
		created := asCommenter.do(t, http.MethodPost, suggestionsPath, `{"doc":`+rejectedDoc+`}`)
		require.Equal(t, http.StatusCreated, created.Code, created.Body.String())
		var createdSugg kbPageSuggestionResponse
		require.NoError(t, json.Unmarshal(created.Body.Bytes(), &createdSugg))

		w := asAdmin.do(t, http.MethodPost, suggestionsPath+"/"+createdSugg.ID+"/reject", "")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var got kbPageSuggestionResponse
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
		assert.Equal(t, "rejected", got.Status)

		after := asAdmin.do(t, http.MethodGet, env.pagePath(rootPage), "")
		require.Equal(t, http.StatusOK, after.Code)
		assert.Equal(t, before.Body.String(), after.Body.String(), "却下は本文を一切変えない")
	})

	t.Run("提案作成後にページが編集されると採用は409", func(t *testing.T) {
		// rootPage 共有の open 一覧を汚さないよう、専用のページを別途用意する
		// （この提案は409で拒否され続けて open のまま残るため）。
		stalePage := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, admin, "a2", "stale")
		stalePath := "/api/v2/kb/workspaces/" + env.slug + "/pages/" + stalePage + "/suggestions"
		staleContentPath := "/api/v2/kb/workspaces/" + env.slug + "/pages/" + stalePage + "/content"

		const staleDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"版がずれる提案"}]}]}`
		created := asCommenter.do(t, http.MethodPost, stalePath, `{"doc":`+staleDoc+`}`)
		require.Equal(t, http.StatusCreated, created.Code, created.Body.String())
		var createdSugg kbPageSuggestionResponse
		require.NoError(t, json.Unmarshal(created.Body.Bytes(), &createdSugg))

		// 提案作成後、採用より前に本文が直接書き換えられる（版が1つ進む）。
		const editedDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"横から入った編集"}]}]}`
		edit := asAdmin.do(t, http.MethodPut, staleContentPath, `{"doc":`+editedDoc+`}`)
		require.Equal(t, http.StatusOK, edit.Code, edit.Body.String())

		w := asAdmin.do(t, http.MethodPost, stalePath+"/"+createdSugg.ID+"/accept", "")
		assert.Equal(t, http.StatusConflict, w.Code, w.Body.String())
		assert.JSONEq(t, `{"error":"suggestion_stale"}`, w.Body.String())

		page := asAdmin.do(t, http.MethodGet, env.pagePath(stalePage), "")
		require.Equal(t, http.StatusOK, page.Code)
		assert.Contains(t, page.Body.String(), "横から入った編集", "拒否されたので横から入った編集のまま")
		assert.NotContains(t, page.Body.String(), "版がずれる提案", "採用が巻き戻されていない")
	})

	t.Run("投稿者あたりの上限に達すると429", func(t *testing.T) {
		// rootPage 共有の open 一覧を汚さないよう、専用のページを別途用意する。
		//
		// maxOpenSuggestionsPerAuthorPerPage(=20) 件まで実際に POST で積もうとすると、
		// 同じ経路に既に掛けてある per-user レート制限（1分30回・バーストは10回）に
		// 先に引っかかってしまい、上限チェックそのものを試せない。ここは「real Postgres に
		// 対して CountOpenByAuthor が正しく数える」ことを確かめたいので、19件は
		// persistence 層で直接作って前提を揃え、実際に HTTP 越しで送るのは上限に当たる
		// 最後の1件だけにする。
		floodPage := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, admin, "a1", "flood")
		floodPath := "/api/v2/kb/workspaces/" + env.slug + "/pages/" + floodPage + "/suggestions"
		flooder := kbInsertUser(t, sqlDB, "flooder")
		env.joinWorkspace(t, flooder, domain.GrantRoleCommenter)
		asFlooder := env.as(flooder)
		const floodDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"連投"}]}]}`

		suggestionRepo := persistence.NewPageSuggestionRepository(sqlDB)
		for i := 0; i < 19; i++ {
			s := &domain.PageSuggestion{WorkspaceID: env.workspaceID, PageID: floodPage, Doc: floodDoc, AuthorUserID: flooder}
			require.NoError(t, suggestionRepo.Create(context.Background(), s))
		}
		// 20件目は実際にHTTP経由で作り、ここまでは通ることを確かめる。
		w := asFlooder.do(t, http.MethodPost, floodPath, `{"doc":`+floodDoc+`}`)
		require.Equal(t, http.StatusCreated, w.Code, w.Body.String())

		// 21件目で上限に当たる。
		w = asFlooder.do(t, http.MethodPost, floodPath, `{"doc":`+floodDoc+`}`)
		assert.Equal(t, http.StatusTooManyRequests, w.Code, w.Body.String())
		assert.JSONEq(t, `{"error":"too_many_open_suggestions"}`, w.Body.String())
	})

	t.Run("一覧は open な提案だけをcreated_at昇順で返す", func(t *testing.T) {
		// この時点で既に acceptedPending/rejectedPending にした 2 件は open ではないので、
		// 一覧に混ざらないことも合わせて確かめるため、ここで新たに 2 件の open な提案を作る。
		const firstDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"1件目の提案"}]}]}`
		const secondDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"2件目の提案"}]}]}`

		firstCreated := asCommenter.do(t, http.MethodPost, suggestionsPath, `{"doc":`+firstDoc+`}`)
		require.Equal(t, http.StatusCreated, firstCreated.Code, firstCreated.Body.String())
		var first kbPageSuggestionResponse
		require.NoError(t, json.Unmarshal(firstCreated.Body.Bytes(), &first))

		secondCreated := asCommenter.do(t, http.MethodPost, suggestionsPath, `{"doc":`+secondDoc+`}`)
		require.Equal(t, http.StatusCreated, secondCreated.Code, secondCreated.Body.String())
		var second kbPageSuggestionResponse
		require.NoError(t, json.Unmarshal(secondCreated.Body.Bytes(), &second))

		w := asCommenter.do(t, http.MethodGet, suggestionsPath, "")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var got []kbPageSuggestionResponse
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))

		require.Len(t, got, 2, "既にacceptedとrejectedになった提案は一覧に出ない")
		assert.Equal(t, first.ID, got[0].ID, "先に作った提案が先頭に来る（created_at昇順）")
		assert.Equal(t, second.ID, got[1].ID)
		for _, s := range got {
			assert.Equal(t, "open", s.Status)
		}
	})
}
