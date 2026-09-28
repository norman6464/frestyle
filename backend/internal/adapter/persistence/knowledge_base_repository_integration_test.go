//go:build integration

package persistence_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence/sqlcgen"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// kbUseCases は結合テストで使う usecase 一式（実 repository を注入した状態）。
type kbUseCases struct {
	create    *kb.CreatePageUseCase
	get       *kb.GetPageUseCase
	tree      *kb.GetPageTreeUseCase
	rename    *kb.RenamePageUseCase
	move      *kb.MovePageUseCase
	archive   *kb.ArchivePageUseCase
	unarchive *kb.UnarchivePageUseCase
	replace   *kb.ReplacePageBlocksUseCase
	setIcon   *kb.SetPageIconUseCase
	repo      repository.KnowledgeBaseRepository
	txManager repository.TxManager
}

// newKbUseCases は sqlDB から本物の repository / TxManager を組み立てて usecase 一式を作る。
// ReplacePageBlocksUseCase が TxManager / PageVersionRepository を要るようになったため、
// repository だけでなく *sql.DB を受け取り、この中で組む（呼び出し側に組み立てを分散させない）。
func newKbUseCases(sqlDB *sql.DB) kbUseCases {
	repo := persistence.NewKnowledgeBaseRepository(sqlDB)
	txManager := persistence.NewTxManager(sqlDB)
	versions := persistence.NewPageVersionRepository(sqlDB)
	return kbUseCases{
		create:    kb.NewCreatePageUseCase(repo),
		get:       kb.NewGetPageUseCase(repo),
		tree:      kb.NewGetPageTreeUseCase(repo),
		rename:    kb.NewRenamePageUseCase(repo),
		move:      kb.NewMovePageUseCase(repo),
		archive:   kb.NewArchivePageUseCase(repo),
		unarchive: kb.NewUnarchivePageUseCase(repo),
		replace:   kb.NewReplacePageBlocksUseCase(repo, txManager, versions),
		setIcon:   kb.NewSetPageIconUseCase(repo),
		repo:      repo,
		txManager: txManager,
	}
}

// mustCreatePage は usecase 経由でページを 1 枚作る（closure も張られる）。
func mustCreatePage(ctx context.Context, t *testing.T, uc kbUseCases, ws, space string, parentID *string, title string) *domain.Page {
	t.Helper()
	page, err := uc.create.Execute(ctx, kb.CreatePageInput{
		WorkspaceID: ws, SpaceID: space, ParentID: parentID, Title: title, CreatedByUserID: 1,
	})
	require.NoError(t, err)
	return page
}

// queryPagePaths は page_paths の全行を "page→ancestor" → depth で返す（closure の全行検証用）。
func queryPagePaths(t *testing.T, db *sql.DB, workspaceID string) map[string]int {
	t.Helper()
	rows, err := db.Query(
		`SELECT page_id::text, ancestor_id::text, depth FROM page_paths WHERE workspace_id = $1`, workspaceID,
	)
	require.NoError(t, err)
	defer rows.Close()
	got := map[string]int{}
	for rows.Next() {
		var pageID, ancestorID string
		var depth int
		require.NoError(t, rows.Scan(&pageID, &ancestorID, &depth))
		got[pageID+"→"+ancestorID] = depth
	}
	require.NoError(t, rows.Err())
	return got
}

// treeShape はページツリーを "title(子, 子, ...)" の文字列に落とす（木の形の比較用）。
func treeShape(nodes []*kb.PageTreeNode) string {
	s := ""
	for i, n := range nodes {
		if i > 0 {
			s += ", "
		}
		s += n.Page.Title
		if len(n.Children) > 0 {
			s += "(" + treeShape(n.Children) + ")"
		}
	}
	return s
}

// stripBlockIDsFromAttrs / requireJSONEqIgnoringBlockIDs は internal/usecase/kb の
// package kb（page_usecase_test.go）にある同名ヘルパーの package persistence_test 版。
// renderPageDoc は常に attrs.id を出力するようになったため（新規ブロックは呼び出しの
// たびに新しい UUID が採番される）、ここでは正規化前の入力 doc をそのまま厳密比較すると
// 落ちる。id を無視して構造だけ比較する。
func stripBlockIDsFromAttrs(v any) {
	switch val := v.(type) {
	case map[string]any:
		if attrsRaw, ok := val["attrs"]; ok {
			if attrsMap, ok := attrsRaw.(map[string]any); ok {
				delete(attrsMap, "id")
				if len(attrsMap) == 0 {
					delete(val, "attrs")
				}
			}
		}
		for _, child := range val {
			stripBlockIDsFromAttrs(child)
		}
	case []any:
		for _, child := range val {
			stripBlockIDsFromAttrs(child)
		}
	}
}

func requireJSONEqIgnoringBlockIDs(t *testing.T, want, got string, msgAndArgs ...any) {
	t.Helper()
	var w, g any
	require.NoError(t, json.Unmarshal([]byte(want), &w))
	require.NoError(t, json.Unmarshal([]byte(got), &g))
	stripBlockIDsFromAttrs(w)
	stripBlockIDsFromAttrs(g)
	assert.Equal(t, w, g, msgAndArgs...)
}

