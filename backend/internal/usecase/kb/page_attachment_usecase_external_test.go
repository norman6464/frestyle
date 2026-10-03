package kb_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// ページ添付の usecase（アップロード URL の発行・記録・ダウンロード URL の発行）と、本文の保存・
// 提案の作成に添付の突き合わせが配線されていることの単体テスト。突き合わせそのものの規則は
// page_attachment_bind_internal_test.go が見る。

const (
	kbAttachmentID    = "0198a000-0000-7000-8000-0000000000c1"
	kbAttachmentOther = "0198a000-0000-7000-8000-000000000009"
)

func kbAttachmentKeyPrefix() string {
	return "kb/" + kbWS + "/" + kbPage + "/att/"
}

func Test_添付アップロードURL発行_このページのatt配下のkeyを採番して署名する(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	presigner := &mockPageAttachmentPresigner{}
	var gotKey string
	presigner.On("PresignUpload", mock.Anything, mock.Anything, "application/pdf", int64(2048)).
		Run(func(args mock.Arguments) { gotKey = args.String(1) }).
		Return("https://example/upload", 600, nil)
	uc := kb.NewIssuePageAttachmentUploadURLUseCase(repo, presigner)

	out, err := uc.Execute(context.Background(), kb.IssuePageAttachmentUploadURLInput{
		WorkspaceID: kbWS, PageID: kbPage, ContentType: "application/pdf", Size: 2048,
	})

	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(out.Key, kbAttachmentKeyPrefix()), "key=%s", out.Key)
	assert.True(t, strings.HasSuffix(out.Key, ".bin"))
	assert.Equal(t, out.Key, gotKey, "署名した key をそのまま返す")
	assert.Equal(t, "https://example/upload", out.URL)
	assert.Equal(t, 600, out.ExpiresIn)
}

func Test_添付アップロードURL発行_許可していない種類や大きさはページを読む前に断る(t *testing.T) {
	cases := []struct {
		name        string
		contentType string
		size        int64
		want        error
	}{
		{"html", "text/html", 10, domain.ErrUnsupportedAttachmentContentType},
		{"svg", "image/svg+xml", 10, domain.ErrUnsupportedAttachmentContentType},
		{"25MiB を超える", "application/pdf", domain.MaxAttachmentUploadBytes + 1, domain.ErrAttachmentTooLarge},
		{"大きさ 0", "application/pdf", 0, domain.ErrAttachmentTooLarge},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &mockKnowledgeBaseRepo{}
			presigner := &mockPageAttachmentPresigner{}
			uc := kb.NewIssuePageAttachmentUploadURLUseCase(repo, presigner)
			_, err := uc.Execute(context.Background(), kb.IssuePageAttachmentUploadURLInput{
				WorkspaceID: kbWS, PageID: kbPage, ContentType: tc.contentType, Size: tc.size,
			})
			require.ErrorIs(t, err, tc.want)
			repo.AssertNotCalled(t, "FindPage", mock.Anything, mock.Anything, mock.Anything)
			presigner.AssertNotCalled(t, "PresignUpload", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
		})
	}
}

func Test_添付アップロードURL発行_アーカイブ済みのページは断る(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbArchivedPage(kbPage, kbSpace, nil), nil)
	presigner := &mockPageAttachmentPresigner{}
	uc := kb.NewIssuePageAttachmentUploadURLUseCase(repo, presigner)
	_, err := uc.Execute(context.Background(), kb.IssuePageAttachmentUploadURLInput{
		WorkspaceID: kbWS, PageID: kbPage, ContentType: "application/pdf", Size: 10,
	})
	require.ErrorIs(t, err, kb.ErrPageArchived)
	presigner.AssertNotCalled(t, "PresignUpload", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_添付の記録_このページの添付として記録する(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	attachments := &mockPageAttachmentRepo{}
	var got *domain.PageAttachment
	attachments.On("CreatePageAttachment", mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) {
			got = args.Get(1).(*domain.PageAttachment)
			got.ID = kbAttachmentID
		}).Return(nil)
	uc := kb.NewCreatePageAttachmentUseCase(repo, attachments)

	out, err := uc.Execute(context.Background(), kb.CreatePageAttachmentInput{
		WorkspaceID: kbWS, PageID: kbPage, Key: kbAttachmentKeyPrefix() + "1.bin", Filename: "議事録.pdf",
		ContentType: "application/pdf", SizeBytes: 2048, UploadedByUserID: kbEditorUserID,
	})

	require.NoError(t, err)
	assert.Equal(t, kbAttachmentID, out.ID)
	assert.Equal(t, domain.PageAttachment{
		ID: kbAttachmentID, WorkspaceID: kbWS, PageID: kbPage, Key: kbAttachmentKeyPrefix() + "1.bin",
		Filename: "議事録.pdf", ContentType: "application/pdf", SizeBytes: 2048, UploadedByUserID: kbEditorUserID,
	}, *got)
}

