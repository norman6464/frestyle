package ticket_test

import (
	"context"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func Test_添付アップロードURL発行_不正な値は拒否(t *testing.T) {
	uc := ticket.NewIssueTicketAttachmentUploadURLUseCase(&mockTicketRepo{}, &mockTicketAttachmentPresigner{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, ticket.IssueTicketAttachmentUploadURLInput{
		WorkspaceID: tkWS, TicketID: tkTicket, ContentType: "application/x-msdownload", Size: 100,
	})
	require.ErrorIs(t, err, domain.ErrUnsupportedAttachmentContentType, "許可リストに無い形式は拒否")

	_, err = uc.Execute(ctx, ticket.IssueTicketAttachmentUploadURLInput{
		WorkspaceID: tkWS, TicketID: tkTicket, ContentType: "application/pdf", Size: domain.MaxAttachmentUploadBytes + 1,
	})
	require.ErrorIs(t, err, domain.ErrAttachmentTooLarge, "上限を超えるサイズは拒否")
}

func Test_添付アップロードURL発行_チケットが無ければ拒否(t *testing.T) {
	tickets := &mockTicketRepo{}
	tickets.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(nil, repository.ErrTicketNotFound)

	_, err := ticket.NewIssueTicketAttachmentUploadURLUseCase(tickets, &mockTicketAttachmentPresigner{}).
		Execute(context.Background(), ticket.IssueTicketAttachmentUploadURLInput{
			WorkspaceID: tkWS, TicketID: tkTicket, ContentType: "application/pdf", Size: 1024,
		})
	require.ErrorIs(t, err, repository.ErrTicketNotFound)
}

func Test_添付アップロードURL発行_keyはチケットに閉じた接頭辞を持つ(t *testing.T) {
	tickets := &mockTicketRepo{}
	tickets.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(&domain.Ticket{ID: tkTicket, WorkspaceID: tkWS}, nil)
	presigner := &mockTicketAttachmentPresigner{}
	var capturedKey string
	presigner.On("PresignUpload", mock.Anything, mock.AnythingOfType("string"), "application/pdf", int64(1024)).
		Run(func(args mock.Arguments) { capturedKey = args.String(1) }).
		Return("https://example/put", 600, nil)

	out, err := ticket.NewIssueTicketAttachmentUploadURLUseCase(tickets, presigner).
		Execute(context.Background(), ticket.IssueTicketAttachmentUploadURLInput{
			WorkspaceID: tkWS, TicketID: tkTicket, ContentType: "application/pdf", Size: 1024,
		})
	require.NoError(t, err)
	require.Equal(t, capturedKey, out.Key)
	require.Contains(t, out.Key, "tickets/"+tkWS+"/"+tkTicket+"/")
	require.Equal(t, 600, out.ExpiresIn)
}

func Test_添付記録_チケット由来ではないkeyは拒否(t *testing.T) {
	uc := ticket.NewCreateTicketAttachmentUseCase(&mockTicketRepo{}, &mockTicketAttachmentRepo{})

	_, err := uc.Execute(context.Background(), ticket.CreateTicketAttachmentInput{
		WorkspaceID: tkWS, TicketID: tkTicket,
		Key:      "tickets/other-workspace/other-ticket/123.bin",
		Filename: "資料.pdf", ContentType: "application/pdf", SizeBytes: 1024, UploadedByUserID: 1,
	})
	require.ErrorIs(t, err, ticket.ErrInvalidAttachmentKey, "他チケットの key を自チケットの添付として登録できない")
}

func Test_添付記録_不正なファイル名は拒否(t *testing.T) {
	uc := ticket.NewCreateTicketAttachmentUseCase(&mockTicketRepo{}, &mockTicketAttachmentRepo{})

	_, err := uc.Execute(context.Background(), ticket.CreateTicketAttachmentInput{
		WorkspaceID: tkWS, TicketID: tkTicket,
		Key:      "tickets/" + tkWS + "/" + tkTicket + "/123.bin",
		Filename: "", ContentType: "application/pdf", SizeBytes: 1024, UploadedByUserID: 1,
	})
	require.ErrorIs(t, err, domain.ErrInvalidAttachmentFilename)
}

func Test_添付記録_妥当な入力は保存する(t *testing.T) {
	tickets := &mockTicketRepo{}
	tickets.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(&domain.Ticket{ID: tkTicket, WorkspaceID: tkWS}, nil)
	attachments := &mockTicketAttachmentRepo{}
	var captured *domain.TicketAttachment
	attachments.On("CreateTicketAttachment", mock.Anything, mock.AnythingOfType("*domain.TicketAttachment")).
		Run(func(args mock.Arguments) { captured = args.Get(1).(*domain.TicketAttachment) }).Return(nil)

	key := "tickets/" + tkWS + "/" + tkTicket + "/123.bin"
	_, err := ticket.NewCreateTicketAttachmentUseCase(tickets, attachments).
		Execute(context.Background(), ticket.CreateTicketAttachmentInput{
			WorkspaceID: tkWS, TicketID: tkTicket, Key: key,
			Filename: "資料.pdf", ContentType: "application/pdf", SizeBytes: 1024, UploadedByUserID: 7,
		})
	require.NoError(t, err)
	require.Equal(t, "資料.pdf", captured.Filename)
	require.Equal(t, key, captured.Key)
	require.Equal(t, uint64(7), captured.UploadedByUserID)
}

func Test_添付一覧(t *testing.T) {
	repo := &mockTicketAttachmentRepo{}
	want := []domain.TicketAttachment{{ID: "attachment-1", Filename: "資料.pdf"}}
	repo.On("ListTicketAttachments", mock.Anything, tkWS, tkTicket).Return(want, nil)

	got, err := ticket.NewListTicketAttachmentsUseCase(repo).Execute(context.Background(), tkWS, tkTicket)
	require.NoError(t, err)
	require.Equal(t, want, got)
}

func Test_添付ダウンロードURL発行_見つからなければそのまま伝える(t *testing.T) {
	repo := &mockTicketAttachmentRepo{}
	repo.On("FindTicketAttachment", mock.Anything, tkWS, tkTicket, "attachment-1").
		Return(nil, repository.ErrTicketAttachmentNotFound)

	_, err := ticket.NewIssueTicketAttachmentDownloadURLUseCase(repo, &mockTicketAttachmentPresigner{}).
		Execute(context.Background(), ticket.IssueTicketAttachmentDownloadURLInput{
			WorkspaceID: tkWS, TicketID: tkTicket, AttachmentID: "attachment-1",
		})
	require.ErrorIs(t, err, repository.ErrTicketAttachmentNotFound)
}

func Test_添付ダウンロードURL発行_保存済みのkeyと元のファイル名で署名する(t *testing.T) {
	repo := &mockTicketAttachmentRepo{}
	key := "tickets/" + tkWS + "/" + tkTicket + "/123.bin"
	repo.On("FindTicketAttachment", mock.Anything, tkWS, tkTicket, "attachment-1").
		Return(&domain.TicketAttachment{ID: "attachment-1", Key: key, Filename: "見積書.xlsx"}, nil)
	presigner := &mockTicketAttachmentPresigner{}
	presigner.On("PresignDownload", mock.Anything, key, "見積書.xlsx").Return("https://example/get", 600, nil)

	out, err := ticket.NewIssueTicketAttachmentDownloadURLUseCase(repo, presigner).
		Execute(context.Background(), ticket.IssueTicketAttachmentDownloadURLInput{
			WorkspaceID: tkWS, TicketID: tkTicket, AttachmentID: "attachment-1",
		})
	require.NoError(t, err)
	require.Equal(t, "https://example/get", out.URL)
	require.Equal(t, 600, out.ExpiresIn)
}

func Test_添付削除(t *testing.T) {
	repo := &mockTicketAttachmentRepo{}
	repo.On("DeleteTicketAttachment", mock.Anything, tkWS, tkTicket, "attachment-1").Return(nil)

	err := ticket.NewDeleteTicketAttachmentUseCase(repo).Execute(context.Background(), ticket.DeleteTicketAttachmentInput{
		WorkspaceID: tkWS, TicketID: tkTicket, AttachmentID: "attachment-1",
	})
	require.NoError(t, err)
}
