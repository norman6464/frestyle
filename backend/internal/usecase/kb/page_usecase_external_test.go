package kb_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

const (
	kbWS    = "0198a000-0000-7000-8000-000000000001"
	kbSpace = "0198a000-0000-7000-8000-000000000002"
	kbPage  = "0198a000-0000-7000-8000-000000000003"
)

// stripBlockIDsFromAttrs / requireJSONEqIgnoringBlockIDs は、internal/usecase/kb の
// package kb（page_usecase_test.go）にある同名ヘルパーの package kb_test 版。
// external test package からは internal のテストヘルパーを import できないため、
// ここに小さな複製を置く。renderPageDoc は常に attrs.id を出力するようになったため
// （新規ブロックは呼び出しのたびに新しい UUID が採番される）、doc の厳密一致比較は
// id を無視しないと落ちる。
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

func requireJSONEqIgnoringBlockIDs(t *testing.T, want, got string) {
	t.Helper()
	var w, g any
	require.NoError(t, json.Unmarshal([]byte(want), &w))
	require.NoError(t, json.Unmarshal([]byte(got), &g))
	stripBlockIDsFromAttrs(w)
	stripBlockIDsFromAttrs(g)
	require.Equal(t, w, g)
}

func kbActivePage(id, spaceID string, parentID *string) *domain.Page {
	return &domain.Page{
		ID: id, WorkspaceID: kbWS, SpaceID: spaceID, ParentID: parentID,
		Position: "a0", Title: "ページ", CreatedByUserID: 1,
	}
}

func kbArchivedPage(id, spaceID string, parentID *string) *domain.Page {
	p := kbActivePage(id, spaceID, parentID)
	at := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	p.ArchivedAt = &at
	return p
}

func Test_ページ作成_必須項目の検証(t *testing.T) {
	uc := kb.NewCreatePageUseCase(&mockKnowledgeBaseRepo{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, kb.CreatePageInput{SpaceID: kbSpace, CreatedByUserID: 1})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(ctx, kb.CreatePageInput{WorkspaceID: kbWS, CreatedByUserID: 1})
	require.Error(t, err, "spaceID 必須")
	_, err = uc.Execute(ctx, kb.CreatePageInput{WorkspaceID: kbWS, SpaceID: kbSpace})
	require.Error(t, err, "createdByUserID 必須")
	_, err = uc.Execute(ctx, kb.CreatePageInput{
		WorkspaceID: kbWS, SpaceID: kbSpace, CreatedByUserID: 1,
		Title: strings.Repeat("あ", 201),
	})
	require.Error(t, err, "title は 200 文字まで")
}

func Test_ページ作成_スペースが無ければ失敗(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindSpace", mock.Anything, kbWS, kbSpace).Return(nil, repository.ErrSpaceNotFound)
	uc := kb.NewCreatePageUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.CreatePageInput{
		WorkspaceID: kbWS, SpaceID: kbSpace, CreatedByUserID: 1,
	})
	require.ErrorIs(t, err, repository.ErrSpaceNotFound)
}

func Test_ページ作成_親が別スペースなら拒否(t *testing.T) {
	otherSpace := "0198a000-0000-7000-8000-00000000000f"
	parentID := kbPage
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindSpace", mock.Anything, kbWS, kbSpace).Return(&domain.Space{ID: kbSpace, WorkspaceID: kbWS}, nil)
	repo.On("FindPage", mock.Anything, kbWS, parentID).Return(kbActivePage(parentID, otherSpace, nil), nil)
	uc := kb.NewCreatePageUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.CreatePageInput{
		WorkspaceID: kbWS, SpaceID: kbSpace, ParentID: &parentID, CreatedByUserID: 1,
	})
	require.ErrorIs(t, err, kb.ErrPageParentSpaceMismatch)
}

func Test_ページ作成_アーカイブ済みの親は拒否(t *testing.T) {
	parentID := kbPage
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindSpace", mock.Anything, kbWS, kbSpace).Return(&domain.Space{ID: kbSpace, WorkspaceID: kbWS}, nil)
	repo.On("FindPage", mock.Anything, kbWS, parentID).Return(kbArchivedPage(parentID, kbSpace, nil), nil)
	uc := kb.NewCreatePageUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.CreatePageInput{
		WorkspaceID: kbWS, SpaceID: kbSpace, ParentID: &parentID, CreatedByUserID: 1,
	})
	require.ErrorIs(t, err, kb.ErrPageParentArchived)
}

func Test_ページ作成_末尾のpositionを採番して保存(t *testing.T) {
	parentID := kbPage
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindSpace", mock.Anything, kbWS, kbSpace).Return(&domain.Space{ID: kbSpace, WorkspaceID: kbWS}, nil)
	repo.On("FindPage", mock.Anything, kbWS, parentID).Return(kbActivePage(parentID, kbSpace, nil), nil)
	repo.On("LastActiveSiblingPosition", mock.Anything, kbWS, kbSpace, &parentID).Return("a5", nil)
	var created *domain.Page
	repo.On("CreatePage", mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) { created = args.Get(1).(*domain.Page) }).Return(nil)
	uc := kb.NewCreatePageUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.CreatePageInput{
		WorkspaceID: kbWS, SpaceID: kbSpace, ParentID: &parentID, Title: "新ページ", CreatedByUserID: 7,
	})
	require.NoError(t, err)
	require.NotNil(t, created)
	assert.Equal(t, "a6", created.Position, "末尾 a5 の次 = fracindex.Between(\"a5\", \"\")")
	assert.Equal(t, kbSpace, created.SpaceID)
	assert.Equal(t, &parentID, created.ParentID)
	assert.Equal(t, uint64(7), created.CreatedByUserID)
}

func Test_ページ作成_最初の1件はルートに採番(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindSpace", mock.Anything, kbWS, kbSpace).Return(&domain.Space{ID: kbSpace, WorkspaceID: kbWS}, nil)
	repo.On("LastActiveSiblingPosition", mock.Anything, kbWS, kbSpace, (*string)(nil)).Return("", nil)
	var created *domain.Page
	repo.On("CreatePage", mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) { created = args.Get(1).(*domain.Page) }).Return(nil)
	uc := kb.NewCreatePageUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.CreatePageInput{
		WorkspaceID: kbWS, SpaceID: kbSpace, CreatedByUserID: 1,
	})
	require.NoError(t, err)
	require.NotNil(t, created)
	assert.Equal(t, "a0", created.Position, "兄弟なし = fracindex の最初のキー")
	assert.Nil(t, created.ParentID)
}

func Test_ページ取得_snapshotがあればそれを返す(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	repo.On("GetPageSnapshot", mock.Anything, kbWS, kbPage).
		Return(&domain.PageSnapshot{PageID: kbPage, Doc: `{"type":"doc","content":[]}`}, nil)
	uc := kb.NewGetPageUseCase(repo)

	out, err := uc.Execute(context.Background(), kb.GetPageInput{WorkspaceID: kbWS, PageID: kbPage})
	require.NoError(t, err)
	assert.Equal(t, `{"type":"doc","content":[]}`, out.Doc)
	assert.Equal(t, kbPage, out.Page.ID)
	repo.AssertNotCalled(t, "ListBlocksByPage", mock.Anything, mock.Anything, mock.Anything)
}

func Test_ページ取得_snapshotが無ければブロックから組み立てる(t *testing.T) {
	inline := `[{"type":"text","text":"本文"}]`
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	repo.On("GetPageSnapshot", mock.Anything, kbWS, kbPage).Return(nil, repository.ErrPageSnapshotNotFound)
	repo.On("ListBlocksByPage", mock.Anything, kbWS, kbPage).Return([]domain.Block{
		{ID: "b1", PageID: kbPage, Type: domain.BlockTypeParagraph, Position: "a0", Attrs: "{}", Inline: &inline},
	}, nil)
	uc := kb.NewGetPageUseCase(repo)

	out, err := uc.Execute(context.Background(), kb.GetPageInput{WorkspaceID: kbWS, PageID: kbPage})
	require.NoError(t, err)
	requireJSONEqIgnoringBlockIDs(t, `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"本文"}]}]}`, out.Doc)
}

func Test_ページ取得_無いページはそのまま失敗(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(nil, repository.ErrPageNotFound)
	uc := kb.NewGetPageUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.GetPageInput{WorkspaceID: kbWS, PageID: kbPage})
	require.ErrorIs(t, err, repository.ErrPageNotFound)
}

func Test_ページツリー_親子と兄弟順を組み立てる(t *testing.T) {
	root1 := kbActivePage("p1", kbSpace, nil)
	root1.Position = "a0"
	root2 := kbActivePage("p2", kbSpace, nil)
	root2.Position = "a1"
	p1 := "p1"
	child1 := kbActivePage("p3", kbSpace, &p1)
	child1.Position = "a0"
	child2 := kbActivePage("p4", kbSpace, &p1)
	child2.Position = "a1"

	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindSpace", mock.Anything, kbWS, kbSpace).Return(&domain.Space{ID: kbSpace, WorkspaceID: kbWS}, nil)
	// ListActivePagesBySpace は position 順で返る（クエリの ORDER BY）。
	repo.On("ListActivePagesBySpace", mock.Anything, kbWS, kbSpace).
		Return([]domain.Page{*root1, *child1, *root2, *child2}, nil)
	uc := kb.NewGetPageTreeUseCase(repo)

	tree, err := uc.Execute(context.Background(), kb.GetPageTreeInput{WorkspaceID: kbWS, SpaceID: kbSpace})
	require.NoError(t, err)
	require.Len(t, tree, 2)
	assert.Equal(t, "p1", tree[0].Page.ID)
	assert.Equal(t, "p2", tree[1].Page.ID)
	require.Len(t, tree[0].Children, 2)
	assert.Equal(t, "p3", tree[0].Children[0].Page.ID)
	assert.Equal(t, "p4", tree[0].Children[1].Page.ID)
	assert.Empty(t, tree[1].Children)
}

func Test_ページツリー_スペースが無ければ失敗(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindSpace", mock.Anything, kbWS, kbSpace).Return(nil, repository.ErrSpaceNotFound)
	uc := kb.NewGetPageTreeUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.GetPageTreeInput{WorkspaceID: kbWS, SpaceID: kbSpace})
	require.ErrorIs(t, err, repository.ErrSpaceNotFound)
}

