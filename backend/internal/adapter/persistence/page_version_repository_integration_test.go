//go:build integration

package persistence_test

import (
	"context"
	"database/sql"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// pageVersionTables は page_versions を含めたナレッジのテーブル（TRUNCATE 対象）。
// kbTables（knowledge_base_schema_integration_test.go）に page_versions を加えたもの
// （commentTables と同じ役割分担）。子から先に並べる。
var pageVersionTables = []string{
	"page_suggestions", "page_versions",
	"space_grants", "workspace_grants",
	"principal_members", "principals",
	"blocks", "page_paths", "page_snapshots", "pages", "spaces", "workspaces",
}

const pageVersionTestDoc = `{"type":"doc","content":[]}`

// insertPageVersion は page_versions に 1 行を直接 INSERT する（created_at を指定できる —
// 10 分規則・30 日掃除の境界を再現するためのテスト専用ヘルパー。time.Now() 自体はモックしない
// 設計なので、「過去の時刻を持つ行を直接 SQL で仕込む」ことで境界を再現する）。
func insertPageVersion(
	db *sql.DB, workspaceID, pageID string, seq int64, doc string, authorUserID int64, note *string, createdAt time.Time,
) error {
	_, err := db.Exec(
		`INSERT INTO page_versions (workspace_id, page_id, seq, doc, author_user_id, note, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		workspaceID, pageID, seq, doc, authorUserID, note, createdAt,
	)
	return err
}

func countPageVersions(t *testing.T, db *sql.DB, workspaceID, pageID string) int {
	t.Helper()
	var count int
	require.NoError(t, db.QueryRow(
		`SELECT count(*) FROM page_versions WHERE workspace_id = $1 AND page_id = $2`, workspaceID, pageID,
	).Scan(&count))
	return count
}

// setupPageVersionFixture はワークスペース・スペース・ページを 1 枚ずつ作る
// （page_versions 単体のテストに必要な最小限）。
func setupPageVersionFixture(t *testing.T, db *sql.DB, slug string) (ws, page string) {
	t.Helper()
	testsupport.TruncateAll(t, db, pageVersionTables...)
	ws = createWorkspace(t, db, slug)
	space := createSpace(t, db, ws, "eng")
	page = createPage(t, db, ws, space, nil, "a0")
	return ws, page
}

// TestPageVersionRepository_TenMinuteRule_Integration は CreateVersionIfDue の間引き判定
// （10 分規則）を実 PostgreSQL で固定する。
func TestPageVersionRepository_TenMinuteRule_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	repo := persistence.NewPageVersionRepository(sqlDB)

	t.Run("版が1件も無い状態からの初回保存では必ずseq1が作られる", func(t *testing.T) {
		ws, page := setupPageVersionFixture(t, sqlDB, "ws-pv-10min-a")
		created, v, err := repo.CreateVersionIfDue(ctx, ws, page, pageVersionTestDoc, 1, nil, false)
		require.NoError(t, err)
		assert.True(t, created)
		require.NotNil(t, v)
		assert.Equal(t, int64(1), v.Seq)
	})

	t.Run("直近の版から9分しか経っていなければ間引く", func(t *testing.T) {
		ws, page := setupPageVersionFixture(t, sqlDB, "ws-pv-10min-b")
		require.NoError(t, insertPageVersion(sqlDB, ws, page, 1, pageVersionTestDoc, 1, nil, time.Now().Add(-9*time.Minute)))

		created, v, err := repo.CreateVersionIfDue(ctx, ws, page, pageVersionTestDoc, 1, nil, false)
		require.NoError(t, err)
		assert.False(t, created, "9分では10分規則に届かない")
		assert.Nil(t, v)
		assert.Equal(t, 1, countPageVersions(t, sqlDB, ws, page), "版の件数が増えていない")
	})

	t.Run("直近の版から11分経っていれば新しい版を作る", func(t *testing.T) {
		ws, page := setupPageVersionFixture(t, sqlDB, "ws-pv-10min-c")
		require.NoError(t, insertPageVersion(sqlDB, ws, page, 1, pageVersionTestDoc, 1, nil, time.Now().Add(-11*time.Minute)))

		created, v, err := repo.CreateVersionIfDue(ctx, ws, page, pageVersionTestDoc, 1, nil, false)
		require.NoError(t, err)
		assert.True(t, created, "11分は10分規則を超えている")
		require.NotNil(t, v)
		assert.Equal(t, int64(2), v.Seq)
		assert.Equal(t, 2, countPageVersions(t, sqlDB, ws, page))
	})
}

// TestPageVersionRepository_ExplicitVersion_Integration は「版を残す」
// （CreateExplicitPageVersionUseCase 経由・force=true）が 10 分規則を無視して常に作られること、
// note が保存されること、本文（blocks）を一切変更しないことを固定する。
func TestPageVersionRepository_ExplicitVersion_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, page := setupPageVersionFixture(t, sqlDB, "ws-pv-explicit")

	kbRepo := persistence.NewKnowledgeBaseRepository(sqlDB)
	txManager := persistence.NewTxManager(sqlDB)
	versionRepo := persistence.NewPageVersionRepository(sqlDB)
	replaceUC := kb.NewReplacePageBlocksUseCase(kbRepo, txManager, versionRepo, persistence.NewKnowledgeBasePermissionRepository(sqlDB), persistence.NewNotificationRepository(sqlDB), nil)
	createVersionUC := kb.NewCreateExplicitPageVersionUseCase(versionRepo, kbRepo, txManager)

	doc := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"本文"}]}]}`
	_, err := replaceUC.Execute(ctx, kb.ReplacePageBlocksInput{WorkspaceID: ws, PageID: page, Doc: doc, EditorUserID: 1})
	require.NoError(t, err, "初回保存で seq=1 が作られる")

	blocksBefore, err := kbRepo.ListBlocksByPage(ctx, ws, page)
	require.NoError(t, err)

	// 直前の保存（seq=1）から 10 分も経っていない状態で「版を残す」を呼ぶ。
	// 通常の自動保存なら間引かれるはずのタイミングだが、force=true は無視して必ず作る。
	note := "リリース直前の状態"
	v, err := createVersionUC.Execute(ctx, kb.CreateExplicitPageVersionInput{
		WorkspaceID: ws, PageID: page, AuthorUserID: 2, Note: &note,
	})
	require.NoError(t, err)
	require.NotNil(t, v)
	assert.Equal(t, int64(2), v.Seq, "10分規則を無視して必ず1件増える")
	require.NotNil(t, v.Note)
	assert.Equal(t, note, *v.Note)

	blocksAfter, err := kbRepo.ListBlocksByPage(ctx, ws, page)
	require.NoError(t, err)
	assert.Equal(t, blocksBefore, blocksAfter, "版を残す操作は本文（blocks）を一切変更しない")
}

// TestPageVersionRepository_Restore_Integration は RestorePageVersionUseCase が
// 過去の版の doc を実際に本文として反映すること、復元自体で版が 1 つ増えること、
// その版の author_user_id が復元を行ったユーザーであることを固定する。
func TestPageVersionRepository_Restore_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, page := setupPageVersionFixture(t, sqlDB, "ws-pv-restore")

	kbRepo := persistence.NewKnowledgeBaseRepository(sqlDB)
	txManager := persistence.NewTxManager(sqlDB)
	versionRepo := persistence.NewPageVersionRepository(sqlDB)
	replaceUC := kb.NewReplacePageBlocksUseCase(kbRepo, txManager, versionRepo, persistence.NewKnowledgeBasePermissionRepository(sqlDB), persistence.NewNotificationRepository(sqlDB), nil)
	restoreUC := kb.NewRestorePageVersionUseCase(versionRepo, replaceUC)
	getUC := kb.NewGetPageUseCase(kbRepo)
	listUC := kb.NewListPageVersionsUseCase(versionRepo)

	docA := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"A"}]}]}`
	docB := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"B"}]}]}`

	_, err := replaceUC.Execute(ctx, kb.ReplacePageBlocksInput{WorkspaceID: ws, PageID: page, Doc: docA, EditorUserID: 1})
	require.NoError(t, err, "seq=1 = docA")
	// seq=1 の created_at を 11 分前に見せかけ、2 回目の保存が 10 分規則を超えて確実に
	// seq=2 を作るようにする（本物の time.Now() のまま。過去の行を直接仕込むだけ）。
	_, err = sqlDB.Exec(
		`UPDATE page_versions SET created_at = $1 WHERE workspace_id = $2 AND page_id = $3 AND seq = 1`,
		time.Now().Add(-11*time.Minute), ws, page,
	)
	require.NoError(t, err)
	_, err = replaceUC.Execute(ctx, kb.ReplacePageBlocksInput{WorkspaceID: ws, PageID: page, Doc: docB, EditorUserID: 1})
	require.NoError(t, err, "seq=2 = docB")

	snap, err := restoreUC.Execute(ctx, kb.RestorePageVersionInput{
		WorkspaceID: ws, PageID: page, Seq: 1, EditorUserID: 99,
	})
	require.NoError(t, err)
	requireJSONEqIgnoringBlockIDs(t, docA, snap.Doc)

	out, err := getUC.Execute(ctx, kb.GetPageInput{WorkspaceID: ws, PageID: page})
	require.NoError(t, err)
	requireJSONEqIgnoringBlockIDs(t, docA, out.Doc, "GetPageUseCase 越しでも本文が docA に戻っている")

	versions, err := listUC.Execute(ctx, kb.ListPageVersionsInput{WorkspaceID: ws, PageID: page})
	require.NoError(t, err)
	require.Len(t, versions, 3, "復元自体で版が1つ増える（seq=1,2 + 復元でできた seq=3）")
	assert.Equal(t, int64(3), versions[0].Seq, "一覧は seq 降順なので先頭が最新")
	assert.Equal(t, uint64(99), versions[0].AuthorUserID, "復元を行ったユーザーが版の著者になる")
}

