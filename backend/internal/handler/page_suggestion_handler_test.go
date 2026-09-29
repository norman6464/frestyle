package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 提案 API の handler テスト。
//
// エンドポイントごとに判定の軸が違う（作成=CanComment、一覧=CanView、採用・却下=CanEdit）ため、
// kbEndpoints のような単一の表には乗せず個別に検証する（kb_page_handler_test.go の
// 登録漏れ検査には手で足してある）。

const (
	kbSuggestionsPath     = "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/suggestions"
	kbSuggestionAcceptFmt = "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/suggestions/%s/accept"
	kbSuggestionRejectFmt = "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/suggestions/%s/reject"
)

var kbCommenterPerm = domain.PagePermission{CanView: true, CanComment: true}

// Test_提案API_作成にはCanCommentが要る は、閲覧だけのユーザーが 403 になり、
// コメントできるユーザーは 201 で提案（本文含む）が返ることを固定する。
func Test_提案API_作成にはCanCommentが要る(t *testing.T) {
	t.Run("閲覧のみでは403", func(t *testing.T) {
		f := newKbFixture(kbCanView, kbUserID)
		w := f.do(t, http.MethodPost, kbSuggestionsPath, `{"baseRevision":0,"doc":`+kbValidDoc+`}`)
		assert.Equal(t, http.StatusForbidden, w.Code, w.Body.String())
	})

	t.Run("コメントできれば201", func(t *testing.T) {
		f := newKbFixture(kbCommenterPerm, kbUserID)
		w := f.do(t, http.MethodPost, kbSuggestionsPath, `{"baseRevision":0,"doc":`+kbValidDoc+`}`)
		require.Equal(t, http.StatusCreated, w.Code, w.Body.String())

		var got kbPageSuggestionResponse
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
		assert.NotEmpty(t, got.ID)
		assert.Equal(t, "open", got.Status)
		assert.Equal(t, kbUserID, got.Author.UserID)
		assert.Nil(t, got.BaseSeq, "まだ版が無いページへの提案はBaseSeqがnil")
		assert.Nil(t, got.ResolvedAt)
		assert.Contains(t, string(got.Doc), "本文")
	})
}

// Test_提案API_作成は非所属なら404 は、ワークスペースに属さないユーザーが
// middleware.KnowledgeBaseWorkspace の段で 404 に落ちることを固定する。
func Test_提案API_作成は非所属なら404(t *testing.T) {
	f := newKbFixture(kbCommenterPerm, kbOutsiderUserID)
	w := f.do(t, http.MethodPost, kbSuggestionsPath, `{"baseRevision":0,"doc":`+kbValidDoc+`}`)
	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.JSONEq(t, `{"error":"not_found"}`, w.Body.String())
}

// Test_提案API_作成で不正なdocは400 は、壊れた JSON が ReplacePageBlocksUseCase と同じ
// invalid_document 応答に落ちることを固定する。
func Test_提案API_作成で不正なdocは400(t *testing.T) {
	f := newKbFixture(kbCommenterPerm, kbUserID)
	w := f.do(t, http.MethodPost, kbSuggestionsPath, `{"baseRevision":0,"doc":{"type":"paragraph"}}`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.JSONEq(t, `{"error":"invalid_document"}`, w.Body.String())
}

// Test_提案API_作成でbaseSeqとbaseDocが版を指す は、既に版があるページへの提案が
// その版の seq を BaseSeq にし、応答の BaseDoc にその版の本文が乗ることを固定する。
func Test_提案API_作成でbaseSeqとbaseDocが版を指す(t *testing.T) {
	f := newKbFixture(kbCommenterPerm, kbUserID)
	_, v, err := f.versions.CreateVersionIfDue(context.Background(), kbWorkspaceID, kbChildPageID, kbValidDoc, kbUserID, nil, true)
	require.NoError(t, err)
	require.NotNil(t, v)

	w := f.do(t, http.MethodPost, kbSuggestionsPath, `{"baseRevision":0,"doc":`+kbValidDoc+`}`)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())

	var got kbPageSuggestionResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
	require.NotNil(t, got.BaseSeq)
	assert.Equal(t, v.Seq, *got.BaseSeq)
	assert.NotEmpty(t, got.BaseDoc)
}