func TestKnowledgeBasePageUseCases_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	repo := persistence.NewKnowledgeBaseRepository(sqlDB)
	uc := newKbUseCases(sqlDB)
	ctx := context.Background()

	// setup は各サブテストの冒頭で呼ぶ共通初期化（ワークスペース + スペース 2 つ）。
	setup := func(t *testing.T) (ws, spaceA, spaceB string) {
		t.Helper()
		testsupport.TruncateAll(t, sqlDB, kbTables...)
		ws = createWorkspace(t, sqlDB, "ws-main")
		spaceA = createSpace(t, sqlDB, ws, "aaa")
		spaceB = createSpace(t, sqlDB, ws, "bbb")
		return ws, spaceA, spaceB
	}

	t.Run("祖先IDが根から順に返る（パンくずの骨組み）", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		root := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "根")
		child := mustCreatePage(ctx, t, uc, ws, spaceA, &root.ID, "子")
		grand := mustCreatePage(ctx, t, uc, ws, spaceA, &child.ID, "孫")

		got, err := repo.ListAncestorPageIDs(ctx, ws, grand.ID)
		require.NoError(t, err)
		assert.Equal(t, []string{root.ID, child.ID}, got, "根 → 親 の順（自分は含まない）")

		// 根ページ・実在しない ID は空（エラーにしない）。
		empty, err := repo.ListAncestorPageIDs(ctx, ws, root.ID)
		require.NoError(t, err)
		assert.Empty(t, empty)
		none, err := repo.ListAncestorPageIDs(ctx, ws, "not-a-uuid")
		require.NoError(t, err)
		assert.Empty(t, none)
	})

	t.Run("削除は子孫・closure・本文ごとCASCADEで消える", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		root := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "消す根")
		child := mustCreatePage(ctx, t, uc, ws, spaceA, &root.ID, "消える子")
		survivor := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "残る根")
		_, err := uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{
			WorkspaceID: ws, PageID: child.ID,
			// pageRef を含めて page_links に行ができる状態を作る（下の CASCADE 確認のため）。
			Doc: `{"type":"doc","content":[{"type":"paragraph","content":[` +
				`{"type":"text","text":"本文"},{"type":"pageRef","attrs":{"pageId":"` + survivor.ID + `"}}` +
				`]}]}`,
			EditorUserID: 1,
		})
		require.NoError(t, err)
		var linkCountBefore int
		require.NoError(t, sqlDB.QueryRowContext(ctx,
			`SELECT count(*) FROM page_links pl JOIN blocks b ON b.id = pl.source_block_id
			 WHERE b.page_id = $1`, child.ID).Scan(&linkCountBefore))
		require.Equal(t, 1, linkCountBefore, "前提: 削除前はpage_linksが1行ある")

		require.NoError(t, repo.DeletePageSubtree(ctx, ws, root.ID))

		_, err = uc.get.Execute(ctx, kb.GetPageInput{WorkspaceID: ws, PageID: child.ID})
		require.ErrorIs(t, err, repository.ErrPageNotFound, "子孫も一緒に消える")
		tree, err := uc.tree.Execute(ctx, kb.GetPageTreeInput{WorkspaceID: ws, SpaceID: spaceA})
		require.NoError(t, err)
		assert.Equal(t, "残る根", treeShape(tree), "残す根は無傷で、消した木は形から消える")

		// 派生テーブルにも残骸が無い（CASCADE の確認）。
		var count int
		require.NoError(t, sqlDB.QueryRowContext(ctx,
			`SELECT count(*) FROM page_paths WHERE page_id = $1 OR ancestor_id = $1`, child.ID).Scan(&count))
		assert.Zero(t, count)
		require.NoError(t, sqlDB.QueryRowContext(ctx,
			`SELECT count(*) FROM blocks WHERE page_id = $1`, child.ID).Scan(&count))
		assert.Zero(t, count)
		require.NoError(t, sqlDB.QueryRowContext(ctx,
			`SELECT count(*) FROM page_snapshots WHERE page_id = $1`, child.ID).Scan(&count))
		assert.Zero(t, count)
		require.NoError(t, sqlDB.QueryRowContext(ctx,
			`SELECT count(*) FROM page_search WHERE page_id = $1`, child.ID).Scan(&count))
		assert.Zero(t, count)
		require.NoError(t, sqlDB.QueryRowContext(ctx,
			`SELECT count(*) FROM page_links pl JOIN blocks b ON b.id = pl.source_block_id
			 WHERE b.page_id = $1`, child.ID).Scan(&count))
		assert.Zero(t, count)

		// 実在しないページの削除は ErrPageNotFound（冪等にしない — 押した相手が
		// 「もう無い」ことを知れる）。
		require.ErrorIs(t, repo.DeletePageSubtree(ctx, ws, root.ID), repository.ErrPageNotFound)
	})

	t.Run("作成して取得すると木の形とclosureが正しい", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		root1 := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "root1")
		root2 := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "root2")
		child := mustCreatePage(ctx, t, uc, ws, spaceA, &root1.ID, "child")
		grand := mustCreatePage(ctx, t, uc, ws, spaceA, &child.ID, "grand")

		got, err := uc.get.Execute(ctx, kb.GetPageInput{WorkspaceID: ws, PageID: child.ID})
		require.NoError(t, err)
		assert.Equal(t, "child", got.Page.Title)
		assert.Equal(t, &root1.ID, got.Page.ParentID)
		assert.JSONEq(t, `{"type":"doc","content":[]}`, got.Doc, "未保存ページの本文は空 doc")

		tree, err := uc.tree.Execute(ctx, kb.GetPageTreeInput{WorkspaceID: ws, SpaceID: spaceA})
		require.NoError(t, err)
		assert.Equal(t, "root1(child(grand)), root2", treeShape(tree))

		assert.Equal(t, map[string]int{
			root1.ID + "→" + root1.ID: 0,
			root2.ID + "→" + root2.ID: 0,
			child.ID + "→" + child.ID: 0,
			child.ID + "→" + root1.ID: 1,
			grand.ID + "→" + grand.ID: 0,
			grand.ID + "→" + child.ID: 1,
			grand.ID + "→" + root1.ID: 2,
		}, queryPagePaths(t, sqlDB, ws), "closure は自分自身 depth=0 + 全祖先")
	})

	t.Run("同一スペース内の移動でclosureが付け替わる", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		root1 := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "root1")
		root2 := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "root2")
		child := mustCreatePage(ctx, t, uc, ws, spaceA, &root1.ID, "child")
		grand := mustCreatePage(ctx, t, uc, ws, spaceA, &child.ID, "grand")

		moved, err := uc.move.Execute(ctx, kb.MovePageInput{
			WorkspaceID: ws, PageID: child.ID, NewParentID: &root2.ID,
		})
		require.NoError(t, err)
		assert.Equal(t, &root2.ID, moved.ParentID)
		assert.Equal(t, spaceA, moved.SpaceID)

		tree, err := uc.tree.Execute(ctx, kb.GetPageTreeInput{WorkspaceID: ws, SpaceID: spaceA})
		require.NoError(t, err)
		assert.Equal(t, "root1, root2(child(grand))", treeShape(tree))

		assert.Equal(t, map[string]int{
			root1.ID + "→" + root1.ID: 0,
			root2.ID + "→" + root2.ID: 0,
			child.ID + "→" + child.ID: 0,
			child.ID + "→" + root2.ID: 1,
			grand.ID + "→" + grand.ID: 0,
			grand.ID + "→" + child.ID: 1,
			grand.ID + "→" + root2.ID: 2,
		}, queryPagePaths(t, sqlDB, ws), "旧祖先 root1 との組が消え、新祖先 root2 との組に置き換わる")
	})

	t.Run("自分の子孫への移動は拒否される", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		root := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "root")
		child := mustCreatePage(ctx, t, uc, ws, spaceA, &root.ID, "child")
		grand := mustCreatePage(ctx, t, uc, ws, spaceA, &child.ID, "grand")

		_, err := uc.move.Execute(ctx, kb.MovePageInput{
			WorkspaceID: ws, PageID: root.ID, NewParentID: &grand.ID,
		})
		require.ErrorIs(t, err, kb.ErrPageCycle)

		_, err = uc.move.Execute(ctx, kb.MovePageInput{
			WorkspaceID: ws, PageID: root.ID, NewParentID: &root.ID,
		})
		require.ErrorIs(t, err, kb.ErrPageCycle, "自分自身も拒否")

		// 木が壊れていないこと。
		tree, err := uc.tree.Execute(ctx, kb.GetPageTreeInput{WorkspaceID: ws, SpaceID: spaceA})
		require.NoError(t, err)
		assert.Equal(t, "root(child(grand))", treeShape(tree))
	})

	t.Run("スペースをまたぐ移動で子孫のspace_idも変わる", func(t *testing.T) {
		ws, spaceA, spaceB := setup(t)
		rootA := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "rootA")
		child := mustCreatePage(ctx, t, uc, ws, spaceA, &rootA.ID, "child")
		grand := mustCreatePage(ctx, t, uc, ws, spaceA, &child.ID, "grand")
		rootB := mustCreatePage(ctx, t, uc, ws, spaceB, nil, "rootB")

		// child（+ grand）を spaceB の rootB の下へ。
		moved, err := uc.move.Execute(ctx, kb.MovePageInput{
			WorkspaceID: ws, PageID: child.ID, NewParentID: &rootB.ID,
		})
		require.NoError(t, err)
		assert.Equal(t, spaceB, moved.SpaceID)

		grandAfter, err := uc.get.Execute(ctx, kb.GetPageInput{WorkspaceID: ws, PageID: grand.ID})
		require.NoError(t, err)
		assert.Equal(t, spaceB, grandAfter.Page.SpaceID, "子孫の space_id も一括で変わる")

		treeA, err := uc.tree.Execute(ctx, kb.GetPageTreeInput{WorkspaceID: ws, SpaceID: spaceA})
		require.NoError(t, err)
		assert.Equal(t, "rootA", treeShape(treeA))
		treeB, err := uc.tree.Execute(ctx, kb.GetPageTreeInput{WorkspaceID: ws, SpaceID: spaceB})
		require.NoError(t, err)
		assert.Equal(t, "rootB(child(grand))", treeShape(treeB))

		assert.Equal(t, map[string]int{
			rootA.ID + "→" + rootA.ID: 0,
			rootB.ID + "→" + rootB.ID: 0,
			child.ID + "→" + child.ID: 0,
			child.ID + "→" + rootB.ID: 1,
			grand.ID + "→" + grand.ID: 0,
			grand.ID + "→" + child.ID: 1,
			grand.ID + "→" + rootB.ID: 2,
		}, queryPagePaths(t, sqlDB, ws))
	})

	t.Run("別スペースのルートへの移動もできる", func(t *testing.T) {
		ws, spaceA, spaceB := setup(t)
		rootA := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "rootA")
		child := mustCreatePage(ctx, t, uc, ws, spaceA, &rootA.ID, "child")

		moved, err := uc.move.Execute(ctx, kb.MovePageInput{
			WorkspaceID: ws, PageID: child.ID, NewSpaceID: spaceB,
		})
		require.NoError(t, err)
		assert.Nil(t, moved.ParentID)
		assert.Equal(t, spaceB, moved.SpaceID)

		assert.Equal(t, map[string]int{
			rootA.ID + "→" + rootA.ID: 0,
			child.ID + "→" + child.ID: 0,
		}, queryPagePaths(t, sqlDB, ws), "ルートへ出たので祖先との組は自分自身だけ")
	})

	t.Run("アーカイブでツリーから消え復帰で戻る", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		root := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "root")
		child := mustCreatePage(ctx, t, uc, ws, spaceA, &root.ID, "child")
		keep := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "keep")

		require.NoError(t, uc.archive.Execute(ctx, kb.ArchivePageInput{WorkspaceID: ws, PageID: root.ID}))

		tree, err := uc.tree.Execute(ctx, kb.GetPageTreeInput{WorkspaceID: ws, SpaceID: spaceA})
		require.NoError(t, err)
		assert.Equal(t, "keep", treeShape(tree), "サブツリーごと消える")

		childAfter, err := uc.get.Execute(ctx, kb.GetPageInput{WorkspaceID: ws, PageID: child.ID})
		require.NoError(t, err)
		assert.NotNil(t, childAfter.Page.ArchivedAt, "子孫もアーカイブされる")

		restored, err := uc.unarchive.Execute(ctx, kb.UnarchivePageInput{WorkspaceID: ws, PageID: root.ID})
		require.NoError(t, err)
		assert.Nil(t, restored.ArchivedAt)

		tree, err = uc.tree.Execute(ctx, kb.GetPageTreeInput{WorkspaceID: ws, SpaceID: spaceA})
		require.NoError(t, err)
		assert.Equal(t, "root(child), keep", treeShape(tree), "サブツリーごと戻る")
		_ = keep
	})

	t.Run("復帰時にpositionが衝突したら末尾へ再採番される", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		first := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "first") // position a0

		require.NoError(t, uc.archive.Execute(ctx, kb.ArchivePageInput{WorkspaceID: ws, PageID: first.ID}))
		// アーカイブ中は現役の兄弟がいないので、新しいページが同じ position a0 を取る。
		second := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "second")
		assert.Equal(t, first.Position, second.Position, "前提: 部分 UNIQUE は現役だけを守るので同じ position になる")

		restored, err := uc.unarchive.Execute(ctx, kb.UnarchivePageInput{WorkspaceID: ws, PageID: first.ID})
		require.NoError(t, err)
		assert.Nil(t, restored.ArchivedAt)
		assert.Greater(t, restored.Position, second.Position, "衝突を検出して末尾へ再採番")

		tree, err := uc.tree.Execute(ctx, kb.GetPageTreeInput{WorkspaceID: ws, SpaceID: spaceA})
		require.NoError(t, err)
		assert.Equal(t, "second, first", treeShape(tree))
	})

	t.Run("復帰は根と同時にアーカイブされた一括分だけを戻す", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		root := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "root")
		early := mustCreatePage(ctx, t, uc, ws, spaceA, &root.ID, "early")
		late := mustCreatePage(ctx, t, uc, ws, spaceA, &root.ID, "late")

		// early を先に単独アーカイブ → その後 root ごとアーカイブ。
		require.NoError(t, uc.archive.Execute(ctx, kb.ArchivePageInput{WorkspaceID: ws, PageID: early.ID}))
		require.NoError(t, uc.archive.Execute(ctx, kb.ArchivePageInput{WorkspaceID: ws, PageID: root.ID}))

		_, err := uc.unarchive.Execute(ctx, kb.UnarchivePageInput{WorkspaceID: ws, PageID: root.ID})
		require.NoError(t, err)

		tree, err := uc.tree.Execute(ctx, kb.GetPageTreeInput{WorkspaceID: ws, SpaceID: spaceA})
		require.NoError(t, err)
		assert.Equal(t, "root(late)", treeShape(tree), "先に単独アーカイブした early は戻らない")
		_ = late
	})

	t.Run("親がアーカイブ中のままでは復帰できない", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		root := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "root")
		child := mustCreatePage(ctx, t, uc, ws, spaceA, &root.ID, "child")
		require.NoError(t, uc.archive.Execute(ctx, kb.ArchivePageInput{WorkspaceID: ws, PageID: root.ID}))

		_, err := uc.unarchive.Execute(ctx, kb.UnarchivePageInput{WorkspaceID: ws, PageID: child.ID})
		require.ErrorIs(t, err, kb.ErrPageParentArchived)
	})

	t.Run("アーカイブ済みの親の下には作成も移動もできない", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		root := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "root")
		other := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "other")
		require.NoError(t, uc.archive.Execute(ctx, kb.ArchivePageInput{WorkspaceID: ws, PageID: root.ID}))

		_, err := uc.create.Execute(ctx, kb.CreatePageInput{
			WorkspaceID: ws, SpaceID: spaceA, ParentID: &root.ID, Title: "x", CreatedByUserID: 1,
		})
		require.ErrorIs(t, err, kb.ErrPageParentArchived)

		_, err = uc.move.Execute(ctx, kb.MovePageInput{
			WorkspaceID: ws, PageID: other.ID, NewParentID: &root.ID,
		})
		require.ErrorIs(t, err, kb.ErrPageParentArchived)
	})

	t.Run("ブロック書き換えと取得の往復とsnapshot更新", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		page := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "doc-page")

		doc1 := `{"type":"doc","content":[
			{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"タイトル"}]},
			{"type":"bulletList","content":[
				{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","marks":[{"type":"bold"}],"text":"太字"}]}]}
			]}
		]}`
		snap1, err := uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{WorkspaceID: ws, PageID: page.ID, Doc: doc1, EditorUserID: 1})
		require.NoError(t, err)
		requireJSONEqIgnoringBlockIDs(t, doc1, snap1.Doc)

		got, err := uc.get.Execute(ctx, kb.GetPageInput{WorkspaceID: ws, PageID: page.ID})
		require.NoError(t, err)
		requireJSONEqIgnoringBlockIDs(t, doc1, got.Doc, "保存した doc と取得した doc が同値")

		// snapshot を消しても blocks から同じ doc が組み上がる（正本は blocks 側）。
		_, err = sqlDB.Exec(`DELETE FROM page_snapshots WHERE page_id = $1`, page.ID)
		require.NoError(t, err)
		got, err = uc.get.Execute(ctx, kb.GetPageInput{WorkspaceID: ws, PageID: page.ID})
		require.NoError(t, err)
		requireJSONEqIgnoringBlockIDs(t, doc1, got.Doc, "blocks からの組み立てでも同値")

		// 書き換えると blocks / snapshot が置き換わる。
		doc2 := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"書き換え後"}]}]}`
		snap2, err := uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{WorkspaceID: ws, PageID: page.ID, Doc: doc2, EditorUserID: 1})
		require.NoError(t, err)
		requireJSONEqIgnoringBlockIDs(t, doc2, snap2.Doc, "snapshot が焼き直される")

		var blockCount int
		require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM blocks WHERE page_id = $1`, page.ID).Scan(&blockCount))
		assert.Equal(t, 1, blockCount, "全消し全入れで旧行が残らない")

		// 空 doc で全消しできる。
		empty := `{"type":"doc","content":[]}`
		snap3, err := uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{WorkspaceID: ws, PageID: page.ID, Doc: empty, EditorUserID: 1})
		require.NoError(t, err)
		assert.JSONEq(t, empty, snap3.Doc)
		require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM blocks WHERE page_id = $1`, page.ID).Scan(&blockCount))
		assert.Equal(t, 0, blockCount)
	})

	t.Run("改名できる", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		page := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "旧名")
		renamed, err := uc.rename.Execute(ctx, kb.RenamePageInput{WorkspaceID: ws, PageID: page.ID, Title: "新名"})
		require.NoError(t, err)
		assert.Equal(t, "新名", renamed.Title)
		assert.True(t, renamed.UpdatedAt.After(page.UpdatedAt) || renamed.UpdatedAt.Equal(page.UpdatedAt))
	})

	t.Run("別ワークスペースのページには全usecaseで手が届かない", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		wsOther := createWorkspace(t, sqlDB, "ws-other")
		spaceOther := createSpace(t, sqlDB, wsOther, "other")
		victim := mustCreatePage(ctx, t, uc, wsOther, spaceOther, nil, "victim")
		mine := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "mine")

		// 読み: 取得・ツリー。
		_, err := uc.get.Execute(ctx, kb.GetPageInput{WorkspaceID: ws, PageID: victim.ID})
		require.ErrorIs(t, err, repository.ErrPageNotFound)
		_, err = uc.tree.Execute(ctx, kb.GetPageTreeInput{WorkspaceID: ws, SpaceID: spaceOther})
		require.ErrorIs(t, err, repository.ErrSpaceNotFound)

		// 書き: 作成（親／スペース越え）・改名・移動・アーカイブ・復帰・本文書き換え。
		_, err = uc.create.Execute(ctx, kb.CreatePageInput{
			WorkspaceID: ws, SpaceID: spaceOther, Title: "x", CreatedByUserID: 1,
		})
		require.ErrorIs(t, err, repository.ErrSpaceNotFound)
		_, err = uc.create.Execute(ctx, kb.CreatePageInput{
			WorkspaceID: ws, SpaceID: spaceA, ParentID: &victim.ID, Title: "x", CreatedByUserID: 1,
		})
		require.ErrorIs(t, err, repository.ErrPageNotFound)
		_, err = uc.rename.Execute(ctx, kb.RenamePageInput{WorkspaceID: ws, PageID: victim.ID, Title: "乗っ取り"})
		require.ErrorIs(t, err, repository.ErrPageNotFound)
		_, err = uc.move.Execute(ctx, kb.MovePageInput{WorkspaceID: ws, PageID: victim.ID})
		require.ErrorIs(t, err, repository.ErrPageNotFound)
		_, err = uc.move.Execute(ctx, kb.MovePageInput{WorkspaceID: ws, PageID: mine.ID, NewParentID: &victim.ID})
		require.ErrorIs(t, err, repository.ErrPageNotFound, "別テナントのページを親にもできない")
		err = uc.archive.Execute(ctx, kb.ArchivePageInput{WorkspaceID: ws, PageID: victim.ID})
		require.ErrorIs(t, err, repository.ErrPageNotFound)
		_, err = uc.unarchive.Execute(ctx, kb.UnarchivePageInput{WorkspaceID: ws, PageID: victim.ID})
		require.ErrorIs(t, err, repository.ErrPageNotFound)
		_, err = uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{
			WorkspaceID: ws, PageID: victim.ID, Doc: `{"type":"doc","content":[]}`, EditorUserID: 1,
		})
		require.ErrorIs(t, err, repository.ErrPageNotFound)

		// 相手のページが無傷であること。
		after, err := uc.get.Execute(ctx, kb.GetPageInput{WorkspaceID: wsOther, PageID: victim.ID})
		require.NoError(t, err)
		assert.Equal(t, "victim", after.Page.Title)
		assert.Nil(t, after.Page.ArchivedAt)
	})

	t.Run("ワークスペースとスペースの存在確認", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		found, err := repo.FindWorkspaceByID(ctx, ws)
		require.NoError(t, err)
		assert.Equal(t, "ws-main", found.Slug)
		sp, err := repo.FindSpace(ctx, ws, spaceA)
		require.NoError(t, err)
		assert.Equal(t, "aaa", sp.Key)

		_, err = repo.FindWorkspaceByID(ctx, newID())
		require.ErrorIs(t, err, repository.ErrWorkspaceNotFound)
		_, err = repo.FindSpace(ctx, ws, newID())
		require.ErrorIs(t, err, repository.ErrSpaceNotFound)
	})

	// /kb/spaces/{spaceId} の解決用。ID だけで引くので、別テナントのスペースも引ける
	// （越境を防ぐのは、引いた直後にそのワークスペースで権限判定を通す呼び出し側の handler）。
	t.Run("スペースをIDだけで引く", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		wsOther := createWorkspace(t, sqlDB, "ws-other")
		spaceOther := createSpace(t, sqlDB, wsOther, "other")

		sp, err := repo.FindSpaceByIDAcrossWorkspaces(ctx, spaceA)
		require.NoError(t, err)
		assert.Equal(t, ws, sp.WorkspaceID)
		assert.Equal(t, "aaa", sp.Key)

		other, err := repo.FindSpaceByIDAcrossWorkspaces(ctx, spaceOther)
		require.NoError(t, err)
		assert.Equal(t, wsOther, other.WorkspaceID, "どのワークスペースのスペースかは行から決まる")

		_, err = repo.FindSpaceByIDAcrossWorkspaces(ctx, newID())
		require.ErrorIs(t, err, repository.ErrSpaceNotFound)
		_, err = repo.FindSpaceByIDAcrossWorkspaces(ctx, "not-a-uuid")
		require.ErrorIs(t, err, repository.ErrSpaceNotFound, "不正な形式は DB エラーでなく存在しない扱い")
	})

	// URL 由来の生文字列がそのまま来る想定の入口検証。UUID として不正な ID は
	// DB エラーではなく「存在しない」と同じ結果に落ちること。
	t.Run("不正な形式のIDは存在しない扱いになる", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		bad := "not-a-uuid"

		_, err := repo.FindWorkspaceByID(ctx, bad)
		require.ErrorIs(t, err, repository.ErrWorkspaceNotFound)
		_, err = repo.FindSpace(ctx, ws, bad)
		require.ErrorIs(t, err, repository.ErrSpaceNotFound)
		_, err = repo.FindPage(ctx, ws, bad)
		require.ErrorIs(t, err, repository.ErrPageNotFound)

		pages, err := repo.ListActivePagesBySpace(ctx, ws, bad)
		require.NoError(t, err)
		assert.Empty(t, pages)
		pos, err := repo.LastActiveSiblingPosition(ctx, ws, bad, nil)
		require.NoError(t, err)
		assert.Empty(t, pos)
		conflicted, err := repo.HasActiveSiblingPosition(ctx, ws, spaceA, &bad, "a0", bad)
		require.NoError(t, err)
		assert.False(t, conflicted)
		isDesc, err := repo.HasDescendant(ctx, ws, bad, bad)
		require.NoError(t, err)
		assert.False(t, isDesc)

		err = repo.CreatePage(ctx, &domain.Page{WorkspaceID: ws, SpaceID: bad, Position: "a0", CreatedByUserID: 1})
		require.ErrorIs(t, err, repository.ErrPageNotFound)
		_, err = repo.UpdatePageTitle(ctx, ws, bad, "x")
		require.ErrorIs(t, err, repository.ErrPageNotFound)
		err = repo.MovePage(ctx, ws, bad, nil, spaceA, "a0")
		require.ErrorIs(t, err, repository.ErrPageNotFound)
		err = repo.ArchivePageSubtree(ctx, ws, bad)
		require.ErrorIs(t, err, repository.ErrPageNotFound)
		err = repo.UnarchivePageSubtree(ctx, ws, bad, time.Now(), nil)
		require.ErrorIs(t, err, repository.ErrPageNotFound)
		blocks, err := repo.ListBlocksByPage(ctx, ws, bad)
		require.NoError(t, err)
		assert.Empty(t, blocks)
		err = repo.ReplacePageBlocks(ctx, ws, bad, nil, `{"type":"doc","content":[]}`, "", "", nil, nil)
		require.ErrorIs(t, err, repository.ErrPageNotFound)
		_, err = repo.GetPageSnapshot(ctx, ws, bad)
		require.ErrorIs(t, err, repository.ErrPageSnapshotNotFound)
	})

	t.Run("存在しないページの改名と移動はErrPageNotFound", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		_, err := repo.UpdatePageTitle(ctx, ws, newID(), "x")
		require.ErrorIs(t, err, repository.ErrPageNotFound)
		err = repo.MovePage(ctx, ws, newID(), nil, spaceA, "a0")
		require.ErrorIs(t, err, repository.ErrPageNotFound)
	})

	t.Run("文書順が壊れたBlockWriteは保存を拒否する", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		page := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "broken-rows")
		// 存在しない ID を指す ParentID = dangling 参照。fk_blocks_parent が拒否する。
		danglingParent := "00000000-0000-0000-0000-000000000099"
		err := repo.ReplacePageBlocks(ctx, ws, page.ID, []repository.BlockWrite{
			{ID: uuid.NewString(), ParentID: &danglingParent, Position: "a0", Type: domain.BlockTypeListItem, Attrs: "{}"},
		}, `{"type":"doc","content":[]}`, "", "", nil, nil)
		require.Error(t, err) // fk_blocks_parent 制約違反で失敗するはず
		var blockCount int
		require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM blocks WHERE page_id = $1`, page.ID).Scan(&blockCount))
		assert.Equal(t, 0, blockCount, "途中まで書いた行がロールバックで残らない")
	})

	t.Run("大きめの木でも作成と取得が破綻しない", func(t *testing.T) {
		ws, spaceA, _ := setup(t)
		root := mustCreatePage(ctx, t, uc, ws, spaceA, nil, "root")
		parent := root.ID
		// 深さ 5 × 各 3 兄弟の木。
		for depth := 0; depth < 5; depth++ {
			var next string
			for i := 0; i < 3; i++ {
				p := mustCreatePage(ctx, t, uc, ws, spaceA, &parent, fmt.Sprintf("d%d-%d", depth, i))
				next = p.ID
			}
			parent = next
		}
		tree, err := uc.tree.Execute(ctx, kb.GetPageTreeInput{WorkspaceID: ws, SpaceID: spaceA})
		require.NoError(t, err)
		require.Len(t, tree, 1)
		var count func(nodes []*kb.PageTreeNode) int
		count = func(nodes []*kb.PageTreeNode) int {
			n := len(nodes)
			for _, node := range nodes {
				n += count(node.Children)
			}
			return n
		}
		assert.Equal(t, 16, count(tree))
	})
}

