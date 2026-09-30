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

// pageTemplateTables は page_templates を含めたナレッジのテーブル（TRUNCATE 対象）。
// kbTables（knowledge_base_schema_integration_test.go）に page_templates を加えたもの
// （pageVersionTables と同じ役割分担）。
var pageTemplateTables = []string{
	"page_templates",
	"space_grants", "workspace_grants",
	"principal_members", "principals",
	"blocks", "page_paths", "page_snapshots", "page_search", "page_links", "pages", "spaces", "workspaces",
}

const pageTemplateTestDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"雛形の本文"}]}]}`

// setupPageTemplateFixture はワークスペース・スペース・ページを 1 枚ずつ作る
// （page_templates 単体のテストに必要な最小限。setupPageVersionFixture と同じ形）。
func setupPageTemplateFixture(t *testing.T, db *sql.DB, slug string) (ws, space, page string) {
	t.Helper()
	testsupport.TruncateAll(t, db, pageTemplateTables...)
	ws = createWorkspace(t, db, slug)
	space = createSpace(t, db, ws, "eng")
	page = createPage(t, db, ws, space, nil, "a0")
	return ws, space, page
}

// TestPageTemplateRepository_DuplicateName_Integration は同じワークスペース内で同名の
// 雛形を 2 回作ろうとすると、一意制約（uq_page_templates_workspace_name）違反が
// repository.ErrDuplicateTemplateName へ翻訳されることを固定する。
func TestPageTemplateRepository_DuplicateName_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, _, _ := setupPageTemplateFixture(t, sqlDB, "ws-tpl-dup")
	repo := persistence.NewPageTemplateRepository(sqlDB)

	tpl1 := &domain.PageTemplate{WorkspaceID: ws, Name: "議事録", Doc: pageTemplateTestDoc, CreatedByUserID: 1}
	require.NoError(t, repo.Create(ctx, tpl1))

	tpl2 := &domain.PageTemplate{WorkspaceID: ws, Name: "議事録", Doc: pageTemplateTestDoc, CreatedByUserID: 1}
	err := repo.Create(ctx, tpl2)
	require.ErrorIs(t, err, repository.ErrDuplicateTemplateName)
}

// TestPageTemplateRepository_ListBySpace_Integration は spaceId 絞り込みの規則
// （そのスペース向けの雛形はそのスペースの一覧にだけ出る／ワークスペース全体向けの雛形は
// どのスペースの一覧からも見える）を固定する。
func TestPageTemplateRepository_ListBySpace_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, spaceA, _ := setupPageTemplateFixture(t, sqlDB, "ws-tpl-list")
	spaceB := createSpace(t, sqlDB, ws, "design")
	repo := persistence.NewPageTemplateRepository(sqlDB)

	workspaceWide := &domain.PageTemplate{WorkspaceID: ws, Name: "全体向け", Doc: pageTemplateTestDoc, CreatedByUserID: 1}
	require.NoError(t, repo.Create(ctx, workspaceWide))
	scopedToA := &domain.PageTemplate{WorkspaceID: ws, SpaceID: &spaceA, Name: "Aだけ", Doc: pageTemplateTestDoc, CreatedByUserID: 1}
	require.NoError(t, repo.Create(ctx, scopedToA))
	scopedToB := &domain.PageTemplate{WorkspaceID: ws, SpaceID: &spaceB, Name: "Bだけ", Doc: pageTemplateTestDoc, CreatedByUserID: 1}
	require.NoError(t, repo.Create(ctx, scopedToB))

	t.Run("スペースAの一覧には全体向けとAだけが出る", func(t *testing.T) {
		got, err := repo.List(ctx, ws, &spaceA)
		require.NoError(t, err)
		names := templateNames(got)
		assert.ElementsMatch(t, []string{"全体向け", "Aだけ"}, names)
	})

	t.Run("スペースBの一覧には全体向けとBだけが出る", func(t *testing.T) {
		got, err := repo.List(ctx, ws, &spaceB)
		require.NoError(t, err)
		names := templateNames(got)
		assert.ElementsMatch(t, []string{"全体向け", "Bだけ"}, names)
	})

	t.Run("spaceIdを指定しない一覧には全体向けだけが出る", func(t *testing.T) {
		got, err := repo.List(ctx, ws, nil)
		require.NoError(t, err)
		names := templateNames(got)
		assert.ElementsMatch(t, []string{"全体向け"}, names)
	})

	t.Run("一覧の行はdocを持ち出さない", func(t *testing.T) {
		got, err := repo.List(ctx, ws, nil)
		require.NoError(t, err)
		require.Len(t, got, 1)
		assert.Empty(t, got[0].Doc, "一覧クエリはdoc列を選択しない（ListPageTemplatesRowにDocが無い）")
	})
}

func templateNames(templates []domain.PageTemplate) []string {
	out := make([]string, 0, len(templates))
	for _, tpl := range templates {
		out = append(out, tpl.Name)
	}
	return out
}

// TestPageTemplateRepository_TenantIsolation_Integration は別テナントの雛形が
// 一切見えない・触れないことを固定する（List / Get / Delete のいずれも workspace_id が
// 違えば「存在しない」と同じ扱いになる）。
func TestPageTemplateRepository_TenantIsolation_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	testsupport.TruncateAll(t, sqlDB, pageTemplateTables...)
	wsA := createWorkspace(t, sqlDB, "ws-tpl-tenant-a")
	wsB := createWorkspace(t, sqlDB, "ws-tpl-tenant-b")
	repo := persistence.NewPageTemplateRepository(sqlDB)

	tpl := &domain.PageTemplate{WorkspaceID: wsA, Name: "他社秘密", Doc: pageTemplateTestDoc, CreatedByUserID: 1}
	require.NoError(t, repo.Create(ctx, tpl))

	t.Run("別テナントのworkspace_idでは覗けない", func(t *testing.T) {
		_, err := repo.Get(ctx, wsB, tpl.ID)
		assert.ErrorIs(t, err, domain.ErrPageTemplateNotFound)
	})

	t.Run("別テナントの一覧には出ない", func(t *testing.T) {
		got, err := repo.List(ctx, wsB, nil)
		require.NoError(t, err)
		assert.Empty(t, got)
	})

	t.Run("別テナントのworkspace_idでは削除できない", func(t *testing.T) {
		err := repo.Delete(ctx, wsB, tpl.ID)
		assert.ErrorIs(t, err, domain.ErrPageTemplateNotFound)
		// 本当に消えていないことも確かめる。
		_, getErr := repo.Get(ctx, wsA, tpl.ID)
		assert.NoError(t, getErr)
	})
}

// TestCreatePageFromTemplate_TwoPagesDoNotCollide_Integration は
// regenerateBlockIDs が効いていることの直接確認: 同じ雛形から 2 ページ作っても、
// blocks.id（グローバルに一意な PK）が衝突せず両方保存できることを固定する
// （knowledge_base_repository_integration_test.go の blocks 確認パターンを踏襲し、
// 2 ページ分の blocks が実際に別々の id で存在することまで見る）。
func TestCreatePageFromTemplate_TwoPagesDoNotCollide_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, space, sourcePage := setupPageTemplateFixture(t, sqlDB, "ws-tpl-nocollide")

	kbRepo := persistence.NewKnowledgeBaseRepository(sqlDB)
	txManager := persistence.NewTxManager(sqlDB)
	versionRepo := persistence.NewPageVersionRepository(sqlDB)
	templateRepo := persistence.NewPageTemplateRepository(sqlDB)
	checkSpace := kb.NewCheckSpacePermissionUseCase(persistence.NewKnowledgeBasePermissionRepository(sqlDB))

	replaceUC := kb.NewReplacePageBlocksUseCase(kbRepo, txManager, versionRepo)
	createPageUC := kb.NewCreatePageUseCase(kbRepo)
	deletePageUC := kb.NewDeletePageUseCase(kbRepo)
	createTemplateUC := kb.NewCreateTemplateFromPageUseCase(kbRepo, templateRepo, checkSpace)
	createFromTemplateUC := kb.NewCreatePageFromTemplateUseCase(templateRepo, checkSpace, createPageUC, replaceUC, deletePageUC)

	// 元ページに本文を保存し、それを雛形として保存する。
	sourceDoc := `{"type":"doc","content":[
		{"type":"paragraph","content":[{"type":"text","text":"段落1"}]},
		{"type":"bulletList","content":[{"type":"listItem","content":[
			{"type":"paragraph","content":[{"type":"text","text":"箇条書き"}]}
		]}]}
	]}`
	_, err := replaceUC.Execute(ctx, kb.ReplacePageBlocksInput{WorkspaceID: ws, PageID: sourcePage, Doc: sourceDoc, EditorUserID: 1})
	require.NoError(t, err)

	tpl, err := createTemplateUC.Execute(ctx, kb.CreateTemplateFromPageInput{
		WorkspaceID: ws, PageID: sourcePage, Name: "衝突確認用", AuthorUserID: 1,
	})
	require.NoError(t, err)
	t.Logf("雛形として保存: id=%s name=%s doc=%s", tpl.ID, tpl.Name, tpl.Doc)

	// 同じ雛形から 1 ページ目を作る。
	out1, err := createFromTemplateUC.Execute(ctx, kb.CreatePageFromTemplateInput{
		WorkspaceID: ws, SpaceID: space, TemplateID: tpl.ID, Title: "1ページ目", AuthorUserID: 1,
	})
	require.NoError(t, err, "1ページ目の作成が成功する")
	t.Logf("1ページ目作成: id=%s title=%s doc=%s", out1.Page.ID, out1.Page.Title, out1.Doc)

	// 同じ雛形から 2 ページ目を作る。regenerateBlockIDs が効いていなければ、ここで
	// blocks.id の衝突（一意制約違反）が起きて失敗する。
	out2, err := createFromTemplateUC.Execute(ctx, kb.CreatePageFromTemplateInput{
		WorkspaceID: ws, SpaceID: space, TemplateID: tpl.ID, Title: "2ページ目", AuthorUserID: 1,
	})
	require.NoError(t, err, "2ページ目の作成もblock id衝突なく成功する")
	t.Logf("2ページ目作成: id=%s title=%s doc=%s", out2.Page.ID, out2.Page.Title, out2.Doc)

	require.NotEqual(t, out1.Page.ID, out2.Page.ID)

	blocks1, err := kbRepo.ListBlocksByPage(ctx, ws, out1.Page.ID)
	require.NoError(t, err)
	blocks2, err := kbRepo.ListBlocksByPage(ctx, ws, out2.Page.ID)
	require.NoError(t, err)
	// 段落・bulletList・その子の listItem・さらにその子の段落、で 4 行
	// （bulletList / listItem は容器ノードで、それ自身も 1 行になる）。
	require.Len(t, blocks1, 4)
	require.Len(t, blocks2, 4)

	ids1 := make(map[string]bool, len(blocks1))
	for _, b := range blocks1 {
		ids1[b.ID] = true
	}
	for _, b := range blocks2 {
		assert.False(t, ids1[b.ID], "2ページ目のブロックid %sが1ページ目と重複している", b.ID)
	}
}

// TestCreateTemplateFromPage_StripsPageRefAndImage_Integration は「雛形として保存」した
// 本文に pageRef・画像ノードが実際に含まれていないことを固定する。
func TestCreateTemplateFromPage_StripsPageRefAndImage_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	ws, space, sourcePage := setupPageTemplateFixture(t, sqlDB, "ws-tpl-strip")
	otherPage := createPage(t, sqlDB, ws, space, nil, "a1")

	kbRepo := persistence.NewKnowledgeBaseRepository(sqlDB)
	txManager := persistence.NewTxManager(sqlDB)
	versionRepo := persistence.NewPageVersionRepository(sqlDB)
	templateRepo := persistence.NewPageTemplateRepository(sqlDB)
	replaceUC := kb.NewReplacePageBlocksUseCase(kbRepo, txManager, versionRepo)
	checkSpace := kb.NewCheckSpacePermissionUseCase(persistence.NewKnowledgeBasePermissionRepository(sqlDB))
	createTemplateUC := kb.NewCreateTemplateFromPageUseCase(kbRepo, templateRepo, checkSpace)

	docWithRefAndImage := `{"type":"doc","content":[
		{"type":"paragraph","content":[
			{"type":"text","text":"参照: "},
			{"type":"pageRef","attrs":{"pageId":"` + otherPage + `","title":"隠す"}}
		]},
		{"type":"image","attrs":{"src":"kb/` + ws + `/` + sourcePage + `/1.bin"}}
	]}`
	_, err := replaceUC.Execute(ctx, kb.ReplacePageBlocksInput{
		WorkspaceID: ws, PageID: sourcePage, Doc: docWithRefAndImage, EditorUserID: 1,
	})
	require.NoError(t, err)

	tpl, err := createTemplateUC.Execute(ctx, kb.CreateTemplateFromPageInput{
		WorkspaceID: ws, PageID: sourcePage, Name: "除外確認用", AuthorUserID: 1,
	})
	require.NoError(t, err)

	assert.NotContains(t, tpl.Doc, "pageRef")
	assert.NotContains(t, tpl.Doc, otherPage)
	assert.NotContains(t, tpl.Doc, `"image"`)
	assert.Contains(t, tpl.Doc, "参照: ", "pageRef以外のテキストは残る")

	// DB に保存された行そのものも確認する（Create の戻り値だけでなく実データを見る）。
	stored, err := templateRepo.Get(ctx, ws, tpl.ID)
	require.NoError(t, err)
	assert.NotContains(t, stored.Doc, "pageRef")
	assert.NotContains(t, stored.Doc, `"image"`)
}