func Test_添付の記録_入力が正しくなければページを読む前に断る(t *testing.T) {
	valid := kb.CreatePageAttachmentInput{
		WorkspaceID: kbWS, PageID: kbPage, Key: kbAttachmentKeyPrefix() + "1.bin", Filename: "a.pdf",
		ContentType: "application/pdf", SizeBytes: 10, UploadedByUserID: kbEditorUserID,
	}
	cases := []struct {
		name   string
		mutate func(in *kb.CreatePageAttachmentInput)
		want   error
	}{
		{"別のページの key", func(in *kb.CreatePageAttachmentInput) {
			in.Key = "kb/" + kbWS + "/" + kbAttachmentOther + "/att/1.bin"
		}, kb.ErrInvalidPageAttachmentKey},
		{"別のワークスペースの key", func(in *kb.CreatePageAttachmentInput) {
			in.Key = "kb/" + kbAttachmentOther + "/" + kbPage + "/att/1.bin"
		}, kb.ErrInvalidPageAttachmentKey},
		{"同じページの画像の key（att/ を持たない）", func(in *kb.CreatePageAttachmentInput) {
			in.Key = "kb/" + kbWS + "/" + kbPage + "/1.bin"
		}, kb.ErrInvalidPageAttachmentKey},
		{"チケット添付の key", func(in *kb.CreatePageAttachmentInput) {
			in.Key = "tickets/" + kbWS + "/" + kbPage + "/1.bin"
		}, kb.ErrInvalidPageAttachmentKey},
		{"html", func(in *kb.CreatePageAttachmentInput) { in.ContentType = "text/html" }, domain.ErrUnsupportedAttachmentContentType},
		{"大きすぎる", func(in *kb.CreatePageAttachmentInput) { in.SizeBytes = domain.MaxAttachmentUploadBytes + 1 }, domain.ErrAttachmentTooLarge},
		{"ファイル名が空白で囲まれている", func(in *kb.CreatePageAttachmentInput) { in.Filename = " a.pdf" }, domain.ErrInvalidAttachmentFilename},
		{"ファイル名が長すぎる", func(in *kb.CreatePageAttachmentInput) {
			in.Filename = strings.Repeat("a", domain.MaxAttachmentFilenameBytes+1)
		}, domain.ErrInvalidAttachmentFilename},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &mockKnowledgeBaseRepo{}
			attachments := &mockPageAttachmentRepo{}
			in := valid
			tc.mutate(&in)
			_, err := kb.NewCreatePageAttachmentUseCase(repo, attachments).Execute(context.Background(), in)
			require.ErrorIs(t, err, tc.want)
			repo.AssertNotCalled(t, "FindPage", mock.Anything, mock.Anything, mock.Anything)
			attachments.AssertNotCalled(t, "CreatePageAttachment", mock.Anything, mock.Anything)
		})
	}
}

func Test_添付の記録_アーカイブ済みのページには記録しない(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbArchivedPage(kbPage, kbSpace, nil), nil)
	attachments := &mockPageAttachmentRepo{}
	_, err := kb.NewCreatePageAttachmentUseCase(repo, attachments).Execute(context.Background(), kb.CreatePageAttachmentInput{
		WorkspaceID: kbWS, PageID: kbPage, Key: kbAttachmentKeyPrefix() + "1.bin", Filename: "a.pdf",
		ContentType: "application/pdf", SizeBytes: 10, UploadedByUserID: kbEditorUserID,
	})
	require.ErrorIs(t, err, kb.ErrPageArchived)
	attachments.AssertNotCalled(t, "CreatePageAttachment", mock.Anything, mock.Anything)
}

