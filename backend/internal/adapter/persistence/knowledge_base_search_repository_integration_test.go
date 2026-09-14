//go:build integration

package persistence_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 本文検索と逆リンクの結合テスト。
//
// page_search / page_links は blocks / pages.title から作り直せる派生データ
// （schema.hcl のコメント参照）なので、ここでは「保存のたびに正しく張り替わるか」
// 「CASCADE で正しく消えるか」「再構築が冪等か」を実 PostgreSQL で固定する。

// queryPageSearchRow は page_search を 1 行だけ読む（無ければ found=false）。
func queryPageSearchRow(t *testing.T, db *sql.DB, pageID string) (title, body string, found bool) {
	t.Helper()
	err := db.QueryRow(`SELECT title, body FROM page_search WHERE page_id = $1`, pageID).Scan(&title, &body)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", false
	}
	require.NoError(t, err)
	return title, body, true
}

// countPageLinksForPage はページ 1 枚が持つ page_links の行数（そのページ配下の
// ブロックが source_block_id になっている行）を数える。
func countPageLinksForPage(t *testing.T, db *sql.DB, workspaceID, pageID string) int {
	t.Helper()
	var count int
	require.NoError(t, db.QueryRow(`
		SELECT count(*) FROM page_links pl
		JOIN blocks b ON b.id = pl.source_block_id
		WHERE b.workspace_id = $1 AND b.page_id = $2
	`, workspaceID, pageID).Scan(&count))
	return count
}

// pageRefDoc は 1 段落・1 pageRef だけの最小 doc を組み立てる（本文テキストと参照先の
// 両方を持たせたいテストのための小道具）。
func pageRefDoc(text, targetPageID string) string {
	return fmt.Sprintf(
		`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":%q},{"type":"pageRef","attrs":{"pageId":%q}}]}]}`,
		text, targetPageID,
	)
}

