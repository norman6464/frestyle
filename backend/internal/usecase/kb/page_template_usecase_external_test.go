package kb_test

import (
	"context"
	"strings"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// FRESTYLE-435（段5・テンプレート）の kb.CreateTemplateFromPageUseCase /
// kb.ListPageTemplatesUseCase / kb.DeletePageTemplateUseCase /
// kb.CreatePageFromTemplateUseCase の単体テスト。page_usecase_external_test.go /
// page_version_usecase_external_test.go と同じ流儀（testify/mock、kbWS/kbSpace/kbPage/
// kbEditorUserID/kbActivePage/fakeTxManager/inTx を共有）。

const kbTemplateDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"雛形の本文"}]}]}`

// Test_雛形として保存_snapshotがあればそれをdocとして使う は GetPageUseCase.Execute と同じ
// フォールバック手順（snapshot 優先）を CreateTemplateFromPageUseCase も踏むことを固定する。
func Test_雛形として保存_snapshotがあればそれをdocとして使う(t *testing.T) {
	kbRepo := &mockKnowledgeBaseRepo{}
	kbRepo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	kbRepo.On("GetPageSnapshot", mock.Anything, kbWS, kbPage).
		Return(&domain.PageSnapshot{PageID: kbPage, Doc: kbTemplateDoc}, nil)
	templates := &mockPageTemplateRepo{}
	var created *domain.PageTemplate
	templates.On("Create", mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) { created = args.Get(1).(*domain.PageTemplate) }).Return(nil)
	uc := kb.NewCreateTemplateFromPageUseCase(kbRepo, templates, kb.NewCheckSpacePermissionUseCase(&mockKBPermissionRepo{}))

	_, err := uc.Execute(context.Background(), kb.CreateTemplateFromPageInput{
		WorkspaceID: kbWS, PageID: kbPage, Name: "議事録", AuthorUserID: kbEditorUserID,
	})
	require.NoError(t, err)
	require.NotNil(t, created)
	assert.Contains(t, created.Doc, "雛形の本文")
	kbRepo.AssertNotCalled(t, "ListBlocksByPage", mock.Anything, mock.Anything, mock.Anything)
}

// Test_雛形として保存_snapshotが無ければブロックから組み立てる は currentPageDoc の
// フォールバック（ListBlocksByPage → treeFromBlocks/renderPageDoc）を固定する。
func Test_雛形として保存_snapshotが無ければブロックから組み立てる(t *testing.T) {
	inline := `[{"type":"text","text":"組み立てた本文"}]`
	kbRepo := &mockKnowledgeBaseRepo{}
	kbRepo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	kbRepo.On("GetPageSnapshot", mock.Anything, kbWS, kbPage).Return(nil, repository.ErrPageSnapshotNotFound)
	kbRepo.On("ListBlocksByPage", mock.Anything, kbWS, kbPage).Return([]domain.Block{
		{ID: "b1", PageID: kbPage, Type: domain.BlockTypeParagraph, Position: "a0", Attrs: "{}", Inline: &inline},
	}, nil)
	templates := &mockPageTemplateRepo{}
	var created *domain.PageTemplate
	templates.On("Create", mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) { created = args.Get(1).(*domain.PageTemplate) }).Return(nil)
	uc := kb.NewCreateTemplateFromPageUseCase(kbRepo, templates, kb.NewCheckSpacePermissionUseCase(&mockKBPermissionRepo{}))

	_, err := uc.Execute(context.Background(), kb.CreateTemplateFromPageInput{
		WorkspaceID: kbWS, PageID: kbPage, Name: "議事録", AuthorUserID: kbEditorUserID,
	})
	require.NoError(t, err)
	require.NotNil(t, created)
	assert.Contains(t, created.Doc, "組み立てた本文")
}

// Test_雛形として保存_不正な名前を拒否しrepoを呼ばない は、ValidateTemplateName の検証を
// kbRepo / templates のどちらも呼ぶ前に行うことを固定する。
func Test_雛形として保存_不正な名前を拒否しrepoを呼ばない(t *testing.T) {
	kbRepo := &mockKnowledgeBaseRepo{}
	templates := &mockPageTemplateRepo{}
	uc := kb.NewCreateTemplateFromPageUseCase(kbRepo, templates, kb.NewCheckSpacePermissionUseCase(&mockKBPermissionRepo{}))

	_, err := uc.Execute(context.Background(), kb.CreateTemplateFromPageInput{
		WorkspaceID: kbWS, PageID: kbPage, Name: "   ", AuthorUserID: kbEditorUserID,
	})
	require.ErrorIs(t, err, domain.ErrInvalidTemplateName)
	kbRepo.AssertNotCalled(t, "FindPage", mock.Anything, mock.Anything, mock.Anything)
	templates.AssertNotCalled(t, "Create", mock.Anything, mock.Anything)
}

// Test_雛形として保存_存在しないspaceIdを拒否する は、指定した spaceId が同じワークスペース内に
// 実在しないとき repository.ErrSpaceNotFound を返し、templates.Create を呼ばないことを固定する。
func Test_雛形として保存_存在しないspaceIdを拒否する(t *testing.T) {
	missingSpace := "0198a000-0000-7000-8000-0000000000ff"
	kbRepo := &mockKnowledgeBaseRepo{}
	kbRepo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	kbRepo.On("GetPageSnapshot", mock.Anything, kbWS, kbPage).
		Return(&domain.PageSnapshot{PageID: kbPage, Doc: kbTemplateDoc}, nil)
	kbRepo.On("FindSpace", mock.Anything, kbWS, missingSpace).Return(nil, repository.ErrSpaceNotFound)
	templates := &mockPageTemplateRepo{}
	uc := kb.NewCreateTemplateFromPageUseCase(kbRepo, templates, kb.NewCheckSpacePermissionUseCase(&mockKBPermissionRepo{}))

	_, err := uc.Execute(context.Background(), kb.CreateTemplateFromPageInput{
		WorkspaceID: kbWS, PageID: kbPage, SpaceID: &missingSpace, Name: "議事録", AuthorUserID: kbEditorUserID,
	})
	require.ErrorIs(t, err, repository.ErrSpaceNotFound)
	templates.AssertNotCalled(t, "Create", mock.Anything, mock.Anything)
}

// Test_雛形として保存_閲覧できないspaceIdは拒否する は、spaceId が実在しても呼び出し者が
// そのスペースを閲覧できなければ ErrSpaceNotFound で拒否することを固定する。実在確認だけでは
// 「見たこともない非公開スペースへ、自分が編集できる別ページの本文を紐付ける」ことを
// 止められないため（usecase 側のコメント参照）。
//
// 変異確認: !perm.CanView の分岐を外すと、このテストの ErrSpaceNotFound 判定が落ちる。
func Test_雛形として保存_閲覧できないspaceIdは拒否する(t *testing.T) {
	privateSpace := "0198a000-0000-7000-8000-0000000000ee"
	kbRepo := &mockKnowledgeBaseRepo{}
	kbRepo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	kbRepo.On("GetPageSnapshot", mock.Anything, kbWS, kbPage).
		Return(&domain.PageSnapshot{PageID: kbPage, Doc: kbTemplateDoc}, nil)
	kbRepo.On("FindSpace", mock.Anything, kbWS, privateSpace).Return(&domain.Space{ID: privateSpace, WorkspaceID: kbWS}, nil)
	perms := &mockKBPermissionRepo{}
	perms.On("SpacePermissionFactsForUser", mock.Anything, kbWS, privateSpace, kbEditorUserID).
		Return(&domain.ScopeFacts{}, nil)
	templates := &mockPageTemplateRepo{}
	uc := kb.NewCreateTemplateFromPageUseCase(kbRepo, templates, kb.NewCheckSpacePermissionUseCase(perms))

	_, err := uc.Execute(context.Background(), kb.CreateTemplateFromPageInput{
		WorkspaceID: kbWS, PageID: kbPage, SpaceID: &privateSpace, Name: "議事録", AuthorUserID: kbEditorUserID,
	})
	require.ErrorIs(t, err, repository.ErrSpaceNotFound)
	templates.AssertNotCalled(t, "Create", mock.Anything, mock.Anything)
}

// Test_雛形一覧_spaceId指定が無ければ権限を確かめずrepoをそのまま呼ぶ は、ワークスペース全体
// （space_id IS NULL）の一覧取得には閲覧権限の確認が要らないことを固定する（そもそも
// ワークスペース所属者なら誰でも読める設計 — handler の requireWorkspaceMember 参照）。
func Test_雛形一覧_spaceId指定が無ければ権限を確かめずrepoをそのまま呼ぶ(t *testing.T) {
	templates := &mockPageTemplateRepo{}
	want := []domain.PageTemplate{{ID: "t1", WorkspaceID: kbWS, Name: "A"}, {ID: "t2", WorkspaceID: kbWS, Name: "B"}}
	templates.On("List", mock.Anything, kbWS, (*string)(nil)).Return(want, nil)
	perms := &mockKBPermissionRepo{}
	uc := kb.NewListPageTemplatesUseCase(templates, kb.NewCheckSpacePermissionUseCase(perms))

	got, err := uc.Execute(context.Background(), kb.ListPageTemplatesInput{WorkspaceID: kbWS, UserID: kbEditorUserID})
	require.NoError(t, err)
	assert.Equal(t, want, got)
	perms.AssertNotCalled(t, "SpacePermissionFactsForUser", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

// Test_雛形一覧_spaceId指定は閲覧権限を確かめてから返す は、spaceId で絞った一覧が
// そのスペースを閲覧できない利用者には返らないことを固定する（spaceId さえ分かれば
// 非公開スペースの雛形名・アイコンが読めていた漏洩の修正）。
//
// 変異確認: !perm.CanView の分岐を外すと、このテストの ErrSpaceNotFound 判定が落ちる。
func Test_雛形一覧_spaceId指定は閲覧権限を確かめてから返す(t *testing.T) {
	privateSpace := "0198a000-0000-7000-8000-0000000000ee"
	templates := &mockPageTemplateRepo{}
	perms := &mockKBPermissionRepo{}
	perms.On("SpacePermissionFactsForUser", mock.Anything, kbWS, privateSpace, kbEditorUserID).
		Return(&domain.ScopeFacts{}, nil)
	uc := kb.NewListPageTemplatesUseCase(templates, kb.NewCheckSpacePermissionUseCase(perms))

	_, err := uc.Execute(context.Background(), kb.ListPageTemplatesInput{
		WorkspaceID: kbWS, SpaceID: &privateSpace, UserID: kbEditorUserID,
	})
	require.ErrorIs(t, err, repository.ErrSpaceNotFound)
	templates.AssertNotCalled(t, "List", mock.Anything, mock.Anything, mock.Anything)
}

func Test_雛形一覧_閲覧できるspaceIdはrepoを呼ぶ(t *testing.T) {
	space := kbSpace
	templates := &mockPageTemplateRepo{}
	want := []domain.PageTemplate{{ID: "t1", WorkspaceID: kbWS, SpaceID: &space, Name: "A"}}
	templates.On("List", mock.Anything, kbWS, &space).Return(want, nil)
	perms := &mockKBPermissionRepo{}
	perms.On("SpacePermissionFactsForUser", mock.Anything, kbWS, kbSpace, kbEditorUserID).
		Return(&domain.ScopeFacts{Roles: []domain.GrantRole{domain.GrantRoleViewer}}, nil)
	uc := kb.NewListPageTemplatesUseCase(templates, kb.NewCheckSpacePermissionUseCase(perms))

	got, err := uc.Execute(context.Background(), kb.ListPageTemplatesInput{
		WorkspaceID: kbWS, SpaceID: &space, UserID: kbEditorUserID,
	})
	require.NoError(t, err)
	assert.Equal(t, want, got)
}

func Test_雛形削除_ワークスペース全体向けの雛形は権限を確かめずrepoをそのまま呼ぶ(t *testing.T) {
	templates := &mockPageTemplateRepo{}
	templates.On("Get", mock.Anything, kbWS, "t1").Return(&domain.PageTemplate{ID: "t1", WorkspaceID: kbWS}, nil)
	templates.On("Delete", mock.Anything, kbWS, "t1").Return(nil)
	perms := &mockKBPermissionRepo{}
	uc := kb.NewDeletePageTemplateUseCase(templates, kb.NewCheckSpacePermissionUseCase(perms))

	err := uc.Execute(context.Background(), kb.DeletePageTemplateInput{
		WorkspaceID: kbWS, TemplateID: "t1", UserID: kbEditorUserID,
	})
	require.NoError(t, err)
	templates.AssertExpectations(t)
	perms.AssertNotCalled(t, "SpacePermissionFactsForUser", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

// Test_雛形削除_スペース限定の雛形は閲覧できなければ404 は、ワークスペース全体への CanEdit
// だけでは、非公開スペースの雛形の存在有無を確かめる・削除することができないことを固定する
// （List・CreateFromPage 側で塞いだ閲覧の穴と対になる書き込み側の穴）。
func Test_雛形削除_スペース限定の雛形は閲覧できなければ404(t *testing.T) {
	privateSpace := "0198a000-0000-7000-8000-0000000000ee"
	templates := &mockPageTemplateRepo{}
	templates.On("Get", mock.Anything, kbWS, "t1").
		Return(&domain.PageTemplate{ID: "t1", WorkspaceID: kbWS, SpaceID: &privateSpace}, nil)
	perms := &mockKBPermissionRepo{}
	perms.On("SpacePermissionFactsForUser", mock.Anything, kbWS, privateSpace, kbEditorUserID).
		Return(&domain.ScopeFacts{}, nil)
	uc := kb.NewDeletePageTemplateUseCase(templates, kb.NewCheckSpacePermissionUseCase(perms))

	err := uc.Execute(context.Background(), kb.DeletePageTemplateInput{
		WorkspaceID: kbWS, TemplateID: "t1", UserID: kbEditorUserID,
	})
	require.ErrorIs(t, err, domain.ErrPageTemplateNotFound)
	templates.AssertNotCalled(t, "Delete", mock.Anything, mock.Anything, mock.Anything)
}

// Test_雛形から作成_CreatePageとReplaceBlocksをこの順で正しい引数で呼ぶ は
// CreatePageFromTemplateUseCase が CreatePageUseCase → ReplacePageBlocksUseCase の順で
// 薄いオーケストレーションを行うこと、雛形の本文のブロックidが剥がされてから
// 本文書き込みに渡ることを固定する。
func Test_雛形から作成_CreatePageとReplaceBlocksをこの順で正しい引数で呼ぶ(t *testing.T) {
	const tplDoc = `{"type":"doc","content":[{"type":"paragraph","attrs":{"id":"11111111-1111-1111-1111-111111111111"},"content":[{"type":"text","text":"雛形本文"}]}]}`
	templates := &mockPageTemplateRepo{}
	templates.On("Get", mock.Anything, kbWS, "tpl-1").Return(&domain.PageTemplate{
		ID: "tpl-1", WorkspaceID: kbWS, Name: "議事録", Doc: tplDoc,
	}, nil)

	var order []string
	kbRepo := &mockKnowledgeBaseRepo{}
	kbRepo.On("FindSpace", mock.Anything, kbWS, kbSpace).Return(&domain.Space{ID: kbSpace, WorkspaceID: kbWS}, nil)
	kbRepo.On("LastActiveSiblingPosition", mock.Anything, kbWS, kbSpace, (*string)(nil)).Return("", nil)
	kbRepo.On("CreatePage", mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) {
			order = append(order, "CreatePage")
			args.Get(1).(*domain.Page).ID = kbPage
		}).Return(nil)
	kbRepo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	kbRepo.On("TouchPageLastEditedBy", mock.Anything, kbWS, kbPage, kbEditorUserID).
		Run(func(mock.Arguments) { order = append(order, "TouchPageLastEditedBy") }).Return(nil)
	var replacedDoc string
	kbRepo.On("ReplacePageBlocks", mock.Anything, kbWS, kbPage, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) {
			order = append(order, "ReplacePageBlocks")
			replacedDoc = args.String(4)
		}).Return(nil)
	kbRepo.On("GetPageSnapshot", mock.Anything, kbWS, kbPage).
		Return(&domain.PageSnapshot{PageID: kbPage, Doc: tplDoc}, nil)

	versionRepo := &mockPageVersionRepo{}
	versionRepo.On("CreateVersionIfDue", mock.Anything, kbWS, kbPage, mock.Anything, kbEditorUserID, (*string)(nil), false).
		Return(false, nil, nil)

	createPageUC := kb.NewCreatePageUseCase(kbRepo)
	replaceUC := kb.NewReplacePageBlocksUseCase(kbRepo, &fakeTxManager{}, versionRepo, &mockKBPermissionRepo{}, &mockNotificationRepo{})
	deleteUC := kb.NewDeletePageUseCase(kbRepo)
	uc := kb.NewCreatePageFromTemplateUseCase(templates, kb.NewCheckSpacePermissionUseCase(&mockKBPermissionRepo{}), createPageUC, replaceUC, deleteUC)

	out, err := uc.Execute(context.Background(), kb.CreatePageFromTemplateInput{
		WorkspaceID: kbWS, SpaceID: kbSpace, TemplateID: "tpl-1", Title: "新しい議事録", AuthorUserID: kbEditorUserID,
	})
	require.NoError(t, err)
	require.NotNil(t, out)
	assert.Equal(t, kbPage, out.Page.ID)
	assert.Equal(t, []string{"CreatePage", "TouchPageLastEditedBy", "ReplacePageBlocks"}, order)
	assert.NotContains(t, replacedDoc, "11111111-1111-1111-1111-111111111111",
		"雛形のブロックidは regenerateBlockIDs で剥がされてから本文書き込みに渡る")
	assert.Contains(t, replacedDoc, "雛形本文")
}

// Test_雛形から作成_スペース限定の雛形は閲覧できなければ404 は、handler が確かめているのは
// 「作成先の場所を編集できるか」だけで雛形自身を見てよいかは問われないため、雛形が非公開
// スペースにひも付いていれば templateId さえ知っていれば本文を抜き出せてしまう穴を、
// usecase 側で閉じていることを固定する。
//
// 変異確認: !perm.CanView の分岐を外すと、このテストの ErrPageTemplateNotFound 判定が落ちる。
func Test_雛形から作成_スペース限定の雛形は閲覧できなければ404(t *testing.T) {
	const tplDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"雛形本文"}]}]}`
	privateSpace := "0198a000-0000-7000-8000-0000000000ee"
	templates := &mockPageTemplateRepo{}
	templates.On("Get", mock.Anything, kbWS, "tpl-1").Return(&domain.PageTemplate{
		ID: "tpl-1", WorkspaceID: kbWS, SpaceID: &privateSpace, Name: "議事録", Doc: tplDoc,
	}, nil)
	perms := &mockKBPermissionRepo{}
	perms.On("SpacePermissionFactsForUser", mock.Anything, kbWS, privateSpace, kbEditorUserID).
		Return(&domain.ScopeFacts{}, nil)

	kbRepo := &mockKnowledgeBaseRepo{}
	createPageUC := kb.NewCreatePageUseCase(kbRepo)
	replaceUC := kb.NewReplacePageBlocksUseCase(kbRepo, &fakeTxManager{}, &mockPageVersionRepo{}, &mockKBPermissionRepo{}, &mockNotificationRepo{})
	deleteUC := kb.NewDeletePageUseCase(kbRepo)
	uc := kb.NewCreatePageFromTemplateUseCase(templates, kb.NewCheckSpacePermissionUseCase(perms), createPageUC, replaceUC, deleteUC)

	_, err := uc.Execute(context.Background(), kb.CreatePageFromTemplateInput{
		WorkspaceID: kbWS, SpaceID: kbSpace, TemplateID: "tpl-1", Title: "新しい議事録", AuthorUserID: kbEditorUserID,
	})
	require.ErrorIs(t, err, domain.ErrPageTemplateNotFound)
	kbRepo.AssertNotCalled(t, "CreatePage", mock.Anything, mock.Anything)
}