func Test_ページツリー_親が一覧に無い行はルート扱いで隠さない(t *testing.T) {
	missing := "not-in-list"
	orphan := kbActivePage("p9", kbSpace, &missing)
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindSpace", mock.Anything, kbWS, kbSpace).Return(&domain.Space{ID: kbSpace, WorkspaceID: kbWS}, nil)
	repo.On("ListActivePagesBySpace", mock.Anything, kbWS, kbSpace).Return([]domain.Page{*orphan}, nil)
	uc := kb.NewGetPageTreeUseCase(repo)

	tree, err := uc.Execute(context.Background(), kb.GetPageTreeInput{WorkspaceID: kbWS, SpaceID: kbSpace})
	require.NoError(t, err)
	require.Len(t, tree, 1)
	assert.Equal(t, "p9", tree[0].Page.ID)
}

func Test_ページ改名_アーカイブ済みは拒否(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbArchivedPage(kbPage, kbSpace, nil), nil)
	uc := kb.NewRenamePageUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.RenamePageInput{WorkspaceID: kbWS, PageID: kbPage, Title: "x"})
	require.ErrorIs(t, err, kb.ErrPageArchived)
}

func Test_ページ改名_タイトルを更新する(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	updated := kbActivePage(kbPage, kbSpace, nil)
	updated.Title = "改名後"
	repo.On("UpdatePageTitle", mock.Anything, kbWS, kbPage, "改名後").Return(updated, nil)
	uc := kb.NewRenamePageUseCase(repo)

	got, err := uc.Execute(context.Background(), kb.RenamePageInput{WorkspaceID: kbWS, PageID: kbPage, Title: "改名後"})
	require.NoError(t, err)
	assert.Equal(t, "改名後", got.Title)
}

func Test_ページ改名_長すぎるタイトルは拒否(t *testing.T) {
	uc := kb.NewRenamePageUseCase(&mockKnowledgeBaseRepo{})
	_, err := uc.Execute(context.Background(), kb.RenamePageInput{
		WorkspaceID: kbWS, PageID: kbPage, Title: strings.Repeat("あ", 201),
	})
	require.Error(t, err)
}

func Test_ページ参照_本文を読まずにメタ情報だけ返す(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	uc := kb.NewFindPageUseCase(repo)

	page, err := uc.Execute(context.Background(), kb.FindPageInput{WorkspaceID: kbWS, PageID: kbPage})
	require.NoError(t, err)
	assert.Equal(t, kbSpace, page.SpaceID, "権限判定に使うスペースが取れる")
	repo.AssertNotCalled(t, "GetPageSnapshot", mock.Anything, mock.Anything, mock.Anything)
	repo.AssertNotCalled(t, "ListBlocksByPage", mock.Anything, mock.Anything, mock.Anything)
}

func Test_ページ参照_必須項目の検証(t *testing.T) {
	uc := kb.NewFindPageUseCase(&mockKnowledgeBaseRepo{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, kb.FindPageInput{PageID: kbPage})
	require.Error(t, err, "workspaceID 必須")
	_, err = uc.Execute(ctx, kb.FindPageInput{WorkspaceID: kbWS})
	require.ErrorIs(t, err, repository.ErrPageNotFound, "空の pageID は存在しないページと同じ扱い")
}

// kbTreePages は root → child → grandchild と、独立した sibling の 4 ページ。
func kbTreePages() []domain.Page {
	root := "p-root"
	child := "p-child"
	return []domain.Page{
		{ID: root, Position: "a0", Title: "root"},
		{ID: child, Position: "a1", Title: "child", ParentID: &root},
		{ID: "p-grandchild", Position: "a2", Title: "grandchild", ParentID: &child},
		{ID: "p-sibling", Position: "a3", Title: "sibling"},
	}
}

func Test_ツリー組み立て_親子が復元される(t *testing.T) {
	roots := kb.BuildPageTree(kbTreePages(), kb.PageTreeOrphanHidden)

	require.Len(t, roots, 2)
	assert.Equal(t, "p-root", roots[0].Page.ID)
	require.Len(t, roots[0].Children, 1)
	assert.Equal(t, "p-child", roots[0].Children[0].Page.ID)
	require.Len(t, roots[0].Children[0].Children, 1)
	assert.Equal(t, "p-grandchild", roots[0].Children[0].Children[0].Page.ID)
	assert.Equal(t, "p-sibling", roots[1].Page.ID)
}

func Test_ツリー組み立て_見えない親の子孫はまとめて落ちる(t *testing.T) {
	// 権限のふるいで root が落ちた一覧を再現する。
	pages := kbTreePages()[1:]

	roots := kb.BuildPageTree(pages, kb.PageTreeOrphanHidden)

	require.Len(t, roots, 1, "見えない親の子は根に昇格させない（配下の存在も漏らさない）")
	assert.Equal(t, "p-sibling", roots[0].Page.ID)
}

func Test_ツリー組み立て_ふるいにかけない一覧では親無しを根として見せる(t *testing.T) {
	pages := kbTreePages()[1:]

	roots := kb.BuildPageTree(pages, kb.PageTreeOrphanAsRoot)

	require.Len(t, roots, 2, "整合が崩れた行はデータを隠さずルート扱いで見せる")
	assert.Equal(t, "p-child", roots[0].Page.ID)
	require.Len(t, roots[0].Children, 1)
	assert.Equal(t, "p-sibling", roots[1].Page.ID)
}

func Test_ツリー組み立て_空の一覧は空のスライス(t *testing.T) {
	roots := kb.BuildPageTree(nil, kb.PageTreeOrphanHidden)
	assert.NotNil(t, roots, "nil ではなく空スライス（JSON で null にしない）")
	assert.Empty(t, roots)
}

func Test_ツリー組み立て_兄弟の並びは入力順のまま(t *testing.T) {
	parent := "p-parent"
	pages := []domain.Page{
		{ID: parent, Position: "a0"},
		{ID: "p-1", Position: "a1", ParentID: &parent},
		{ID: "p-2", Position: "a2", ParentID: &parent},
		{ID: "p-3", Position: "a3", ParentID: &parent},
	}

	roots := kb.BuildPageTree(pages, kb.PageTreeOrphanHidden)

	require.Len(t, roots, 1)
	got := make([]string, 0, 3)
	for _, c := range roots[0].Children {
		got = append(got, c.Page.ID)
	}
	assert.Equal(t, []string{"p-1", "p-2", "p-3"}, got)
}

// kbEditorUserID はこのファイルの本文書き換えテストで共通に使う「保存した人」の ID。
const kbEditorUserID = uint64(7)

func Test_本文書き換え_docを行に分解して全入れ替えする(t *testing.T) {
	doc := `{"type":"doc","content":[
		{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"見出し"}]},
		{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"項目"}]}]}]}
	]}`
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	repo.On("TouchPageLastEditedBy", mock.Anything, kbWS, kbPage, kbEditorUserID).Return(nil)
	var gotRows []repository.BlockWrite
	var gotSnapshot string
	repo.On("ReplacePageBlocks", mock.Anything, kbWS, kbPage, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) {
			gotRows = args.Get(3).([]repository.BlockWrite)
			gotSnapshot = args.String(4)
		}).Return(nil)
	repo.On("GetPageSnapshot", mock.Anything, kbWS, kbPage).
		Return(&domain.PageSnapshot{PageID: kbPage, Doc: doc}, nil)
	// versionRepo.CreateVersionIfDue が呼ばれ、渡す doc は ReplacePageBlocks の snapshotDoc と
	// 同じ正規形（normalized）であること・通常の自動保存は force=false, note=nil であることを
	// 引数の検証込みで固定する（FRESTYLE-433 段 3）。
	versionRepo := &mockPageVersionRepo{}
	var gotVersionDoc string
	var gotForce bool
	versionRepo.On("CreateVersionIfDue", mock.Anything, kbWS, kbPage, mock.Anything, kbEditorUserID, (*string)(nil), false).
		Run(func(args mock.Arguments) {
			gotVersionDoc = args.String(3)
			gotForce = args.Bool(6)
		}).
		Return(false, nil, nil)
	uc := kb.NewReplacePageBlocksUseCase(repo, &fakeTxManager{}, versionRepo, &mockKBPermissionRepo{}, &mockNotificationRepo{}, nil)

	out, err := uc.Execute(context.Background(), kb.ReplacePageBlocksInput{
		WorkspaceID: kbWS, PageID: kbPage, Doc: doc, EditorUserID: kbEditorUserID,
	})
	require.NoError(t, err)
	require.NotNil(t, out)
	require.Len(t, gotRows, 4, "heading / bulletList / listItem / paragraph の 4 行")
	assert.Equal(t, domain.BlockTypeHeading, gotRows[0].Type)
	assert.Equal(t, domain.BlockTypeBulletList, gotRows[1].Type)
	assert.Equal(t, gotRows[1].ID, *gotRows[2].ParentID, "listItem の親は bulletList")
	requireJSONEqIgnoringBlockIDs(t, doc, gotSnapshot)
	assert.False(t, gotForce, "通常の自動保存は ForceVersion のゼロ値のまま")
	assert.Equal(t, gotSnapshot, gotVersionDoc, "versionRepo に渡す doc は snapshot と同じ正規形")
	versionRepo.AssertExpectations(t)
}

// Test_本文書き換え_ブロック置換と最終編集者の記録と版の記録は同じトランザクションで行う は
// TouchPageLastEditedBy / ReplacePageBlocks / versionRepo.CreateVersionIfDue が **同じ**
// DoInTx の呼び出し 1 回の中で行われることを固定する（既知のリスク: Touch を先に呼ぶことで
// 同じページへの同時保存が直列化される。どれか 1 つだけ tx の外で呼ばれる回帰はここで捕まえる）。
func Test_本文書き換え_ブロック置換と最終編集者の記録と版の記録は同じトランザクションで行う(t *testing.T) {
	doc := `{"type":"doc","content":[]}`
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	repo.On("TouchPageLastEditedBy", mock.MatchedBy(inTx), kbWS, kbPage, kbEditorUserID).Return(nil)
	repo.On("ReplacePageBlocks", mock.MatchedBy(inTx), kbWS, kbPage, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil)
	repo.On("GetPageSnapshot", mock.Anything, kbWS, kbPage).
		Return(&domain.PageSnapshot{PageID: kbPage, Doc: doc}, nil)
	versionRepo := &mockPageVersionRepo{}
	versionRepo.On(
		"CreateVersionIfDue", mock.MatchedBy(inTx), kbWS, kbPage, mock.Anything, kbEditorUserID, (*string)(nil), false,
	).Return(false, nil, nil)
	tx := &fakeTxManager{}
	uc := kb.NewReplacePageBlocksUseCase(repo, tx, versionRepo, &mockKBPermissionRepo{}, &mockNotificationRepo{}, nil)

	_, err := uc.Execute(context.Background(), kb.ReplacePageBlocksInput{
		WorkspaceID: kbWS, PageID: kbPage, Doc: doc, EditorUserID: kbEditorUserID,
	})
	require.NoError(t, err)
	assert.Equal(t, 1, tx.calls,
		"DoInTx は 1 回だけ（Touch / ReplacePageBlocks / CreateVersionIfDue を 1 つの単位にまとめる）")
	repo.AssertExpectations(t)
	versionRepo.AssertExpectations(t)
}