func TestKnowledgeBasePageSearchAndLinksWrite_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	uc := newKbUseCases(sqlDB)
	repo := persistence.NewKnowledgeBaseRepository(sqlDB)
	ctx := context.Background()

	setup := func(t *testing.T) (ws, space string) {
		t.Helper()
		testsupport.TruncateAll(t, sqlDB, kbTables...)
		ws = createWorkspace(t, sqlDB, "ws-search-write")
		space = createSpace(t, sqlDB, ws, "eng")
		return ws, space
	}

	t.Run("本文を書き換えて2回保存すると古い内容ではなく新しい内容が反映される", func(t *testing.T) {
		ws, space := setup(t)
		target := mustCreatePage(ctx, t, uc, ws, space, nil, "参照先")
		page := mustCreatePage(ctx, t, uc, ws, space, nil, "対象ページ")

		_, err := uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{
			WorkspaceID: ws, PageID: page.ID, Doc: pageRefDoc("最初の内容", target.ID), EditorUserID: 1,
		})
		require.NoError(t, err)

		title, body, found := queryPageSearchRow(t, sqlDB, page.ID)
		require.True(t, found, "1回目の保存で page_search 行ができる")
		assert.Equal(t, "対象ページ", title, "titleはpages.titleの写し")
		assert.Contains(t, body, "最初の内容")
		assert.Equal(t, 1, countPageLinksForPage(t, sqlDB, ws, page.ID), "1回目の保存でpage_linksが1行できる")

		_, err = uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{
			WorkspaceID: ws, PageID: page.ID,
			Doc:          `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"書き換え後の内容"}]}]}`,
			EditorUserID: 1,
		})
		require.NoError(t, err)

		_, body2, found2 := queryPageSearchRow(t, sqlDB, page.ID)
		require.True(t, found2)
		assert.NotContains(t, body2, "最初の内容", "古い内容は残らない（UPSERTで完全に置き換わる）")
		assert.Contains(t, body2, "書き換え後の内容", "新しい内容が反映される")
		assert.Equal(t, 0, countPageLinksForPage(t, sqlDB, ws, page.ID),
			"2回目の保存はpageRefを含まないのでpage_linksは張り替わって0行になる")
	})

	t.Run("ブロック削除でそのブロックのpage_linksが消える（CASCADE経由）", func(t *testing.T) {
		ws, space := setup(t)
		target := mustCreatePage(ctx, t, uc, ws, space, nil, "参照先2")
		page := mustCreatePage(ctx, t, uc, ws, space, nil, "対象ページ2")
		_, err := uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{
			WorkspaceID: ws, PageID: page.ID, Doc: pageRefDoc("本文", target.ID), EditorUserID: 1,
		})
		require.NoError(t, err)

		var blockID string
		require.NoError(t, sqlDB.QueryRow(`SELECT id::text FROM blocks WHERE page_id = $1`, page.ID).Scan(&blockID))
		var linkCountBefore int
		require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM page_links WHERE source_block_id = $1`, blockID).Scan(&linkCountBefore))
		require.Equal(t, 1, linkCountBefore, "前提: ブロックがpage_linksを1行持つ")

		// 保存経路（ReplacePageBlocks 自身の DELETE+INSERT）を経由せず、ブロックそのものを
		// 直接消す。CASCADE（fk_page_links_source_block）そのものを確かめるため。
		_, err = sqlDB.Exec(`DELETE FROM blocks WHERE id = $1`, blockID)
		require.NoError(t, err)

		var linkCountAfter int
		require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM page_links WHERE source_block_id = $1`, blockID).Scan(&linkCountAfter))
		assert.Equal(t, 0, linkCountAfter, "ブロックが消えたらそのブロックのpage_linksもCASCADEで消える")
	})

	t.Run("参照先ページ削除でpage_linksが消える（CASCADE経由）", func(t *testing.T) {
		ws, space := setup(t)
		target := mustCreatePage(ctx, t, uc, ws, space, nil, "消される参照先")
		page := mustCreatePage(ctx, t, uc, ws, space, nil, "対象ページ3")
		_, err := uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{
			WorkspaceID: ws, PageID: page.ID, Doc: pageRefDoc("本文", target.ID), EditorUserID: 1,
		})
		require.NoError(t, err)
		require.Equal(t, 1, countPageLinksForPage(t, sqlDB, ws, page.ID))

		require.NoError(t, repo.DeletePageSubtree(ctx, ws, target.ID))

		assert.Equal(t, 0, countPageLinksForPage(t, sqlDB, ws, page.ID), "参照先ページが消えたらリンクもCASCADEで消える")
	})

	t.Run("再構築（RebuildPageSearchAndLinks）を2回流しても同じ結果になる（冪等性）", func(t *testing.T) {
		ws, space := setup(t)
		target := mustCreatePage(ctx, t, uc, ws, space, nil, "参照先4")
		page := mustCreatePage(ctx, t, uc, ws, space, nil, "対象ページ4")
		_, err := uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{
			WorkspaceID: ws, PageID: page.ID, Doc: pageRefDoc("再構築の確認", target.ID), EditorUserID: 1,
		})
		require.NoError(t, err)

		title0, body0, found0 := queryPageSearchRow(t, sqlDB, page.ID)
		require.True(t, found0)
		require.Equal(t, 1, countPageLinksForPage(t, sqlDB, ws, page.ID))

		require.NoError(t, repo.RebuildPageSearchAndLinks(ctx, ws, page.ID))
		title1, body1, found1 := queryPageSearchRow(t, sqlDB, page.ID)
		require.True(t, found1)
		assert.Equal(t, title0, title1)
		assert.Equal(t, body0, body1)
		assert.Equal(t, 1, countPageLinksForPage(t, sqlDB, ws, page.ID), "1回目の再構築後も1行のまま")

		require.NoError(t, repo.RebuildPageSearchAndLinks(ctx, ws, page.ID))
		title2, body2, found2 := queryPageSearchRow(t, sqlDB, page.ID)
		require.True(t, found2)
		assert.Equal(t, title0, title2)
		assert.Equal(t, body0, body2)
		assert.Equal(t, 1, countPageLinksForPage(t, sqlDB, ws, page.ID), "2回目の再構築後も重複せず1行のまま（冪等）")
	})

	t.Run("101個の有効な異なるpageRefを含むページは保存経路と再構築で同じ件数のpage_linksになる", func(t *testing.T) {
		ws, space := setup(t)
		page := mustCreatePage(ctx, t, uc, ws, space, nil, "多数リンクページ")

		const targetCount = 101
		targetIDs := make([]string, targetCount)
		for i := 0; i < targetCount; i++ {
			target := mustCreatePage(ctx, t, uc, ws, space, nil, fmt.Sprintf("参照先%d", i))
			targetIDs[i] = target.ID
		}

		content := []map[string]any{{"type": "text", "text": "本文"}}
		for _, id := range targetIDs {
			content = append(content, map[string]any{"type": "pageRef", "attrs": map[string]any{"pageId": id}})
		}
		doc := map[string]any{
			"type": "doc",
			"content": []map[string]any{
				{"type": "paragraph", "content": content},
			},
		}
		docJSON, err := json.Marshal(doc)
		require.NoError(t, err)

		_, err = uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{
			WorkspaceID: ws, PageID: page.ID, Doc: string(docJSON), EditorUserID: 1,
		})
		require.NoError(t, err)

		savedCount := countPageLinksForPage(t, sqlDB, ws, page.ID)
		require.Equal(t, 100, savedCount, "参照先の種類数はkbPageRefMaxResolve=100件で打ち切られる")

		require.NoError(t, repo.RebuildPageSearchAndLinks(ctx, ws, page.ID))
		rebuiltCount := countPageLinksForPage(t, sqlDB, ws, page.ID)
		assert.Equal(t, savedCount, rebuiltCount, "再構築でも同じ上限が掛かるため、保存経路と件数が一致する")
	})
}