func Test_添付ダウンロードURL発行_行のkeyとファイル名で署名する(t *testing.T) {
	attachments := &mockPageAttachmentRepo{}
	attachments.On("FindPageAttachment", mock.Anything, kbWS, kbPage, kbAttachmentID).Return(&domain.PageAttachment{
		ID: kbAttachmentID, WorkspaceID: kbWS, PageID: kbPage, Key: kbAttachmentKeyPrefix() + "1.bin", Filename: "議事録.pdf",
	}, nil)
	presigner := &mockPageAttachmentPresigner{}
	presigner.On("PresignDownload", mock.Anything, kbAttachmentKeyPrefix()+"1.bin", "議事録.pdf").
		Return("https://example/download", 600, nil)

	out, err := kb.NewIssuePageAttachmentDownloadURLUseCase(attachments, presigner).Execute(context.Background(),
		kb.IssuePageAttachmentDownloadURLInput{WorkspaceID: kbWS, PageID: kbPage, AttachmentID: kbAttachmentID})

	require.NoError(t, err)
	assert.Equal(t, "https://example/download", out.URL)
	assert.Equal(t, 600, out.ExpiresIn)
	presigner.AssertExpectations(t)
}

func Test_添付ダウンロードURL発行_このページの添付でなければ署名しない(t *testing.T) {
	attachments := &mockPageAttachmentRepo{}
	attachments.On("FindPageAttachment", mock.Anything, kbWS, kbPage, kbAttachmentID).
		Return(nil, repository.ErrPageAttachmentNotFound)
	presigner := &mockPageAttachmentPresigner{}

	_, err := kb.NewIssuePageAttachmentDownloadURLUseCase(attachments, presigner).Execute(context.Background(),
		kb.IssuePageAttachmentDownloadURLInput{WorkspaceID: kbWS, PageID: kbPage, AttachmentID: kbAttachmentID})

	require.ErrorIs(t, err, repository.ErrPageAttachmentNotFound)
	presigner.AssertNotCalled(t, "PresignDownload", mock.Anything, mock.Anything, mock.Anything)
}

func kbAttachmentDoc(filename string) string {
	return `{"type":"doc","content":[{"type":"attachment","attrs":{"attachmentId":"` + kbAttachmentID + `","filename":"` + filename + `"}}]}`
}

func Test_本文書き換え_添付は行の値で保存し本文検索にファイル名を載せる(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	repo.On("TouchPageLastEditedBy", mock.Anything, kbWS, kbPage, kbEditorUserID).Return(nil)
	var gotSnapshot, gotBody string
	repo.On("ReplacePageBlocks", mock.Anything, kbWS, kbPage, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).
		Run(func(args mock.Arguments) {
			gotSnapshot = args.String(4)
			gotBody = args.String(6)
		}).Return(nil)
	repo.On("GetPageSnapshot", mock.Anything, kbWS, kbPage).Return(&domain.PageSnapshot{PageID: kbPage}, nil)
	versionRepo := &mockPageVersionRepo{}
	versionRepo.On("CreateVersionIfDue", mock.Anything, kbWS, kbPage, mock.Anything, kbEditorUserID, (*string)(nil), false).
		Return(false, nil, nil)
	attachments := &mockPageAttachmentRepo{}
	attachments.On("ListPageAttachmentsByIDs", mock.Anything, kbWS, kbPage, []string{kbAttachmentID}).
		Return([]domain.PageAttachment{{
			ID: kbAttachmentID, WorkspaceID: kbWS, PageID: kbPage, Filename: "議事録.pdf", ContentType: "application/pdf", SizeBytes: 2048,
		}}, nil)
	uc := kb.NewReplacePageBlocksUseCase(repo, &fakeTxManager{}, versionRepo, &mockKBPermissionRepo{}, &mockNotificationRepo{}, attachments)

	_, err := uc.Execute(context.Background(), kb.ReplacePageBlocksInput{
		WorkspaceID: kbWS, PageID: kbPage, Doc: kbAttachmentDoc("偽.exe"), EditorUserID: kbEditorUserID,
	})

	require.NoError(t, err)
	assert.Contains(t, gotSnapshot, `"filename":"議事録.pdf"`, "書いた人の filename ではなく行の値で保存する")
	assert.NotContains(t, gotSnapshot, "偽.exe")
	assert.Equal(t, "議事録.pdf", gotBody)
}