// TestPageVersionRepository_Cleanup_Integration は 30 日保持の掃除を固定する。
// 31 日前の版と 29 日前の版を直接 SQL で仕込み、新しい版を 1 件作らせた後、
// 31 日前の版だけが消えて 29 日前の版と新しい版は残ることを確認する。
func TestPageVersionRepository_Cleanup_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, page := setupPageVersionFixture(t, sqlDB, "ws-pv-cleanup")
	versionRepo := persistence.NewPageVersionRepository(sqlDB)

	require.NoError(t, insertPageVersion(sqlDB, ws, page, 1, pageVersionTestDoc, 1, nil, time.Now().Add(-31*24*time.Hour)))
	require.NoError(t, insertPageVersion(sqlDB, ws, page, 2, pageVersionTestDoc, 1, nil, time.Now().Add(-29*24*time.Hour)))

	created, v, err := versionRepo.CreateVersionIfDue(ctx, ws, page, pageVersionTestDoc, 1, nil, true)
	require.NoError(t, err)
	require.True(t, created)
	require.NotNil(t, v)
	assert.Equal(t, int64(3), v.Seq)

	rows, err := sqlDB.Query(`SELECT seq FROM page_versions WHERE workspace_id = $1 AND page_id = $2 ORDER BY seq`, ws, page)
	require.NoError(t, err)
	defer rows.Close()
	var seqs []int64
	for rows.Next() {
		var seq int64
		require.NoError(t, rows.Scan(&seq))
		seqs = append(seqs, seq)
	}
	require.NoError(t, rows.Err())
	assert.Equal(t, []int64{2, 3}, seqs, "31日前の版だけ消え、29日前の版と新しい版は残る")
}