// ticketRefDoc は 1 段落・1 ticketRef だけの最小 doc を組み立てる（pageRefDoc のチケット版）。
func ticketRefDoc(text, targetTicketID string) string {
	return fmt.Sprintf(
		`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":%q},{"type":"ticketRef","attrs":{"ticketId":%q}}]}]}`,
		text, targetTicketID,
	)
}

// countPageTicketLinksForPage はページ 1 枚が持つ page_ticket_links の行数を数える
// （countPageLinksForPage のチケット版）。
func countPageTicketLinksForPage(t *testing.T, db *sql.DB, workspaceID, pageID string) int {
	t.Helper()
	var count int
	require.NoError(t, db.QueryRow(`
		SELECT count(*) FROM page_ticket_links ptl
		JOIN blocks b ON b.id = ptl.source_block_id
		WHERE b.workspace_id = $1 AND b.page_id = $2
	`, workspaceID, pageID).Scan(&count))
	return count
}

// TestKnowledgeBasePageTicketLinks_Integration は page_ticket_links（ページへのチケット埋め込みの
// 派生索引。段 5）を実 Postgres で固定する。page_links の対の表なので、
// TestKnowledgeBasePageSearchAndLinksWrite_Integration と同じ観点（張り替え・CASCADE・冪等性）を
// 見るが、参照先がページではなくチケットである点だけが違う。
func TestKnowledgeBasePageTicketLinks_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	uc := newKbUseCases(sqlDB)
	repo := persistence.NewKnowledgeBaseRepository(sqlDB)
	tickets := persistence.NewTicketRepository(sqlDB)
	ctx := context.Background()

	setup := func(t *testing.T) (ws, space string) {
		t.Helper()
		testsupport.TruncateAll(t, sqlDB, kbTables...)
		ws = createWorkspace(t, sqlDB, "ws-ticket-links")
		space = createSpace(t, sqlDB, ws, "eng")
		return ws, space
	}

	// チケットはプロジェクトに属する（スペースとは別の入れ物）。ページ側の space とは
	// 独立に作る — ここが独立していることこそがこの表の設計。
	mustCreateTicket := func(t *testing.T, ws string) *domain.Ticket {
		t.Helper()
		project := createProject(t, sqlDB, ws, "tk-links")
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, tickets, ws, project)
		created, err := tickets.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, ProjectID: project, TypeID: typeID, StatusID: statusID,
			Title: "埋め込み先チケット", Doc: []byte(`{"type":"doc","content":[]}`),
			Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		return created
	}

	t.Run("実在しないチケットを指すticketRefは黙って除外される", func(t *testing.T) {
		ws, space := setup(t)
		page := mustCreatePage(ctx, t, uc, ws, space, nil, "参照切れページ")

		_, err := uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{
			WorkspaceID: ws, PageID: page.ID, Doc: ticketRefDoc("参照", newID()), EditorUserID: 1,
		})
		require.NoError(t, err, "リンク切れ1本のために保存全体を失敗させない")
		assert.Equal(t, 0, countPageTicketLinksForPage(t, sqlDB, ws, page.ID))
	})

	t.Run("ticketRefを含むページを保存するとpage_ticket_linksが張られる", func(t *testing.T) {
		ws, space := setup(t)
		target := mustCreateTicket(t, ws)
		page := mustCreatePage(ctx, t, uc, ws, space, nil, "埋め込み元ページ")

		_, err := uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{
			WorkspaceID: ws, PageID: page.ID, Doc: ticketRefDoc("参照", target.ID), EditorUserID: 1,
		})
		require.NoError(t, err)
		assert.Equal(t, 1, countPageTicketLinksForPage(t, sqlDB, ws, page.ID))

		// ticketRefを含まない内容へ書き換えると張り替わって消える。
		_, err = uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{
			WorkspaceID: ws, PageID: page.ID,
			Doc:          `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"埋め込み無し"}]}]}`,
			EditorUserID: 1,
		})
		require.NoError(t, err)
		assert.Equal(t, 0, countPageTicketLinksForPage(t, sqlDB, ws, page.ID))
	})

	t.Run("ブロック削除でそのブロックのpage_ticket_linksが消える_CASCADE経由", func(t *testing.T) {
		ws, space := setup(t)
		target := mustCreateTicket(t, ws)
		page := mustCreatePage(ctx, t, uc, ws, space, nil, "対象ページ")
		_, err := uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{
			WorkspaceID: ws, PageID: page.ID, Doc: ticketRefDoc("本文", target.ID), EditorUserID: 1,
		})
		require.NoError(t, err)
		require.Equal(t, 1, countPageTicketLinksForPage(t, sqlDB, ws, page.ID))

		var blockID string
		require.NoError(t, sqlDB.QueryRow(`SELECT id::text FROM blocks WHERE page_id = $1`, page.ID).Scan(&blockID))
		_, err = sqlDB.Exec(`DELETE FROM blocks WHERE id = $1`, blockID)
		require.NoError(t, err)

		assert.Equal(t, 0, countPageTicketLinksForPage(t, sqlDB, ws, page.ID))
	})

	t.Run("埋め込み先チケット削除でpage_ticket_linksが消える_CASCADE経由", func(t *testing.T) {
		ws, space := setup(t)
		target := mustCreateTicket(t, ws)
		page := mustCreatePage(ctx, t, uc, ws, space, nil, "対象ページ2")
		_, err := uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{
			WorkspaceID: ws, PageID: page.ID, Doc: ticketRefDoc("本文", target.ID), EditorUserID: 1,
		})
		require.NoError(t, err)
		require.Equal(t, 1, countPageTicketLinksForPage(t, sqlDB, ws, page.ID))

		// tickets は通常 DeleteTicket で「消えたことにする」だけだが、CASCADE 自体
		// （fk_page_ticket_links_target_ticket）は物理削除でしか確かめられない。
		_, err = sqlDB.Exec(`DELETE FROM tickets WHERE id = $1`, target.ID)
		require.NoError(t, err)

		assert.Equal(t, 0, countPageTicketLinksForPage(t, sqlDB, ws, page.ID))
	})

	t.Run("再構築を2回流しても同じ結果になる_冪等性", func(t *testing.T) {
		ws, space := setup(t)
		target := mustCreateTicket(t, ws)
		page := mustCreatePage(ctx, t, uc, ws, space, nil, "対象ページ3")
		_, err := uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{
			WorkspaceID: ws, PageID: page.ID, Doc: ticketRefDoc("本文", target.ID), EditorUserID: 1,
		})
		require.NoError(t, err)
		require.Equal(t, 1, countPageTicketLinksForPage(t, sqlDB, ws, page.ID))

		require.NoError(t, repo.RebuildPageSearchAndLinks(ctx, ws, page.ID))
		assert.Equal(t, 1, countPageTicketLinksForPage(t, sqlDB, ws, page.ID), "1回目の再構築後も1行のまま")
		require.NoError(t, repo.RebuildPageSearchAndLinks(ctx, ws, page.ID))
		assert.Equal(t, 1, countPageTicketLinksForPage(t, sqlDB, ws, page.ID), "2回目の再構築後も重複せず1行のまま")
	})
}