// Test_提案API_一覧はCanViewだけで読める は、一覧が CanComment を要求しない
// （viewer でも既存の提案は読める）ことを固定する。
func Test_提案API_一覧はCanViewだけで読める(t *testing.T) {
	f := newKbFixture(kbCanView, kbUserID)
	seeded := &domain.PageSuggestion{WorkspaceID: kbWorkspaceID, PageID: kbChildPageID, Doc: kbValidDoc, AuthorUserID: kbUserID}
	require.NoError(t, f.suggestions.Create(context.Background(), seeded))

	w := f.do(t, http.MethodGet, kbSuggestionsPath, "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var got []kbPageSuggestionResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
	require.Len(t, got, 1)
	assert.Equal(t, seeded.ID, got[0].ID)
}

// Test_提案API_一覧は0件でも空配列 は、null ではなく [] が返ることを固定する
// （フロントの .map が落ちないように）。
func Test_提案API_一覧は0件でも空配列(t *testing.T) {
	f := newKbFixture(kbCanView, kbUserID)
	w := f.do(t, http.MethodGet, kbSuggestionsPath, "")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.JSONEq(t, `[]`, w.Body.String())
}

// Test_提案API_一覧は非所属なら404 は Test_提案API_作成は非所属なら404 と同じ形。
func Test_提案API_一覧は非所属なら404(t *testing.T) {
	f := newKbFixture(kbCommenterPerm, kbOutsiderUserID)
	w := f.do(t, http.MethodGet, kbSuggestionsPath, "")
	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.JSONEq(t, `{"error":"not_found"}`, w.Body.String())
}

// Test_提案API_採用にはCanEditが要る は、コメントできるだけの相手（editor未満）が 403 になり、
// 編集できる相手は 200 で本文へ反映されることを固定する。
func Test_提案API_採用にはCanEditが要る(t *testing.T) {
	t.Run("コメントできるだけでは403", func(t *testing.T) {
		f := newKbFixture(kbCommenterPerm, kbUserID)
		seeded := &domain.PageSuggestion{WorkspaceID: kbWorkspaceID, PageID: kbChildPageID, Doc: kbValidDoc, AuthorUserID: kbUserID}
		require.NoError(t, f.suggestions.Create(context.Background(), seeded))

		w := f.do(t, http.MethodPost, kbSuggestionAccept(seeded.ID), "")
		assert.Equal(t, http.StatusForbidden, w.Code, w.Body.String())
	})

	t.Run("編集できれば200で本文へ反映される", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		const suggestedDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"採用後の本文"}]}]}`
		baseRevision := int64(0)
		seeded := &domain.PageSuggestion{
			WorkspaceID:  kbWorkspaceID,
			PageID:       kbChildPageID,
			BaseRevision: &baseRevision,
			Doc:          suggestedDoc,
			AuthorUserID: 99,
		}
		require.NoError(t, f.suggestions.Create(context.Background(), seeded))

		w := f.do(t, http.MethodPost, kbSuggestionAccept(seeded.ID), "")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())

		var got kbPageSuggestionResponse
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
		assert.Equal(t, "accepted", got.Status)
		require.NotNil(t, got.ResolvedBy)
		assert.Equal(t, kbUserID, got.ResolvedBy.UserID)
		require.NotNil(t, got.ResolvedAt)

		page := f.do(t, http.MethodGet, "/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID, "")
		require.Equal(t, http.StatusOK, page.Code)
		assert.Contains(t, page.Body.String(), "採用後の本文", "採用した提案のdocが本文へ反映される")
	})
}

// Test_提案API_却下にはCanEditが要る は、却下が本文を一切変えないことを固定する。
func Test_提案API_却下にはCanEditが要る(t *testing.T) {
	t.Run("コメントできるだけでは403", func(t *testing.T) {
		f := newKbFixture(kbCommenterPerm, kbUserID)
		seeded := &domain.PageSuggestion{WorkspaceID: kbWorkspaceID, PageID: kbChildPageID, Doc: kbValidDoc, AuthorUserID: kbUserID}
		require.NoError(t, f.suggestions.Create(context.Background(), seeded))

		w := f.do(t, http.MethodPost, kbSuggestionReject(seeded.ID), "")
		assert.Equal(t, http.StatusForbidden, w.Code, w.Body.String())
	})

	t.Run("編集できれば200で本文は変わらない", func(t *testing.T) {
		f := newKbFixture(kbCanEdit, kbUserID)
		before := f.do(t, http.MethodGet, "/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID, "")
		require.Equal(t, http.StatusOK, before.Code)

		const suggestedDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"却下される本文"}]}]}`
		seeded := &domain.PageSuggestion{WorkspaceID: kbWorkspaceID, PageID: kbChildPageID, Doc: suggestedDoc, AuthorUserID: 99}
		require.NoError(t, f.suggestions.Create(context.Background(), seeded))

		w := f.do(t, http.MethodPost, kbSuggestionReject(seeded.ID), "")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())

		var got kbPageSuggestionResponse
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
		assert.Equal(t, "rejected", got.Status)

		after := f.do(t, http.MethodGet, "/api/v2/kb/workspaces/"+kbWorkspaceSlug+"/pages/"+kbChildPageID, "")
		require.Equal(t, http.StatusOK, after.Code)
		assert.Equal(t, before.Body.String(), after.Body.String(), "却下は本文を一切変えない")
		assert.NotContains(t, after.Body.String(), "却下される本文")
	})
}

