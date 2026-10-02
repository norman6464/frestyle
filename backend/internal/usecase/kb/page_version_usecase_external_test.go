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

// FRESTYLE-433 段 3（版と履歴）の kb.CreateExplicitPageVersionUseCase /
// kb.ListPageVersionsUseCase / kb.GetPageVersionUseCase / kb.RestorePageVersionUseCase の
// 単体テスト。page_usecase_external_test.go と同じ流儀（testify/mock、kbWS/kbPage/kbSpace/
// kbEditorUserID/kbActivePage/fakeTxManager/inTx を共有）。

// Test_版を残す_snapshotがあればそれをdocとして使う は、kbRepo.GetPageSnapshot が返す doc が
// そのまま versionRepo.CreateVersionIfDue（force=true）に渡ることを固定する。
func Test_版を残す_snapshotがあればそれをdocとして使う(t *testing.T) {
	const snapshotDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"現在の本文"}]}]}`
	kbRepo := &mockKnowledgeBaseRepo{}
	kbRepo.On("GetPageSnapshot", mock.MatchedBy(inTx), kbWS, kbPage).
		Return(&domain.PageSnapshot{PageID: kbPage, Doc: snapshotDoc}, nil)
	versionRepo := &mockPageVersionRepo{}
	versionRepo.On("LockPage", mock.MatchedBy(inTx), kbWS, kbPage).Return(nil)
	created := &domain.PageVersion{PageID: kbPage, Seq: 1, Doc: snapshotDoc, AuthorUserID: kbEditorUserID}
	versionRepo.On("CreateVersionIfDue", mock.MatchedBy(inTx), kbWS, kbPage, snapshotDoc, kbEditorUserID, (*string)(nil), true).
		Return(true, created, nil)
	tx := &fakeTxManager{}
	uc := kb.NewCreateExplicitPageVersionUseCase(versionRepo, kbRepo, tx)

	got, err := uc.Execute(context.Background(), kb.CreateExplicitPageVersionInput{
		WorkspaceID: kbWS, PageID: kbPage, AuthorUserID: kbEditorUserID,
	})
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, int64(1), got.Seq)
	assert.Equal(t, 1, tx.calls, "1つのトランザクションの中でロック・読み取り・挿入をすべて行う")
	kbRepo.AssertNotCalled(t, "ListBlocksByPage", mock.Anything, mock.Anything, mock.Anything)
}

// Test_版を残す_ロックしてから今の内容を読む は CodeRabbit が指摘した実バグの回帰確認。
//
// 元の実装は versionRepo.LockPage を呼ばずに currentPageDoc（kbRepo.GetPageSnapshot）を
// 先に読んでいたため、その読み取りと CreateVersionIfDue 内部のロック取得の間に本物の編集
// （ReplacePageBlocksUseCase）が割り込むと、古い内容のまま版を切ってしまう競合があった。
//
// 変異確認: page_version_usecase.go の Execute から versionRepo.LockPage の呼び出しを消すと、
// このテストは「LockPage → GetPageSnapshot → CreateVersionIfDue」の順序を期待する assert.Equal
// で落ちる（呼び出し順ログに LockPage が現れなくなるため）。
func Test_版を残す_ロックしてから今の内容を読む(t *testing.T) {
	const snapshotDoc = `{"type":"doc","content":[]}`
	var order []string

	kbRepo := &mockKnowledgeBaseRepo{}
	kbRepo.On("GetPageSnapshot", mock.MatchedBy(inTx), kbWS, kbPage).
		Run(func(mock.Arguments) { order = append(order, "GetPageSnapshot") }).
		Return(&domain.PageSnapshot{PageID: kbPage, Doc: snapshotDoc}, nil)

	versionRepo := &mockPageVersionRepo{}
	versionRepo.On("LockPage", mock.MatchedBy(inTx), kbWS, kbPage).
		Run(func(mock.Arguments) { order = append(order, "LockPage") }).
		Return(nil)
	versionRepo.On("CreateVersionIfDue", mock.MatchedBy(inTx), kbWS, kbPage, snapshotDoc, kbEditorUserID, (*string)(nil), true).
		Run(func(mock.Arguments) { order = append(order, "CreateVersionIfDue") }).
		Return(true, &domain.PageVersion{PageID: kbPage, Seq: 1}, nil)

	uc := kb.NewCreateExplicitPageVersionUseCase(versionRepo, kbRepo, &fakeTxManager{})
	_, err := uc.Execute(context.Background(), kb.CreateExplicitPageVersionInput{
		WorkspaceID: kbWS, PageID: kbPage, AuthorUserID: kbEditorUserID,
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"LockPage", "GetPageSnapshot", "CreateVersionIfDue"}, order)
}

// Test_版を残す_snapshotが無ければブロックから組み立てる は GetPageUseCase.Execute と同じ
// フォールバック手順（snapshot 無し → ListBlocksByPage → treeFromBlocks/renderPageDoc）を
// CreateExplicitPageVersionUseCase も踏むことを固定する。
func Test_版を残す_snapshotが無ければブロックから組み立てる(t *testing.T) {
	inline := `[{"type":"text","text":"本文"}]`
	kbRepo := &mockKnowledgeBaseRepo{}
	kbRepo.On("GetPageSnapshot", mock.MatchedBy(inTx), kbWS, kbPage).Return(nil, repository.ErrPageSnapshotNotFound)
	kbRepo.On("ListBlocksByPage", mock.MatchedBy(inTx), kbWS, kbPage).Return([]domain.Block{
		{ID: "b1", PageID: kbPage, Type: domain.BlockTypeParagraph, Position: "a0", Attrs: "{}", Inline: &inline},
	}, nil)
	versionRepo := &mockPageVersionRepo{}
	versionRepo.On("LockPage", mock.MatchedBy(inTx), kbWS, kbPage).Return(nil)
	var gotDoc string
	versionRepo.On("CreateVersionIfDue", mock.MatchedBy(inTx), kbWS, kbPage, mock.Anything, kbEditorUserID, (*string)(nil), true).
		Run(func(args mock.Arguments) { gotDoc = args.String(3) }).
		Return(true, &domain.PageVersion{PageID: kbPage, Seq: 1}, nil)
	uc := kb.NewCreateExplicitPageVersionUseCase(versionRepo, kbRepo, &fakeTxManager{})

	_, err := uc.Execute(context.Background(), kb.CreateExplicitPageVersionInput{
		WorkspaceID: kbWS, PageID: kbPage, AuthorUserID: kbEditorUserID,
	})
	require.NoError(t, err)
	requireJSONEqIgnoringBlockIDs(t,
		`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"本文"}]}]}`, gotDoc)
}

// Test_版を残す_不正なnoteは拒否しrepoを呼ばない は、domain.ValidateVersionNote の検証を
// kbRepo / versionRepo のどちらも呼ぶ前に行うことを固定する（不正な入力のためだけに
// doc を読みに行く無駄を避ける）。
func Test_版を残す_不正なnoteは拒否しrepoを呼ばない(t *testing.T) {
	kbRepo := &mockKnowledgeBaseRepo{}
	versionRepo := &mockPageVersionRepo{}
	tx := &fakeTxManager{}
	uc := kb.NewCreateExplicitPageVersionUseCase(versionRepo, kbRepo, tx)
	badNote := strings.Repeat("a", domain.PageVersionNoteMaxBytes+1)

	_, err := uc.Execute(context.Background(), kb.CreateExplicitPageVersionInput{
		WorkspaceID: kbWS, PageID: kbPage, AuthorUserID: kbEditorUserID, Note: &badNote,
	})
	require.ErrorIs(t, err, domain.ErrInvalidPageVersionNote)
	assert.Equal(t, 0, tx.calls, "不正なメモのためだけにトランザクションを開かない")
	kbRepo.AssertNotCalled(t, "GetPageSnapshot", mock.Anything, mock.Anything, mock.Anything)
	versionRepo.AssertNotCalled(t, "LockPage", mock.Anything, mock.Anything, mock.Anything)
	versionRepo.AssertNotCalled(t, "CreateVersionIfDue",
		mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_版一覧_versionRepoをそのまま呼ぶ(t *testing.T) {
	versionRepo := &mockPageVersionRepo{}
	want := []domain.PageVersion{{PageID: kbPage, Seq: 2}, {PageID: kbPage, Seq: 1}}
	versionRepo.On("ListVersions", mock.Anything, kbWS, kbPage).Return(want, nil)
	uc := kb.NewListPageVersionsUseCase(versionRepo)

	got, err := uc.Execute(context.Background(), kb.ListPageVersionsInput{WorkspaceID: kbWS, PageID: kbPage})
	require.NoError(t, err)
	assert.Equal(t, want, got)
}

func Test_版取得_versionRepoをそのまま呼ぶ(t *testing.T) {
	versionRepo := &mockPageVersionRepo{}
	want := &domain.PageVersion{PageID: kbPage, Seq: 3, Doc: `{"type":"doc","content":[]}`}
	versionRepo.On("GetVersion", mock.Anything, kbWS, kbPage, int64(3)).Return(want, nil)
	uc := kb.NewGetPageVersionUseCase(versionRepo)

	got, err := uc.Execute(context.Background(), kb.GetPageVersionInput{WorkspaceID: kbWS, PageID: kbPage, Seq: 3})
	require.NoError(t, err)
	assert.Same(t, want, got)
}

func Test_版取得_無い版はErrPageVersionNotFound(t *testing.T) {
	versionRepo := &mockPageVersionRepo{}
	versionRepo.On("GetVersion", mock.Anything, kbWS, kbPage, int64(99)).
		Return(nil, domain.ErrPageVersionNotFound)
	uc := kb.NewGetPageVersionUseCase(versionRepo)

	_, err := uc.Execute(context.Background(), kb.GetPageVersionInput{WorkspaceID: kbWS, PageID: kbPage, Seq: 99})
	require.ErrorIs(t, err, domain.ErrPageVersionNotFound)
	// GetVersion が実際に期待した引数(WorkspaceID, PageID, Seq: 99)で呼ばれたことまで確認する
	// （呼ばれずにerrだけ手元で作ってしまう実装のすり替えを防ぐ） — CodeRabbit 指摘。
	versionRepo.AssertExpectations(t)
}

// Test_復元_ForceVersionは必ずtrue は RestorePageVersionUseCase が
// versionRepo.GetVersion で取得した版の Doc をそのまま ReplacePageBlocksUseCase.Execute の
// Input.Doc に渡し、ForceVersion を必ず true にして呼ぶことを固定する（「復元自体も版になる」
// という要件）。ReplacePageBlocksUseCase は interface ではなく具象型なので、その内側の
// KnowledgeBaseRepository / PageVersionRepository を mock して間接的に確かめる。
func Test_復元_ForceVersionは必ずtrue(t *testing.T) {
	const oldDoc = `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"旧版の本文"}]}]}`
	kbRepo := &mockKnowledgeBaseRepo{}
	kbRepo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	kbRepo.On("TouchPageLastEditedBy", mock.Anything, kbWS, kbPage, kbEditorUserID).Return(nil)
	kbRepo.On("ReplacePageBlocks", mock.Anything, kbWS, kbPage, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil)
	kbRepo.On("GetPageSnapshot", mock.Anything, kbWS, kbPage).
		Return(&domain.PageSnapshot{PageID: kbPage, Doc: oldDoc}, nil)

	versionRepo := &mockPageVersionRepo{}
	versionRepo.On("GetVersion", mock.Anything, kbWS, kbPage, int64(3)).
		Return(&domain.PageVersion{PageID: kbPage, Seq: 3, Doc: oldDoc, AuthorUserID: 1}, nil)
	var gotDoc string
	var gotForce bool
	var gotNote *string
	versionRepo.On("CreateVersionIfDue", mock.Anything, kbWS, kbPage, mock.Anything, kbEditorUserID, mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) {
			gotDoc = args.String(3)
			if args.Get(5) != nil {
				gotNote = args.Get(5).(*string)
			}
			gotForce = args.Bool(6)
		}).
		Return(true, &domain.PageVersion{PageID: kbPage, Seq: 4, AuthorUserID: kbEditorUserID}, nil)

	replaceUC := kb.NewReplacePageBlocksUseCase(kbRepo, &fakeTxManager{}, versionRepo, &mockKBPermissionRepo{}, &mockNotificationRepo{})
	uc := kb.NewRestorePageVersionUseCase(versionRepo, replaceUC)

	_, err := uc.Execute(context.Background(), kb.RestorePageVersionInput{
		WorkspaceID: kbWS, PageID: kbPage, Seq: 3, EditorUserID: kbEditorUserID,
	})
	require.NoError(t, err)
	assert.True(t, gotForce, "復元はForceVersionが必ずtrue（10分規則を無視して必ず版を切る）")
	require.NotNil(t, gotNote, "復元は人間可読な自動メモを添える")
	assert.Contains(t, *gotNote, "3", "自動メモに復元元の版番号を含む")
	assert.Contains(t, gotDoc, "旧版の本文", "復元対象の版のDocがそのまま本文として書き戻される")
}

// Test_復元_対象の版が無ければ本文は書き換えない は、versionRepo.GetVersion が失敗したら
// ReplacePageBlocksUseCase.Execute（＝ kbRepo）に一切触れないことを固定する。
func Test_復元_対象の版が無ければ本文は書き換えない(t *testing.T) {
	kbRepo := &mockKnowledgeBaseRepo{}
	versionRepo := &mockPageVersionRepo{}
	versionRepo.On("GetVersion", mock.Anything, kbWS, kbPage, int64(99)).
		Return(nil, domain.ErrPageVersionNotFound)
	replaceUC := kb.NewReplacePageBlocksUseCase(kbRepo, &fakeTxManager{}, versionRepo, &mockKBPermissionRepo{}, &mockNotificationRepo{})
	uc := kb.NewRestorePageVersionUseCase(versionRepo, replaceUC)

	_, err := uc.Execute(context.Background(), kb.RestorePageVersionInput{
		WorkspaceID: kbWS, PageID: kbPage, Seq: 99, EditorUserID: kbEditorUserID,
	})
	require.ErrorIs(t, err, domain.ErrPageVersionNotFound)
	kbRepo.AssertNotCalled(t, "FindPage", mock.Anything, mock.Anything, mock.Anything)
}