// Test_雛形から作成_本文書き込み失敗時に空ページの削除を試みる は、ReplacePageBlocksUseCase が
// 失敗したとき、作成済みの空ページを DeletePageUseCase で後始末しようとすることを固定する。
func Test_雛形から作成_本文書き込み失敗時に空ページの削除を試みる(t *testing.T) {
	const tplDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"雛形本文"}]}]}`
	templates := &mockPageTemplateRepo{}
	templates.On("Get", mock.Anything, kbWS, "tpl-1").Return(&domain.PageTemplate{
		ID: "tpl-1", WorkspaceID: kbWS, Name: "議事録", Doc: tplDoc,
	}, nil)

	kbRepo := &mockKnowledgeBaseRepo{}
	kbRepo.On("FindSpace", mock.Anything, kbWS, kbSpace).Return(&domain.Space{ID: kbSpace, WorkspaceID: kbWS}, nil)
	kbRepo.On("LastActiveSiblingPosition", mock.Anything, kbWS, kbSpace, (*string)(nil)).Return("", nil)
	kbRepo.On("CreatePage", mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) { args.Get(1).(*domain.Page).ID = kbPage }).Return(nil)
	// ReplacePageBlocksUseCase.Execute は最初に FindPage を呼ぶ。ここをアーカイブ済みにして
	// ErrPageArchived で失敗させ、本文書き込みそのものが失敗するケースを再現する。
	kbRepo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbArchivedPage(kbPage, kbSpace, nil), nil)
	kbRepo.On("DeletePageSubtree", mock.Anything, kbWS, kbPage).Return(nil)

	createPageUC := kb.NewCreatePageUseCase(kbRepo)
	replaceUC := kb.NewReplacePageBlocksUseCase(kbRepo, &fakeTxManager{}, &mockPageVersionRepo{}, &mockKBPermissionRepo{}, &mockNotificationRepo{})
	deleteUC := kb.NewDeletePageUseCase(kbRepo)
	uc := kb.NewCreatePageFromTemplateUseCase(templates, kb.NewCheckSpacePermissionUseCase(&mockKBPermissionRepo{}), createPageUC, replaceUC, deleteUC)

	_, err := uc.Execute(context.Background(), kb.CreatePageFromTemplateInput{
		WorkspaceID: kbWS, SpaceID: kbSpace, TemplateID: "tpl-1", Title: "新しい議事録", AuthorUserID: kbEditorUserID,
	})
	require.ErrorIs(t, err, kb.ErrPageArchived, "後始末に成功した場合は元のエラーをそのまま返す")
	kbRepo.AssertCalled(t, "DeletePageSubtree", mock.Anything, kbWS, kbPage)
}

// Test_雛形から作成_後始末の削除にも失敗したらエラーに残す は、空ページの削除自体が失敗した
// ケースで、返るエラーのメッセージから中途半端な空ページが残っていることが分かることを固定する。
func Test_雛形から作成_後始末の削除にも失敗したらエラーに残す(t *testing.T) {
	const tplDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"雛形本文"}]}]}`
	templates := &mockPageTemplateRepo{}
	templates.On("Get", mock.Anything, kbWS, "tpl-1").Return(&domain.PageTemplate{
		ID: "tpl-1", WorkspaceID: kbWS, Name: "議事録", Doc: tplDoc,
	}, nil)

	kbRepo := &mockKnowledgeBaseRepo{}
	kbRepo.On("FindSpace", mock.Anything, kbWS, kbSpace).Return(&domain.Space{ID: kbSpace, WorkspaceID: kbWS}, nil)
	kbRepo.On("LastActiveSiblingPosition", mock.Anything, kbWS, kbSpace, (*string)(nil)).Return("", nil)
	kbRepo.On("CreatePage", mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) { args.Get(1).(*domain.Page).ID = kbPage }).Return(nil)
	kbRepo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbArchivedPage(kbPage, kbSpace, nil), nil)
	kbRepo.On("DeletePageSubtree", mock.Anything, kbWS, kbPage).Return(repository.ErrPageNotFound)

	createPageUC := kb.NewCreatePageUseCase(kbRepo)
	replaceUC := kb.NewReplacePageBlocksUseCase(kbRepo, &fakeTxManager{}, &mockPageVersionRepo{}, &mockKBPermissionRepo{}, &mockNotificationRepo{})
	deleteUC := kb.NewDeletePageUseCase(kbRepo)
	uc := kb.NewCreatePageFromTemplateUseCase(templates, kb.NewCheckSpacePermissionUseCase(&mockKBPermissionRepo{}), createPageUC, replaceUC, deleteUC)

	_, err := uc.Execute(context.Background(), kb.CreatePageFromTemplateInput{
		WorkspaceID: kbWS, SpaceID: kbSpace, TemplateID: "tpl-1", Title: "新しい議事録", AuthorUserID: kbEditorUserID,
	})
	require.Error(t, err)
	assert.True(t, strings.Contains(err.Error(), kbPage), "残った空ページのidがエラーメッセージから分かる")
	require.ErrorIs(t, err, kb.ErrPageArchived, "後始末に失敗しても元のエラーはerrors.Isで判定できる")
}