// TestKnowledgeBasePageLastEditedBy_Integration は本文保存で最終編集者が記録され、
// 改名では変わらないことを実 PostgreSQL で固定する（ReplacePageBlocksUseCase 経由）。
func TestKnowledgeBasePageLastEditedBy_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	repo := persistence.NewKnowledgeBaseRepository(sqlDB)
	uc := newKbUseCases(sqlDB)
	ctx := context.Background()
	testsupport.TruncateAll(t, sqlDB, kbTables...)

	ws := createWorkspace(t, sqlDB, "ws-last-edited")
	space := createSpace(t, sqlDB, ws, "eng")
	page := mustCreatePage(ctx, t, uc, ws, space, nil, "対象ページ")

	before, err := repo.FindPage(ctx, ws, page.ID)
	require.NoError(t, err)
	assert.Nil(t, before.LastEditedByUserID, "作成直後は誰も本文を保存していない")

	const editorID = uint64(9)
	_, err = uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{
		WorkspaceID: ws, PageID: page.ID, Doc: `{"type":"doc","content":[]}`, EditorUserID: editorID,
	})
	require.NoError(t, err)

	after, err := repo.FindPage(ctx, ws, page.ID)
	require.NoError(t, err)
	require.NotNil(t, after.LastEditedByUserID)
	assert.Equal(t, editorID, *after.LastEditedByUserID)

	// 改名では最終編集者は変わらない（RenamePageUseCase は Touch を呼ばない）。
	_, err = uc.rename.Execute(ctx, kb.RenamePageInput{WorkspaceID: ws, PageID: page.ID, Title: "改名後"})
	require.NoError(t, err)
	afterRename, err := repo.FindPage(ctx, ws, page.ID)
	require.NoError(t, err)
	require.NotNil(t, afterRename.LastEditedByUserID)
	assert.Equal(t, editorID, *afterRename.LastEditedByUserID, "改名では最終編集者は変わらない")
}

