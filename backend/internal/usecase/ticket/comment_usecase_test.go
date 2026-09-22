package ticket_test

import (
	"context"
	"testing"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/norman6464/frestyle/backend/internal/usecase/ticket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

const tkComment = "01a00000-0000-7000-8000-0000000000c1"

func tkSimpleBody(text string) string {
	return `[{"type":"text","text":"` + text + `"}]`
}

func mustParseTime(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339, s)
	require.NoError(t, err)
	return v
}

func Test_発言作成_必須項目と本文の検証(t *testing.T) {
	uc := ticket.NewCreateTicketCommentUseCase(&mockTicketCommentRepo{}, &mockTicketRepo{}, &mockKBPermissionRepo{}, &mockNotificationRepo{})
	ctx := context.Background()

	_, err := uc.Execute(ctx, ticket.CreateTicketCommentInput{TicketID: tkTicket, AuthorUserID: 1, Body: tkSimpleBody("x")})
	require.Error(t, err, "workspaceID必須")
	_, err = uc.Execute(ctx, ticket.CreateTicketCommentInput{WorkspaceID: tkWS, AuthorUserID: 1, Body: tkSimpleBody("x")})
	require.Error(t, err, "ticketID必須")
	_, err = uc.Execute(ctx, ticket.CreateTicketCommentInput{WorkspaceID: tkWS, TicketID: tkTicket, Body: tkSimpleBody("x")})
	require.Error(t, err, "authorUserID必須")
	_, err = uc.Execute(ctx, ticket.CreateTicketCommentInput{WorkspaceID: tkWS, TicketID: tkTicket, AuthorUserID: 1, Body: `[]`})
	require.ErrorIs(t, err, domain.ErrInvalidCommentBody, "空配列は拒否")
}

func Test_発言作成_チケットが無ければそのまま伝える(t *testing.T) {
	repo := &mockTicketRepo{}
	repo.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(nil, repository.ErrTicketNotFound)
	uc := ticket.NewCreateTicketCommentUseCase(&mockTicketCommentRepo{}, repo, &mockKBPermissionRepo{}, &mockNotificationRepo{})

	_, err := uc.Execute(context.Background(), ticket.CreateTicketCommentInput{
		WorkspaceID: tkWS, TicketID: tkTicket, AuthorUserID: 1, Body: tkSimpleBody("x"),
	})
	require.ErrorIs(t, err, repository.ErrTicketNotFound)
}

func Test_発言作成_親発言が実在しなければ拒否(t *testing.T) {
	tickets := &mockTicketRepo{}
	tickets.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(&domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject}, nil)
	comments := &mockTicketCommentRepo{}
	comments.On("FindTicketComment", mock.Anything, tkWS, tkTicket, "does-not-exist").Return(nil, repository.ErrTicketCommentNotFound)
	uc := ticket.NewCreateTicketCommentUseCase(comments, tickets, &mockKBPermissionRepo{}, &mockNotificationRepo{})

	parent := "does-not-exist"
	_, err := uc.Execute(context.Background(), ticket.CreateTicketCommentInput{
		WorkspaceID: tkWS, TicketID: tkTicket, ParentCommentID: &parent, AuthorUserID: 1, Body: tkSimpleBody("返信"),
	})
	require.ErrorIs(t, err, repository.ErrTicketCommentNotFound)
	comments.AssertNotCalled(t, "CreateTicketComment", mock.Anything, mock.Anything)
}