// Test_提案API_採用で存在しない提案は404 は domain.ErrPageSuggestionNotFound の応答を固定する。
func Test_提案API_採用で存在しない提案は404(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	w := f.do(t, http.MethodPost, kbSuggestionAccept("00000000-0000-7000-8000-000000000000"), "")
	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.JSONEq(t, `{"error":"not_found"}`, w.Body.String())
}

// Test_提案API_既に解決済みの提案への操作は409 は domain.ErrPageSuggestionAlreadyResolved の
// 応答を固定する（同時に 2 人が採用・却下を叩いても片方しか成功しない）。
func Test_提案API_既に解決済みの提案への操作は409(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	baseRevision := int64(0)
	seeded := &domain.PageSuggestion{
		WorkspaceID:  kbWorkspaceID,
		PageID:       kbChildPageID,
		BaseRevision: &baseRevision,
		Doc:          kbValidDoc,
		AuthorUserID: 1,
	}
	require.NoError(t, f.suggestions.Create(context.Background(), seeded))

	first := f.do(t, http.MethodPost, kbSuggestionAccept(seeded.ID), "")
	require.Equal(t, http.StatusOK, first.Code, first.Body.String())

	second := f.do(t, http.MethodPost, kbSuggestionReject(seeded.ID), "")
	assert.Equal(t, http.StatusConflict, second.Code)
	assert.JSONEq(t, `{"error":"suggestion_already_resolved"}`, second.Body.String())
}

// Test_提案API_commenterは本文を直接書けない は、CanEdit を持たない相手が本文の直接置き換え
// （PUT .../content）を叩いても 403 になることを固定する — 提案の設計が前提とする
// 「commenter は blocks へ直接書けない」を、既存のエンドポイントの認可がそのまま守っている
// ことの確認。
func Test_提案API_commenterは本文を直接書けない(t *testing.T) {
	f := newKbFixture(kbCommenterPerm, kbUserID)
	path := "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + kbChildPageID + "/content"
	w := f.do(t, http.MethodPut, path, `{"doc":`+kbValidDoc+`}`)
	assert.Equal(t, http.StatusForbidden, w.Code, w.Body.String())
}

func kbSuggestionAccept(suggestionID string) string {
	return fmt.Sprintf(kbSuggestionAcceptFmt, suggestionID)
}

func kbSuggestionReject(suggestionID string) string {
	return fmt.Sprintf(kbSuggestionRejectFmt, suggestionID)
}
