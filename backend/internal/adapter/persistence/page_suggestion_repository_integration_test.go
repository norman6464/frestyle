//go:build integration

package persistence_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// pageSuggestionTables は page_suggestions を含めたナレッジのテーブル（TRUNCATE 対象）。
// page_suggestions は page_versions を base_seq で参照するため、page_versions も含める
// （pageVersionTables と同じ役割分担）。
var pageSuggestionTables = []string{
	"page_suggestions", "page_versions",
	"space_grants", "workspace_grants",
	"principal_members", "principals",
	"blocks", "page_paths", "page_snapshots", "pages", "spaces", "workspaces",
}

const pageSuggestionTestDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"提案の本文"}]}]}`

// setupPageSuggestionFixture はワークスペース・スペース・ページを 1 枚ずつ作る
// （setupPageVersionFixture と同じ形。page_suggestions 単体のテストに必要な最小限）。
func setupPageSuggestionFixture(t *testing.T, db *sql.DB, slug string) (ws, page string) {
	t.Helper()
	testsupport.TruncateAll(t, db, pageSuggestionTables...)
	ws = createWorkspace(t, db, slug)
	space := createSpace(t, db, ws, "eng")
	page = createPage(t, db, ws, space, nil, "a0")
	return ws, page
}

// TestPageSuggestionRepository_ListOpen_Integration は複数の提案を作った順（created_at 昇順）
// で ListOpen が返すことを固定する。
func TestPageSuggestionRepository_ListOpen_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, page := setupPageSuggestionFixture(t, sqlDB, "ws-sugg-list")
	repo := persistence.NewPageSuggestionRepository(sqlDB)

	first := &domain.PageSuggestion{WorkspaceID: ws, PageID: page, Doc: pageSuggestionTestDoc, AuthorUserID: 1}
	require.NoError(t, repo.Create(ctx, first))
	second := &domain.PageSuggestion{WorkspaceID: ws, PageID: page, Doc: pageSuggestionTestDoc, AuthorUserID: 2}
	require.NoError(t, repo.Create(ctx, second))
	// created_at の同時刻衝突を避け、順序を確実にする。
	_, err := sqlDB.Exec(`UPDATE page_suggestions SET created_at = $1 WHERE id = $2`, time.Now().Add(-1*time.Minute), first.ID)
	require.NoError(t, err)

	got, err := repo.ListOpen(ctx, ws, page, 10)
	require.NoError(t, err)
	require.Len(t, got, 2)
	assert.Equal(t, first.ID, got[0].ID, "先に作った提案が先頭に来る（created_at昇順）")
	assert.Equal(t, second.ID, got[1].ID)
}

// TestPageSuggestionRepository_ListOpen_Limit_Integration は limit が SQL の LIMIT として
// そのまま効くことを固定する（大量に open 提案が積まれても、呼び出し元が渡した件数までしか
// 読み出さない）。
func TestPageSuggestionRepository_ListOpen_Limit_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, page := setupPageSuggestionFixture(t, sqlDB, "ws-sugg-list-limit")
	repo := persistence.NewPageSuggestionRepository(sqlDB)

	for i := 0; i < 3; i++ {
		s := &domain.PageSuggestion{WorkspaceID: ws, PageID: page, Doc: pageSuggestionTestDoc, AuthorUserID: 1}
		require.NoError(t, repo.Create(ctx, s))
	}

	got, err := repo.ListOpen(ctx, ws, page, 2)
	require.NoError(t, err)
	assert.Len(t, got, 2, "3件あってもlimitの2件までしか返らない")
}

// TestPageSuggestionRepository_CountOpen_Integration は CountOpen が open な提案だけを数え、
// 解決済みは数えないことを固定する。
func TestPageSuggestionRepository_CountOpen_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, page := setupPageSuggestionFixture(t, sqlDB, "ws-sugg-count-open")
	repo := persistence.NewPageSuggestionRepository(sqlDB)

	first := &domain.PageSuggestion{WorkspaceID: ws, PageID: page, Doc: pageSuggestionTestDoc, AuthorUserID: 1}
	require.NoError(t, repo.Create(ctx, first))
	second := &domain.PageSuggestion{WorkspaceID: ws, PageID: page, Doc: pageSuggestionTestDoc, AuthorUserID: 2}
	require.NoError(t, repo.Create(ctx, second))
	_, err := repo.Resolve(ctx, ws, page, second.ID, domain.PageSuggestionStatusRejected, 1, time.Now())
	require.NoError(t, err)

	count, err := repo.CountOpen(ctx, ws, page)
	require.NoError(t, err)
	assert.Equal(t, 1, count, "解決済みの2件目は数えない")
}

// TestPageSuggestionRepository_CountOpenByAuthor_Integration は CountOpenByAuthor が
// 投稿者本人の open な提案だけを数えることを固定する（他の投稿者の分を数えに含めない）。
func TestPageSuggestionRepository_CountOpenByAuthor_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, page := setupPageSuggestionFixture(t, sqlDB, "ws-sugg-count-author")
	repo := persistence.NewPageSuggestionRepository(sqlDB)

	require.NoError(t, repo.Create(ctx, &domain.PageSuggestion{WorkspaceID: ws, PageID: page, Doc: pageSuggestionTestDoc, AuthorUserID: 1}))
	require.NoError(t, repo.Create(ctx, &domain.PageSuggestion{WorkspaceID: ws, PageID: page, Doc: pageSuggestionTestDoc, AuthorUserID: 1}))
	require.NoError(t, repo.Create(ctx, &domain.PageSuggestion{WorkspaceID: ws, PageID: page, Doc: pageSuggestionTestDoc, AuthorUserID: 2}))

	count, err := repo.CountOpenByAuthor(ctx, ws, page, 1)
	require.NoError(t, err)
	assert.Equal(t, 2, count, "投稿者2の1件は含めない")
}

// TestPageSuggestionRepository_BaseSeqNil_Integration は「まだ版が 1 つも無いページへの提案」
// （BaseSeq が nil）も作成・取得できることを固定する。
func TestPageSuggestionRepository_BaseSeqNil_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, page := setupPageSuggestionFixture(t, sqlDB, "ws-sugg-nilbase")
	repo := persistence.NewPageSuggestionRepository(sqlDB)

	s := &domain.PageSuggestion{WorkspaceID: ws, PageID: page, Doc: pageSuggestionTestDoc, AuthorUserID: 1}
	require.NoError(t, repo.Create(ctx, s))
	assert.Nil(t, s.BaseSeq)

	got, err := repo.Get(ctx, ws, page, s.ID)
	require.NoError(t, err)
	assert.Nil(t, got.BaseSeq)
	// jsonb は key の並びを内部規則で持ち直すため、元の文字列と完全一致はしない
	// （意味的に同じ JSON であることだけを見る）。
	assert.JSONEq(t, pageSuggestionTestDoc, got.Doc)
}

// TestPageSuggestionRepository_BaseSeqSet_Integration は base_seq が実在する版を指すときに
// そのまま作成・取得できることを固定する（FK fk_page_suggestions_base_version が通ること自体の確認）。
func TestPageSuggestionRepository_BaseSeqSet_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, page := setupPageSuggestionFixture(t, sqlDB, "ws-sugg-base")
	require.NoError(t, insertPageVersion(sqlDB, ws, page, 1, pageVersionTestDoc, 1, nil, time.Now()))
	repo := persistence.NewPageSuggestionRepository(sqlDB)

	seq := int64(1)
	s := &domain.PageSuggestion{WorkspaceID: ws, PageID: page, BaseSeq: &seq, Doc: pageSuggestionTestDoc, AuthorUserID: 1}
	require.NoError(t, repo.Create(ctx, s))

	got, err := repo.Get(ctx, ws, page, s.ID)
	require.NoError(t, err)
	require.NotNil(t, got.BaseSeq)
	assert.Equal(t, seq, *got.BaseSeq)
}

// TestPageSuggestionRepository_ResolveClearsBaseSeq_Integration は、base_seq を持つ提案を
// 解決すると Resolve の戻り値・その後の Get の両方で base_seq が nil になることを固定する
// （ResolvePageSuggestion クエリ参照）。
func TestPageSuggestionRepository_ResolveClearsBaseSeq_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, page := setupPageSuggestionFixture(t, sqlDB, "ws-sugg-resolve-clears-base")
	require.NoError(t, insertPageVersion(sqlDB, ws, page, 1, pageVersionTestDoc, 1, nil, time.Now()))
	repo := persistence.NewPageSuggestionRepository(sqlDB)

	seq := int64(1)
	s := &domain.PageSuggestion{WorkspaceID: ws, PageID: page, BaseSeq: &seq, Doc: pageSuggestionTestDoc, AuthorUserID: 1}
	require.NoError(t, repo.Create(ctx, s))

	resolved, err := repo.Resolve(ctx, ws, page, s.ID, domain.PageSuggestionStatusRejected, 2, time.Now())
	require.NoError(t, err)
	assert.Nil(t, resolved.BaseSeq, "Resolveの戻り値でbase_seqがnilになる")

	got, err := repo.Get(ctx, ws, page, s.ID)
	require.NoError(t, err)
	assert.Nil(t, got.BaseSeq, "解決後にGetし直してもbase_seqはnilのまま")
}

// TestPageSuggestionRepository_Resolve_Integration は Resolve の条件付き UPDATE
// （WHERE status='open'）を固定する: 1回目（accept）は成功し、2回目（同じ提案をもう一度解決
// しようとする）は ErrPageSuggestionAlreadyResolved になる。
func TestPageSuggestionRepository_Resolve_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, page := setupPageSuggestionFixture(t, sqlDB, "ws-sugg-resolve")
	repo := persistence.NewPageSuggestionRepository(sqlDB)

	s := &domain.PageSuggestion{WorkspaceID: ws, PageID: page, Doc: pageSuggestionTestDoc, AuthorUserID: 1}
	require.NoError(t, repo.Create(ctx, s))

	resolvedAt := time.Now()
	got, err := repo.Resolve(ctx, ws, page, s.ID, domain.PageSuggestionStatusAccepted, 2, resolvedAt)
	require.NoError(t, err, "1回目のResolveは成功する")
	require.NotNil(t, got)
	assert.Equal(t, domain.PageSuggestionStatusAccepted, got.Status)
	require.NotNil(t, got.ResolvedByUserID)
	assert.Equal(t, uint64(2), *got.ResolvedByUserID)
	require.NotNil(t, got.ResolvedAt)

	_, err = repo.Resolve(ctx, ws, page, s.ID, domain.PageSuggestionStatusRejected, 3, time.Now())
	assert.ErrorIs(t, err, domain.ErrPageSuggestionAlreadyResolved, "既にacceptedな提案への2回目のResolveは失敗する")

	// 本当に上書きされていないことも確かめる（1回目のacceptedのまま）。
	stillAccepted, err := repo.Get(ctx, ws, page, s.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.PageSuggestionStatusAccepted, stillAccepted.Status)
}

// TestPageSuggestionRepository_ResolveNotFound_Integration は存在しない提案への Resolve が
// domain.ErrPageSuggestionNotFound になることを固定する（ErrPageSuggestionAlreadyResolved との
// 区別が repository.Resolve 内の追加 Get で正しく行われていることの確認）。
func TestPageSuggestionRepository_ResolveNotFound_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, page := setupPageSuggestionFixture(t, sqlDB, "ws-sugg-resolve-notfound")
	repo := persistence.NewPageSuggestionRepository(sqlDB)

	_, err := repo.Resolve(ctx, ws, page, newID(), domain.PageSuggestionStatusAccepted, 1, time.Now())
	assert.ErrorIs(t, err, domain.ErrPageSuggestionNotFound)
}

// TestPageSuggestionRepository_TenantIsolation_Integration は別テナントから提案が
// 見えない・操作できないことを固定する（page_template_repository_integration_test.go の
// TenantIsolation_Integration と同じ形）。
func TestPageSuggestionRepository_TenantIsolation_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	testsupport.TruncateAll(t, sqlDB, pageSuggestionTables...)
	wsA := createWorkspace(t, sqlDB, "ws-sugg-tenant-a")
	spaceA := createSpace(t, sqlDB, wsA, "eng")
	pageA := createPage(t, sqlDB, wsA, spaceA, nil, "a0")
	wsB := createWorkspace(t, sqlDB, "ws-sugg-tenant-b")
	repo := persistence.NewPageSuggestionRepository(sqlDB)

	s := &domain.PageSuggestion{WorkspaceID: wsA, PageID: pageA, Doc: pageSuggestionTestDoc, AuthorUserID: 1}
	require.NoError(t, repo.Create(ctx, s))

	t.Run("別テナントのworkspace_idでは覗けない", func(t *testing.T) {
		_, err := repo.Get(ctx, wsB, pageA, s.ID)
		assert.ErrorIs(t, err, domain.ErrPageSuggestionNotFound)
	})

	t.Run("別テナントの一覧には出ない", func(t *testing.T) {
		got, err := repo.ListOpen(ctx, wsB, pageA, 10)
		require.NoError(t, err)
		assert.Empty(t, got)
	})

	t.Run("別テナントのworkspace_idではResolveできない", func(t *testing.T) {
		_, err := repo.Resolve(ctx, wsB, pageA, s.ID, domain.PageSuggestionStatusAccepted, 1, time.Now())
		assert.ErrorIs(t, err, domain.ErrPageSuggestionNotFound)
		// 本当に解決されていないことも確かめる。
		stillOpen, getErr := repo.Get(ctx, wsA, pageA, s.ID)
		require.NoError(t, getErr)
		assert.Equal(t, domain.PageSuggestionStatusOpen, stillOpen.Status)
	})
}

// TestPageSuggestionRepository_ResolutionConsistencyCheck_Integration は
// ck_page_suggestions_resolution_consistency（comment_threads.ck_comment_threads_resolved_pair
// と同じ発想）を固定する: open なのに resolved_at/resolved_by_user_id のどちらかが入っている行、
// accepted/rejected なのにどちらかが欠けている行は、どちらも INSERT できない。
func TestPageSuggestionRepository_ResolutionConsistencyCheck_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ws, page := setupPageSuggestionFixture(t, sqlDB, "ws-sugg-resolution-check")

	insert := func(status string, resolvedAt, resolvedBy string) error {
		_, err := sqlDB.Exec(
			`INSERT INTO page_suggestions (id, workspace_id, page_id, doc, status, author_user_id, resolved_at, resolved_by_user_id)
			 VALUES ($1, $2, $3, $4, $5, 1, `+resolvedAt+`, `+resolvedBy+`)`,
			newID(), ws, page, pageSuggestionTestDoc, status,
		)
		return err
	}

	t.Run("openなのにresolved_atだけ入っている行は拒否する", func(t *testing.T) {
		err := insert("open", "now()", "NULL")
		requirePgError(t, err, sqlStateCheckViolation, "ck_page_suggestions_resolution_consistency")
	})

	t.Run("openなのにresolved_by_user_idだけ入っている行は拒否する", func(t *testing.T) {
		err := insert("open", "NULL", "1")
		requirePgError(t, err, sqlStateCheckViolation, "ck_page_suggestions_resolution_consistency")
	})

	t.Run("acceptedなのにresolved_at/resolved_by_user_idが両方無い行は拒否する", func(t *testing.T) {
		err := insert("accepted", "NULL", "NULL")
		requirePgError(t, err, sqlStateCheckViolation, "ck_page_suggestions_resolution_consistency")
	})

	t.Run("acceptedでresolved_at/resolved_by_user_idが両方揃っていれば通る", func(t *testing.T) {
		err := insert("accepted", "now()", "1")
		require.NoError(t, err)
	})
}