// 名指しされた相手のうち、このワークスペースの一員に解決できた相手だけへ ticket_mentioned が
// 届く。自分自身への通知は作らない。
func Test_発言作成_メンションはワークスペースの一員にだけ届き自分は除く(t *testing.T) {
	tickets := &mockTicketRepo{}
	tickets.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(&domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject, Title: "本文タイトル"}, nil)
	tickets.On("FindTicketAssignment", mock.Anything, tkWS, tkTicket).Return(nil, repository.ErrTicketNotFound)

	comments := &mockTicketCommentRepo{}
	comments.On("CreateTicketComment", mock.Anything, mock.AnythingOfType("*domain.TicketComment")).Return(nil)

	perms := &mockKBPermissionRepo{}
	perms.On("IsWorkspaceMemberBulk", mock.Anything, tkWS, []uint64{1, 2, 9}).
		Return(map[uint64]bool{1: true, 2: true}, nil) // 9 は非メンバーなので集合に含めない

	notifs := &mockNotificationRepo{}
	var captured []domain.Notification
	notifs.On("CreateMany", mock.Anything, mock.AnythingOfType("[]domain.Notification")).
		Run(func(args mock.Arguments) { captured = args.Get(1).([]domain.Notification) }).
		Return(nil)

	uc := ticket.NewCreateTicketCommentUseCase(comments, tickets, perms, notifs)

	body := `[
		{"type":"mention","attrs":{"userId":"1"}},
		{"type":"mention","attrs":{"userId":"2"}},
		{"type":"mention","attrs":{"userId":"9"}}
	]`
	_, err := uc.Execute(context.Background(), ticket.CreateTicketCommentInput{
		WorkspaceID: tkWS, TicketID: tkTicket, AuthorUserID: 1, Body: body,
	})
	require.NoError(t, err)

	require.Len(t, captured, 1, "メンバーの2だけに届く（自分=1は除外・非メンバー=9は除外）")
	assert.Equal(t, uint64(2), captured[0].UserID)
	assert.Equal(t, domain.NotificationTypeTicketMentioned, captured[0].Type)
	// 通知の行から当のチケットへ飛べる。フロントの /tickets/:ticketId と一致。
	assert.Equal(t, "/tickets/"+tkTicket, captured[0].LinkPath)
}

// 担当が付いていて発言者本人でなければ ticket_commented が届く。
func Test_発言作成_担当者への通知(t *testing.T) {
	tickets := &mockTicketRepo{}
	tickets.On("FindTicket", mock.Anything, tkWS, tkTicket).Return(&domain.Ticket{ID: tkTicket, WorkspaceID: tkWS, ProjectID: tkProject, Title: "T"}, nil)
	tickets.On("FindTicketAssignment", mock.Anything, tkWS, tkTicket).
		Return(&domain.TicketAssignment{TicketID: tkTicket, AssigneePrincipalID: "principal-1"}, nil)

	comments := &mockTicketCommentRepo{}
	comments.On("CreateTicketComment", mock.Anything, mock.AnythingOfType("*domain.TicketComment")).Return(nil)

	assigneeUserID := uint64(42)
	perms := &mockKBPermissionRepo{}
	perms.On("FindPrincipal", mock.Anything, tkWS, "principal-1").
		Return(&domain.Principal{ID: "principal-1", WorkspaceID: tkWS, Kind: domain.PrincipalKindUser, UserID: &assigneeUserID}, nil)

	notifs := &mockNotificationRepo{}
	var captured []domain.Notification
	notifs.On("CreateMany", mock.Anything, mock.AnythingOfType("[]domain.Notification")).
		Run(func(args mock.Arguments) { captured = args.Get(1).([]domain.Notification) }).
		Return(nil)

	uc := ticket.NewCreateTicketCommentUseCase(comments, tickets, perms, notifs)

	_, err := uc.Execute(context.Background(), ticket.CreateTicketCommentInput{
		WorkspaceID: tkWS, TicketID: tkTicket, AuthorUserID: 1, Body: tkSimpleBody("発言"),
	})
	require.NoError(t, err)

	require.Len(t, captured, 1)
	assert.Equal(t, assigneeUserID, captured[0].UserID)
	assert.Equal(t, domain.NotificationTypeTicketCommented, captured[0].Type)
	assert.Equal(t, "/tickets/"+tkTicket, captured[0].LinkPath)
}

func Test_発言編集_投稿者本人は編集できる(t *testing.T) {
	repo := &mockTicketCommentRepo{}
	existing := &domain.TicketComment{ID: tkComment, WorkspaceID: tkWS, TicketID: tkTicket, AuthorUserID: 1, Body: tkSimpleBody("旧")}
	repo.On("FindTicketComment", mock.Anything, tkWS, tkTicket, tkComment).Return(existing, nil)
	repo.On("InsertTicketCommentEdit", mock.Anything, mock.MatchedBy(func(e *domain.TicketCommentEdit) bool {
		return e.CommentID == tkComment && e.PreviousBody == tkSimpleBody("旧") && e.EditorUserID == 1
	})).Return(nil)
	repo.On("UpdateTicketCommentBody", mock.Anything, tkWS, tkTicket, tkComment, tkSimpleBody("新")).
		Return(&domain.TicketComment{ID: tkComment, Body: tkSimpleBody("新")}, nil)

	updated, err := ticket.NewUpdateTicketCommentUseCase(repo, fakeTxManager{}).Execute(context.Background(), ticket.UpdateTicketCommentInput{
		WorkspaceID: tkWS, TicketID: tkTicket, CommentID: tkComment, ActorUserID: 1, Body: tkSimpleBody("新"),
	})
	require.NoError(t, err)
	assert.Equal(t, tkSimpleBody("新"), updated.Body)
}

