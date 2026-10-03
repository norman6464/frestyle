package handler

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/handler/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ページ添付の口（アップロード URL の発行 → 記録 → 本文へ置く → ダウンロード URL の発行）を
// HTTP の端から端まで固定する。認可（編集・閲覧・テナント）は kbEndpoints の総当たりが見る。

func kbAttachmentBase(pageID string) string {
	return "/api/v2/kb/workspaces/" + kbWorkspaceSlug + "/pages/" + pageID
}

func Test_ナレッジ添付_アップロードから本文へ置いてダウンロードするまで(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	base := kbAttachmentBase(kbRootPageID)

	// 1. アップロード URL。key はこのページの att/ の下。
	upload := f.do(t, http.MethodPost, base+"/attachments/upload-url", `{"contentType":"application/pdf","size":2048}`)
	require.Equal(t, http.StatusOK, upload.Code, "body=%s", upload.Body.String())
	var uploadResp dto.PageAttachmentUploadURLResponse
	require.NoError(t, json.Unmarshal(upload.Body.Bytes(), &uploadResp))
	assert.True(t, strings.HasPrefix(uploadResp.Key, "kb/"+kbWorkspaceID+"/"+kbRootPageID+"/att/"), "key=%s", uploadResp.Key)

	// 2. 記録。応答に id と表示の値が載り、保管庫の key は載らない。
	created := f.do(t, http.MethodPost, base+"/attachments",
		`{"key":"`+uploadResp.Key+`","filename":"議事録 10月.pdf","contentType":"application/pdf","sizeBytes":2048}`)
	require.Equal(t, http.StatusCreated, created.Code, "body=%s", created.Body.String())
	assert.NotContains(t, created.Body.String(), uploadResp.Key, "key は応答に出さない")
	var att dto.PageAttachmentResponse
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &att))
	assert.NotEmpty(t, att.ID)
	assert.Equal(t, kbRootPageID, att.PageID)
	assert.Equal(t, "議事録 10月.pdf", att.Filename)
	assert.Equal(t, int64(2048), att.SizeBytes)

	// 3. 本文へ置く。書いた人の filename ではなく、記録した値で保存される。
	doc := `{"type":"doc","content":[{"type":"attachment","attrs":{"attachmentId":"` + att.ID + `","filename":"偽.exe"}}]}`
	saved := f.do(t, http.MethodPut, base+"/content", `{"doc":`+doc+`}`)
	require.Equal(t, http.StatusOK, saved.Code, "body=%s", saved.Body.String())
	got := f.do(t, http.MethodGet, base, "")
	require.Equal(t, http.StatusOK, got.Code)
	assert.Contains(t, got.Body.String(), `議事録 10月.pdf`)
	assert.NotContains(t, got.Body.String(), "偽.exe")

	// 4. ダウンロード URL。元のファイル名で保存させる指定が載る（fake は保存名を query に写す）。
	download := f.do(t, http.MethodGet, base+"/attachments/"+att.ID+"/download-url", "")
	require.Equal(t, http.StatusOK, download.Code, "body=%s", download.Body.String())
	var downloadResp dto.PageAttachmentDownloadURLResponse
	require.NoError(t, json.Unmarshal(download.Body.Bytes(), &downloadResp))
	u, err := url.Parse(downloadResp.URL)
	require.NoError(t, err)
	assert.Equal(t, "議事録 10月.pdf", u.Query().Get("filename"))
	assert.Contains(t, u.Path, uploadResp.Key)
}

func Test_ナレッジ添付_別のページの添付はダウンロードできない(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	// kbAttachmentID は子ページの添付。閲覧できる別のページ（root）から指す。
	w := f.do(t, http.MethodGet, kbAttachmentBase(kbRootPageID)+"/attachments/"+kbAttachmentID+"/download-url", "")
	assert.Equal(t, http.StatusNotFound, w.Code, "body=%s", w.Body.String())
	assert.JSONEq(t, `{"error":"not_found"}`, w.Body.String())
}

func Test_ナレッジ添付_別のページの添付を本文に置くと保存を断る(t *testing.T) {
	f := newKbFixture(kbCanEdit, kbUserID)
	doc := `{"type":"doc","content":[{"type":"attachment","attrs":{"attachmentId":"` + kbAttachmentID + `"}}]}`
	w := f.do(t, http.MethodPut, kbAttachmentBase(kbRootPageID)+"/content", `{"doc":`+doc+`}`)
	assert.Equal(t, http.StatusBadRequest, w.Code, "body=%s", w.Body.String())
	assert.JSONEq(t, `{"error":"unknown_attachment"}`, w.Body.String(), "画面が理由を出せるよう、文書の形の誤りとは別の理由で返す")
}

func Test_ナレッジ添付_入力の検証(t *testing.T) {
	base := kbAttachmentBase(kbChildPageID)
	cases := []struct {
		name   string
		method string
		path   string
		body   string
		status int
		error  string
	}{
		{"html は送れない", http.MethodPost, base + "/attachments/upload-url", `{"contentType":"text/html","size":10}`, http.StatusBadRequest, "unsupported_content_type"},
		{"svg は送れない", http.MethodPost, base + "/attachments/upload-url", `{"contentType":"image/svg+xml","size":10}`, http.StatusBadRequest, "unsupported_content_type"},
		{"25MiB を超えると送れない", http.MethodPost, base + "/attachments/upload-url", `{"contentType":"application/pdf","size":26214401}`, http.StatusBadRequest, "attachment_too_large"},
		{"大きさが無い", http.MethodPost, base + "/attachments/upload-url", `{"contentType":"application/pdf"}`, http.StatusBadRequest, "invalid_request"},
		{
			"別のページの key は記録できない", http.MethodPost, base + "/attachments",
			`{"key":"kb/` + kbWorkspaceID + `/` + kbRootPageID + `/att/1.bin","filename":"a.pdf","contentType":"application/pdf","sizeBytes":10}`,
			http.StatusBadRequest, "invalid_attachment_key",
		},
		{
			"ファイル名が空白で囲まれている", http.MethodPost, base + "/attachments",
			`{"key":"kb/` + kbWorkspaceID + `/` + kbChildPageID + `/att/1.bin","filename":" a.pdf","contentType":"application/pdf","sizeBytes":10}`,
			http.StatusBadRequest, "invalid_request",
		},
		{
			"html は記録できない", http.MethodPost, base + "/attachments",
			`{"key":"kb/` + kbWorkspaceID + `/` + kbChildPageID + `/att/1.bin","filename":"a.html","contentType":"text/html","sizeBytes":10}`,
			http.StatusBadRequest, "unsupported_content_type",
		},
		{"存在しない添付", http.MethodGet, base + "/attachments/0198a000-0000-7000-8000-00000000beef/download-url", "", http.StatusNotFound, "not_found"},
		{"UUID でない添付 ID", http.MethodGet, base + "/attachments/not-a-uuid/download-url", "", http.StatusNotFound, "not_found"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newKbFixture(kbCanEdit, kbUserID)
			w := f.do(t, tc.method, tc.path, tc.body)
			assert.Equal(t, tc.status, w.Code, "body=%s", w.Body.String())
			assert.JSONEq(t, `{"error":"`+tc.error+`"}`, w.Body.String())
		})
	}
}