// Test_本文書き換え_版の記録に失敗したら本文の書き込みごと失敗として返る は、
// versionRepo.CreateVersionIfDue が失敗したら DoInTx 全体がエラーとして返り、
// GetPageSnapshot（「保存できた」ことを前提にした読み出し）まで到達しないことを固定する。
// 実際にトランザクションがロールバックされ本文が保存前の状態に戻ることは、
// mock ではなく本物の PostgreSQL を使う結合テストが確認する
// （page_version_repository_integration_test.go）。
func Test_本文書き換え_版の記録に失敗したら本文の書き込みごと失敗として返る(t *testing.T) {
	doc := `{"type":"doc","content":[]}`
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	repo.On("TouchPageLastEditedBy", mock.Anything, kbWS, kbPage, kbEditorUserID).Return(nil)
	repo.On("ReplacePageBlocks", mock.Anything, kbWS, kbPage, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil)
	versionRepoErr := errors.New("db down")
	versionRepo := &mockPageVersionRepo{}
	versionRepo.On("CreateVersionIfDue", mock.Anything, kbWS, kbPage, mock.Anything, kbEditorUserID, (*string)(nil), false).
		Return(false, nil, versionRepoErr)
	uc := kb.NewReplacePageBlocksUseCase(repo, &fakeTxManager{}, versionRepo, &mockKBPermissionRepo{}, &mockNotificationRepo{}, nil)

	out, err := uc.Execute(context.Background(), kb.ReplacePageBlocksInput{
		WorkspaceID: kbWS, PageID: kbPage, Doc: doc, EditorUserID: kbEditorUserID,
	})
	require.ErrorIs(t, err, versionRepoErr)
	assert.Nil(t, out)
	repo.AssertNotCalled(t, "GetPageSnapshot", mock.Anything, mock.Anything, mock.Anything)
}

// Test_本文書き換え_最終編集者の記録に失敗したら本文を書かない は、Touch が失敗したら
// ReplacePageBlocks / versionRepo.CreateVersionIfDue を呼ばずに tx ごと失敗として伝えることを固定する。
func Test_本文書き換え_最終編集者の記録に失敗したら本文を書かない(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	repo.On("TouchPageLastEditedBy", mock.Anything, kbWS, kbPage, kbEditorUserID).
		Return(repository.ErrPageNotFound)
	versionRepo := &mockPageVersionRepo{}
	uc := kb.NewReplacePageBlocksUseCase(repo, &fakeTxManager{}, versionRepo, &mockKBPermissionRepo{}, &mockNotificationRepo{}, nil)

	_, err := uc.Execute(context.Background(), kb.ReplacePageBlocksInput{
		WorkspaceID: kbWS, PageID: kbPage, Doc: `{"type":"doc","content":[]}`, EditorUserID: kbEditorUserID,
	})
	require.ErrorIs(t, err, repository.ErrPageNotFound)
	repo.AssertNotCalled(t, "ReplacePageBlocks", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	repo.AssertExpectations(t)
	versionRepo.AssertNotCalled(t, "CreateVersionIfDue",
		mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

// Test_本文書き換え_編集者が未指定なら拒否 は EditorUserID の 0 値（未指定）を repository を
// 一切呼ばずに拒否することを固定する。
func Test_本文書き換え_編集者が未指定なら拒否(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	uc := kb.NewReplacePageBlocksUseCase(repo, &fakeTxManager{}, &mockPageVersionRepo{}, &mockKBPermissionRepo{}, &mockNotificationRepo{}, nil)

	_, err := uc.Execute(context.Background(), kb.ReplacePageBlocksInput{
		WorkspaceID: kbWS, PageID: kbPage, Doc: `{"type":"doc","content":[]}`,
	})
	require.ErrorIs(t, err, kb.ErrPageEditorRequired)
	repo.AssertNotCalled(t, "FindPage", mock.Anything, mock.Anything, mock.Anything)
}

func Test_本文書き換え_不正なdocは保存せず失敗(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	uc := kb.NewReplacePageBlocksUseCase(repo, &fakeTxManager{}, &mockPageVersionRepo{}, &mockKBPermissionRepo{}, &mockNotificationRepo{}, nil)

	_, err := uc.Execute(context.Background(), kb.ReplacePageBlocksInput{
		WorkspaceID: kbWS, PageID: kbPage, Doc: `{"type":"doc","content":[{"type":"iframe"}]}`, EditorUserID: kbEditorUserID,
	})
	require.ErrorIs(t, err, kb.ErrPageDocUnknownNodeType)
	repo.AssertNotCalled(t, "ReplacePageBlocks", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_本文書き換え_アーカイブ済みページは拒否(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbArchivedPage(kbPage, kbSpace, nil), nil)
	uc := kb.NewReplacePageBlocksUseCase(repo, &fakeTxManager{}, &mockPageVersionRepo{}, &mockKBPermissionRepo{}, &mockNotificationRepo{}, nil)

	_, err := uc.Execute(context.Background(), kb.ReplacePageBlocksInput{
		WorkspaceID: kbWS, PageID: kbPage, Doc: `{"type":"doc","content":[]}`, EditorUserID: kbEditorUserID,
	})
	require.ErrorIs(t, err, kb.ErrPageArchived)
}

func Test_本文書き換え_無いページはそのまま失敗(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(nil, repository.ErrPageNotFound)
	uc := kb.NewReplacePageBlocksUseCase(repo, &fakeTxManager{}, &mockPageVersionRepo{}, &mockKBPermissionRepo{}, &mockNotificationRepo{}, nil)

	_, err := uc.Execute(context.Background(), kb.ReplacePageBlocksInput{
		WorkspaceID: kbWS, PageID: kbPage, Doc: `{"type":"doc","content":[]}`, EditorUserID: kbEditorUserID,
	})
	require.ErrorIs(t, err, repository.ErrPageNotFound)
}

// Test_ページアイコン_設定すると正規形で保存される は SetPageIconUseCase が
// repository へ渡す値をそのまま固定する（正規形かどうかは domain.PageIcon.Valid() の責務で、
// ここでは usecase が値を加工せず repository まで届けることだけを見る）。
func Test_ページアイコン_設定すると正規形で保存される(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	icon := &domain.PageIcon{Type: domain.PageIconTypeEmoji, Value: "📘"}
	updated := kbActivePage(kbPage, kbSpace, nil)
	updated.Icon = icon
	repo.On("UpdatePageIcon", mock.Anything, kbWS, kbPage, icon).Return(updated, nil)
	uc := kb.NewSetPageIconUseCase(repo)

	got, err := uc.Execute(context.Background(), kb.SetPageIconInput{
		WorkspaceID: kbWS, PageID: kbPage, Icon: icon,
	})
	require.NoError(t, err)
	require.NotNil(t, got.Icon)
	assert.Equal(t, *icon, *got.Icon)
}

// Test_ページアイコン_解除はnilを渡す は「外す」操作が UpdatePageIcon に nil を渡すことを固定する。
func Test_ページアイコン_解除はnilを渡す(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	repo.On("UpdatePageIcon", mock.Anything, kbWS, kbPage, (*domain.PageIcon)(nil)).
		Return(kbActivePage(kbPage, kbSpace, nil), nil)
	uc := kb.NewSetPageIconUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.SetPageIconInput{
		WorkspaceID: kbWS, PageID: kbPage, Icon: nil,
	})
	require.NoError(t, err)
	repo.AssertExpectations(t)
}

func Test_ページアイコン_アーカイブ済みは拒否(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbArchivedPage(kbPage, kbSpace, nil), nil)
	uc := kb.NewSetPageIconUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.SetPageIconInput{
		WorkspaceID: kbWS, PageID: kbPage, Icon: &domain.PageIcon{Type: domain.PageIconTypeEmoji, Value: "📘"},
	})
	require.ErrorIs(t, err, kb.ErrPageArchived)
}

// Test_ページアイコン_不正な値は保存せず拒否 は、形の検証が repository を呼ぶ**前**に
// 効いていることを固定する（FindPage すら呼ばれない — 中途半端な副作用を残さないため）。
func Test_ページアイコン_不正な値は保存せず拒否(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	uc := kb.NewSetPageIconUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.SetPageIconInput{
		WorkspaceID: kbWS, PageID: kbPage, Icon: &domain.PageIcon{Type: domain.PageIconTypeEmoji, Value: ""},
	})
	require.ErrorIs(t, err, kb.ErrInvalidPageIcon)
	repo.AssertNotCalled(t, "FindPage", mock.Anything, mock.Anything, mock.Anything)
	repo.AssertNotCalled(t, "UpdatePageIcon", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

// Test_公開範囲_設定した値がそのまま保存される は SetPageVisibilityUseCase が
// repository へ渡す値をそのまま固定する（SetPageIconUseCase の対応するテストと同じ形）。
func Test_公開範囲_設定した値がそのまま保存される(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	updated := kbActivePage(kbPage, kbSpace, nil)
	updated.Visibility = domain.PageVisibilityPrivate
	repo.On("UpdatePageVisibility", mock.Anything, kbWS, kbPage, domain.PageVisibilityPrivate).Return(updated, nil)
	uc := kb.NewSetPageVisibilityUseCase(repo)

	got, err := uc.Execute(context.Background(), kb.SetPageVisibilityInput{
		WorkspaceID: kbWS, PageID: kbPage, Visibility: domain.PageVisibilityPrivate,
	})
	require.NoError(t, err)
	assert.Equal(t, domain.PageVisibilityPrivate, got.Visibility)
	repo.AssertExpectations(t)
}

func Test_公開範囲_アーカイブ済みは拒否(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbArchivedPage(kbPage, kbSpace, nil), nil)
	uc := kb.NewSetPageVisibilityUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.SetPageVisibilityInput{
		WorkspaceID: kbWS, PageID: kbPage, Visibility: domain.PageVisibilityPrivate,
	})
	require.ErrorIs(t, err, kb.ErrPageArchived)
}