func Test_発言編集_投稿者でもCanManageでもなければ拒否(t *testing.T) {
	repo := &mockTicketCommentRepo{}
	existing := &domain.TicketComment{ID: tkComment, WorkspaceID: tkWS, TicketID: tkTicket, AuthorUserID: 1, Body: tkSimpleBody("旧")}
	repo.On("FindTicketComment", mock.Anything, tkWS, tkTicket, tkComment).Return(existing, nil)

	_, err := ticket.NewUpdateTicketCommentUseCase(repo, fakeTxManager{}).Execute(context.Background(), ticket.UpdateTicketCommentInput{
		WorkspaceID: tkWS, TicketID: tkTicket, CommentID: tkComment, ActorUserID: 2, ActorCanManage: false, Body: tkSimpleBody("横取り"),
	})
	require.ErrorIs(t, err, ticket.ErrNotCommentAuthor)
	repo.AssertNotCalled(t, "UpdateTicketCommentBody", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_発言編集_CanManageなら他人の発言も編集できる(t *testing.T) {
	repo := &mockTicketCommentRepo{}
	existing := &domain.TicketComment{ID: tkComment, WorkspaceID: tkWS, TicketID: tkTicket, AuthorUserID: 1, Body: tkSimpleBody("旧")}
	repo.On("FindTicketComment", mock.Anything, tkWS, tkTicket, tkComment).Return(existing, nil)
	repo.On("InsertTicketCommentEdit", mock.Anything, mock.AnythingOfType("*domain.TicketCommentEdit")).Return(nil)
	repo.On("UpdateTicketCommentBody", mock.Anything, tkWS, tkTicket, tkComment, tkSimpleBody("管理者が修正")).
		Return(&domain.TicketComment{ID: tkComment, Body: tkSimpleBody("管理者が修正")}, nil)

	_, err := ticket.NewUpdateTicketCommentUseCase(repo, fakeTxManager{}).Execute(context.Background(), ticket.UpdateTicketCommentInput{
		WorkspaceID: tkWS, TicketID: tkTicket, CommentID: tkComment, ActorUserID: 2, ActorCanManage: true, Body: tkSimpleBody("管理者が修正"),
	})
	require.NoError(t, err)
}

func Test_発言削除_投稿者本人は削除できる(t *testing.T) {
	repo := &mockTicketCommentRepo{}
	existing := &domain.TicketComment{ID: tkComment, WorkspaceID: tkWS, TicketID: tkTicket, AuthorUserID: 1}
	repo.On("FindTicketComment", mock.Anything, tkWS, tkTicket, tkComment).Return(existing, nil)
	repo.On("DeleteTicketComment", mock.Anything, tkWS, tkTicket, tkComment).Return(nil)

	err := ticket.NewDeleteTicketCommentUseCase(repo).Execute(context.Background(), ticket.DeleteTicketCommentInput{
		WorkspaceID: tkWS, TicketID: tkTicket, CommentID: tkComment, ActorUserID: 1,
	})
	require.NoError(t, err)
}

func Test_発言削除_投稿者でもCanManageでもなければ拒否(t *testing.T) {
	repo := &mockTicketCommentRepo{}
	existing := &domain.TicketComment{ID: tkComment, WorkspaceID: tkWS, TicketID: tkTicket, AuthorUserID: 1}
	repo.On("FindTicketComment", mock.Anything, tkWS, tkTicket, tkComment).Return(existing, nil)

	err := ticket.NewDeleteTicketCommentUseCase(repo).Execute(context.Background(), ticket.DeleteTicketCommentInput{
		WorkspaceID: tkWS, TicketID: tkTicket, CommentID: tkComment, ActorUserID: 2, ActorCanManage: false,
	})
	require.ErrorIs(t, err, ticket.ErrNotCommentAuthor)
	repo.AssertNotCalled(t, "DeleteTicketComment", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_反応の追加_不正な絵文字は拒否(t *testing.T) {
	repo := &mockTicketCommentRepo{}
	err := ticket.NewAddTicketCommentReactionUseCase(repo).Execute(context.Background(), tkWS, tkTicket, tkComment, 1, "")
	require.ErrorIs(t, err, domain.ErrInvalidTicketCommentReactionEmoji)
	repo.AssertNotCalled(t, "AddTicketCommentReaction", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func Test_反応の追加(t *testing.T) {
	repo := &mockTicketCommentRepo{}
	repo.On("FindTicketComment", mock.Anything, tkWS, tkTicket, tkComment).Return(&domain.TicketComment{ID: tkComment}, nil)
	repo.On("AddTicketCommentReaction", mock.Anything, tkWS, tkComment, uint64(1), "👍").Return(nil)

	err := ticket.NewAddTicketCommentReactionUseCase(repo).Execute(context.Background(), tkWS, tkTicket, tkComment, 1, "👍")
	require.NoError(t, err)
}

func Test_発言一覧_反応をまとめて返す(t *testing.T) {
	repo := &mockTicketCommentRepo{}
	c1 := domain.TicketComment{ID: "c1", CreatedAt: mustParseTime(t, "2026-09-10T09:00:00Z")}
	c2 := domain.TicketComment{ID: "c2", CreatedAt: mustParseTime(t, "2026-09-10T09:01:00Z")}
	repo.On("ListTicketComments", mock.Anything, tkWS, tkTicket).Return([]domain.TicketComment{c1, c2}, nil)
	repo.On("ListTicketCommentReactions", mock.Anything, tkWS, []string{"c1", "c2"}).
		Return([]domain.TicketCommentReaction{
			{CommentID: "c1", UserID: 1, Emoji: "👍"},
			{CommentID: "c2", UserID: 2, Emoji: "🎉"},
		}, nil)

	out, err := ticket.NewListTicketCommentsUseCase(repo).Execute(context.Background(), tkWS, tkTicket)
	require.NoError(t, err)
	require.Len(t, out, 2)
	assert.Equal(t, "c1", out[0].Comment.ID)
	require.Len(t, out[0].Reactions, 1)
	assert.Equal(t, "👍", out[0].Reactions[0].Emoji)
	require.Len(t, out[1].Reactions, 1)
	assert.Equal(t, "🎉", out[1].Reactions[0].Emoji)
}

func Test_発言の編集履歴一覧(t *testing.T) {
	repo := &mockTicketCommentRepo{}
	repo.On("FindTicketComment", mock.Anything, tkWS, tkTicket, tkComment).Return(&domain.TicketComment{ID: tkComment}, nil)
	repo.On("ListTicketCommentEdits", mock.Anything, tkWS, tkComment).Return([]domain.TicketCommentEdit{
		{ID: "edit-1", CommentID: tkComment, EditorUserID: 1, PreviousBody: tkSimpleBody("旧")},
	}, nil)

	out, err := ticket.NewListTicketCommentEditsUseCase(repo).Execute(context.Background(), tkWS, tkTicket, tkComment)
	require.NoError(t, err)
	require.Len(t, out, 1)
	assert.Equal(t, uint64(1), out[0].EditorUserID)
}

func Test_発言の編集履歴一覧_発言が無ければそのまま伝える(t *testing.T) {
	repo := &mockTicketCommentRepo{}
	repo.On("FindTicketComment", mock.Anything, tkWS, tkTicket, tkComment).Return(nil, repository.ErrTicketCommentNotFound)

	_, err := ticket.NewListTicketCommentEditsUseCase(repo).Execute(context.Background(), tkWS, tkTicket, tkComment)
	require.ErrorIs(t, err, repository.ErrTicketCommentNotFound)
	repo.AssertNotCalled(t, "ListTicketCommentEdits", mock.Anything, mock.Anything, mock.Anything)
}

func Test_反応の削除(t *testing.T) {
	repo := &mockTicketCommentRepo{}
	repo.On("FindTicketComment", mock.Anything, tkWS, tkTicket, tkComment).Return(&domain.TicketComment{ID: tkComment}, nil)
	repo.On("RemoveTicketCommentReaction", mock.Anything, tkWS, tkComment, uint64(1), "👍").Return(nil)

	err := ticket.NewRemoveTicketCommentReactionUseCase(repo).Execute(context.Background(), tkWS, tkTicket, tkComment, 1, "👍")
	require.NoError(t, err)
}

func Test_反応の削除_発言が無ければそのまま伝える(t *testing.T) {
	repo := &mockTicketCommentRepo{}
	repo.On("FindTicketComment", mock.Anything, tkWS, tkTicket, tkComment).Return(nil, repository.ErrTicketCommentNotFound)

	err := ticket.NewRemoveTicketCommentReactionUseCase(repo).Execute(context.Background(), tkWS, tkTicket, tkComment, 1, "👍")
	require.ErrorIs(t, err, repository.ErrTicketCommentNotFound)
	repo.AssertNotCalled(t, "RemoveTicketCommentReaction", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}
