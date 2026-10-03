package kb

import (
	"context"
	"errors"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeAttachmentLister は bindPageAttachments が使う ListPageAttachmentsByIDs だけを持つ偽物。
// 渡された ID を記録し、rows のうちワークスペースとページが一致するものだけを返す（本物と同じ絞り方）。
type fakeAttachmentLister struct {
	rows   []domain.PageAttachment
	err    error
	gotIDs [][]string
}

func (f *fakeAttachmentLister) CreatePageAttachment(context.Context, *domain.PageAttachment) error {
	return errors.New("not used")
}

func (f *fakeAttachmentLister) FindPageAttachment(context.Context, string, string, string) (*domain.PageAttachment, error) {
	return nil, errors.New("not used")
}

func (f *fakeAttachmentLister) ListPageAttachmentsByIDs(_ context.Context, workspaceID, pageID string, ids []string) ([]domain.PageAttachment, error) {
	f.gotIDs = append(f.gotIDs, ids)
	if f.err != nil {
		return nil, f.err
	}
	want := map[string]bool{}
	for _, id := range ids {
		want[id] = true
	}
	var out []domain.PageAttachment
	for _, r := range f.rows {
		if r.WorkspaceID == workspaceID && r.PageID == pageID && want[r.ID] {
			out = append(out, r)
		}
	}
	return out, nil
}

const (
	bindWS    = "0198a000-0000-7000-8000-000000000001"
	bindPage  = "0198a000-0000-7000-8000-000000000003"
	bindOther = "0198a000-0000-7000-8000-000000000009"
	bindAtt1  = "0198a000-0000-7000-8000-0000000000c1"
	bindAtt2  = "0198a000-0000-7000-8000-0000000000c2"
)

func bindRow(id, pageID, filename string) domain.PageAttachment {
	return domain.PageAttachment{
		ID: id, WorkspaceID: bindWS, PageID: pageID, Key: "kb/" + bindWS + "/" + pageID + "/att/1.bin",
		Filename: filename, ContentType: "application/pdf", SizeBytes: 2048,
	}
}

func Test_添付の突き合わせ_このページの添付は行の値でattrsを書き直す(t *testing.T) {
	tree, err := parsePageDoc(`{"type":"doc","content":[
		{"type":"attachment","attrs":{"attachmentId":"` + bindAtt1 + `","filename":"偽.exe","size":1}},
		{"type":"callout","attrs":{"kind":"info"},"content":[
			{"type":"attachment","attrs":{"attachmentId":"` + bindAtt2 + `"}},
			{"type":"attachment","attrs":{"attachmentId":"` + bindAtt1 + `"}}
		]}
	]}`)
	require.NoError(t, err)
	repo := &fakeAttachmentLister{rows: []domain.PageAttachment{
		bindRow(bindAtt1, bindPage, "議事録.pdf"), bindRow(bindAtt2, bindPage, "見積.xlsx"),
	}}

	require.NoError(t, bindPageAttachments(context.Background(), repo, bindWS, bindPage, tree))

	want1 := `{"attachmentId":"` + bindAtt1 + `","pageId":"` + bindPage + `","filename":"議事録.pdf","contentType":"application/pdf","size":2048}`
	assert.JSONEq(t, want1, tree[0].Attrs, "書いた人の filename・size は行の値で上書きする")
	assert.JSONEq(t, `{"attachmentId":"`+bindAtt2+`","pageId":"`+bindPage+`","filename":"見積.xlsx","contentType":"application/pdf","size":2048}`,
		tree[1].Children[0].Attrs, "容器の中の添付も書き直す")
	assert.JSONEq(t, want1, tree[1].Children[1].Attrs)
	require.Len(t, repo.gotIDs, 1, "問い合わせは 1 回")
	assert.ElementsMatch(t, []string{bindAtt1, bindAtt2}, repo.gotIDs[0], "同じ ID は 1 度だけ問い合わせる")
	assert.Equal(t, "議事録.pdf\n見積.xlsx\n議事録.pdf", extractPageBodyText(tree), "本文検索にはファイル名を 1 行ずつ載せる")
}

func Test_添付の突き合わせ_このページの添付でなければ断る(t *testing.T) {
	cases := []struct {
		name string
		rows []domain.PageAttachment
	}{
		{"存在しない", nil},
		{"別のページの添付", []domain.PageAttachment{bindRow(bindAtt1, bindOther, "他.pdf")}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tree, err := parsePageDoc(`{"type":"doc","content":[{"type":"attachment","attrs":{"attachmentId":"` + bindAtt1 + `"}}]}`)
			require.NoError(t, err)
			err = bindPageAttachments(context.Background(), &fakeAttachmentLister{rows: tc.rows}, bindWS, bindPage, tree)
			require.ErrorIs(t, err, ErrPageDocUnknownAttachment)
		})
	}
}

func Test_添付の突き合わせ_1つでも知らない添付があれば全体を断る(t *testing.T) {
	tree, err := parsePageDoc(`{"type":"doc","content":[
		{"type":"attachment","attrs":{"attachmentId":"` + bindAtt1 + `"}},
		{"type":"attachment","attrs":{"attachmentId":"` + bindAtt2 + `"}}
	]}`)
	require.NoError(t, err)
	repo := &fakeAttachmentLister{rows: []domain.PageAttachment{bindRow(bindAtt1, bindPage, "議事録.pdf")}}
	require.ErrorIs(t, bindPageAttachments(context.Background(), repo, bindWS, bindPage, tree), ErrPageDocUnknownAttachment)
}

func Test_添付の突き合わせ_添付が無ければ問い合わせない(t *testing.T) {
	tree, err := parsePageDoc(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"本文"}]}]}`)
	require.NoError(t, err)
	repo := &fakeAttachmentLister{}
	require.NoError(t, bindPageAttachments(context.Background(), repo, bindWS, bindPage, tree))
	assert.Empty(t, repo.gotIDs)
}

func Test_添付の突き合わせ_取得の失敗はそのまま返す(t *testing.T) {
	tree, err := parsePageDoc(`{"type":"doc","content":[{"type":"attachment","attrs":{"attachmentId":"` + bindAtt1 + `"}}]}`)
	require.NoError(t, err)
	boom := errors.New("db down")
	err = bindPageAttachments(context.Background(), &fakeAttachmentLister{err: boom}, bindWS, bindPage, tree)
	require.ErrorIs(t, err, boom)
	assert.NotErrorIs(t, err, ErrPageDocUnknownAttachment, "取得の失敗を「知らない添付」（400）と取り違えない")
}
