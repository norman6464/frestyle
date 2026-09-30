//go:build integration

package persistence_test

import (
	"context"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/comment"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// commentTables は comment_threads / comments を含めたナレッジのテーブル（TRUNCATE 対象）。
// kbTables（knowledge_base_schema_integration_test.go）に comment_threads / comments を
// 加えたもの。子から先に並べる。
var commentTables = []string{
	"comments", "comment_threads",
	"space_grants", "workspace_grants",
	"principal_members", "principals",
	"blocks", "page_paths", "page_snapshots", "pages", "spaces", "workspaces",
}

// TestCommentRepository_Integration は comment_threads / comments に対する repository の
// 実装と、schema.hcl が張る制約（FK の ON DELETE / CHECK）を実 Postgres で固定する。
func TestCommentRepository_Integration(t *testing.T) {
	db := testsupport.OpenTestDB(t)
	ctx := context.Background()

	t.Run("スレッド作成→取得→一覧で内容が一致する", func(t *testing.T) {
		testsupport.TruncateAll(t, db, commentTables...)
		repo := persistence.NewCommentRepository(db)
		ws := createWorkspace(t, db, "ws-comment-1")
		space := createSpace(t, db, ws, "eng")
		page := createPage(t, db, ws, space, nil, "a0")

		thread, err := repo.CreateCommentThread(ctx, ws, page, 42, repository.CommentAnchor{})
		require.NoError(t, err)
		assert.Equal(t, ws, thread.WorkspaceID)
		assert.Equal(t, page, thread.PageID)
		assert.Equal(t, uint64(42), thread.CreatedByUserID)
		assert.Nil(t, thread.BlockID, "書き込み経路は本文だけを受け取るので block_id は常に nil")
		assert.Nil(t, thread.AnchorFrom)
		assert.Nil(t, thread.ResolvedAt)

		body := `[{"type":"text","text":"最初の発言"}]`
		c, err := repo.CreateComment(ctx, thread.ID, 42, body)
		require.NoError(t, err)
		assert.Equal(t, thread.ID, c.ThreadID)
		assert.JSONEq(t, body, c.Body)

		got, err := repo.GetCommentThread(ctx, ws, page, thread.ID)
		require.NoError(t, err)
		assert.Equal(t, thread.ID, got.ID)

		list, err := repo.ListCommentThreadsByPage(ctx, ws, page)
		require.NoError(t, err)
		require.Len(t, list, 1)
		assert.Equal(t, thread.ID, list[0].ID)

		comments, err := repo.ListCommentsByThreads(ctx, []string{thread.ID})
		require.NoError(t, err)
		require.Len(t, comments, 1)
		assert.Equal(t, c.ID, comments[0].ID)
	})

	t.Run("別テナントのthread_idはErrCommentThreadNotFound", func(t *testing.T) {
		testsupport.TruncateAll(t, db, commentTables...)
		repo := persistence.NewCommentRepository(db)
		wsA := createWorkspace(t, db, "ws-comment-a")
		spaceA := createSpace(t, db, wsA, "eng")
		pageA := createPage(t, db, wsA, spaceA, nil, "a0")
		wsB := createWorkspace(t, db, "ws-comment-b")
		spaceB := createSpace(t, db, wsB, "eng")
		pageB := createPage(t, db, wsB, spaceB, nil, "a0")

		thread, err := repo.CreateCommentThread(ctx, wsA, pageA, 1, repository.CommentAnchor{})
		require.NoError(t, err)

		// 別ワークスペースの workspace_id で引く。
		_, err = repo.GetCommentThread(ctx, wsB, pageB, thread.ID)
		assert.ErrorIs(t, err, repository.ErrCommentThreadNotFound)

		// Resolve/Reopen も同じ WHERE 句（workspace_id AND page_id AND id）で絞っている
		// ので、実在する別テナントの thread_id を渡しても書き換わらず ErrCommentThreadNotFound
		// になることを、乱数の存在しない ID ではなく実在する thread.ID で確かめる
		// （comment.sql の ResolveCommentThread / ReopenCommentThread の WHERE 句を固定する）。
		_, err = repo.ResolveCommentThread(ctx, wsB, pageB, thread.ID, 99)
		assert.ErrorIs(t, err, repository.ErrCommentThreadNotFound, "別テナントの実在thread_idはResolveできない")

		_, err = repo.ReopenCommentThread(ctx, wsB, pageB, thread.ID)
		assert.ErrorIs(t, err, repository.ErrCommentThreadNotFound, "別テナントの実在thread_idはReopenできない")

		// 元のテナント・ページからは変わらず届く（漏れなく絞っているだけで、壊れてはいない）。
		got, err := repo.GetCommentThread(ctx, wsA, pageA, thread.ID)
		require.NoError(t, err)
		assert.Equal(t, thread.ID, got.ID)
	})

	t.Run("同一workspace内の別ページのthread_idもErrCommentThreadNotFound", func(t *testing.T) {
		testsupport.TruncateAll(t, db, commentTables...)
		repo := persistence.NewCommentRepository(db)
		ws := createWorkspace(t, db, "ws-comment-2")
		space := createSpace(t, db, ws, "eng")
		page1 := createPage(t, db, ws, space, nil, "a0")
		page2 := createPage(t, db, ws, space, nil, "a1")

		thread, err := repo.CreateCommentThread(ctx, ws, page1, 1, repository.CommentAnchor{})
		require.NoError(t, err)

		_, err = repo.GetCommentThread(ctx, ws, page2, thread.ID)
		assert.ErrorIs(t, err, repository.ErrCommentThreadNotFound)

		// 同一テナント内でも page_id がずれれば Resolve/Reopen も届かない
		// （page_id を WHERE から抜くと隣のページの thread_id を知るだけで解決できてしまう）。
		_, err = repo.ResolveCommentThread(ctx, ws, page2, thread.ID, 99)
		assert.ErrorIs(t, err, repository.ErrCommentThreadNotFound, "別ページの実在thread_idはResolveできない")

		_, err = repo.ReopenCommentThread(ctx, ws, page2, thread.ID)
		assert.ErrorIs(t, err, repository.ErrCommentThreadNotFound, "別ページの実在thread_idはReopenできない")
	})

	// ブロックを削除すると、そのブロックを block_id に持つスレッドの block_id が NULL に
	// 落ちる（quote は触られない）ことを ON DELETE SET NULL の直接証拠として確認する。
	// このPRでは block_id を書き込む経路が無いので、SQL を直接叩いて block_id ありの
	// スレッドをテスト用に作ってから検証する。
	t.Run("ブロック削除でblock_idがNULLに落ちる_quoteは残る", func(t *testing.T) {
		testsupport.TruncateAll(t, db, commentTables...)
		ws := createWorkspace(t, db, "ws-comment-3")
		space := createSpace(t, db, ws, "eng")
		page := createPage(t, db, ws, space, nil, "a0")
		block := createBlock(t, db, ws, page, nil, "a0", domain.BlockTypeParagraph)

		threadID := newID()
		const quote = "錨付けされた引用文"
		_, err := db.Exec(
			`INSERT INTO comment_threads (id, workspace_id, page_id, block_id, quote, created_by_user_id)
			 VALUES ($1, $2, $3, $4, $5, 1)`,
			threadID, ws, page, block, quote,
		)
		require.NoError(t, err)

		_, err = db.Exec(`DELETE FROM blocks WHERE id = $1`, block)
		require.NoError(t, err)

		var blockID *string
		var gotQuote string
		require.NoError(t, db.QueryRow(
			`SELECT block_id::text, quote FROM comment_threads WHERE id = $1`, threadID,
		).Scan(&blockID, &gotQuote))
		assert.Nil(t, blockID, "ブロックが消えたら block_id は NULL に落ちる")
		assert.Equal(t, quote, gotQuote, "quote はブロック削除で触られない")
	})

	t.Run("anchor_from_anchor_toは片方だけの指定をCHECKで拒否する", func(t *testing.T) {
		testsupport.TruncateAll(t, db, commentTables...)
		ws := createWorkspace(t, db, "ws-comment-4")
		space := createSpace(t, db, ws, "eng")
		page := createPage(t, db, ws, space, nil, "a0")

		_, err := db.Exec(
			`INSERT INTO comment_threads (id, workspace_id, page_id, anchor_from, created_by_user_id)
			 VALUES ($1, $2, $3, 0, 1)`,
			newID(), ws, page,
		)
		requirePgError(t, err, sqlStateCheckViolation, "ck_comment_threads_anchor_pair")

		_, err = db.Exec(
			`INSERT INTO comment_threads (id, workspace_id, page_id, anchor_to, created_by_user_id)
			 VALUES ($1, $2, $3, 10, 1)`,
			newID(), ws, page,
		)
		requirePgError(t, err, sqlStateCheckViolation, "ck_comment_threads_anchor_pair")

		// 両方指定すれば通る。
		_, err = db.Exec(
			`INSERT INTO comment_threads (id, workspace_id, page_id, anchor_from, anchor_to, created_by_user_id)
			 VALUES ($1, $2, $3, 0, 10, 1)`,
			newID(), ws, page,
		)
		require.NoError(t, err)
	})

	t.Run("resolved_at_resolved_by_user_idは片方だけの指定をCHECKで拒否する", func(t *testing.T) {
		testsupport.TruncateAll(t, db, commentTables...)
		ws := createWorkspace(t, db, "ws-comment-5")
		space := createSpace(t, db, ws, "eng")
		page := createPage(t, db, ws, space, nil, "a0")

		_, err := db.Exec(
			`INSERT INTO comment_threads (id, workspace_id, page_id, resolved_at, created_by_user_id)
			 VALUES ($1, $2, $3, now(), 1)`,
			newID(), ws, page,
		)
		requirePgError(t, err, sqlStateCheckViolation, "ck_comment_threads_resolved_pair")

		_, err = db.Exec(
			`INSERT INTO comment_threads (id, workspace_id, page_id, resolved_by_user_id, created_by_user_id)
			 VALUES ($1, $2, $3, 1, 1)`,
			newID(), ws, page,
		)
		requirePgError(t, err, sqlStateCheckViolation, "ck_comment_threads_resolved_pair")
	})

	t.Run("resolveとreopenで往復できる", func(t *testing.T) {
		testsupport.TruncateAll(t, db, commentTables...)
		repo := persistence.NewCommentRepository(db)
		ws := createWorkspace(t, db, "ws-comment-6")
		space := createSpace(t, db, ws, "eng")
		page := createPage(t, db, ws, space, nil, "a0")
		thread, err := repo.CreateCommentThread(ctx, ws, page, 1, repository.CommentAnchor{})
		require.NoError(t, err)

		resolved, err := repo.ResolveCommentThread(ctx, ws, page, thread.ID, 99)
		require.NoError(t, err)
		require.NotNil(t, resolved.ResolvedAt)
		require.NotNil(t, resolved.ResolvedByUserID)
		assert.Equal(t, uint64(99), *resolved.ResolvedByUserID)
		assert.True(t, resolved.Resolved())

		reopened, err := repo.ReopenCommentThread(ctx, ws, page, thread.ID)
		require.NoError(t, err)
		assert.Nil(t, reopened.ResolvedAt)
		assert.Nil(t, reopened.ResolvedByUserID)
		assert.False(t, reopened.Resolved())
	})

	t.Run("対象が無ければResolveもReopenもErrCommentThreadNotFound", func(t *testing.T) {
		testsupport.TruncateAll(t, db, commentTables...)
		repo := persistence.NewCommentRepository(db)
		ws := createWorkspace(t, db, "ws-comment-7")
		space := createSpace(t, db, ws, "eng")
		page := createPage(t, db, ws, space, nil, "a0")

		_, err := repo.ResolveCommentThread(ctx, ws, page, newID(), 1)
		assert.ErrorIs(t, err, repository.ErrCommentThreadNotFound)

		_, err = repo.ReopenCommentThread(ctx, ws, page, newID())
		assert.ErrorIs(t, err, repository.ErrCommentThreadNotFound)
	})

	t.Run("ページ削除でcomment_threadsとcommentsがCASCADEで消える", func(t *testing.T) {
		testsupport.TruncateAll(t, db, commentTables...)
		repo := persistence.NewCommentRepository(db)
		ws := createWorkspace(t, db, "ws-comment-8")
		space := createSpace(t, db, ws, "eng")
		page := createPage(t, db, ws, space, nil, "a0")
		thread, err := repo.CreateCommentThread(ctx, ws, page, 1, repository.CommentAnchor{})
		require.NoError(t, err)
		_, err = repo.CreateComment(ctx, thread.ID, 1, `[{"type":"text","text":"hi"}]`)
		require.NoError(t, err)

		_, err = db.Exec(`DELETE FROM pages WHERE id = $1`, page)
		require.NoError(t, err)

		var threadCount, commentCount int
		require.NoError(t, db.QueryRow(`SELECT count(*) FROM comment_threads WHERE id = $1`, thread.ID).Scan(&threadCount))
		require.NoError(t, db.QueryRow(`SELECT count(*) FROM comments WHERE thread_id = $1`, thread.ID).Scan(&commentCount))
		assert.Zero(t, threadCount, "ページが消えたら comment_threads も CASCADE で消える")
		assert.Zero(t, commentCount, "スレッドが消えたら comments も CASCADE で消える")
	})

	// ここから FRESTYLE-432 段 3（錨付きコメント）。書き込み経路（CreateCommentThread への
	// anchor 引数）が今回のPRで開くので、以降のテストは repo 経由でスレッドを作る
	// （上の「ブロック削除でblock_idがNULLに落ちる」テストのように SQL を直接叩く必要がない）。

	t.Run("錨付きスレッドを作成して取得すると4フィールドが正しく往復する", func(t *testing.T) {
		testsupport.TruncateAll(t, db, commentTables...)
		repo := persistence.NewCommentRepository(db)
		ws := createWorkspace(t, db, "ws-comment-anchor-1")
		space := createSpace(t, db, ws, "eng")
		page := createPage(t, db, ws, space, nil, "a0")
		block := createBlock(t, db, ws, page, nil, "a0", domain.BlockTypeParagraph)

		from, to := 3, 12
		quote := "錨付けされた引用文"
		anchor := repository.CommentAnchor{BlockID: &block, AnchorFrom: &from, AnchorTo: &to, Quote: &quote}

		created, err := repo.CreateCommentThread(ctx, ws, page, 7, anchor)
		require.NoError(t, err)
		require.NotNil(t, created.BlockID)
		assert.Equal(t, block, *created.BlockID)
		require.NotNil(t, created.AnchorFrom)
		assert.Equal(t, from, *created.AnchorFrom)
		require.NotNil(t, created.AnchorTo)
		assert.Equal(t, to, *created.AnchorTo)
		require.NotNil(t, created.Quote)
		assert.Equal(t, quote, *created.Quote)

		got, err := repo.GetCommentThread(ctx, ws, page, created.ID)
		require.NoError(t, err)
		require.NotNil(t, got.BlockID)
		assert.Equal(t, block, *got.BlockID)
		require.NotNil(t, got.AnchorFrom)
		assert.Equal(t, from, *got.AnchorFrom)
		require.NotNil(t, got.AnchorTo)
		assert.Equal(t, to, *got.AnchorTo)
		require.NotNil(t, got.Quote)
		assert.Equal(t, quote, *got.Quote)

		// 一覧経由（ListCommentThreadsByPage）でも同じ4フィールドが往復することを確かめる。
		// GetCommentThread（1件）と ListCommentThreadsByPage（一覧）は別クエリなので、
		// 一覧側だけ列の取りこぼしがあってもコンパイルは通る — CodeRabbit 指摘。
		listed, err := repo.ListCommentThreadsByPage(ctx, ws, page)
		require.NoError(t, err)
		require.Len(t, listed, 1)
		require.NotNil(t, listed[0].BlockID)
		assert.Equal(t, block, *listed[0].BlockID)
		require.NotNil(t, listed[0].AnchorFrom)
		assert.Equal(t, from, *listed[0].AnchorFrom)
		require.NotNil(t, listed[0].AnchorTo)
		assert.Equal(t, to, *listed[0].AnchorTo)
		require.NotNil(t, listed[0].Quote)
		assert.Equal(t, quote, *listed[0].Quote)
	})

	t.Run("作成とほぼ同時にブロックが削除される競合はinvalid_comment_anchorに翻訳される", func(t *testing.T) {
		// usecase の BlockExistsInPage チェックと、この INSERT の間でブロックが削除される
		// レース（TOCTOU・CodeRabbit 指摘）を、実際の外部キー違反を踏んで確かめる。
		// 事前チェックを経由しない repo 直呼びで「チェック通過後にブロックが消えた」状況を
		// 再現する（存在しないIDへのすり替えではなく、実際に作って実際に消したブロック）。
		testsupport.TruncateAll(t, db, commentTables...)
		repo := persistence.NewCommentRepository(db)
		ws := createWorkspace(t, db, "ws-comment-anchor-race")
		space := createSpace(t, db, ws, "eng")
		page := createPage(t, db, ws, space, nil, "a0")
		block := createBlock(t, db, ws, page, nil, "a0", domain.BlockTypeParagraph)

		_, err := db.Exec(`DELETE FROM blocks WHERE id = $1`, block)
		require.NoError(t, err)

		from, to := 0, 5
		quote := "消えた直後のブロックへの錨"
		anchor := repository.CommentAnchor{BlockID: &block, AnchorFrom: &from, AnchorTo: &to, Quote: &quote}

		_, err = repo.CreateCommentThread(ctx, ws, page, 7, anchor)
		require.ErrorIs(t, err, domain.ErrInvalidCommentAnchor)
	})

	t.Run("BlockExistsInPageは同じworkspace_id_page_idのブロックだけtrueを返す", func(t *testing.T) {
		testsupport.TruncateAll(t, db, commentTables...)
		repo := persistence.NewCommentRepository(db)
		wsA := createWorkspace(t, db, "ws-comment-anchor-2a")
		spaceA := createSpace(t, db, wsA, "eng")
		pageA := createPage(t, db, wsA, spaceA, nil, "a0")
		blockA := createBlock(t, db, wsA, pageA, nil, "a0", domain.BlockTypeParagraph)

		wsB := createWorkspace(t, db, "ws-comment-anchor-2b")
		spaceB := createSpace(t, db, wsB, "eng")
		pageB := createPage(t, db, wsB, spaceB, nil, "a0")

		exists, err := repo.BlockExistsInPage(ctx, wsA, pageA, blockA)
		require.NoError(t, err)
		assert.True(t, exists, "自分のworkspace/pageに実在するブロックはtrue")

		exists, err = repo.BlockExistsInPage(ctx, wsB, pageB, blockA)
		require.NoError(t, err)
		assert.False(t, exists, "別ページに実在するブロックはfalse（id単独では実在扱いにしない）")

		exists, err = repo.BlockExistsInPage(ctx, wsA, pageA, newID())
		require.NoError(t, err)
		assert.False(t, exists, "存在しないIDはfalse")
	})

	// 他ページの実在する block_id を錨に指定した書き込みが拒否されることは、PR1の
	// ErrBlockIDConflict（ListExistingBlockIDsAmong）と同種のテナント越え防止で、この
	// PR の核心。BlockExistsInPage を repo 単体で見るだけでなく、usecase まで通して
	// domain.ErrInvalidCommentAnchor が実際に返ることを確認する（存在しないIDでの拒否とは
	// 別物 — こちらは「実在するが持ち主が違う」ケース）。
	t.Run("他ページの実在するblock_idを錨に指定するとErrInvalidCommentAnchorで拒否される", func(t *testing.T) {
		testsupport.TruncateAll(t, db, commentTables...)
		repo := persistence.NewCommentRepository(db)
		txManager := persistence.NewTxManager(db)
		uc := comment.NewCreateCommentThreadUseCase(repo, txManager)

		ws := createWorkspace(t, db, "ws-comment-anchor-3")
		space := createSpace(t, db, ws, "eng")
		pageOwner := createPage(t, db, ws, space, nil, "a0")
		blockOnOtherPage := createBlock(t, db, ws, pageOwner, nil, "a0", domain.BlockTypeParagraph)
		pageVictim := createPage(t, db, ws, space, nil, "a1")

		from, to := 0, 5
		quote := "他ページのブロックを乗っ取ろうとする"
		_, err := uc.Execute(ctx, comment.CreateCommentThreadInput{
			WorkspaceID:  ws,
			PageID:       pageVictim,
			AuthorUserID: 1,
			Body:         `[{"type":"text","text":"hi"}]`,
			Anchor: repository.CommentAnchor{
				BlockID: &blockOnOtherPage, AnchorFrom: &from, AnchorTo: &to, Quote: &quote,
			},
		})
		require.ErrorIs(t, err, domain.ErrInvalidCommentAnchor)

		var count int
		require.NoError(t, db.QueryRow(`SELECT count(*) FROM comment_threads WHERE page_id = $1`, pageVictim).Scan(&count))
		assert.Zero(t, count, "拒否されたので pageVictim にスレッドは作られない")
	})

	t.Run("ブロック削除でblock_idがNULLに落ちても実際にAPI経由で作った錨付きスレッドのquoteは残る", func(t *testing.T) {
		testsupport.TruncateAll(t, db, commentTables...)
		repo := persistence.NewCommentRepository(db)
		txManager := persistence.NewTxManager(db)
		uc := comment.NewCreateCommentThreadUseCase(repo, txManager)

		ws := createWorkspace(t, db, "ws-comment-anchor-4")
		space := createSpace(t, db, ws, "eng")
		page := createPage(t, db, ws, space, nil, "a0")
		block := createBlock(t, db, ws, page, nil, "a0", domain.BlockTypeParagraph)

		from, to := 0, 4
		const quote = "実際に書き込み経路を通した引用文"
		out, err := uc.Execute(ctx, comment.CreateCommentThreadInput{
			WorkspaceID:  ws,
			PageID:       page,
			AuthorUserID: 1,
			Body:         `[{"type":"text","text":"hi"}]`,
			Anchor: repository.CommentAnchor{
				BlockID: &block, AnchorFrom: &from, AnchorTo: &to, Quote: strPtr(quote),
			},
		})
		require.NoError(t, err)
		threadID := out.Thread.ID

		_, err = db.Exec(`DELETE FROM blocks WHERE id = $1`, block)
		require.NoError(t, err)

		got, err := repo.GetCommentThread(ctx, ws, page, threadID)
		require.NoError(t, err)
		assert.Nil(t, got.BlockID, "ブロックが消えたら block_id は NULL に落ちる")
		require.NotNil(t, got.Quote)
		assert.Equal(t, quote, *got.Quote, "quote はブロック削除で触られない")
	})
}

func strPtr(s string) *string { return &s }
