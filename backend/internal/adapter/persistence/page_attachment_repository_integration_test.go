//go:build integration

package persistence_test

import (
	"context"
	"database/sql"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ページ添付（page_attachments）の repository と、本文の保存での突き合わせを実 PostgreSQL で固定する。

type pageAttachmentFixture struct {
	// db は OpenTestDB で開いた接続。OpenTestDB はテストごとに排他のロックを取るので、同じテストで
	// 2 回開くと自分のロックを待ち続けて止まる。テストの中ではこれを使い回す。
	db              *sql.DB
	ws, otherWS     string
	page, otherPage *domain.Page
	foreignPage     *domain.Page
	uploader        uint64
	uc              kbUseCases
	repo            repository.PageAttachmentRepository
}

func newPageAttachmentFixture(t *testing.T) pageAttachmentFixture {
	t.Helper()
	sqlDB := testsupport.OpenTestDB(t)
	testsupport.TruncateAll(t, sqlDB, kbTables...)
	ctx := context.Background()
	uc := newKbUseCases(sqlDB)
	ws := createWorkspace(t, sqlDB, "ws-att")
	otherWS := createWorkspace(t, sqlDB, "ws-att-other")
	space := createSpace(t, sqlDB, ws, "eng")
	otherSpace := createSpace(t, sqlDB, otherWS, "eng")
	return pageAttachmentFixture{
		db: sqlDB, ws: ws, otherWS: otherWS,
		page:        mustCreatePage(ctx, t, uc, ws, space, nil, "添付のページ"),
		otherPage:   mustCreatePage(ctx, t, uc, ws, space, nil, "同じワークスペースの別ページ"),
		foreignPage: mustCreatePage(ctx, t, uc, otherWS, otherSpace, nil, "別ワークスペースのページ"),
		uploader:    createUser(t, sqlDB, "uploader"),
		uc:          uc,
		repo:        persistence.NewPageAttachmentRepository(sqlDB),
	}
}

func (f pageAttachmentFixture) create(ctx context.Context, t *testing.T, ws string, page *domain.Page, filename string) *domain.PageAttachment {
	t.Helper()
	a := &domain.PageAttachment{
		WorkspaceID: ws, PageID: page.ID, Key: "kb/" + ws + "/" + page.ID + "/att/" + newID() + ".bin",
		Filename: filename, ContentType: "application/pdf", SizeBytes: 2048, UploadedByUserID: f.uploader,
	}
	require.NoError(t, f.repo.CreatePageAttachment(ctx, a))
	return a
}

func TestPageAttachmentRepository_Integration(t *testing.T) {
	t.Run("記録した添付をページで絞って引ける", func(t *testing.T) {
		f := newPageAttachmentFixture(t)
		ctx := context.Background()
		a := f.create(ctx, t, f.ws, f.page, "議事録.pdf")
		require.NotEmpty(t, a.ID)
		assert.False(t, a.CreatedAt.IsZero(), "created_at は DB が入れた値を返す")

		got, err := f.repo.FindPageAttachment(ctx, f.ws, f.page.ID, a.ID)
		require.NoError(t, err)
		assert.Equal(t, *a, *got)

		_, err = f.repo.FindPageAttachment(ctx, f.ws, f.otherPage.ID, a.ID)
		require.ErrorIs(t, err, repository.ErrPageAttachmentNotFound, "別のページからは見えない")
		_, err = f.repo.FindPageAttachment(ctx, f.otherWS, f.page.ID, a.ID)
		require.ErrorIs(t, err, repository.ErrPageAttachmentNotFound, "別のワークスペースからは見えない")
		_, err = f.repo.FindPageAttachment(ctx, f.ws, f.page.ID, "not-a-uuid")
		require.ErrorIs(t, err, repository.ErrPageAttachmentNotFound, "UUID でない ID は問い合わせずに無い扱い")
	})

	t.Run("ID の集まりからこのページの添付だけを返す", func(t *testing.T) {
		f := newPageAttachmentFixture(t)
		ctx := context.Background()
		mine1 := f.create(ctx, t, f.ws, f.page, "1.pdf")
		mine2 := f.create(ctx, t, f.ws, f.page, "2.pdf")
		other := f.create(ctx, t, f.ws, f.otherPage, "他.pdf")
		foreign := f.create(ctx, t, f.otherWS, f.foreignPage, "他社.pdf")

		rows, err := f.repo.ListPageAttachmentsByIDs(ctx, f.ws, f.page.ID,
			[]string{mine1.ID, other.ID, foreign.ID, "not-a-uuid", mine2.ID, newID()})
		require.NoError(t, err)
		ids := make([]string, 0, len(rows))
		for _, r := range rows {
			ids = append(ids, r.ID)
		}
		assert.ElementsMatch(t, []string{mine1.ID, mine2.ID}, ids,
			"別ページ・別ワークスペース・UUID でない・存在しない ID は返さない（読めない ID でクエリ全体を落とさない）")

		empty, err := f.repo.ListPageAttachmentsByIDs(ctx, f.ws, f.page.ID, []string{"not-a-uuid"})
		require.NoError(t, err)
		assert.Empty(t, empty)
	})

	t.Run("存在しないページ・別ワークスペースのページには記録できない", func(t *testing.T) {
		f := newPageAttachmentFixture(t)
		ctx := context.Background()
		cases := []struct{ ws, page string }{
			{f.ws, newID()},
			{f.ws, f.foreignPage.ID},
		}
		for _, c := range cases {
			err := f.repo.CreatePageAttachment(ctx, &domain.PageAttachment{
				WorkspaceID: c.ws, PageID: c.page, Key: "kb/x/att/1.bin", Filename: "a.pdf",
				ContentType: "application/pdf", SizeBytes: 1, UploadedByUserID: f.uploader,
			})
			require.ErrorIs(t, err, repository.ErrPageNotFound)
		}
	})

	t.Run("存在しないアップロード者では記録できない", func(t *testing.T) {
		f := newPageAttachmentFixture(t)
		ctx := context.Background()
		err := f.repo.CreatePageAttachment(ctx, &domain.PageAttachment{
			WorkspaceID: f.ws, PageID: f.page.ID, Key: "kb/x/att/1.bin", Filename: "a.pdf",
			ContentType: "application/pdf", SizeBytes: 1, UploadedByUserID: f.uploader + 1000,
		})
		require.ErrorIs(t, err, repository.ErrUserNotFound)
	})

	t.Run("大きさ 0・空のファイル名は表の検査が断る", func(t *testing.T) {
		f := newPageAttachmentFixture(t)
		ctx := context.Background()
		for _, a := range []*domain.PageAttachment{
			{WorkspaceID: f.ws, PageID: f.page.ID, Key: "k", Filename: "a.pdf", ContentType: "application/pdf", SizeBytes: 0, UploadedByUserID: f.uploader},
			{WorkspaceID: f.ws, PageID: f.page.ID, Key: "k", Filename: "  ", ContentType: "application/pdf", SizeBytes: 1, UploadedByUserID: f.uploader},
			{WorkspaceID: f.ws, PageID: f.page.ID, Key: "k", Filename: "a.pdf", ContentType: "", SizeBytes: 1, UploadedByUserID: f.uploader},
		} {
			require.Error(t, f.repo.CreatePageAttachment(ctx, a))
		}
	})
}

// TestPageAttachmentInBody_Integration は本文の保存での突き合わせと、本文検索の平文化を実 DB で固定する。
// 平文化は保存経路（usecase）と再構築経路（persistence）の 2 か所にあるので、両方の結果を突き合わせる。
func TestPageAttachmentInBody_Integration(t *testing.T) {
	t.Run("このページの添付は行の値で保存され、本文検索にファイル名が載る", func(t *testing.T) {
		f := newPageAttachmentFixture(t)
		ctx := context.Background()
		sqlDB := f.db
		a := f.create(ctx, t, f.ws, f.page, "四半期の見積.xlsx")
		doc := `{"type":"doc","content":[` +
			`{"type":"paragraph","content":[{"type":"text","text":"資料"}]},` +
			`{"type":"attachment","attrs":{"attachmentId":"` + a.ID + `","filename":"偽.exe","size":1}}]}`

		_, err := f.uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{WorkspaceID: f.ws, PageID: f.page.ID, Doc: doc, EditorUserID: 1})
		require.NoError(t, err)

		got, err := f.uc.get.Execute(ctx, kb.GetPageInput{WorkspaceID: f.ws, PageID: f.page.ID})
		require.NoError(t, err)
		assert.Contains(t, got.Doc, "四半期の見積.xlsx")
		assert.NotContains(t, got.Doc, "偽.exe")

		_, saved, found := queryPageSearchRow(t, sqlDB, f.page.ID)
		require.True(t, found)
		assert.Equal(t, "資料\n四半期の見積.xlsx", saved)
		require.NoError(t, f.uc.repo.RebuildPageSearchAndLinks(ctx, f.ws, f.page.ID))
		_, rebuilt, found := queryPageSearchRow(t, sqlDB, f.page.ID)
		require.True(t, found)
		assert.Equal(t, saved, rebuilt, "保存経路と再構築経路で本文が同じ")
	})

	t.Run("別ページ・別ワークスペースの添付を置くと保存を断り、本文は変わらない", func(t *testing.T) {
		f := newPageAttachmentFixture(t)
		ctx := context.Background()
		other := f.create(ctx, t, f.ws, f.otherPage, "他.pdf")
		foreign := f.create(ctx, t, f.otherWS, f.foreignPage, "他社.pdf")
		for _, id := range []string{other.ID, foreign.ID, newID()} {
			doc := `{"type":"doc","content":[{"type":"attachment","attrs":{"attachmentId":"` + id + `"}}]}`
			_, err := f.uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{WorkspaceID: f.ws, PageID: f.page.ID, Doc: doc, EditorUserID: 1})
			require.ErrorIs(t, err, kb.ErrPageDocUnknownAttachment)
		}
		got, err := f.uc.get.Execute(ctx, kb.GetPageInput{WorkspaceID: f.ws, PageID: f.page.ID})
		require.NoError(t, err)
		assert.NotContains(t, got.Doc, "attachment")
	})

	t.Run("ページを消すと添付の行も消える", func(t *testing.T) {
		f := newPageAttachmentFixture(t)
		ctx := context.Background()
		sqlDB := f.db
		a := f.create(ctx, t, f.ws, f.page, "a.pdf")
		_, err := sqlDB.Exec(`DELETE FROM pages WHERE id = $1`, f.page.ID)
		require.NoError(t, err)
		_, err = f.repo.FindPageAttachment(ctx, f.ws, f.page.ID, a.ID)
		require.ErrorIs(t, err, repository.ErrPageAttachmentNotFound)
	})
}