// TestKnowledgeBaseTouchLastEditedByRejectsArchived_Integration は、アーカイブ済みページへの
// TouchPageLastEditedBy が repository.ErrPageNotFound で拒否されることを固定する
// （CodeRabbit 指摘: ReplacePageBlocksUseCase の ArchivedAt 確認と DoInTx の間で別トランザクションが
// アーカイブを commit する競合を、SQL の WHERE 句 archived_at IS NULL で塞ぐ）。
func TestKnowledgeBaseTouchLastEditedByRejectsArchived_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	repo := persistence.NewKnowledgeBaseRepository(sqlDB)
	uc := newKbUseCases(sqlDB)
	ctx := context.Background()
	testsupport.TruncateAll(t, sqlDB, kbTables...)

	ws := createWorkspace(t, sqlDB, "ws-touch-archived")
	space := createSpace(t, sqlDB, ws, "eng")
	page := mustCreatePage(ctx, t, uc, ws, space, nil, "対象ページ")

	require.NoError(t, uc.archive.Execute(ctx, kb.ArchivePageInput{WorkspaceID: ws, PageID: page.ID}))

	err := repo.TouchPageLastEditedBy(ctx, ws, page.ID, 9)
	require.ErrorIs(t, err, repository.ErrPageNotFound, "アーカイブ済みは archived_at IS NULL で 0 行になり ErrPageNotFound になる")

	got, err := repo.FindPage(ctx, ws, page.ID)
	require.NoError(t, err)
	assert.Nil(t, got.LastEditedByUserID, "拒否されているので最終編集者は記録されない")
}