// TestPageVersionRepository_Cleanup_KeepsVersionReferencedByOpenSuggestion_Integration は、
// open な提案が base_seq として参照している版は、30 日を超えていても掃除で消えないことを
// 固定する（queries/page_version.sql の DeleteOldPageVersions の NOT EXISTS 参照）。
func TestPageVersionRepository_Cleanup_KeepsVersionReferencedByOpenSuggestion_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, page := setupPageVersionFixture(t, sqlDB, "ws-pv-cleanup-open-sugg")
	versionRepo := persistence.NewPageVersionRepository(sqlDB)
	suggestionRepo := persistence.NewPageSuggestionRepository(sqlDB)

	require.NoError(t, insertPageVersion(sqlDB, ws, page, 1, pageVersionTestDoc, 1, nil, time.Now().Add(-31*24*time.Hour)))
	baseSeq := int64(1)
	sugg := &domain.PageSuggestion{WorkspaceID: ws, PageID: page, BaseSeq: &baseSeq, Doc: pageVersionTestDoc, AuthorUserID: 2}
	require.NoError(t, suggestionRepo.Create(ctx, sugg))

	created, v, err := versionRepo.CreateVersionIfDue(ctx, ws, page, pageVersionTestDoc, 1, nil, true)
	require.NoError(t, err)
	require.True(t, created)
	require.NotNil(t, v)
	assert.Equal(t, int64(2), v.Seq)

	assert.Equal(t, 2, countPageVersions(t, sqlDB, ws, page),
		"31日前でもopenな提案が参照しているseq=1は消えず、新しいseq=2と合わせて2件残る")
}