// Test_公開範囲_不正な値は保存せず拒否 は、値の検証が repository を呼ぶ**前**に
// 効いていることを固定する（FindPage すら呼ばれない — SetPageIconUseCase の
// 対応するテストと同じ形）。
func Test_公開範囲_不正な値は保存せず拒否(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	uc := kb.NewSetPageVisibilityUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.SetPageVisibilityInput{
		WorkspaceID: kbWS, PageID: kbPage, Visibility: domain.PageVisibility("unknown"),
	})
	require.ErrorIs(t, err, kb.ErrInvalidPageVisibility)
	repo.AssertNotCalled(t, "FindPage", mock.Anything, mock.Anything, mock.Anything)
	repo.AssertNotCalled(t, "UpdatePageVisibility", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_ページ移動_自分自身の下には移せない(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	uc := kb.NewMovePageUseCase(repo)

	self := kbPage
	_, err := uc.Execute(context.Background(), kb.MovePageInput{
		WorkspaceID: kbWS, PageID: kbPage, NewParentID: &self,
	})
	require.ErrorIs(t, err, kb.ErrPageCycle)
	repo.AssertNotCalled(t, "MovePage", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_ページ移動_子孫の下には移せない(t *testing.T) {
	desc := "0198a000-0000-7000-8000-0000000000aa"
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	repo.On("FindPage", mock.Anything, kbWS, desc).Return(kbActivePage(desc, kbSpace, nil), nil)
	repo.On("HasDescendant", mock.Anything, kbWS, kbPage, desc).Return(true, nil)
	uc := kb.NewMovePageUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.MovePageInput{
		WorkspaceID: kbWS, PageID: kbPage, NewParentID: &desc,
	})
	require.ErrorIs(t, err, kb.ErrPageCycle)
	repo.AssertNotCalled(t, "MovePage", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_ページ移動_アーカイブ済みページは移せない(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbArchivedPage(kbPage, kbSpace, nil), nil)
	uc := kb.NewMovePageUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.MovePageInput{WorkspaceID: kbWS, PageID: kbPage})
	require.ErrorIs(t, err, kb.ErrPageArchived)
}

func Test_ページ移動_アーカイブ済みの親の下には移せない(t *testing.T) {
	parent := "0198a000-0000-7000-8000-0000000000bb"
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	repo.On("FindPage", mock.Anything, kbWS, parent).Return(kbArchivedPage(parent, kbSpace, nil), nil)
	uc := kb.NewMovePageUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.MovePageInput{
		WorkspaceID: kbWS, PageID: kbPage, NewParentID: &parent,
	})
	require.ErrorIs(t, err, kb.ErrPageParentArchived)
}

func Test_ページ移動_指定スペースと親のスペースが食い違えば拒否(t *testing.T) {
	parent := "0198a000-0000-7000-8000-0000000000bb"
	otherSpace := "0198a000-0000-7000-8000-0000000000cc"
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	repo.On("FindPage", mock.Anything, kbWS, parent).Return(kbActivePage(parent, otherSpace, nil), nil)
	uc := kb.NewMovePageUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.MovePageInput{
		WorkspaceID: kbWS, PageID: kbPage, NewParentID: &parent, NewSpaceID: kbSpace,
	})
	require.ErrorIs(t, err, kb.ErrPageParentSpaceMismatch)
}

func Test_ページ移動_親の下の末尾へ移す(t *testing.T) {
	parent := "0198a000-0000-7000-8000-0000000000bb"
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil).Once()
	repo.On("FindPage", mock.Anything, kbWS, parent).Return(kbActivePage(parent, kbSpace, nil), nil)
	repo.On("HasDescendant", mock.Anything, kbWS, kbPage, parent).Return(false, nil)
	repo.On("LastActiveSiblingPosition", mock.Anything, kbWS, kbSpace, &parent).Return("a2", nil)
	repo.On("MovePage", mock.Anything, kbWS, kbPage, &parent, kbSpace, "a3").Return(nil)
	moved := kbActivePage(kbPage, kbSpace, &parent)
	moved.Position = "a3"
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(moved, nil)
	uc := kb.NewMovePageUseCase(repo)

	got, err := uc.Execute(context.Background(), kb.MovePageInput{
		WorkspaceID: kbWS, PageID: kbPage, NewParentID: &parent,
	})
	require.NoError(t, err)
	assert.Equal(t, "a3", got.Position)
	repo.AssertExpectations(t)
}

func Test_ページ移動_別スペースのルートへ移す(t *testing.T) {
	otherSpace := "0198a000-0000-7000-8000-0000000000cc"
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	repo.On("FindSpace", mock.Anything, kbWS, otherSpace).Return(&domain.Space{ID: otherSpace, WorkspaceID: kbWS}, nil)
	repo.On("LastActiveSiblingPosition", mock.Anything, kbWS, otherSpace, (*string)(nil)).Return("", nil)
	repo.On("MovePage", mock.Anything, kbWS, kbPage, (*string)(nil), otherSpace, "a0").Return(nil)
	uc := kb.NewMovePageUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.MovePageInput{
		WorkspaceID: kbWS, PageID: kbPage, NewSpaceID: otherSpace,
	})
	require.NoError(t, err)
	repo.AssertExpectations(t)
}

func Test_ページ移動_移動先スペースが無ければ失敗(t *testing.T) {
	otherSpace := "0198a000-0000-7000-8000-0000000000cc"
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	repo.On("FindSpace", mock.Anything, kbWS, otherSpace).Return(nil, repository.ErrSpaceNotFound)
	uc := kb.NewMovePageUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.MovePageInput{
		WorkspaceID: kbWS, PageID: kbPage, NewSpaceID: otherSpace,
	})
	require.ErrorIs(t, err, repository.ErrSpaceNotFound)
}

func Test_ページアーカイブ_サブツリーごと隠す(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	repo.On("ArchivePageSubtree", mock.Anything, kbWS, kbPage).Return(nil)
	uc := kb.NewArchivePageUseCase(repo)

	require.NoError(t, uc.Execute(context.Background(), kb.ArchivePageInput{WorkspaceID: kbWS, PageID: kbPage}))
	repo.AssertExpectations(t)
}

func Test_ページアーカイブ_アーカイブ済みなら何もしない(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbArchivedPage(kbPage, kbSpace, nil), nil)
	uc := kb.NewArchivePageUseCase(repo)

	require.NoError(t, uc.Execute(context.Background(), kb.ArchivePageInput{WorkspaceID: kbWS, PageID: kbPage}))
	repo.AssertNotCalled(t, "ArchivePageSubtree", mock.Anything, mock.Anything, mock.Anything)
}

func Test_ページ復帰_一括分をarchived_atを境に戻す(t *testing.T) {
	page := kbArchivedPage(kbPage, kbSpace, nil)
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(page, nil).Once()
	repo.On("HasActiveSiblingPosition", mock.Anything, kbWS, kbSpace, (*string)(nil), page.Position, kbPage).Return(false, nil)
	repo.On("UnarchivePageSubtree", mock.Anything, kbWS, kbPage, *page.ArchivedAt, (*string)(nil)).Return(nil)
	restored := kbActivePage(kbPage, kbSpace, nil)
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(restored, nil)
	uc := kb.NewUnarchivePageUseCase(repo)

	got, err := uc.Execute(context.Background(), kb.UnarchivePageInput{WorkspaceID: kbWS, PageID: kbPage})
	require.NoError(t, err)
	assert.Nil(t, got.ArchivedAt)
	repo.AssertExpectations(t)
}

func Test_ページ復帰_positionが衝突したら末尾へ再採番(t *testing.T) {
	page := kbArchivedPage(kbPage, kbSpace, nil)
	page.Position = "a0"
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(page, nil).Once()
	repo.On("HasActiveSiblingPosition", mock.Anything, kbWS, kbSpace, (*string)(nil), "a0", kbPage).Return(true, nil)
	repo.On("LastActiveSiblingPosition", mock.Anything, kbWS, kbSpace, (*string)(nil)).Return("a7", nil)
	newPos := "a8"
	repo.On("UnarchivePageSubtree", mock.Anything, kbWS, kbPage, *page.ArchivedAt, &newPos).Return(nil)
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	uc := kb.NewUnarchivePageUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.UnarchivePageInput{WorkspaceID: kbWS, PageID: kbPage})
	require.NoError(t, err)
	repo.AssertExpectations(t)
}