// TestKnowledgeBasePageIcon_Integration はアイコンの設定と解除が jsonb を往復することを固定する。
// jsonb はキー順を並べ替えるため、文字列一致ではなく struct で比較する。
func TestKnowledgeBasePageIcon_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	repo := persistence.NewKnowledgeBaseRepository(sqlDB)
	ctx := context.Background()
	testsupport.TruncateAll(t, sqlDB, kbTables...)

	ws := createWorkspace(t, sqlDB, "ws-icon")
	space := createSpace(t, sqlDB, ws, "eng")
	pageID := createPage(t, sqlDB, ws, space, nil, "a0")

	icon := &domain.PageIcon{Type: domain.PageIconTypeEmoji, Value: "📘"}
	updated, err := repo.UpdatePageIcon(ctx, ws, pageID, icon)
	require.NoError(t, err)
	require.NotNil(t, updated.Icon)
	assert.Equal(t, *icon, *updated.Icon)

	got, err := repo.FindPage(ctx, ws, pageID)
	require.NoError(t, err)
	require.NotNil(t, got.Icon, "設定したアイコンが読み出しにも往復する")
	assert.Equal(t, *icon, *got.Icon)

	cleared, err := repo.UpdatePageIcon(ctx, ws, pageID, nil)
	require.NoError(t, err)
	assert.Nil(t, cleared.Icon, "nil を渡すと解除される")

	gotAfterClear, err := repo.FindPage(ctx, ws, pageID)
	require.NoError(t, err)
	assert.Nil(t, gotAfterClear.Icon)
}

// TestKnowledgeBasePageCover_Integration はカバー画像の設定と解除が jsonb を往復することを
// 固定する（TestKnowledgeBasePageIcon_Integration と同じ形）。
func TestKnowledgeBasePageCover_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	repo := persistence.NewKnowledgeBaseRepository(sqlDB)
	ctx := context.Background()
	testsupport.TruncateAll(t, sqlDB, kbTables...)

	ws := createWorkspace(t, sqlDB, "ws-cover")
	space := createSpace(t, sqlDB, ws, "eng")
	pageID := createPage(t, sqlDB, ws, space, nil, "a0")

	cover := &domain.PageCover{Type: domain.PageCoverTypeFile, Key: "kb/" + ws + "/" + pageID + "/1.bin"}
	updated, err := repo.UpdatePageCover(ctx, ws, pageID, cover)
	require.NoError(t, err)
	require.NotNil(t, updated.Cover)
	assert.Equal(t, *cover, *updated.Cover)

	got, err := repo.FindPage(ctx, ws, pageID)
	require.NoError(t, err)
	require.NotNil(t, got.Cover, "設定したカバーが読み出しにも往復する")
	assert.Equal(t, *cover, *got.Cover)

	cleared, err := repo.UpdatePageCover(ctx, ws, pageID, nil)
	require.NoError(t, err)
	assert.Nil(t, cleared.Cover, "nil を渡すと解除される")

	gotAfterClear, err := repo.FindPage(ctx, ws, pageID)
	require.NoError(t, err)
	assert.Nil(t, gotAfterClear.Cover)
}

// TestKnowledgeBaseUpdatePageCoverRejectsArchived_Integration は、UpdatePageIcon には無い
// archived_at IS NULL の絞り込みを UpdatePageCover が最初から持つことを固定する
// （段 1a の TouchPageLastEditedBy で見つかった「アーカイブ後の競合」の教訓 — SQL コメント参照）。
// アーカイブ済みページへの更新は 0 行 = sql.ErrNoRows = repository.ErrPageNotFound になる。
func TestKnowledgeBaseUpdatePageCoverRejectsArchived_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	repo := persistence.NewKnowledgeBaseRepository(sqlDB)
	ctx := context.Background()
	testsupport.TruncateAll(t, sqlDB, kbTables...)

	ws := createWorkspace(t, sqlDB, "ws-cover-archived")
	space := createSpace(t, sqlDB, ws, "eng")
	archivedAt := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	pageID := newID()
	require.NoError(t, insertPage(sqlDB, pageID, ws, space, nil, "a0", &archivedAt))

	cover := &domain.PageCover{Type: domain.PageCoverTypeFile, Key: "kb/" + ws + "/" + pageID + "/1.bin"}
	_, err := repo.UpdatePageCover(ctx, ws, pageID, cover)
	require.ErrorIs(t, err, repository.ErrPageNotFound,
		"アーカイブ済みは archived_at IS NULL で 0 行になり ErrPageNotFound になる")

	got, err := repo.FindPage(ctx, ws, pageID)
	require.NoError(t, err)
	assert.Nil(t, got.Cover, "拒否されているのでカバーは設定されない")
}