// TestPageVersionRepository_Cleanup_DeletesVersionAfterSuggestionResolved_Integration は、
// 提案が採用・却下されて open でなくなれば、それが参照していた古い版は通常どおり
// 掃除されることを固定する（参照が外れたのと同じ扱い）。
func TestPageVersionRepository_Cleanup_DeletesVersionAfterSuggestionResolved_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, page := setupPageVersionFixture(t, sqlDB, "ws-pv-cleanup-resolved-sugg")
	versionRepo := persistence.NewPageVersionRepository(sqlDB)
	suggestionRepo := persistence.NewPageSuggestionRepository(sqlDB)

	require.NoError(t, insertPageVersion(sqlDB, ws, page, 1, pageVersionTestDoc, 1, nil, time.Now().Add(-31*24*time.Hour)))
	baseSeq := int64(1)
	sugg := &domain.PageSuggestion{WorkspaceID: ws, PageID: page, BaseSeq: &baseSeq, Doc: pageVersionTestDoc, AuthorUserID: 2}
	require.NoError(t, suggestionRepo.Create(ctx, sugg))
	_, err := suggestionRepo.Resolve(ctx, ws, page, sugg.ID, domain.PageSuggestionStatusRejected, 3, time.Now())
	require.NoError(t, err)

	created, v, err := versionRepo.CreateVersionIfDue(ctx, ws, page, pageVersionTestDoc, 1, nil, true)
	require.NoError(t, err)
	require.True(t, created)
	require.NotNil(t, v)
	assert.Equal(t, int64(2), v.Seq)

	rows, err := sqlDB.Query(`SELECT seq FROM page_versions WHERE workspace_id = $1 AND page_id = $2 ORDER BY seq`, ws, page)
	require.NoError(t, err)
	defer rows.Close()
	var seqs []int64
	for rows.Next() {
		var seq int64
		require.NoError(t, rows.Scan(&seq))
		seqs = append(seqs, seq)
	}
	require.NoError(t, rows.Err())
	assert.Equal(t, []int64{2}, seqs, "却下済みの提案が参照していたseq=1は通常どおり掃除される")
}

// TestPageVersionRepository_RollbackOnFailure_Integration は、版の書き込み
// （CreateVersionIfDue の INSERT）が失敗したとき、同じトランザクションに入っている
// TouchPageLastEditedBy / ReplacePageBlocks も道連れでロールバックされることを固定する。
//
// page_versions への INSERT を確実に失敗させる方法として、CHECK 制約
// ck_page_versions_doc（doc->>'type' = 'doc' でなければならない）を使う。
// ReplacePageBlocksUseCase を経由すると渡す doc は常に renderPageDoc が組み立てた正規形
// （必ず type=doc）になり自然には失敗させられないため、TestKnowledgeBaseReplaceBlocksTransaction_Integration
// の dangling parent と同じ要領で、usecase を経由せず repository を直接オーケストレーションし、
// わざと壊れた doc を CreateVersionIfDue に渡す。
func TestPageVersionRepository_RollbackOnFailure_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, page := setupPageVersionFixture(t, sqlDB, "ws-pv-rollback")

	kbRepo := persistence.NewKnowledgeBaseRepository(sqlDB)
	txManager := persistence.NewTxManager(sqlDB)
	versionRepo := persistence.NewPageVersionRepository(sqlDB)

	const editorID = uint64(5)
	rows := []repository.BlockWrite{
		{ID: uuid.NewString(), Position: "a0", Type: domain.BlockTypeParagraph, Attrs: "{}"},
	}
	// type が "doc" ではない ck_page_versions_doc 違反の doc。
	brokenDoc := `{"type":"paragraph","content":[]}`

	err := txManager.DoInTx(ctx, func(ctx context.Context) error {
		if err := kbRepo.TouchPageLastEditedBy(ctx, ws, page, editorID); err != nil {
			return err
		}
		if err := kbRepo.ReplacePageBlocks(ctx, ws, page, rows, pageVersionTestDoc, "", "", nil, nil); err != nil {
			return err
		}
		_, _, err := versionRepo.CreateVersionIfDue(ctx, ws, page, brokenDoc, editorID, nil, true)
		return err
	})
	require.Error(t, err, "壊れた doc で CreateVersionIfDue の INSERT が CHECK 違反になる")

	got, err := kbRepo.FindPage(ctx, ws, page)
	require.NoError(t, err)
	assert.Nil(t, got.LastEditedByUserID, "Touch も同じトランザクションでロールバックされる")

	blocks, err := kbRepo.ListBlocksByPage(ctx, ws, page)
	require.NoError(t, err)
	assert.Empty(t, blocks, "本文（blocks）も保存前の状態に戻る")

	assert.Equal(t, 0, countPageVersions(t, sqlDB, ws, page), "版も作られない")
}