func Test_ページ復帰_親がアーカイブ中なら拒否(t *testing.T) {
	parent := "0198a000-0000-7000-8000-0000000000bb"
	page := kbArchivedPage(kbPage, kbSpace, &parent)
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(page, nil)
	repo.On("FindPage", mock.Anything, kbWS, parent).Return(kbArchivedPage(parent, kbSpace, nil), nil)
	uc := kb.NewUnarchivePageUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.UnarchivePageInput{WorkspaceID: kbWS, PageID: kbPage})
	require.ErrorIs(t, err, kb.ErrPageParentArchived)
	repo.AssertNotCalled(t, "UnarchivePageSubtree", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_ページ復帰_現役ページなら何もしない(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	uc := kb.NewUnarchivePageUseCase(repo)

	got, err := uc.Execute(context.Background(), kb.UnarchivePageInput{WorkspaceID: kbWS, PageID: kbPage})
	require.NoError(t, err)
	assert.Nil(t, got.ArchivedAt)
	repo.AssertNotCalled(t, "UnarchivePageSubtree", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

const kbRefWS = "00000000-0000-7000-8000-00000000aaaa"

func kbRefDoc(refs ...string) string {
	content := ""
	for i, id := range refs {
		if i > 0 {
			content += ","
		}
		content += fmt.Sprintf(`{"type":"pageRef","attrs":{"pageId":%q,"title":"無題"}}`, id)
	}
	return `{"type":"doc","content":[{"type":"paragraph","content":[` + content + `]}]}`
}

// kbViewableFacts は「閲覧の役割が届いているページ」の行。
func kbViewableFacts(id, title string) repository.PageWithViewFacts {
	return repository.PageWithViewFacts{
		Page: domain.Page{ID: id, Title: title},
		Role: kbGrantRole(domain.GrantRoleViewer),
	}
}

// kbUnreachableFacts は「付与が 1 つも届いていないページ」の行（Role が nil）。
// 自分が入っていない private のスペースに置かれたページがこれにあたる。
// repository は行そのものは返す（本番の SQL も候補として引いてくる）ので、
// 見えるかどうかは Role を見て usecase 側の domain.ResolvePageView が決める。
func kbUnreachableFacts(id, title string) repository.PageWithViewFacts {
	return repository.PageWithViewFacts{Page: domain.Page{ID: id, Title: title}}
}

func Test_ページ参照の題名解決_閲覧できる参照だけを現在の題名にする(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	visible := "00000000-0000-7000-8000-000000000001"
	unreachable := "00000000-0000-7000-8000-000000000002"
	// unreachable には役割が届いていない（別の private なスペースに置かれたページ）。
	// repository が返すのは事実（届いた中で最も強い役割。無ければ nil）だけで、
	// 判定は usecase 側の ResolvePageView が行う。
	repo.On("ListWorkspacePageViewFactsByIDs", mock.Anything, kbRefWS, uint64(7), []string{visible, unreachable}).
		Return([]repository.PageWithViewFacts{
			kbViewableFacts(visible, "設計メモ v2"),
			kbUnreachableFacts(unreachable, "届かないページの新題名"),
		}, nil)

	uc := kb.NewResolvePageRefTitlesUseCase(repo, &mockTicketRefReader{}, &mockUserDisplayReader{})
	got, err := uc.Execute(context.Background(), kb.ResolvePageRefTitlesInput{
		WorkspaceID: kbRefWS, UserID: 7, Doc: kbRefDoc(visible, unreachable),
	})
	assert.NoError(t, err)

	var doc map[string]any
	assert.NoError(t, json.Unmarshal([]byte(got), &doc))
	inline := doc["content"].([]any)[0].(map[string]any)["content"].([]any)
	first := inline[0].(map[string]any)["attrs"].(map[string]any)
	second := inline[1].(map[string]any)["attrs"].(map[string]any)
	assert.Equal(t, "設計メモ v2", first["title"], "閲覧できる参照は現在の題名になる")
	// 届いていない参照には題名を入れない。保存されていた title も読み出し時に剥がす
	// （剥がす前に保存された doc から、権限を失った読み手へ古い題名が返らないように）。
	assert.Nil(t, second["title"])
	repo.AssertExpectations(t)
}

func Test_ページ参照の題名解決_参照が無ければ問い合わせず原文のまま(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	uc := kb.NewResolvePageRefTitlesUseCase(repo, &mockTicketRefReader{}, &mockUserDisplayReader{})
	doc := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"参照なし"}]}]}`

	got, err := uc.Execute(context.Background(), kb.ResolvePageRefTitlesInput{
		WorkspaceID: kbRefWS, UserID: 7, Doc: doc,
	})

	assert.NoError(t, err)
	assert.Equal(t, doc, got)
	repo.AssertNotCalled(t, "ListWorkspacePageViewFactsByIDs")
}

func Test_ページ参照の題名解決_壊れたdocや取得失敗では原文を返す(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	uc := kb.NewResolvePageRefTitlesUseCase(repo, &mockTicketRefReader{}, &mockUserDisplayReader{})

	broken := `{"type":"doc","content":[`
	got, err := uc.Execute(context.Background(), kb.ResolvePageRefTitlesInput{
		WorkspaceID: kbRefWS, UserID: 7, Doc: broken,
	})
	assert.NoError(t, err, "読めない doc はエラーではない（保存経路の検証が弾く領分）")
	assert.Equal(t, broken, got, "読めない doc はそのまま返す（本文が開けることが題名より重い）")

	id := "00000000-0000-7000-8000-000000000001"
	repo.On("ListWorkspacePageViewFactsByIDs", mock.Anything, kbRefWS, uint64(7), []string{id}).
		Return(nil, assert.AnError)
	got2, err2 := uc.Execute(context.Background(), kb.ResolvePageRefTitlesInput{
		WorkspaceID: kbRefWS, UserID: 7, Doc: kbRefDoc(id),
	})
	assert.ErrorIs(t, err2, assert.AnError, "事実の取得失敗は握り潰さず返す（気づけるように）")
	// 失敗でも本文は返すが、保存されていた title は剥がして返す（可視判定を通っていない
	// 題名を、失敗経路からも出さない）。参照そのものは残る。
	assert.Contains(t, got2, id)
	assert.NotContains(t, got2, `"無題"`)
}

func Test_ページ参照の題名解決_同じ参照は1回だけ数える(t *testing.T) {
	repo := &mockKBPermissionRepo{}
	dup := "00000000-0000-7000-8000-000000000001"
	repo.On("ListWorkspacePageViewFactsByIDs", mock.Anything, kbRefWS, uint64(7), []string{dup}).
		Return([]repository.PageWithViewFacts{kbViewableFacts(dup, "本題")}, nil)
	uc := kb.NewResolvePageRefTitlesUseCase(repo, &mockTicketRefReader{}, &mockUserDisplayReader{})

	got, err := uc.Execute(context.Background(), kb.ResolvePageRefTitlesInput{
		WorkspaceID: kbRefWS, UserID: 7, Doc: kbRefDoc(dup, dup),
	})
	assert.NoError(t, err)

	// 同じ ID は 1 回で問い合わせ、両方の出現が書き換わる。
	assert.Contains(t, got, `"本題"`)
	assert.NotContains(t, got, `"無題"`)
	repo.AssertNumberOfCalls(t, "ListWorkspacePageViewFactsByIDs", 1)
}

func Test_ページ参照の題名解決_解決数の天井は文書順の先頭100件(t *testing.T) {
	// 「長さが 100」だけでは、末尾や任意の 100 件を選ぶ実装でも通ってしまう。
	// 契約は**文書順の先頭 100 件**なので、選ばれた ID の並びまで固定する。
	repo := &mockKBPermissionRepo{}
	ids := make([]string, 101)
	for i := range ids {
		ids[i] = fmt.Sprintf("00000000-0000-7000-8000-%012d", i+1)
	}
	repo.On("ListWorkspacePageViewFactsByIDs", mock.Anything, kbRefWS, uint64(7), ids[:100]).
		Return([]repository.PageWithViewFacts{}, nil)
	uc := kb.NewResolvePageRefTitlesUseCase(repo, &mockTicketRefReader{}, &mockUserDisplayReader{})

	_, err := uc.Execute(context.Background(), kb.ResolvePageRefTitlesInput{
		WorkspaceID: kbRefWS, UserID: 7, Doc: kbRefDoc(ids...),
	})

	assert.NoError(t, err)
	repo.AssertExpectations(t)
}

func Test_ページ参照の題名解決_pageIdの表記ゆれは正規形へ寄せて照合する(t *testing.T) {
	// repository は ID を小文字・ハイフン区切りへ正規化して返す。保存された参照が
	// 大文字で書かれていても、突き合わせが外れて題名だけ差し替わらない、を防ぐ。
	repo := &mockKBPermissionRepo{}
	canonical := "00000000-0000-7000-8000-0000000000ab"
	repo.On("ListWorkspacePageViewFactsByIDs", mock.Anything, kbRefWS, uint64(7), []string{canonical}).
		Return([]repository.PageWithViewFacts{kbViewableFacts(canonical, "正規形の題名")}, nil)
	uc := kb.NewResolvePageRefTitlesUseCase(repo, &mockTicketRefReader{}, &mockUserDisplayReader{})

	upper := "00000000-0000-7000-8000-0000000000AB"
	got, err := uc.Execute(context.Background(), kb.ResolvePageRefTitlesInput{
		WorkspaceID: kbRefWS, UserID: 7, Doc: kbRefDoc(upper),
	})

	assert.NoError(t, err)
	assert.Contains(t, got, "正規形の題名")
	repo.AssertExpectations(t)
}

func Test_ページ参照の題名は保存時に剥がされる(t *testing.T) {
	// title は読み手ごとの派生値。保存されると、閲覧できる編集者の画面で解決された
	// 現在の題名が本文へ焼き込まれ、閲覧できない読み手にも返ってしまう。
	id := "00000000-0000-7000-8000-000000000001"
	doc := kbRefDoc(id)

	got := kb.StripPageRefTitles(doc)

	assert.NotContains(t, got, `"無題"`)
	assert.Contains(t, got, id, "参照そのもの（pageId）は残る")

	// 参照が無い doc は触らない（同じ文字列のまま）。
	plain := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"本文"}]}]}`
	assert.Equal(t, plain, kb.StripPageRefTitles(plain))
}

func Test_ページ参照の題名解決_アーカイブ済みの参照は題名に採らない(t *testing.T) {
	// 隠したページの現在の題名を本文へ映さない（検索が現役だけを対象にするのと同じ線引き）。
	repo := &mockKBPermissionRepo{}
	id := "00000000-0000-7000-8000-000000000001"
	archivedAt := time.Now()
	archived := repository.PageWithViewFacts{
		Page: domain.Page{ID: id, Title: "隠した題名", ArchivedAt: &archivedAt},
		Role: kbGrantRole(domain.GrantRoleViewer),
	}
	repo.On("ListWorkspacePageViewFactsByIDs", mock.Anything, kbRefWS, uint64(7), []string{id}).
		Return([]repository.PageWithViewFacts{archived}, nil)
	uc := kb.NewResolvePageRefTitlesUseCase(repo, &mockTicketRefReader{}, &mockUserDisplayReader{})

	got, err := uc.Execute(context.Background(), kb.ResolvePageRefTitlesInput{
		WorkspaceID: kbRefWS, UserID: 7, Doc: kbRefDoc(id),
	})

	assert.NoError(t, err)
	assert.NotContains(t, got, "隠した題名", "現在の題名は入れない")
	// 原文をそのまま返しても通る検証にしない: 保存されていた「無題」も剥がれている
	//（＝読み出し側の strip と解決の両方が実際に走った）ことまで確かめる。
	assert.NotContains(t, got, `"無題"`)
	repo.AssertExpectations(t)
}

func Test_パンくず_閲覧できる祖先だけがclosureの順で返る(t *testing.T) {
	pages := &mockKnowledgeBaseRepo{}
	perms := &mockKBPermissionRepo{}
	// closure の順は「ん」→「あ」（根が「ん」）。facts は題名順（「あ」が先）で返す —
	// 題名順をそのまま使う退行をこの並びで捕まえる。
	root := "00000000-0000-7000-8000-00000000000a"
	child := "00000000-0000-7000-8000-00000000000b"
	unreachable := "00000000-0000-7000-8000-00000000000c"
	pages.On("ListAncestorPageIDs", mock.Anything, kbRefWS, "page-x").
		Return([]string{root, child, unreachable}, nil)
	// 祖先は見えないのに手前のページは開ける、という並びは本番でも起こる:
	// 祖先が作成者以外に見せない private のページで、子はそうでないとき
	// （private はページ 1 枚ごとの印で、子へは降りない）。
	perms.On("ListWorkspacePageViewFactsByIDs", mock.Anything, kbRefWS, uint64(7),
		[]string{root, child, unreachable}).
		Return([]repository.PageWithViewFacts{
			// 題名順: 「あ」(child) が先、「ん」(root) が後。unreachable は役割が nil。
			kbViewableFacts(child, "あ"),
			kbViewableFacts(root, "ん"),
			kbUnreachableFacts(unreachable, "見えない段"),
		}, nil)
	uc := kb.NewListViewableAncestorsUseCase(pages, perms)

	got, err := uc.Execute(context.Background(), kb.ListViewableAncestorsInput{
		WorkspaceID: kbRefWS, UserID: 7, PageID: "page-x",
	})

	assert.NoError(t, err)
	// 並びは closure（根から）。facts の題名順に引きずられない。
	// 見えない段は行ごと消える（題名どころか実在も知らせない）。
	assert.Equal(t, []kb.AncestorRef{
		{ID: root, Title: "ん"},
		{ID: child, Title: "あ"},
	}, got)
}

func Test_パンくず_アーカイブ済みの祖先も閲覧できる限り含める(t *testing.T) {
	// アーカイブ済みのページは /p で開ける。経路から抜くと「その段が無い」かのように
	// 場所を偽るので、可視である限り出す（題名解決と除外の線引きが違う）。
	pages := &mockKnowledgeBaseRepo{}
	perms := &mockKBPermissionRepo{}
	arch := "00000000-0000-7000-8000-00000000000d"
	archivedAt := time.Now()
	pages.On("ListAncestorPageIDs", mock.Anything, kbRefWS, "page-y").
		Return([]string{arch}, nil)
	perms.On("ListWorkspacePageViewFactsByIDs", mock.Anything, kbRefWS, uint64(7), []string{arch}).
		Return([]repository.PageWithViewFacts{{
			Page: domain.Page{ID: arch, Title: "片付けた親", ArchivedAt: &archivedAt},
			Role: kbGrantRole(domain.GrantRoleViewer),
		}}, nil)
	uc := kb.NewListViewableAncestorsUseCase(pages, perms)

	got, err := uc.Execute(context.Background(), kb.ListViewableAncestorsInput{
		WorkspaceID: kbRefWS, UserID: 7, PageID: "page-y",
	})

	assert.NoError(t, err)
	assert.Equal(t, []kb.AncestorRef{{ID: arch, Title: "片付けた親"}}, got)
}

func Test_パンくず_祖先が無ければ空のsliceを返す(t *testing.T) {
	// nil を返すと JSON で null になり、フロントの ancestors.map が落ちる。
	pages := &mockKnowledgeBaseRepo{}
	perms := &mockKBPermissionRepo{}
	pages.On("ListAncestorPageIDs", mock.Anything, kbRefWS, "root-page").
		Return([]string{}, nil)
	uc := kb.NewListViewableAncestorsUseCase(pages, perms)

	got, err := uc.Execute(context.Background(), kb.ListViewableAncestorsInput{
		WorkspaceID: kbRefWS, UserID: 7, PageID: "root-page",
	})

	assert.NoError(t, err)
	assert.NotNil(t, got)
	assert.Empty(t, got)
	perms.AssertNotCalled(t, "ListWorkspacePageViewFactsByIDs")
}

// =====================================================================================
// ページ画像アップロード URL 発行（IssuePageImageUploadURLUseCase）
// =====================================================================================

func Test_ページ画像アップロード_アーカイブ済みは拒否(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbArchivedPage(kbPage, kbSpace, nil), nil)
	presigner := &mockKbImagePresigner{}
	uc := kb.NewIssuePageImageUploadURLUseCase(repo, presigner)

	_, err := uc.Execute(context.Background(), kb.IssuePageImageUploadURLInput{
		WorkspaceID: kbWS, PageID: kbPage, ContentType: "image/png", Size: 1024,
	})
	require.ErrorIs(t, err, kb.ErrPageArchived)
	presigner.AssertNotCalled(t, "PresignUpload", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

// Test_ページ画像アップロード_不正なcontentTypeやsizeはrepositoryを呼ばず拒否 は、形の検証が
// repository を呼ぶ**前**に効いていることを固定する（SetPageIconUseCase の
// Test_ページアイコン_不正な値は保存せず拒否 と同じ形）。
//
// 変異確認: domain.ValidateImageUpload の許可リストチェックを外すと、「許可リスト外の
// ContentType」ケースが緑のまま落ちなくなる（ErrUnsupportedImageContentType を返さなくなるため）。
func Test_ページ画像アップロード_不正なcontentTypeやsizeはrepositoryを呼ばず拒否(t *testing.T) {
	cases := []struct {
		name        string
		contentType string
		size        int64
	}{
		{"許可リスト外のContentType", "image/svg+xml", 1024},
		{"サイズ超過", "image/png", domain.MaxImageUploadBytes + 1},
		{"サイズ0", "image/png", 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			repo := &mockKnowledgeBaseRepo{}
			presigner := &mockKbImagePresigner{}
			uc := kb.NewIssuePageImageUploadURLUseCase(repo, presigner)

			_, err := uc.Execute(context.Background(), kb.IssuePageImageUploadURLInput{
				WorkspaceID: kbWS, PageID: kbPage, ContentType: c.contentType, Size: c.size,
			})
			require.Error(t, err)
			repo.AssertNotCalled(t, "FindPage", mock.Anything, mock.Anything, mock.Anything)
			presigner.AssertNotCalled(t, "PresignUpload", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
		})
	}
}

func Test_ページ画像アップロード_正常系はページに閉じたキーを採番してpresignする(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	wantPrefix := "kb/" + kbWS + "/" + kbPage + "/"
	presigner := &mockKbImagePresigner{}
	presigner.On("PresignUpload", mock.Anything, mock.MatchedBy(func(key string) bool {
		return strings.HasPrefix(key, wantPrefix) && strings.HasSuffix(key, ".bin")
	}), "image/png", int64(1024)).Return("https://example/upload", 600, nil)
	uc := kb.NewIssuePageImageUploadURLUseCase(repo, presigner)

	got, err := uc.Execute(context.Background(), kb.IssuePageImageUploadURLInput{
		WorkspaceID: kbWS, PageID: kbPage, ContentType: "image/png", Size: 1024,
	})
	require.NoError(t, err)
	assert.Equal(t, "https://example/upload", got.URL)
	assert.Equal(t, 600, got.ExpiresIn)
	assert.True(t, strings.HasPrefix(got.Key, wantPrefix), "採番した key はこのページに閉じた形であること: %s", got.Key)
}

// =====================================================================================
// ページ画像ダウンロード URL 発行（IssuePageImageDownloadURLUseCase）
// =====================================================================================

func Test_ページ画像ダウンロード_キー空文字は専用エラー(t *testing.T) {
	uc := kb.NewIssuePageImageDownloadURLUseCase(&mockKnowledgeBaseRepo{}, &mockKbImagePresigner{})

	_, err := uc.Execute(context.Background(), kb.IssuePageImageDownloadURLInput{
		WorkspaceID: kbWS, PageID: kbPage, Key: "",
	})
	require.ErrorIs(t, err, kb.ErrInvalidImageKey)
}

// Test_ページ画像ダウンロード_自ページのキーは無条件で許可 は、そのページ自身がアップロードした
// key（"kb/<workspaceId>/<pageId>/..." に完全一致する prefix）なら DB 問い合わせを経由せずに
// 許可することを固定する。
func Test_ページ画像ダウンロード_自ページのキーは無条件で許可(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	presigner := &mockKbImagePresigner{}
	key := "kb/" + kbWS + "/" + kbPage + "/1.bin"
	presigner.On("PresignDownload", mock.Anything, key).Return("https://example/download", 600, nil)
	uc := kb.NewIssuePageImageDownloadURLUseCase(repo, presigner)

	got, err := uc.Execute(context.Background(), kb.IssuePageImageDownloadURLInput{
		WorkspaceID: kbWS, PageID: kbPage, Key: key,
	})
	require.NoError(t, err)
	assert.Equal(t, "https://example/download", got.URL)
}

// Test_ページ画像ダウンロード_別ワークスペースのキーは404 は、ワークスペースの境界を越える
// key を弾くことを固定する。
func Test_ページ画像ダウンロード_別ワークスペースのキーは404(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	presigner := &mockKbImagePresigner{}
	otherWS := "0198a000-0000-7000-8000-0000000000ff"
	key := "kb/" + otherWS + "/" + kbPage + "/1.bin"
	uc := kb.NewIssuePageImageDownloadURLUseCase(repo, presigner)

	_, err := uc.Execute(context.Background(), kb.IssuePageImageDownloadURLInput{
		WorkspaceID: kbWS, PageID: kbPage, Key: key,
	})
	require.ErrorIs(t, err, repository.ErrPageNotFound)
	presigner.AssertNotCalled(t, "PresignDownload", mock.Anything, mock.Anything)
}

// Test_ページ画像ダウンロード_同一ワークスペースの他ページ由来のキーも404 は、
// 「同一ワークスペース内なら本文に貼られていれば許可する」というフォールバックを
// しないことを固定する。このフォールバックは自作自演で破れる — blocks.attrs は image
// 特有のフィールドをパースせず素通しするため、自分が編集できるページに他ページの key を
// 書き込むだけで「貼られている」を自分で作れてしまい、その画像の持ち主のページへの
// 権限が無くても読めてしまう。
//
// 変異確認: kbImageKeyPrefix(workspaceID, pageID) の一致条件を「ワークスペースが同じなら
// 常に許可」に緩めると、このテストが落ちる。
func Test_ページ画像ダウンロード_同一ワークスペースの他ページ由来のキーも404(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	presigner := &mockKbImagePresigner{}
	otherPage := "0198a000-0000-7000-8000-0000000000ee"
	key := "kb/" + kbWS + "/" + otherPage + "/1.bin"
	uc := kb.NewIssuePageImageDownloadURLUseCase(repo, presigner)

	_, err := uc.Execute(context.Background(), kb.IssuePageImageDownloadURLInput{
		WorkspaceID: kbWS, PageID: kbPage, Key: key,
	})
	require.ErrorIs(t, err, repository.ErrPageNotFound)
	presigner.AssertNotCalled(t, "PresignDownload", mock.Anything, mock.Anything)
	repo.AssertExpectations(t)
}

// =====================================================================================
// ページカバー設定（SetPageCoverUseCase）
// =====================================================================================

// Test_ページカバー設定_自ページ以外のキーは拒否 は、同一ワークスペース内の他ページの key でも
// フォールバック無しで拒否することを固定する（ダウンロードと違い、カバーには
// 「同一ワークスペースなら許可」を持たせない。ErrInvalidCoverKey の doc 参照）。
//
// 変異確認: SetPageCoverUseCase の prefix チェックを外すと、この「他ページの key を拒否する」
// 検証が落ちる。
func Test_ページカバー設定_自ページ以外のキーは拒否(t *testing.T) {
	otherPage := "0198a000-0000-7000-8000-0000000000ee"
	key := "kb/" + kbWS + "/" + otherPage + "/1.bin"
	repo := &mockKnowledgeBaseRepo{}
	uc := kb.NewSetPageCoverUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.SetPageCoverInput{
		WorkspaceID: kbWS, PageID: kbPage, Key: &key,
	})
	require.ErrorIs(t, err, kb.ErrInvalidCoverKey)
	repo.AssertNotCalled(t, "FindPage", mock.Anything, mock.Anything, mock.Anything)
	repo.AssertNotCalled(t, "UpdatePageCover", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_ページカバー設定_別ワークスペースのキーも拒否(t *testing.T) {
	otherWS := "0198a000-0000-7000-8000-0000000000ff"
	key := "kb/" + otherWS + "/" + kbPage + "/1.bin"
	repo := &mockKnowledgeBaseRepo{}
	uc := kb.NewSetPageCoverUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.SetPageCoverInput{
		WorkspaceID: kbWS, PageID: kbPage, Key: &key,
	})
	require.ErrorIs(t, err, kb.ErrInvalidCoverKey)
}

func Test_ページカバー設定_自ページのキーは保存される(t *testing.T) {
	key := "kb/" + kbWS + "/" + kbPage + "/1.bin"
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	cover := &domain.PageCover{Type: domain.PageCoverTypeFile, Key: key}
	updated := kbActivePage(kbPage, kbSpace, nil)
	updated.Cover = cover
	repo.On("UpdatePageCover", mock.Anything, kbWS, kbPage, cover).Return(updated, nil)
	uc := kb.NewSetPageCoverUseCase(repo)

	got, err := uc.Execute(context.Background(), kb.SetPageCoverInput{
		WorkspaceID: kbWS, PageID: kbPage, Key: &key,
	})
	require.NoError(t, err)
	require.NotNil(t, got.Cover)
	assert.Equal(t, *cover, *got.Cover)
}

func Test_ページカバー設定_アーカイブ済みは拒否(t *testing.T) {
	key := "kb/" + kbWS + "/" + kbPage + "/1.bin"
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbArchivedPage(kbPage, kbSpace, nil), nil)
	uc := kb.NewSetPageCoverUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.SetPageCoverInput{
		WorkspaceID: kbWS, PageID: kbPage, Key: &key,
	})
	require.ErrorIs(t, err, kb.ErrPageArchived)
}