// TestKnowledgeBaseSearchBodyMatch_Integration は本文検索の
// 日本語の部分一致・matchField/excerpt の判定・可視性のふるいを実 PostgreSQL で固定する。
func TestKnowledgeBaseSearchBodyMatch_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	f := setupKBPermission(t, sqlDB)

	page := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "設計メモ")
	_, err := f.pageUC.replace.Execute(ctx, kb.ReplacePageBlocksInput{
		WorkspaceID: f.ws, PageID: page.ID,
		Doc:          `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"この段落には Docker の使い方が書いてある"}]}]}`,
		EditorUserID: 1,
	})
	require.NoError(t, err)

	alice := f.principalFor(ctx, t, f.alice)
	f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)

	t.Run("日本語の本文一致を拾い、matchField=bodyと抜粋を返す", func(t *testing.T) {
		results, err := kb.NewSearchViewablePagesUseCase(f.perm).Execute(ctx,
			kb.SearchViewablePagesInput{WorkspaceID: f.ws, UserID: f.alice, Query: "使い方"})
		require.NoError(t, err)
		require.Len(t, results, 1)
		assert.Equal(t, page.ID, results[0].Page.ID)
		assert.Equal(t, kb.SearchMatchFieldBody, results[0].MatchField)
		assert.Contains(t, results[0].Excerpt, "使い方")
	})

	t.Run("titleが一致するときはmatchField=titleでexcerptを出さない", func(t *testing.T) {
		results, err := kb.NewSearchViewablePagesUseCase(f.perm).Execute(ctx,
			kb.SearchViewablePagesInput{WorkspaceID: f.ws, UserID: f.alice, Query: "設計"})
		require.NoError(t, err)
		require.Len(t, results, 1)
		assert.Equal(t, kb.SearchMatchFieldTitle, results[0].MatchField)
		assert.Empty(t, results[0].Excerpt)
	})

	t.Run("題名にも本文にも一致しなければ出ない", func(t *testing.T) {
		results, err := kb.NewSearchViewablePagesUseCase(f.perm).Execute(ctx,
			kb.SearchViewablePagesInput{WorkspaceID: f.ws, UserID: f.alice, Query: "無関係な語"})
		require.NoError(t, err)
		assert.Empty(t, results)
	})

	t.Run("見えないスペースの本文一致は出ない", func(t *testing.T) {
		secretSpace := createSpace(t, sqlDB, f.ws, "search-secret")
		f.makePrivate(t, secretSpace)
		secret := mustCreatePage(ctx, t, f.pageUC, f.ws, secretSpace, nil, "非公開ページ")
		_, err := f.pageUC.replace.Execute(ctx, kb.ReplacePageBlocksInput{
			WorkspaceID: f.ws, PageID: secret.ID,
			Doc:          `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Docker の秘密の手順"}]}]}`,
			EditorUserID: 1,
		})
		require.NoError(t, err)

		// alice はこの private スペースへの付与を持たない。
		results, err := kb.NewSearchViewablePagesUseCase(f.perm).Execute(ctx,
			kb.SearchViewablePagesInput{WorkspaceID: f.ws, UserID: f.alice, Query: "秘密の手順"})
		require.NoError(t, err)
		assert.Empty(t, results, "見えないスペースの本文一致は検索に出ない")
	})
}