// TestPageVersionRepository_TenantIsolation_Integration は他テナント・他ページの版を
// workspace_id / page_id だけ変えて覗けないことを固定する。
func TestPageVersionRepository_TenantIsolation_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	testsupport.TruncateAll(t, sqlDB, pageVersionTables...)
	versionRepo := persistence.NewPageVersionRepository(sqlDB)

	wsA := createWorkspace(t, sqlDB, "ws-pv-tenant-a")
	spaceA := createSpace(t, sqlDB, wsA, "eng")
	pageA := createPage(t, sqlDB, wsA, spaceA, nil, "a0")
	wsB := createWorkspace(t, sqlDB, "ws-pv-tenant-b")
	spaceB := createSpace(t, sqlDB, wsB, "eng")
	pageB := createPage(t, sqlDB, wsB, spaceB, nil, "a0")

	_, v, err := versionRepo.CreateVersionIfDue(ctx, wsA, pageA, pageVersionTestDoc, 1, nil, true)
	require.NoError(t, err)
	require.NotNil(t, v)

	t.Run("別テナントのworkspace_idでは覗けない", func(t *testing.T) {
		_, err := versionRepo.GetVersion(ctx, wsB, pageA, v.Seq)
		assert.ErrorIs(t, err, domain.ErrPageVersionNotFound)
	})

	t.Run("同テナントの別ページでは覗けない", func(t *testing.T) {
		_, err := versionRepo.GetVersion(ctx, wsA, pageB, v.Seq)
		assert.ErrorIs(t, err, domain.ErrPageVersionNotFound)
	})

	t.Run("別ページのListVersionsは空", func(t *testing.T) {
		got, err := versionRepo.ListVersions(ctx, wsA, pageB)
		require.NoError(t, err)
		assert.Empty(t, got)
	})
}

// TestPageVersionRepository_ConcurrentWrites_Integration は CreateVersionIfDue の採番が
// pages 行の FOR UPDATE ロックで直列化されており、同じページへの同時書き込みで
// PK 違反（page_versions_pkey の重複）が起きないことを固定する。
//
// このロックを手作業（sqlc の queries/page_version.sql から "FOR UPDATE" を消す→ make sqlc）で
// 一時的に外すと、10並行の force=true 書き込みのうち複数が
// "duplicate key value violates unique constraint \"page_versions_pkey\"" で失敗することを
// 確認済み（ロック有りでは複数回実行して常に0件）。「衝突後に再試行」ではなく
// 「ロックで衝突自体を起こさせない」という設計判断をこのテストが守る。
// このテストが無いと、将来誰かがロックを誤って外してもCIが緑のまま気づけない。
func TestPageVersionRepository_ConcurrentWrites_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, page := setupPageVersionFixture(t, sqlDB, "ws-pv-concurrent")
	versionRepo := persistence.NewPageVersionRepository(sqlDB)

	const writers = 10
	var wg sync.WaitGroup
	errs := make([]error, writers)
	seqs := make([]int64, writers)
	created := make([]bool, writers)
	wg.Add(writers)
	for i := range writers {
		go func(i int) {
			defer wg.Done()
			ok, v, err := versionRepo.CreateVersionIfDue(ctx, ws, page, pageVersionTestDoc, 1, nil, true)
			errs[i] = err
			created[i] = ok
			if v != nil {
				seqs[i] = v.Seq
			}
		}(i)
	}
	wg.Wait()

	seen := make(map[int64]int, writers)
	for i := range writers {
		require.NoError(t, errs[i], "force=trueは常に作成されるはずなので、行ロックで直列化されていればPK違反は起きない")
		assert.True(t, created[i])
		seen[seqs[i]]++
	}
	for seq, count := range seen {
		assert.Equal(t, 1, count, "seq=%dが%d回重複して作られた（ロックが効いていない）", seq, count)
	}
	assert.Equal(t, writers, countPageVersions(t, sqlDB, ws, page), "10並行の書き込みがすべて別々のseqとして残る")
}