// Test_ページカバー解除_nilを渡す は「外す」操作が UpdatePageCover に nil を渡すことを固定する
// （SetPageIconUseCase の Test_ページアイコン_解除はnilを渡す と同じ形）。
func Test_ページカバー解除_nilを渡す(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	repo.On("UpdatePageCover", mock.Anything, kbWS, kbPage, (*domain.PageCover)(nil)).
		Return(kbActivePage(kbPage, kbSpace, nil), nil)
	uc := kb.NewSetPageCoverUseCase(repo)

	_, err := uc.Execute(context.Background(), kb.SetPageCoverInput{
		WorkspaceID: kbWS, PageID: kbPage, Key: nil,
	})
	require.NoError(t, err)
	repo.AssertExpectations(t)
}

// =====================================================================================
// カバー URL 解決（ResolveCoverURLUseCase）
// =====================================================================================

func Test_カバーURL解決_nilならnilを返す(t *testing.T) {
	uc := kb.NewResolveCoverURLUseCase(&mockKbImagePresigner{})

	got, err := uc.Execute(context.Background(), nil)
	require.NoError(t, err)
	assert.Nil(t, got)
}

func Test_カバーURL解決_presignして返す(t *testing.T) {
	presigner := &mockKbImagePresigner{}
	cover := &domain.PageCover{Type: domain.PageCoverTypeFile, Key: "kb/x/y/1.bin"}
	presigner.On("PresignDownload", mock.Anything, cover.Key).Return("https://example/dl", 600, nil)
	uc := kb.NewResolveCoverURLUseCase(presigner)

	got, err := uc.Execute(context.Background(), cover)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, "file", got.Type)
	assert.Equal(t, "https://example/dl", got.URL)
	assert.Equal(t, 600, got.ExpiresIn)
}