// TestKnowledgeBaseReplaceBlocksTransaction_Integration は「最終編集者の記録と本文置換は
// 外側のトランザクションで一体になる」ことを固定する。TouchPageLastEditedBy → 壊れた
// rows での ReplacePageBlocks を同じ DoInTx でくくり、失敗後に両方とも元の状態のまま
// （last_edited_by_user_id が NULL のまま・blocks が 0 行のまま）であることを見る
// —— knowledgeBaseRepository.runInTx が外側の tx に相乗りしている直接の証拠になる
// （相乗りしていなければ、Touch や差分 UPSERT の DELETE/UPSERT が別トランザクションで
// commit されて残る）。
func TestKnowledgeBaseReplaceBlocksTransaction_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	repo := persistence.NewKnowledgeBaseRepository(sqlDB)
	txManager := persistence.NewTxManager(sqlDB)
	uc := newKbUseCases(sqlDB)
	ctx := context.Background()
	testsupport.TruncateAll(t, sqlDB, kbTables...)

	ws := createWorkspace(t, sqlDB, "ws-tx-boundary")
	space := createSpace(t, sqlDB, ws, "eng")
	page := mustCreatePage(ctx, t, uc, ws, space, nil, "対象ページ")

	const editorID = uint64(11)
	// 存在しない ID を指す ParentID = dangling 参照。knowledgeBaseRepository.ReplacePageBlocks
	// は ParentID の dangling 参照を Go 側で事前検証しない（fk_blocks_parent の FK 制約が
	// INSERT 時点で自然に拒否するので、そちらに任せる設計）。それでも DoInTx の外側の
	// トランザクションに乗っている限り、直前の Touch も道連れでロールバックされるはず。
	danglingParent := "00000000-0000-0000-0000-000000000098"
	broken := []repository.BlockWrite{
		{ID: uuid.NewString(), ParentID: &danglingParent, Position: "a0", Type: domain.BlockTypeParagraph, Attrs: "{}"},
	}
	err := txManager.DoInTx(ctx, func(ctx context.Context) error {
		if err := repo.TouchPageLastEditedBy(ctx, ws, page.ID, editorID); err != nil {
			return err
		}
		return repo.ReplacePageBlocks(ctx, ws, page.ID, broken, `{"type":"doc","content":[]}`, "", "", nil, nil)
	})
	require.Error(t, err, "壊れた行で ReplacePageBlocks が失敗する")

	got, err := repo.FindPage(ctx, ws, page.ID)
	require.NoError(t, err)
	assert.Nil(t, got.LastEditedByUserID, "Touch も同じトランザクションでロールバックされる")

	blocks, err := repo.ListBlocksByPage(ctx, ws, page.ID)
	require.NoError(t, err)
	assert.Empty(t, blocks, "本文も書き込まれない（差分 UPSERT の UpsertBlock もロールバックされる）")
}