func Test_本文書き換え_このページの添付でなければ何も書かずに断る(t *testing.T) {
	repo := &mockKnowledgeBaseRepo{}
	repo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	attachments := &mockPageAttachmentRepo{}
	attachments.On("ListPageAttachmentsByIDs", mock.Anything, kbWS, kbPage, []string{kbAttachmentID}).
		Return([]domain.PageAttachment{}, nil)
	uc := kb.NewReplacePageBlocksUseCase(repo, &fakeTxManager{}, &mockPageVersionRepo{}, &mockKBPermissionRepo{}, &mockNotificationRepo{}, attachments)

	_, err := uc.Execute(context.Background(), kb.ReplacePageBlocksInput{
		WorkspaceID: kbWS, PageID: kbPage, Doc: kbAttachmentDoc("a.pdf"), EditorUserID: kbEditorUserID,
	})

	require.ErrorIs(t, err, kb.ErrPageDocUnknownAttachment)
	repo.AssertNotCalled(t, "TouchPageLastEditedBy", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	repo.AssertNotCalled(t, "ReplacePageBlocks", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything,
		mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_提案作成_このページの添付でなければ断る(t *testing.T) {
	kbRepo := &mockKnowledgeBaseRepo{}
	kbRepo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	suggestions := &mockPageSuggestionRepo{}
	suggestions.On("CountOpenByAuthor", mock.Anything, kbWS, kbPage, kbEditorUserID).Return(0, nil)
	suggestions.On("CountOpen", mock.Anything, kbWS, kbPage).Return(0, nil)
	attachments := &mockPageAttachmentRepo{}
	attachments.On("ListPageAttachmentsByIDs", mock.Anything, kbWS, kbPage, []string{kbAttachmentID}).
		Return([]domain.PageAttachment{}, nil)
	uc := kb.NewCreateSuggestionUseCase(kbRepo, &mockPageVersionRepo{}, suggestions, &fakeTxManager{}, attachments)

	_, err := uc.Execute(context.Background(), kb.CreateSuggestionInput{
		WorkspaceID: kbWS, PageID: kbPage, Doc: kbAttachmentDoc("a.pdf"), AuthorUserID: kbEditorUserID,
	})

	require.ErrorIs(t, err, kb.ErrPageDocUnknownAttachment)
	suggestions.AssertNotCalled(t, "Create", mock.Anything, mock.Anything)
}

func Test_提案作成_添付の取得に失敗したら提案を作らない(t *testing.T) {
	kbRepo := &mockKnowledgeBaseRepo{}
	kbRepo.On("FindPage", mock.Anything, kbWS, kbPage).Return(kbActivePage(kbPage, kbSpace, nil), nil)
	suggestions := &mockPageSuggestionRepo{}
	suggestions.On("CountOpenByAuthor", mock.Anything, kbWS, kbPage, kbEditorUserID).Return(0, nil)
	suggestions.On("CountOpen", mock.Anything, kbWS, kbPage).Return(0, nil)
	boom := errors.New("db down")
	attachments := &mockPageAttachmentRepo{}
	attachments.On("ListPageAttachmentsByIDs", mock.Anything, kbWS, kbPage, []string{kbAttachmentID}).Return(nil, boom)
	uc := kb.NewCreateSuggestionUseCase(kbRepo, &mockPageVersionRepo{}, suggestions, &fakeTxManager{}, attachments)

	_, err := uc.Execute(context.Background(), kb.CreateSuggestionInput{
		WorkspaceID: kbWS, PageID: kbPage, Doc: kbAttachmentDoc("a.pdf"), AuthorUserID: kbEditorUserID,
	})

	require.ErrorIs(t, err, boom)
	suggestions.AssertNotCalled(t, "Create", mock.Anything, mock.Anything)
}