// kbTicketRefDoc は ticketRef（表示の写し付き）だけを並べた本文。
func kbTicketRefDoc(ids ...string) string {
	content := ""
	for i, id := range ids {
		if i > 0 {
			content += ","
		}
		content += fmt.Sprintf(`{"type":"ticketRef","attrs":{"ticketId":%q,"key":"OLD-1","title":"古い題名","statusName":"古い状態","statusCategory":"todo"}}`, id)
	}
	return `{"type":"doc","content":[{"type":"paragraph","content":[` + content + `]}]}`
}

func kbInlineAttrs(t *testing.T, doc string, index int) map[string]any {
	t.Helper()
	var root map[string]any
	require.NoError(t, json.Unmarshal([]byte(doc), &root))
	inline := root["content"].([]any)[0].(map[string]any)["content"].([]any)
	return inline[index].(map[string]any)["attrs"].(map[string]any)
}

func Test_チケット参照の解決_見られるチケットは鍵と題名と状態になる(t *testing.T) {
	perms := &mockKBPermissionRepo{}
	tickets := &mockTicketRefReader{}
	visible := "00000000-0000-7000-8000-0000000000b1"
	gone := "00000000-0000-7000-8000-0000000000b2"
	perms.On("WorkspacePermissionFactsForUser", mock.Anything, kbRefWS, uint64(7)).
		Return(&domain.ScopeFacts{Roles: []domain.GrantRole{domain.GrantRoleViewer}}, nil)
	// gone は返ってこない（削除済み・他ワークスペース・存在しない、のどれも同じ）。
	tickets.On("ListTicketRefFactsByIDs", mock.Anything, kbRefWS, []string{visible, gone}).
		Return([]domain.TicketRefFact{
			{ID: visible, ProjectKey: "ENG", Number: 12, Title: "ログインが落ちる", StatusName: "進行中", StatusCategory: domain.TicketStatusCategoryInProgress},
		}, nil)

	uc := kb.NewResolvePageRefTitlesUseCase(perms, tickets, &mockUserDisplayReader{})
	got, err := uc.Execute(context.Background(), kb.ResolvePageRefTitlesInput{
		WorkspaceID: kbRefWS, UserID: 7, Doc: kbTicketRefDoc(visible, gone),
	})
	require.NoError(t, err)

	first := kbInlineAttrs(t, got, 0)
	assert.Equal(t, visible, first["ticketId"])
	assert.Equal(t, "ENG-12", first["key"], "表示キーはプロジェクトの key と連番から組み立てる")
	assert.Equal(t, "ログインが落ちる", first["title"])
	assert.Equal(t, "進行中", first["statusName"])
	assert.Equal(t, "in_progress", first["statusCategory"])

	// 返ってこなかった参照は表示の写しをすべて剥がす（保存されていた古い値を読み手へ返さない）。
	second := kbInlineAttrs(t, got, 1)
	assert.Equal(t, gone, second["ticketId"])
	for _, key := range []string{"key", "title", "statusName", "statusCategory"} {
		assert.Nil(t, second[key], key)
	}
	perms.AssertNotCalled(t, "ListWorkspacePageViewFactsByIDs")
	tickets.AssertExpectations(t)
}

func Test_チケット参照の解決_ページ参照と混ざっていても両方解決する(t *testing.T) {
	perms := &mockKBPermissionRepo{}
	tickets := &mockTicketRefReader{}
	page := "00000000-0000-7000-8000-0000000000a1"
	ticket := "00000000-0000-7000-8000-0000000000b1"
	doc := `{"type":"doc","content":[{"type":"paragraph","content":[` +
		fmt.Sprintf(`{"type":"pageRef","attrs":{"pageId":%q,"title":null}},`, page) +
		fmt.Sprintf(`{"type":"ticketRef","attrs":{"ticketId":%q}}`, ticket) +
		`]}]}`
	perms.On("WorkspacePermissionFactsForUser", mock.Anything, kbRefWS, uint64(7)).
		Return(&domain.ScopeFacts{Roles: []domain.GrantRole{domain.GrantRoleViewer}}, nil)
	perms.On("ListWorkspacePageViewFactsByIDs", mock.Anything, kbRefWS, uint64(7), []string{page}).
		Return([]repository.PageWithViewFacts{kbViewableFacts(page, "設計メモ")}, nil)
	tickets.On("ListTicketRefFactsByIDs", mock.Anything, kbRefWS, []string{ticket}).
		Return([]domain.TicketRefFact{{ID: ticket, ProjectKey: "eng", Number: 3, Title: "表を直す", StatusName: "To Do", StatusCategory: domain.TicketStatusCategoryTodo}}, nil)

	uc := kb.NewResolvePageRefTitlesUseCase(perms, tickets, &mockUserDisplayReader{})
	got, err := uc.Execute(context.Background(), kb.ResolvePageRefTitlesInput{WorkspaceID: kbRefWS, UserID: 7, Doc: doc})
	require.NoError(t, err)
	assert.Equal(t, "設計メモ", kbInlineAttrs(t, got, 0)["title"])
	assert.Equal(t, "ENG-3", kbInlineAttrs(t, got, 1)["key"], "鍵は大文字にそろえる")
	assert.Equal(t, "表を直す", kbInlineAttrs(t, got, 1)["title"])
}

func Test_チケット参照の解決_取得に失敗したら剥がした本文とエラーを返す(t *testing.T) {
	perms := &mockKBPermissionRepo{}
	tickets := &mockTicketRefReader{}
	id := "00000000-0000-7000-8000-0000000000b1"
	perms.On("WorkspacePermissionFactsForUser", mock.Anything, kbRefWS, uint64(7)).
		Return(&domain.ScopeFacts{Roles: []domain.GrantRole{domain.GrantRoleViewer}}, nil)
	tickets.On("ListTicketRefFactsByIDs", mock.Anything, kbRefWS, []string{id}).Return(nil, errors.New("db down"))

	uc := kb.NewResolvePageRefTitlesUseCase(perms, tickets, &mockUserDisplayReader{})
	got, err := uc.Execute(context.Background(), kb.ResolvePageRefTitlesInput{WorkspaceID: kbRefWS, UserID: 7, Doc: kbTicketRefDoc(id)})
	assert.Error(t, err)
	attrs := kbInlineAttrs(t, got, 0)
	assert.Equal(t, id, attrs["ticketId"])
	assert.Nil(t, attrs["title"], "失敗しても保存されていた古い写しは返さない")
	assert.Nil(t, attrs["key"])
}