// TestKnowledgeBaseReplacePageBlocksDiffUpsert_Integration は差分 UPSERT（ReplacePageBlocks の
// 「消えた id だけ DELETE・生き残る id は UPDATE・新しい id だけ INSERT」という書き換え方式）の
// 正しさを実 PostgreSQL で固定する。全消し全入れに戻っていないことの直接証拠になる。
func TestKnowledgeBaseReplacePageBlocksDiffUpsert_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	repo := persistence.NewKnowledgeBaseRepository(sqlDB)
	uc := newKbUseCases(sqlDB)
	ctx := context.Background()

	setup := func(t *testing.T) (ws, space string) {
		t.Helper()
		testsupport.TruncateAll(t, sqlDB, kbTables...)
		ws = createWorkspace(t, sqlDB, "ws-diff-upsert")
		space = createSpace(t, sqlDB, ws, "eng")
		return ws, space
	}

	// blockCreatedAt はテスト内で「同じ行が保たれているか（created_at が変わっていないか）」を
	// 確かめるための直接 SELECT。
	blockCreatedAt := func(t *testing.T, id string) time.Time {
		t.Helper()
		var createdAt time.Time
		require.NoError(t, sqlDB.QueryRow(`SELECT created_at FROM blocks WHERE id = $1`, id).Scan(&createdAt))
		return createdAt
	}
	blockExists := func(t *testing.T, id string) bool {
		t.Helper()
		var count int
		require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM blocks WHERE id = $1`, id).Scan(&count))
		return count > 0
	}

	t.Run("本文を書き換えても既存ブロックのidは保たれる", func(t *testing.T) {
		ws, space := setup(t)
		page := mustCreatePage(ctx, t, uc, ws, space, nil, "diff-upsert-page")

		fixedID := newID()
		inline1 := `[{"type":"text","text":"最初の内容"}]`
		err := repo.ReplacePageBlocks(ctx, ws, page.ID, []repository.BlockWrite{
			{ID: fixedID, Position: "a0", Type: domain.BlockTypeParagraph, Attrs: "{}", Inline: &inline1},
		}, fmt.Sprintf(`{"type":"doc","content":[{"type":"paragraph","attrs":{"id":%q},"content":%s}]}`, fixedID, inline1), "", "", nil, nil)
		require.NoError(t, err)
		createdAt1 := blockCreatedAt(t, fixedID)

		// 同じ id・少し変えた内容（inline のテキスト）で再保存する。
		inline2 := `[{"type":"text","text":"書き換え後の内容"}]`
		err = repo.ReplacePageBlocks(ctx, ws, page.ID, []repository.BlockWrite{
			{ID: fixedID, Position: "a0", Type: domain.BlockTypeParagraph, Attrs: "{}", Inline: &inline2},
		}, fmt.Sprintf(`{"type":"doc","content":[{"type":"paragraph","attrs":{"id":%q},"content":%s}]}`, fixedID, inline2), "", "", nil, nil)
		require.NoError(t, err)

		var count int
		require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM blocks WHERE page_id = $1`, page.ID).Scan(&count))
		assert.Equal(t, 1, count, "同じ id の行が 1 つだけ残っている（別行の delete/insert ではない）")

		var gotInline []byte
		require.NoError(t, sqlDB.QueryRow(`SELECT inline FROM blocks WHERE id = $1`, fixedID).Scan(&gotInline))
		assert.Contains(t, string(gotInline), "書き換え後の内容", "中身は書き換わっている")

		createdAt2 := blockCreatedAt(t, fixedID)
		assert.Equal(t, createdAt1, createdAt2, "行そのものは UPDATE されるだけで created_at は変わらない（同一行である証拠）")
	})

	t.Run("ページから消えたブロックのidは本当に削除される", func(t *testing.T) {
		ws, space := setup(t)
		page := mustCreatePage(ctx, t, uc, ws, space, nil, "diff-upsert-delete-page")

		id1, id2 := newID(), newID()
		inline := `[{"type":"text","text":"x"}]`
		err := repo.ReplacePageBlocks(ctx, ws, page.ID, []repository.BlockWrite{
			{ID: id1, Position: "a0", Type: domain.BlockTypeParagraph, Attrs: "{}", Inline: &inline},
			{ID: id2, Position: "a1", Type: domain.BlockTypeParagraph, Attrs: "{}", Inline: &inline},
		}, `{"type":"doc","content":[]}`, "", "", nil, nil)
		require.NoError(t, err)
		require.True(t, blockExists(t, id1))
		require.True(t, blockExists(t, id2))

		// id2 を含まない doc で再保存する。
		err = repo.ReplacePageBlocks(ctx, ws, page.ID, []repository.BlockWrite{
			{ID: id1, Position: "a0", Type: domain.BlockTypeParagraph, Attrs: "{}", Inline: &inline},
		}, `{"type":"doc","content":[]}`, "", "", nil, nil)
		require.NoError(t, err)

		assert.True(t, blockExists(t, id1), "残った id は消えない")
		assert.False(t, blockExists(t, id2), "ページから消えた id は本当に削除される")
	})

	t.Run("他ページのidを乗っ取ろうとすると拒否される", func(t *testing.T) {
		ws, space := setup(t)
		pageA := mustCreatePage(ctx, t, uc, ws, space, nil, "page-a")
		pageB := mustCreatePage(ctx, t, uc, ws, space, nil, "page-b")

		sharedID := newID()
		inline := `[{"type":"text","text":"page-aの内容"}]`
		err := repo.ReplacePageBlocks(ctx, ws, pageA.ID, []repository.BlockWrite{
			{ID: sharedID, Position: "a0", Type: domain.BlockTypeParagraph, Attrs: "{}", Inline: &inline},
		}, `{"type":"doc","content":[]}`, "", "", nil, nil)
		require.NoError(t, err)
		createdAtBefore := blockCreatedAt(t, sharedID)
		var inlineBefore []byte
		require.NoError(t, sqlDB.QueryRow(`SELECT inline FROM blocks WHERE id = $1`, sharedID).Scan(&inlineBefore))

		// ページ B の保存で、ページ A に既に存在する id を新規ブロックとして送る。
		hijackInline := `[{"type":"text","text":"乗っ取ろうとした内容"}]`
		err = repo.ReplacePageBlocks(ctx, ws, pageB.ID, []repository.BlockWrite{
			{ID: sharedID, Position: "a0", Type: domain.BlockTypeParagraph, Attrs: "{}", Inline: &hijackInline},
		}, `{"type":"doc","content":[]}`, "", "", nil, nil)
		require.ErrorIs(t, err, repository.ErrBlockIDConflict)

		var countInB int
		require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM blocks WHERE page_id = $1`, pageB.ID).Scan(&countInB))
		assert.Zero(t, countInB, "ページ B 側に id の行が作られない")

		var pageIDOfShared string
		require.NoError(t, sqlDB.QueryRow(`SELECT page_id::text FROM blocks WHERE id = $1`, sharedID).Scan(&pageIDOfShared))
		assert.Equal(t, pageA.ID, pageIDOfShared, "ページ A 側の行は乗っ取られていない")
		var inlineAfter []byte
		require.NoError(t, sqlDB.QueryRow(`SELECT inline FROM blocks WHERE id = $1`, sharedID).Scan(&inlineAfter))
		assert.Equal(t, string(inlineBefore), string(inlineAfter), "ページ A 側の中身も変更されていない")
		assert.Equal(t, createdAtBefore, blockCreatedAt(t, sharedID))
	})

	t.Run("同じ内容を繰り返し保存してもpositionの一意制約に落ちない", func(t *testing.T) {
		ws, space := setup(t)
		page := mustCreatePage(ctx, t, uc, ws, space, nil, "diff-upsert-repeat-page")

		ids := []string{newID(), newID(), newID(), newID()}
		positions := []string{"a0", "a1", "a2", "a3"}
		inline := `[{"type":"text","text":"兄弟"}]`
		buildRows := func(order []string) []repository.BlockWrite {
			rows := make([]repository.BlockWrite, 0, len(order))
			for i, id := range order {
				rows = append(rows, repository.BlockWrite{
					ID: id, Position: positions[i], Type: domain.BlockTypeParagraph, Attrs: "{}", Inline: &inline,
				})
			}
			return rows
		}

		// id と position の組が毎回同じ（flattenPageDoc は木の形が同じなら常に同じ position
		// 列を返す）だけでは ParkBlockPositions を経由しなくても衝突しない（各 UPSERT が
		// 自分自身と同じ行に同じ position を書くだけ）。ParkBlockPositions の必要性を
		// 実際に検証するには、id と position の対応が入れ替わるケースが要る
		// （CodeRabbit 指摘: このケースは元々 ParkBlockPositions を削除しても通ってしまう）。
		for i := 0; i < 3; i++ {
			err := repo.ReplacePageBlocks(ctx, ws, page.ID, buildRows(ids), `{"type":"doc","content":[]}`, "", "", nil, nil)
			require.NoError(t, err, "%d 回目の保存", i+1)
		}

		// ここが ParkBlockPositions の本題。id と position の対応を逆順に入れ替えると、
		// 退避が無い限り「まだ古い position を持つ別の生存行」と一時的に衝突する
		// （uq_blocks_page_position）。エラーにならないことがその素通りの証拠。
		reversed := []string{ids[3], ids[2], ids[1], ids[0]}
		require.NoError(t,
			repo.ReplacePageBlocks(ctx, ws, page.ID, buildRows(reversed), `{"type":"doc","content":[]}`, "", "", nil, nil),
			"id と position の対応を入れ替えた保存")

		var count int
		require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM blocks WHERE page_id = $1`, page.ID).Scan(&count))
		assert.Equal(t, len(ids), count)
	})

	t.Run("UpsertBlockのDO_UPDATEは所有者が食い違う行を素通りし影響行数0を返す", func(t *testing.T) {
		// ReplacePageBlocks の事前チェック（ListExistingBlockIDsAmong）は行をロックしないため、
		// 別ページ・別ワークスペースの保存が同じ id を先に INSERT するレースを塞ぎきれない
		// 場合がある（CodeRabbit 指摘）。その最後の防衛線が UpsertBlock の
		// ON CONFLICT (id) DO UPDATE ... WHERE workspace_id = ... AND page_id = ...。
		// ここではその防衛線だけを、事前チェックを経由せず sqlcgen を直接呼んで検証する
		// （実際の並行レースを再現するのは不安定なテストになるため、SQL レベルの
		// 振る舞いを単体で固定する）。
		wsA, spaceA := setup(t)
		pageA := mustCreatePage(ctx, t, uc, wsA, spaceA, nil, "owner-guard-page-a")
		// 2 つ目のワークスペースは setup を使わない（setup は TruncateAll するため、
		// 呼び直すと直前に作った page A ごと消えてしまう）。
		wsB := createWorkspace(t, sqlDB, "ws-diff-upsert-owner-guard-b")
		spaceB := createSpace(t, sqlDB, wsB, "eng")
		pageB := mustCreatePage(ctx, t, uc, wsB, spaceB, nil, "owner-guard-page-b")

		sharedID := newID()
		inlineA := `[{"type":"text","text":"page A の内容"}]`
		require.NoError(t, repo.ReplacePageBlocks(ctx, wsA, pageA.ID, []repository.BlockWrite{
			{ID: sharedID, Position: "a0", Type: domain.BlockTypeParagraph, Attrs: "{}", Inline: &inlineA},
		}, fmt.Sprintf(`{"type":"doc","content":[{"type":"paragraph","attrs":{"id":%q},"content":%s}]}`, sharedID, inlineA), "", "", nil, nil))

		id, err := uuid.Parse(sharedID)
		require.NoError(t, err)
		wsBUUID, err := uuid.Parse(wsB)
		require.NoError(t, err)
		pageBUUID, err := uuid.Parse(pageB.ID)
		require.NoError(t, err)
		inlineB := json.RawMessage(`[{"type":"text","text":"乗っ取りを試みる内容"}]`)

		rows, err := sqlcgen.New(sqlDB).UpsertBlock(ctx, sqlcgen.UpsertBlockParams{
			ID:          id,
			WorkspaceID: wsBUUID,
			PageID:      pageBUUID,
			Position:    "a0",
			Type:        string(domain.BlockTypeParagraph),
			Attrs:       json.RawMessage("{}"),
			Inline:      &inlineB,
		})
		require.NoError(t, err)
		assert.Equal(t, int64(0), rows, "所有者(workspace_id/page_id)が食い違う衝突はDO UPDATEのWHEREで素通りする")

		// page A 側の行は無傷のまま（別ページに乗っ取られていない）。
		var gotWorkspaceID, gotPageID string
		require.NoError(t, sqlDB.QueryRow(
			`SELECT workspace_id::text, page_id::text FROM blocks WHERE id = $1`, sharedID,
		).Scan(&gotWorkspaceID, &gotPageID))
		assert.Equal(t, wsA, gotWorkspaceID)
		assert.Equal(t, pageA.ID, gotPageID)
	})
}