// TestKnowledgeBaseBacklinks_Integration は逆リンクの可視判定を
// 実 PostgreSQL で固定する。見えない参照元ページ（権限の無いスペース）からのリンクは
// 一覧に出ないこと。
func TestKnowledgeBaseBacklinks_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	f := setupKBPermission(t, sqlDB)

	target := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "参照される側")

	visibleSource := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "見える参照元")
	_, err := f.pageUC.replace.Execute(ctx, kb.ReplacePageBlocksInput{
		WorkspaceID: f.ws, PageID: visibleSource.ID, Doc: pageRefDoc("参照", target.ID), EditorUserID: 1,
	})
	require.NoError(t, err)

	// 見えない参照元: private スペース（alice には付与しない）。
	secretSpace := createSpace(t, sqlDB, f.ws, "backlink-secret")
	f.makePrivate(t, secretSpace)
	hiddenSource := mustCreatePage(ctx, t, f.pageUC, f.ws, secretSpace, nil, "見えない参照元")
	_, err = f.pageUC.replace.Execute(ctx, kb.ReplacePageBlocksInput{
		WorkspaceID: f.ws, PageID: hiddenSource.ID, Doc: pageRefDoc("参照", target.ID), EditorUserID: 1,
	})
	require.NoError(t, err)

	alice := f.principalFor(ctx, t, f.alice)
	f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)

	backlinks, err := kb.NewListPageBacklinksUseCase(f.perm).Execute(ctx, kb.ListPageBacklinksInput{
		WorkspaceID: f.ws, UserID: f.alice, PageID: target.ID,
	})
	require.NoError(t, err)
	ids := make([]string, 0, len(backlinks))
	for _, p := range backlinks {
		ids = append(ids, p.ID)
	}
	assert.ElementsMatch(t, []string{visibleSource.ID}, ids,
		"見える参照元だけが出て、権限の無いスペースの参照元は出ない")

	// bob は secretSpace にも付与を持つので、両方見える。
	bob := f.principalFor(ctx, t, f.bob)
	f.grantSpace(ctx, t, f.spaceA, bob.ID, domain.GrantRoleViewer)
	f.grantSpace(ctx, t, secretSpace, bob.ID, domain.GrantRoleViewer)
	backlinksForBob, err := kb.NewListPageBacklinksUseCase(f.perm).Execute(ctx, kb.ListPageBacklinksInput{
		WorkspaceID: f.ws, UserID: f.bob, PageID: target.ID,
	})
	require.NoError(t, err)
	idsForBob := make([]string, 0, len(backlinksForBob))
	for _, p := range backlinksForBob {
		idsForBob = append(idsForBob, p.ID)
	}
	assert.ElementsMatch(t, []string{visibleSource.ID, hiddenSource.ID}, idsForBob,
		"両方のスペースが見える相手には両方の参照元が出る")
}