func Test_チケット参照の解決_バックログを見られない読み手には写しを返さない(t *testing.T) {
	// ページは共有リンクや個別の付与で見られても、チケットの閲覧はワークスペースの役割で決まる
	// （CheckTicketPermissionUseCase と同じ事実・同じ規則）。役割が無ければ問い合わせもしない。
	perms := &mockKBPermissionRepo{}
	tickets := &mockTicketRefReader{}
	id := "00000000-0000-7000-8000-0000000000b1"
	perms.On("WorkspacePermissionFactsForUser", mock.Anything, kbRefWS, uint64(7)).
		Return(&domain.ScopeFacts{}, nil)

	uc := kb.NewResolvePageRefTitlesUseCase(perms, tickets, &mockUserDisplayReader{})
	got, err := uc.Execute(context.Background(), kb.ResolvePageRefTitlesInput{WorkspaceID: kbRefWS, UserID: 7, Doc: kbTicketRefDoc(id)})
	require.NoError(t, err)
	attrs := kbInlineAttrs(t, got, 0)
	assert.Equal(t, id, attrs["ticketId"], "参照そのものは残る（画面は「チケット」とだけ出す）")
	for _, key := range []string{"key", "title", "statusName", "statusCategory"} {
		assert.Nil(t, attrs[key], key)
	}
	tickets.AssertNotCalled(t, "ListTicketRefFactsByIDs")
}

func kbMentionDoc(ids ...string) string {
	content := ""
	for i, id := range ids {
		if i > 0 {
			content += ","
		}
		content += fmt.Sprintf(`{"type":"mention","attrs":{"userId":%q,"name":"古い名前"}}`, id)
	}
	return `{"type":"doc","content":[{"type":"paragraph","content":[` + content + `]}]}`
}

func Test_名指しの解決_実在する人の名前が入り無い人は剥がしたまま(t *testing.T) {
	users := &mockUserDisplayReader{}
	users.On("ListUserDisplaysByIDs", mock.Anything, []uint64{5, 6}).
		Return([]domain.UserDisplay{{UserID: 5, Name: "田中"}}, nil)

	uc := kb.NewResolvePageRefTitlesUseCase(&mockKBPermissionRepo{}, &mockTicketRefReader{}, users)
	got, err := uc.Execute(context.Background(), kb.ResolvePageRefTitlesInput{WorkspaceID: kbRefWS, UserID: 7, Doc: kbMentionDoc("5", "6")})
	require.NoError(t, err)
	assert.Equal(t, "田中", kbInlineAttrs(t, got, 0)["name"])
	assert.Equal(t, "5", kbInlineAttrs(t, got, 0)["userId"])
	assert.Nil(t, kbInlineAttrs(t, got, 1)["name"], "無い人は保存されていた古い写しも返さない")
	users.AssertExpectations(t)
}

func Test_名指しの解決_不正なuserIdは数えず問い合わせもしない(t *testing.T) {
	users := &mockUserDisplayReader{}
	doc := `{"type":"doc","content":[{"type":"paragraph","content":[` +
		`{"type":"mention","attrs":{"userId":"abc","name":"x"}},{"type":"mention","attrs":{"userId":"0"}}]}]}`
	uc := kb.NewResolvePageRefTitlesUseCase(&mockKBPermissionRepo{}, &mockTicketRefReader{}, users)
	got, err := uc.Execute(context.Background(), kb.ResolvePageRefTitlesInput{WorkspaceID: kbRefWS, UserID: 7, Doc: doc})
	require.NoError(t, err)
	// 参照として数えない以上、解決の対象が無い本文としてそのまま返る（保存側は ID の形に
	// 関わらず剥がすので、こうした写しは新しい保存からは消える。pageRef の不正な ID と同じ扱い）。
	assert.Equal(t, doc, got)
	users.AssertNotCalled(t, "ListUserDisplaysByIDs")
}

// replaceWithMentionsFixture は本文の保存の土台（既存の保存テストと同じモック）に、
// 名指しの通知に要る権限と通知のモックを添える。
type replaceWithMentionsFixture struct {
	repo        *mockKnowledgeBaseRepo
	versionRepo *mockPageVersionRepo
	perms       *mockKBPermissionRepo
	notifs      *mockNotificationRepo
	created     []domain.Notification
}

func newReplaceWithMentionsFixture(t *testing.T, previous *domain.PageSnapshot, previousErr error) *replaceWithMentionsFixture {
	t.Helper()
	f := &replaceWithMentionsFixture{
		repo: &mockKnowledgeBaseRepo{}, versionRepo: &mockPageVersionRepo{},
		perms: &mockKBPermissionRepo{}, notifs: &mockNotificationRepo{},
	}
	f.repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	f.repo.On("TouchPageLastEditedBy", mock.Anything, kbWS, kbPage, kbEditorUserID).Return(nil)
	f.repo.On("ReplacePageBlocks", mock.Anything, kbWS, kbPage, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil)
	// 1 回目は置き換える前の本文（通知の差分の材料）、2 回目は保存後の返却。
	f.repo.On("GetPageSnapshot", mock.Anything, kbWS, kbPage).Return(previous, previousErr).Once()
	f.repo.On("GetPageSnapshot", mock.Anything, kbWS, kbPage).Return(&domain.PageSnapshot{PageID: kbPage, Doc: "{}"}, nil)
	f.versionRepo.On("CreateVersionIfDue", mock.Anything, kbWS, kbPage, mock.Anything, kbEditorUserID, (*string)(nil), false).Return(false, nil, nil)
	f.notifs.On("CreateMany", mock.Anything, mock.Anything).Run(func(args mock.Arguments) {
		f.created = append(f.created, args.Get(1).([]domain.Notification)...)
	}).Return(nil).Maybe()
	return f
}

func (f *replaceWithMentionsFixture) allowView(userID uint64) {
	role := domain.GrantRoleViewer
	f.perms.On("PagePermissionFactsForUser", mock.Anything, kbWS, kbPage, userID).
		Return(&domain.PagePermissionFacts{Member: true, Role: &role}, nil)
}

func (f *replaceWithMentionsFixture) denyView(userID uint64) {
	f.perms.On("PagePermissionFactsForUser", mock.Anything, kbWS, kbPage, userID).
		Return(&domain.PagePermissionFacts{}, nil)
}

func (f *replaceWithMentionsFixture) save(t *testing.T, doc string) {
	t.Helper()
	uc := kb.NewReplacePageBlocksUseCase(f.repo, &fakeTxManager{}, f.versionRepo, f.perms, f.notifs, nil)
	_, err := uc.Execute(context.Background(), kb.ReplacePageBlocksInput{
		WorkspaceID: kbWS, PageID: kbPage, Doc: doc, EditorUserID: kbEditorUserID,
	})
	require.NoError(t, err)
}

func Test_名指しの通知_新しく名指しされた見られる一員にだけ届き本人と前からいた人と見られない人には届かない(t *testing.T) {
	self := strconv.FormatUint(kbEditorUserID, 10)
	f := newReplaceWithMentionsFixture(t, &domain.PageSnapshot{PageID: kbPage, Doc: kbMentionDoc("5")}, nil)
	f.allowView(6)
	f.denyView(8)

	// 5 は前の本文にもいる・6 は新しく見られる・8 は新しいが見られない・本人は常に対象外。
	f.save(t, kbMentionDoc("5", "6", "8", self))

	require.Len(t, f.created, 1)
	got := f.created[0]
	assert.Equal(t, uint64(6), got.UserID)
	assert.Equal(t, domain.NotificationTypePageMentioned, got.Type)
	assert.Equal(t, "ページで名指しされました", got.Title)
	assert.Equal(t, kbActivePage(kbPage, kbSpace, nil).Title, got.Body, "本文は題名")
	assert.Equal(t, "/kb/"+kbPage, got.LinkPath)
	f.perms.AssertNotCalled(t, "PagePermissionFactsForUser", mock.Anything, kbWS, kbPage, uint64(5))
	f.perms.AssertNotCalled(t, "PagePermissionFactsForUser", mock.Anything, kbWS, kbPage, kbEditorUserID)
}

func Test_名指しの通知_前の本文がまだ無ければ名指し全員が新しい(t *testing.T) {
	f := newReplaceWithMentionsFixture(t, nil, repository.ErrPageSnapshotNotFound)
	f.allowView(5)
	f.allowView(6)
	f.save(t, kbMentionDoc("5", "6"))
	require.Len(t, f.created, 2)
}

func Test_名指しの通知_通知の作成に失敗しても保存は成功する(t *testing.T) {
	f := newReplaceWithMentionsFixture(t, nil, repository.ErrPageSnapshotNotFound)
	f.notifs.ExpectedCalls = nil
	f.notifs.On("CreateMany", mock.Anything, mock.Anything).Return(errors.New("db down"))
	f.allowView(5)
	f.save(t, kbMentionDoc("5"))
	f.notifs.AssertExpectations(t)
}

func Test_名指しの通知_名指しが無ければ前の本文も権限も読まない(t *testing.T) {
	f := newReplaceWithMentionsFixture(t, nil, nil)
	f.save(t, `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"ただの本文"}]}]}`)
	f.repo.AssertNumberOfCalls(t, "GetPageSnapshot", 1)
	f.perms.AssertNotCalled(t, "PagePermissionFactsForUser")
	f.notifs.AssertNotCalled(t, "CreateMany")
	assert.Empty(t, f.created)
}

func Test_名指しの通知_前の本文を読めなければ保存ごと失敗する(t *testing.T) {
	f := newReplaceWithMentionsFixture(t, nil, errors.New("db down"))
	uc := kb.NewReplacePageBlocksUseCase(f.repo, &fakeTxManager{}, f.versionRepo, f.perms, f.notifs, nil)
	_, err := uc.Execute(context.Background(), kb.ReplacePageBlocksInput{
		WorkspaceID: kbWS, PageID: kbPage, Doc: kbMentionDoc("5"), EditorUserID: kbEditorUserID,
	})
	assert.Error(t, err)
	f.repo.AssertNotCalled(t, "ReplacePageBlocks", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}