// TestKnowledgeBaseSimpleProtocol_Integration は simple query protocol（本番の
// transaction pooler と同じ経路）で blocks.inline（NULL 可 jsonb）の INSERT / SELECT が
// 通ることを固定する回帰テスト。extended protocol では型の取り違えが OID で救われてしまい、
// ローカル / CI の既定接続では原理的に検出できない（段 1-a で確定した欠陥の再発防止）。
func TestKnowledgeBaseSimpleProtocol_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDBSimpleProtocol(t)
	repo := persistence.NewKnowledgeBaseRepository(sqlDB)
	uc := newKbUseCases(sqlDB)
	ctx := context.Background()

	testsupport.TruncateAll(t, sqlDB, kbTables...)
	ws := createWorkspace(t, sqlDB, "ws-simple")
	space := createSpace(t, sqlDB, ws, "eng")
	page := mustCreatePage(ctx, t, uc, ws, space, nil, "simple-protocol")

	// inline あり（葉）と inline NULL（容器・区切り線）を両方通す。
	doc := `{"type":"doc","content":[
		{"type":"paragraph","content":[{"type":"text","text":"simple protocol 経由"}]},
		{"type":"horizontalRule"},
		{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"項目"}]}]}]}
	]}`
	snap, err := uc.replace.Execute(ctx, kb.ReplacePageBlocksInput{WorkspaceID: ws, PageID: page.ID, Doc: doc, EditorUserID: 1})
	require.NoError(t, err)
	requireJSONEqIgnoringBlockIDs(t, doc, snap.Doc)

	got, err := uc.get.Execute(ctx, kb.GetPageInput{WorkspaceID: ws, PageID: page.ID})
	require.NoError(t, err)
	requireJSONEqIgnoringBlockIDs(t, doc, got.Doc)

	// 行レベルでも inline の NULL / 非 NULL が意図どおり保存されていること。
	blocks, err := repo.ListBlocksByPage(ctx, ws, page.ID)
	require.NoError(t, err)
	require.Len(t, blocks, 5)
	byType := map[domain.BlockType]*domain.Block{}
	for i := range blocks {
		byType[blocks[i].Type] = &blocks[i]
	}
	require.NotNil(t, byType[domain.BlockTypeParagraph].Inline, "葉ノードは inline を持つ")
	require.Nil(t, byType[domain.BlockTypeHorizontalRule].Inline, "content の無いノードは inline NULL")
	require.Nil(t, byType[domain.BlockTypeBulletList].Inline, "容器ノードは inline NULL")

	// icon（NULL 可 jsonb）も simple protocol で往復すること。sqlc.yaml の *json.RawMessage
	// override が守っているのはまさにこの経路 — []byte のままだと本番の simple protocol で
	// bytea リテラルへ埋め込まれ jsonb 列に対して 22P02 になる（このテストの本題）。
	updated, err := repo.UpdatePageIcon(ctx, ws, page.ID, &domain.PageIcon{Type: domain.PageIconTypeEmoji, Value: "📘"})
	require.NoError(t, err)
	require.NotNil(t, updated.Icon)
	assert.Equal(t, domain.PageIcon{Type: domain.PageIconTypeEmoji, Value: "📘"}, *updated.Icon)

	// page_versions.doc（NOT NULL jsonb）と note（nullable text）も simple protocol で往復する
	// こと（FRESTYLE-433 段 3）。doc は page_snapshots.doc / blocks.attrs と同じ「素の
	// json.RawMessage をそのまま渡す」経路なので、このテストの本題（icon の pointer 型
	// override）とは別の懸念だが、page_versions で新しく増えた書き込み経路として確認しておく。
	versionRepo := persistence.NewPageVersionRepository(sqlDB)
	note := "simple protocol 経由のメモ"
	created, versionDoc, err := versionRepo.CreateVersionIfDue(ctx, ws, page.ID, doc, 1, &note, true)
	require.NoError(t, err)
	require.True(t, created)
	require.NotNil(t, versionDoc)
	requireJSONEqIgnoringBlockIDs(t, doc, versionDoc.Doc)

	gotVersion, err := versionRepo.GetVersion(ctx, ws, page.ID, versionDoc.Seq)
	require.NoError(t, err)
	requireJSONEqIgnoringBlockIDs(t, doc, gotVersion.Doc)
	require.NotNil(t, gotVersion.Note)
	assert.Equal(t, note, *gotVersion.Note)
}

// TestKnowledgeBaseDeleteWorkspace_Integration は DeleteWorkspace が人の居るワークスペースを
// 守り、それ以外は配下ごと消すことを実 PostgreSQL で固定する。
func TestKnowledgeBaseDeleteWorkspace_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	repo := persistence.NewKnowledgeBaseRepository(sqlDB)
	truncTables := append([]string{"users"}, kbTables...)

	t.Run("所属している人がいるワークスペースは消さない", func(t *testing.T) {
		testsupport.TruncateAll(t, sqlDB, truncTables...)
		ws := createWorkspace(t, sqlDB, "ws-with-members")
		member := createUser(t, sqlDB, "member")
		// 段 2: 所属の正本は workspace_members（active な行）。
		_, err := sqlDB.Exec(
			`INSERT INTO workspace_members (workspace_id, user_id, status, joined_at) VALUES ($1, $2, 'active', now())`,
			ws, member,
		)
		require.NoError(t, err)

		err = repo.DeleteWorkspace(ctx, ws)
		assert.ErrorIs(t, err, repository.ErrWorkspaceHasMembers)

		var count int
		require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM workspaces WHERE id = $1`, ws).Scan(&count))
		assert.Equal(t, 1, count, "人の居るワークスペースは残っていなければならない")
	})

	t.Run("誰も所属していないワークスペースは配下ごと消える", func(t *testing.T) {
		testsupport.TruncateAll(t, sqlDB, truncTables...)
		ws := createWorkspace(t, sqlDB, "ws-personal")
		createSpace(t, sqlDB, ws, "eng")

		require.NoError(t, repo.DeleteWorkspace(ctx, ws))

		var wsCount, spaceCount int
		require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM workspaces WHERE id = $1`, ws).Scan(&wsCount))
		require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM spaces WHERE workspace_id = $1`, ws).Scan(&spaceCount))
		assert.Zero(t, wsCount)
		assert.Zero(t, spaceCount, "配下は FK CASCADE で一緒に消える")
	})

	t.Run("招待中の人しかいないワークスペースは消える（まだ誰も実際には所属していない）", func(t *testing.T) {
		testsupport.TruncateAll(t, sqlDB, truncTables...)
		ws := createWorkspace(t, sqlDB, "ws-invited-only")
		invitee := createUser(t, sqlDB, "invitee")
		_, err := sqlDB.Exec(
			`INSERT INTO workspace_members (workspace_id, user_id, status) VALUES ($1, $2, 'invited')`,
			ws, invitee,
		)
		require.NoError(t, err)

		require.NoError(t, repo.DeleteWorkspace(ctx, ws), "invited だけでは「人が居る」に数えない")
	})

	t.Run("段2移行前の姿: principalsだけの既存メンバーはbackfillしないと守られない", func(t *testing.T) {
		// 本番は 2026-09-11 時点で principals(kind='user') が 6 件（workspace_members は
		// まだ存在しない）。段 2 の schema-apply を先に当てて workspace_members への
		// backfill を後回しにすると、既存メンバーがいるワークスペースでも
		// 「人が居ない」と誤判定されて消せてしまう（安全装置の穴）。
		// この危険性を再現したうえで、正しい backfill 手順（apply の前に実行する）が
		// それを塞ぐことを固定する。
		testsupport.TruncateAll(t, sqlDB, truncTables...)
		ws := createWorkspace(t, sqlDB, "ws-migration-before")
		member := createUser(t, sqlDB, "legacy-member")
		_, err := sqlDB.Exec(
			`INSERT INTO principals (id, workspace_id, kind, user_id) VALUES (gen_random_uuid(), $1, 'user', $2)`,
			ws, member,
		)
		require.NoError(t, err)

		require.NoError(t, repo.DeleteWorkspace(ctx, ws),
			"backfill 前は workspace_members が空なので誤って消せてしまう（危険性の実証）")

		// 同じ状況を、backfill を先に実行してから再現する。
		ws2 := createWorkspace(t, sqlDB, "ws-migration-after")
		member2 := createUser(t, sqlDB, "legacy-member-2")
		_, err = sqlDB.Exec(
			`INSERT INTO principals (id, workspace_id, kind, user_id) VALUES (gen_random_uuid(), $1, 'user', $2)`,
			ws2, member2,
		)
		require.NoError(t, err)
		// 本番適用手順: schema-apply の前に実行する backfill（PR の説明にも記載）。
		_, err = sqlDB.Exec(`
			INSERT INTO workspace_members (workspace_id, user_id, status, joined_at, created_at, updated_at)
			SELECT p.workspace_id, p.user_id, 'active', p.created_at, p.created_at, p.updated_at
			FROM principals p
			WHERE p.kind = 'user'
			ON CONFLICT (workspace_id, user_id) DO NOTHING`)
		require.NoError(t, err)

		err = repo.DeleteWorkspace(ctx, ws2)
		assert.ErrorIs(t, err, repository.ErrWorkspaceHasMembers, "backfill 後は正しく守られる")
	})

	t.Run("存在しないワークスペースはErrWorkspaceNotFound", func(t *testing.T) {
		testsupport.TruncateAll(t, sqlDB, truncTables...)
		err := repo.DeleteWorkspace(ctx, newID())
		assert.ErrorIs(t, err, repository.ErrWorkspaceNotFound)
	})
}
