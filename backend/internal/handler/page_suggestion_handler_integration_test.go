//go:build integration

package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

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
		w := asCommenter.do(t, http.MethodPost, suggestionsPath, `{"baseRevision":0,"doc":`+suggestedDoc+`}`)
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
		created := asCommenter.do(t, http.MethodPost, suggestionsPath, `{"baseRevision":1,"doc":`+rejectedDoc+`}`)
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

	t.Run("10分以内の本文編集でも古い提案の採用は409", func(t *testing.T) {
		// 専用ページを用意する。
		stalePage := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, admin, "a2", "stale")
		stalePath := "/api/v2/kb/workspaces/" + env.slug + "/pages/" + stalePage + "/suggestions"
		staleContentPath := "/api/v2/kb/workspaces/" + env.slug + "/pages/" + stalePage + "/content"
		staleVersionsPath := "/api/v2/kb/workspaces/" + env.slug + "/pages/" + stalePage + "/versions"

		// まず1回保存して、content_revision=1・version=1 の状態を作る。
		const baseDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"提案の基準本文"}]}]}`
		firstEdit := asAdmin.do(t, http.MethodPut, staleContentPath, `{"doc":`+baseDoc+`}`)
		require.Equal(t, http.StatusOK, firstEdit.Code, firstEdit.Body.String())

		versionsBefore := asAdmin.do(t, http.MethodGet, staleVersionsPath, "")
		require.Equal(t, http.StatusOK, versionsBefore.Code)
		var before []pageVersionSummaryResponse
		require.NoError(t, json.Unmarshal(versionsBefore.Body.Bytes(), &before))
		require.Len(t, before, 1, "初回保存では版が1件作られる")

		// revision=1 の本文を基準に提案を作る。
		const staleDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"古い提案"}]}]}`
		created := asCommenter.do(t, http.MethodPost, stalePath, `{"baseRevision":1,"doc":`+staleDoc+`}`)
		require.Equal(t, http.StatusCreated, created.Code, created.Body.String())

		var createdSugg kbPageSuggestionResponse
		require.NoError(t, json.Unmarshal(created.Body.Bytes(), &createdSugg))

		// 10分以内にもう一度本文を保存する。
		// content_revision は進むが、10分規則により page_versions は増えない。
		const editedDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"横から入った編集"}]}]}`
		edit := asAdmin.do(t, http.MethodPut, staleContentPath, `{"doc":`+editedDoc+`}`)
		require.Equal(t, http.StatusOK, edit.Code, edit.Body.String())

		versionsAfterEdit := asAdmin.do(t, http.MethodGet, staleVersionsPath, "")
		require.Equal(t, http.StatusOK, versionsAfterEdit.Code)
		var afterEdit []pageVersionSummaryResponse
		require.NoError(t, json.Unmarshal(versionsAfterEdit.Body.Bytes(), &afterEdit))
		assert.Len(t, afterEdit, len(before), "10分以内の保存では版は増えない")

		// BaseSeq は変わっていなくても、BaseRevision が古いので採用できない。
		w := asAdmin.do(t, http.MethodPost, stalePath+"/"+createdSugg.ID+"/accept", "")
		assert.Equal(t, http.StatusConflict, w.Code, w.Body.String())
		assert.JSONEq(t, `{"error":"suggestion_stale"}`, w.Body.String())

		page := asAdmin.do(t, http.MethodGet, env.pagePath(stalePage), "")
		require.Equal(t, http.StatusOK, page.Code)
		assert.Contains(t, page.Body.String(), "横から入った編集", "後から保存された本文が残る")
		assert.NotContains(t, page.Body.String(), "古い提案", "古い提案で本文が巻き戻されない")
	})
	t.Run("古いrevisionでは提案を作成できない", func(t *testing.T) {
		staleCreatePage := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, admin, "a3", "stale-create")
		staleCreatePath := "/api/v2/kb/workspaces/" + env.slug + "/pages/" + staleCreatePage + "/suggestions"
		staleCreateContentPath := "/api/v2/kb/workspaces/" + env.slug + "/pages/" + staleCreatePage + "/content"

		// 本文を更新して content_revision を 0 → 1 に進める。
		const latestDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"最新の本文"}]}]}`
		edit := asAdmin.do(t, http.MethodPut, staleCreateContentPath, `{"doc":`+latestDoc+`}`)
		require.Equal(t, http.StatusOK, edit.Code, edit.Body.String())

		// 古い revision=0 を基準に提案しようとする。
		const suggestionDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"古い本文を基準にした提案"}]}]}`
		w := asCommenter.do(t, http.MethodPost, staleCreatePath, `{"baseRevision":0,"doc":`+suggestionDoc+`}`)

		assert.Equal(t, http.StatusConflict, w.Code, w.Body.String())
		assert.JSONEq(t, `{"error":"suggestion_stale"}`, w.Body.String())
	})
	t.Run("本文保存と提案採用が競合しても後の編集を巻き戻さない", func(t *testing.T) {
		racePage := kbInsertRootPage(t, sqlDB, env.workspaceID, env.spaceID, admin, "a4", "race")
		racePath := "/api/v2/kb/workspaces/" + env.slug + "/pages/" + racePage + "/suggestions"
		raceContentPath := "/api/v2/kb/workspaces/" + env.slug + "/pages/" + racePage + "/content"

		// revision=0 の本文を基準に提案を作る。
		const raceSuggestionDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"競合中の提案"}]}]}`
		created := asCommenter.do(t, http.MethodPost, racePath, `{"baseRevision":0,"doc":`+raceSuggestionDoc+`}`)
		require.Equal(t, http.StatusCreated, created.Code, created.Body.String())

		var createdSugg kbPageSuggestionResponse
		require.NoError(t, json.Unmarshal(created.Body.Bytes(), &createdSugg))

		// 後続の保存・採用をいったん待たせるため、テスト側で pages 行をロックする。
		lockTx, err := sqlDB.BeginTx(context.Background(), nil)
		require.NoError(t, err)
		t.Cleanup(func() {
			_ = lockTx.Rollback()
		})

		var locked int
		err = lockTx.QueryRowContext(
			context.Background(),
			`SELECT 1
		 FROM pages
		 WHERE workspace_id = $1 AND id = $2
		 FOR UPDATE`,
			env.workspaceID,
			racePage,
		).Scan(&locked)
		require.NoError(t, err)
		// 通常の本文保存を先に開始し、テスト側の行ロックで待たせる。
		const raceEditedDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"競合中に入った編集"}]}]}`

		type responseResult struct {
			code int
			body string
		}

		saveDone := make(chan responseResult, 1)
		go func() {
			w := asAdmin.do(t, http.MethodPut, raceContentPath, `{"doc":`+raceEditedDoc+`}`)
			saveDone <- responseResult{code: w.Code, body: w.Body.String()}
		}()

		// 保存処理が実際に PostgreSQL のロック待ちになったことを確認する。
		require.Eventually(t, func() bool {
			var waiting bool
			err := sqlDB.QueryRowContext(context.Background(), `
		SELECT EXISTS (
			SELECT 1
			FROM pg_stat_activity
			WHERE datname = current_database()
			  AND pid <> pg_backend_pid()
			  AND state = 'active'
			  AND wait_event_type = 'Lock'
			  AND query LIKE '%UPDATE pages%'
			  AND query LIKE '%content_revision%'
		)
	`).Scan(&waiting)

			return err == nil && waiting
		}, 2*time.Second, 10*time.Millisecond, "本文保存がページ行ロック待ちになる")
		// 保存処理が先に待っている状態で、提案の採用も開始する。
		acceptDone := make(chan responseResult, 1)
		go func() {
			w := asAdmin.do(t, http.MethodPost, racePath+"/"+createdSugg.ID+"/accept", "")
			acceptDone <- responseResult{code: w.Code, body: w.Body.String()}
		}()

		// 採用処理も pages の FOR UPDATE で待っていることを確認する。
		require.Eventually(t, func() bool {
			var waiting bool
			err := sqlDB.QueryRowContext(context.Background(), `
		SELECT EXISTS (
			SELECT 1
			FROM pg_stat_activity
			WHERE datname = current_database()
			  AND pid <> pg_backend_pid()
			  AND state = 'active'
			  AND wait_event_type = 'Lock'
			  AND query LIKE '%FOR UPDATE%'
			  AND query LIKE '%pages%'
		)
	`).Scan(&waiting)

			return err == nil && waiting
		}, 2*time.Second, 10*time.Millisecond, "提案採用がページ行ロック待ちになる")
		// テスト側のロックを解除する。
		// 先に待っていた本文保存が完了し、その後に採用処理がページをロックする。
		require.NoError(t, lockTx.Commit())

		var saveResult responseResult
		select {
		case saveResult = <-saveDone:
		case <-time.After(2 * time.Second):
			t.Fatal("本文保存が完了しなかった")
		}
		require.Equal(t, http.StatusOK, saveResult.code, saveResult.body)

		var acceptResult responseResult
		select {
		case acceptResult = <-acceptDone:
		case <-time.After(2 * time.Second):
			t.Fatal("提案採用が完了しなかった")
		}
		assert.Equal(t, http.StatusConflict, acceptResult.code, acceptResult.body)
		assert.JSONEq(t, `{"error":"suggestion_stale"}`, acceptResult.body)

		// 先に完了した本文保存が、古い提案によって巻き戻されていないことを確認する。
		page := asAdmin.do(t, http.MethodGet, env.pagePath(racePage), "")
		require.Equal(t, http.StatusOK, page.Code)
		assert.Contains(t, page.Body.String(), "競合中に入った編集")
		assert.NotContains(t, page.Body.String(), "競合中の提案")
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
		w := asFlooder.do(t, http.MethodPost, floodPath, `{"baseRevision":0,"doc":`+floodDoc+`}`)
		require.Equal(t, http.StatusCreated, w.Code, w.Body.String())

		// 21件目で上限に当たる。
		w = asFlooder.do(t, http.MethodPost, floodPath, `{"baseRevision":0,"doc":`+floodDoc+`}`)
		assert.Equal(t, http.StatusTooManyRequests, w.Code, w.Body.String())
		assert.JSONEq(t, `{"error":"too_many_open_suggestions"}`, w.Body.String())
	})

	t.Run("一覧は open な提案だけをcreated_at昇順で返す", func(t *testing.T) {
		// この時点で既に acceptedPending/rejectedPending にした 2 件は open ではないので、
		// 一覧に混ざらないことも合わせて確かめるため、ここで新たに 2 件の open な提案を作る。
		const firstDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"1件目の提案"}]}]}`
		const secondDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"2件目の提案"}]}]}`

		firstCreated := asCommenter.do(t, http.MethodPost, suggestionsPath, `{"baseRevision":1,"doc":`+firstDoc+`}`)
		require.Equal(t, http.StatusCreated, firstCreated.Code, firstCreated.Body.String())
		var first kbPageSuggestionResponse
		require.NoError(t, json.Unmarshal(firstCreated.Body.Bytes(), &first))

		secondCreated := asCommenter.do(t, http.MethodPost, suggestionsPath, `{"baseRevision":1,"doc":`+secondDoc+`}`)
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