// TestKnowledgeBasePagesReferencingTicket_Integration は ListPagesReferencingTicketUseCase
// （ページへのチケット埋め込みの逆参照。段 5）の可視判定を実 PostgreSQL で固定する。
// TestKnowledgeBaseBacklinks_Integration と全く同じ観点（見えないスペースの参照元は
// 一覧に出ない）を、参照先がページではなくチケットである形で見る。
func TestKnowledgeBasePagesReferencingTicket_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	f := setupKBPermission(t, sqlDB)
	tickets := persistence.NewTicketRepository(sqlDB)

	project := createProject(t, sqlDB, f.ws, "tk-backlink")
	statusID, typeID := seedTicketMasterViaRepo(ctx, t, tickets, f.ws, project)
	target, err := tickets.CreateTicket(ctx, repository.TicketCreateInput{
		WorkspaceID: f.ws, ProjectID: project, TypeID: typeID, StatusID: statusID,
		Title: "参照される側", Doc: []byte(`{"type":"doc","content":[]}`),
		Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
	})
	require.NoError(t, err)

	visibleSource := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "見える埋め込み元")
	_, err = f.pageUC.replace.Execute(ctx, kb.ReplacePageBlocksInput{
		WorkspaceID: f.ws, PageID: visibleSource.ID, Doc: ticketRefDoc("参照", target.ID), EditorUserID: 1,
	})
	require.NoError(t, err)

	// 見えない埋め込み元: private スペース（alice には付与しない）。
	secretSpace := createSpace(t, sqlDB, f.ws, "ticket-backlink-secret")
	f.makePrivate(t, secretSpace)
	hiddenSource := mustCreatePage(ctx, t, f.pageUC, f.ws, secretSpace, nil, "見えない埋め込み元")
	_, err = f.pageUC.replace.Execute(ctx, kb.ReplacePageBlocksInput{
		WorkspaceID: f.ws, PageID: hiddenSource.ID, Doc: ticketRefDoc("参照", target.ID), EditorUserID: 1,
	})
	require.NoError(t, err)

	alice := f.principalFor(ctx, t, f.alice)
	f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)

	pages, err := kb.NewListPagesReferencingTicketUseCase(f.perm).Execute(ctx, kb.ListPagesReferencingTicketInput{
		WorkspaceID: f.ws, UserID: f.alice, TicketID: target.ID,
	})
	require.NoError(t, err)
	ids := make([]string, 0, len(pages))
	for _, p := range pages {
		ids = append(ids, p.ID)
	}
	assert.ElementsMatch(t, []string{visibleSource.ID}, ids,
		"見える埋め込み元だけが出て、権限の無いスペースの埋め込み元は出ない")
}
