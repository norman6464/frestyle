package kb_test

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
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
	invWS    = "0198a000-0000-7000-8000-000000000001"
	invID    = "0198a000-0000-7000-8000-00000000000d"
	invEmail = "taro@example.com"
)

func pendingInvitation(now time.Time) *domain.Invitation {
	return &domain.Invitation{
		ID: invID, WorkspaceID: invWS, Scope: domain.InvitationScopeWorkspace, Role: domain.GrantRoleEditor,
		Email: invEmail, InvitedByUserID: 9, ExpiresAt: now.Add(3 * 24 * time.Hour),
		LastSentAt: now.Add(-time.Hour), LastSentByUserID: 9, SendCount: 1, CreatedAt: now.Add(-time.Hour),
	}
}

func detailOf(inv *domain.Invitation) *domain.InvitationDetail {
	return &domain.InvitationDetail{Invitation: *inv, WorkspaceSlug: "acme", WorkspaceName: "Acme 社", InviterName: "鈴木"}
}

// tokenMatchesHash は応答の平文トークンが、保存に渡した SHA-256 と対応しているかを確かめる。
func tokenMatchesHash(t *testing.T, token string, hash []byte) {
	t.Helper()
	raw, err := base64.RawURLEncoding.DecodeString(token)
	require.NoError(t, err, "トークンは base64url")
	assert.Len(t, raw, 32, "256 bit の乱数")
	sum := sha256.Sum256([]byte(token))
	assert.Equal(t, sum[:], hash, "DB に渡すのは平文の SHA-256")
}

func newInviteMocks() (*mockInvitationRepo, *mockUserRepo, *mockNotificationRepo, *fakeTxManager) {
	inv := &mockInvitationRepo{}
	inv.On("CountSentBySince", mock.Anything, uint64(1), mock.Anything).Return(int64(0), nil).Maybe()
	inv.On("CountSentToEmailSince", mock.Anything, invEmail, mock.Anything).Return(int64(0), nil).Maybe()
	inv.On("CountOpenInWorkspace", mock.Anything, invWS).Return(int64(0), nil).Maybe()
	return inv, &mockUserRepo{}, &mockNotificationRepo{}, &fakeTxManager{}
}

func Test_email招待_招待を作り既にアカウントのある宛先には通知を出す(t *testing.T) {
	inv, users, notifications, tx := newInviteMocks()
	var written repository.InvitationWrite
	inv.On("Upsert", mock.Anything, mock.MatchedBy(func(in repository.InvitationWrite) bool {
		written = in
		return in.WorkspaceID == invWS && in.Scope == domain.InvitationScopeWorkspace &&
			in.Email == invEmail && in.InviteeName == "山田 太郎" && in.Role == domain.GrantRoleEditor &&
			in.ActorUserID == 1 && len(in.TokenHash) == 32 &&
			// 期限は 7 日後、再送の境界は 10 分前（どちらも now 基準）。
			time.Until(in.ExpiresAt) > kb.InvitationTTL-time.Minute &&
			time.Since(in.SentBefore) > kb.InvitationResendInterval-time.Minute
	})).Return(pendingInvitation(time.Now()), nil)
	inv.On("FindDetailByTokenHash", mock.Anything, mock.Anything).Return(detailOf(pendingInvitation(time.Now())), nil)
	users.On("FindActiveIDByEmail", mock.Anything, invEmail).Return(uint64(7), true, nil)
	users.On("FindDisplayByID", mock.Anything, uint64(1)).Return(&domain.UserDisplay{UserID: 1, Name: "鈴木"}, nil)
	notifications.On("Create", mock.Anything, mock.MatchedBy(func(n *domain.Notification) bool {
		return n.UserID == 7 && n.Type == domain.NotificationTypeWorkspaceInvitation &&
			n.LinkPath == "/invitations" && strings.Contains(n.Title, "鈴木") && strings.Contains(n.Title, "Acme 社")
	})).Return(nil)
	uc := kb.NewInviteByEmailUseCase(inv, users, notifications, tx)

	out, err := uc.Execute(context.Background(), kb.InviteByEmailInput{
		WorkspaceID: invWS, WorkspaceName: "Acme 社",
		// 前後の空白と大文字は正規化して保存する。
		Email: "  Taro@Example.com ", InviteeName: " 山田 太郎 ", Role: domain.GrantRoleEditor, ActorUserID: 1,
	})
	require.NoError(t, err)
	tokenMatchesHash(t, out.Token, written.TokenHash)
	assert.Equal(t, uint64(7), out.NotifiedUserID)
	assert.Equal(t, "acme", out.Invitation.WorkspaceSlug, "一覧と同じ形で返す")
	assert.Equal(t, 1, tx.calls, "招待と通知は同じトランザクション")
	inv.AssertExpectations(t)
	notifications.AssertExpectations(t)
}

func Test_email招待_宛先にアカウントが無ければ通知は出さない(t *testing.T) {
	inv, users, notifications, tx := newInviteMocks()
	inv.On("Upsert", mock.Anything, mock.Anything).Return(pendingInvitation(time.Now()), nil)
	inv.On("FindDetailByTokenHash", mock.Anything, mock.Anything).Return(detailOf(pendingInvitation(time.Now())), nil)
	users.On("FindActiveIDByEmail", mock.Anything, invEmail).Return(uint64(0), false, nil)
	uc := kb.NewInviteByEmailUseCase(inv, users, notifications, tx)

	out, err := uc.Execute(context.Background(), kb.InviteByEmailInput{
		WorkspaceID: invWS, Email: invEmail, Role: domain.GrantRoleViewer, ActorUserID: 1,
	})
	require.NoError(t, err)
	assert.Zero(t, out.NotifiedUserID)
	// notifications に期待を登録していないので、呼ばれれば mock が panic する。
	notifications.AssertNotCalled(t, "Create", mock.Anything, mock.Anything)
}

func Test_email招待_自分自身の宛先には通知しない(t *testing.T) {
	inv, users, notifications, tx := newInviteMocks()
	inv.On("Upsert", mock.Anything, mock.Anything).Return(pendingInvitation(time.Now()), nil)
	inv.On("FindDetailByTokenHash", mock.Anything, mock.Anything).Return(detailOf(pendingInvitation(time.Now())), nil)
	users.On("FindActiveIDByEmail", mock.Anything, invEmail).Return(uint64(1), true, nil)
	uc := kb.NewInviteByEmailUseCase(inv, users, notifications, tx)

	out, err := uc.Execute(context.Background(), kb.InviteByEmailInput{
		WorkspaceID: invWS, Email: invEmail, Role: domain.GrantRoleAdmin, ActorUserID: 1,
	})
	require.NoError(t, err)
	assert.Zero(t, out.NotifiedUserID)
}

func Test_email招待_入力の検査(t *testing.T) {
	inv, users, notifications, tx := newInviteMocks()
	uc := kb.NewInviteByEmailUseCase(inv, users, notifications, tx)
	base := kb.InviteByEmailInput{WorkspaceID: invWS, Email: invEmail, Role: domain.GrantRoleEditor, ActorUserID: 1}

	for _, email := range []string{"", "taro", "@example.com", "山田 <taro@example.com>", "a@b, c@d", strings.Repeat("a", 250) + "@x.jp"} {
		in := base
		in.Email = email
		_, err := uc.Execute(context.Background(), in)
		assert.ErrorIs(t, err, domain.ErrInvalidInvitationEmail, "email=%q", email)
	}
	in := base
	in.Role = domain.GrantRole("owner")
	_, err := uc.Execute(context.Background(), in)
	assert.ErrorIs(t, err, kb.ErrInvalidGrantRole)
	in = base
	in.InviteeName = strings.Repeat("あ", 201)
	_, err = uc.Execute(context.Background(), in)
	assert.ErrorIs(t, err, kb.ErrInvalidName)
	in = base
	in.WorkspaceID = ""
	_, err = uc.Execute(context.Background(), in)
	require.Error(t, err)
	in = base
	in.ActorUserID = 0
	_, err = uc.Execute(context.Background(), in)
	require.Error(t, err)
	inv.AssertNotCalled(t, "Upsert", mock.Anything, mock.Anything)
	assert.Zero(t, tx.calls, "検査で落ちたらトランザクションは開かない")
}

func Test_email招待_上限に達したら断る(t *testing.T) {
	base := kb.InviteByEmailInput{WorkspaceID: invWS, Email: invEmail, Role: domain.GrantRoleEditor, ActorUserID: 1}
	t.Run("招く側の1日の件数", func(t *testing.T) {
		inv := &mockInvitationRepo{}
		inv.On("CountSentBySince", mock.Anything, uint64(1), mock.Anything).Return(int64(kb.InvitationDailyLimitPerInviter), nil)
		uc := kb.NewInviteByEmailUseCase(inv, &mockUserRepo{}, &mockNotificationRepo{}, &fakeTxManager{})
		_, err := uc.Execute(context.Background(), base)
		assert.ErrorIs(t, err, kb.ErrInvitationInviterLimit)
	})
	t.Run("同じ宛先への1日の件数", func(t *testing.T) {
		inv := &mockInvitationRepo{}
		inv.On("CountSentBySince", mock.Anything, uint64(1), mock.Anything).Return(int64(0), nil)
		inv.On("CountSentToEmailSince", mock.Anything, invEmail, mock.Anything).Return(int64(kb.InvitationDailyLimitPerEmail), nil)
		uc := kb.NewInviteByEmailUseCase(inv, &mockUserRepo{}, &mockNotificationRepo{}, &fakeTxManager{})
		_, err := uc.Execute(context.Background(), base)
		assert.ErrorIs(t, err, kb.ErrInvitationEmailLimit)
	})
	t.Run("ワークスペースの未決の件数", func(t *testing.T) {
		inv := &mockInvitationRepo{}
		inv.On("CountSentBySince", mock.Anything, uint64(1), mock.Anything).Return(int64(0), nil)
		inv.On("CountSentToEmailSince", mock.Anything, invEmail, mock.Anything).Return(int64(0), nil)
		inv.On("CountOpenInWorkspace", mock.Anything, invWS).Return(int64(kb.InvitationOpenLimitPerWorkspace), nil)
		uc := kb.NewInviteByEmailUseCase(inv, &mockUserRepo{}, &mockNotificationRepo{}, &fakeTxManager{})
		_, err := uc.Execute(context.Background(), base)
		assert.ErrorIs(t, err, kb.ErrInvitationWorkspaceLimit)
	})
	t.Run("再送の間隔はrepositoryの判定をそのまま伝える", func(t *testing.T) {
		inv, users, notifications, tx := newInviteMocks()
		inv.On("Upsert", mock.Anything, mock.Anything).Return(nil, repository.ErrInvitationResendTooSoon)
		uc := kb.NewInviteByEmailUseCase(inv, users, notifications, tx)
		_, err := uc.Execute(context.Background(), base)
		assert.ErrorIs(t, err, repository.ErrInvitationResendTooSoon)
	})
}

func Test_招待再送_トークンを差し替えて期限を延ばす(t *testing.T) {
	inv := &mockInvitationRepo{}
	inv.On("Find", mock.Anything, invWS, invID).Return(pendingInvitation(time.Now()), nil)
	inv.On("CountSentBySince", mock.Anything, uint64(2), mock.Anything).Return(int64(0), nil)
	inv.On("CountSentToEmailSince", mock.Anything, invEmail, mock.Anything).Return(int64(0), nil)
	var refreshed repository.InvitationRefresh
	inv.On("Refresh", mock.Anything, mock.MatchedBy(func(in repository.InvitationRefresh) bool {
		refreshed = in
		return in.WorkspaceID == invWS && in.InvitationID == invID && in.ActorUserID == 2 && len(in.TokenHash) == 32 &&
			time.Until(in.ExpiresAt) > kb.InvitationTTL-time.Minute
	})).Return(pendingInvitation(time.Now()), nil)
	inv.On("FindDetailByTokenHash", mock.Anything, mock.Anything).Return(detailOf(pendingInvitation(time.Now())), nil)
	uc := kb.NewResendInvitationUseCase(inv)

	out, err := uc.Execute(context.Background(), kb.ResendInvitationInput{WorkspaceID: invWS, InvitationID: invID, ActorUserID: 2})
	require.NoError(t, err)
	tokenMatchesHash(t, out.Token, refreshed.TokenHash)
	assert.Equal(t, invID, out.Invitation.ID)

	_, err = uc.Execute(context.Background(), kb.ResendInvitationInput{WorkspaceID: invWS, ActorUserID: 2})
	assert.ErrorIs(t, err, repository.ErrInvitationNotFound, "id 無しは not found")
}

func Test_招待再送_発行と同じ1日の上限を数える(t *testing.T) {
	// 再送も 1 回の送信。ここを数えないと、再送を繰り返すだけで上限を回れる。
	t.Run("招く側の上限", func(t *testing.T) {
		inv := &mockInvitationRepo{}
		inv.On("Find", mock.Anything, invWS, invID).Return(pendingInvitation(time.Now()), nil)
		inv.On("CountSentBySince", mock.Anything, uint64(2), mock.Anything).Return(int64(kb.InvitationDailyLimitPerInviter), nil)
		_, err := kb.NewResendInvitationUseCase(inv).Execute(context.Background(), kb.ResendInvitationInput{WorkspaceID: invWS, InvitationID: invID, ActorUserID: 2})
		assert.ErrorIs(t, err, kb.ErrInvitationInviterLimit)
		inv.AssertNotCalled(t, "Refresh", mock.Anything, mock.Anything)
	})
	t.Run("宛先の上限", func(t *testing.T) {
		inv := &mockInvitationRepo{}
		inv.On("Find", mock.Anything, invWS, invID).Return(pendingInvitation(time.Now()), nil)
		inv.On("CountSentBySince", mock.Anything, uint64(2), mock.Anything).Return(int64(0), nil)
		inv.On("CountSentToEmailSince", mock.Anything, invEmail, mock.Anything).Return(int64(kb.InvitationDailyLimitPerEmail), nil)
		_, err := kb.NewResendInvitationUseCase(inv).Execute(context.Background(), kb.ResendInvitationInput{WorkspaceID: invWS, InvitationID: invID, ActorUserID: 2})
		assert.ErrorIs(t, err, kb.ErrInvitationEmailLimit)
		inv.AssertNotCalled(t, "Refresh", mock.Anything, mock.Anything)
	})
	t.Run("招待が無ければ上限を数える前に not found", func(t *testing.T) {
		inv := &mockInvitationRepo{}
		inv.On("Find", mock.Anything, invWS, invID).Return(nil, repository.ErrInvitationNotFound)
		_, err := kb.NewResendInvitationUseCase(inv).Execute(context.Background(), kb.ResendInvitationInput{WorkspaceID: invWS, InvitationID: invID, ActorUserID: 2})
		assert.ErrorIs(t, err, repository.ErrInvitationNotFound)
		inv.AssertNotCalled(t, "CountSentBySince", mock.Anything, mock.Anything, mock.Anything)
	})
}

func Test_招待取消_repositoryへそのまま渡す(t *testing.T) {
	inv := &mockInvitationRepo{}
	inv.On("Revoke", mock.Anything, invWS, invID, uint64(2)).Return(nil)
	uc := kb.NewRevokeInvitationUseCase(inv)
	require.NoError(t, uc.Execute(context.Background(), kb.RevokeInvitationInput{WorkspaceID: invWS, InvitationID: invID, ActorUserID: 2}))
	inv.AssertExpectations(t)
}

func Test_招待の一覧_admin向けは上限つきで引く(t *testing.T) {
	inv := &mockInvitationRepo{}
	want := []domain.InvitationDetail{*detailOf(pendingInvitation(time.Now()))}
	inv.On("ListByWorkspace", mock.Anything, invWS, mock.AnythingOfType("int")).Return(want, nil)
	uc := kb.NewListWorkspaceInvitationsUseCase(inv)
	got, err := uc.Execute(context.Background(), kb.ListWorkspaceInvitationsInput{WorkspaceID: invWS})
	require.NoError(t, err)
	assert.Equal(t, want, got)
}

func Test_招待の案内_使えないものはどれも同じ理由に畳む(t *testing.T) {
	now := time.Now()
	cases := map[string]*domain.InvitationDetail{
		"期限切れ": func() *domain.InvitationDetail {
			d := detailOf(pendingInvitation(now))
			d.ExpiresAt = now.Add(-time.Minute)
			return d
		}(),
		"承諾済み": func() *domain.InvitationDetail {
			d := detailOf(pendingInvitation(now))
			at, by := now.Add(-time.Minute), uint64(7)
			d.AcceptedAt, d.AcceptedByUserID = &at, &by
			return d
		}(),
		"取消済み": func() *domain.InvitationDetail {
			d := detailOf(pendingInvitation(now))
			at, by := now.Add(-time.Minute), uint64(9)
			d.RevokedAt, d.RevokedByUserID = &at, &by
			return d
		}(),
	}
	for name, detail := range cases {
		t.Run(name, func(t *testing.T) {
			inv := &mockInvitationRepo{}
			inv.On("FindDetailByTokenHash", mock.Anything, mock.Anything).Return(detail, nil)
			_, err := kb.NewPreviewInvitationUseCase(inv).Execute(context.Background(), "tok")
			assert.ErrorIs(t, err, kb.ErrInvitationUnavailable)
		})
	}
	t.Run("無い", func(t *testing.T) {
		inv := &mockInvitationRepo{}
		inv.On("FindDetailByTokenHash", mock.Anything, mock.Anything).Return(nil, repository.ErrInvitationNotFound)
		_, err := kb.NewPreviewInvitationUseCase(inv).Execute(context.Background(), "tok")
		assert.ErrorIs(t, err, kb.ErrInvitationUnavailable)
	})
	t.Run("空のトークンはrepositoryを引かない", func(t *testing.T) {
		inv := &mockInvitationRepo{}
		_, err := kb.NewPreviewInvitationUseCase(inv).Execute(context.Background(), "")
		assert.ErrorIs(t, err, kb.ErrInvitationUnavailable)
		inv.AssertNotCalled(t, "FindDetailByTokenHash", mock.Anything, mock.Anything)
	})
	t.Run("承諾できるものは案内を返す", func(t *testing.T) {
		inv := &mockInvitationRepo{}
		sum := sha256.Sum256([]byte("tok"))
		inv.On("FindDetailByTokenHash", mock.Anything, sum[:]).Return(detailOf(pendingInvitation(now)), nil)
		got, err := kb.NewPreviewInvitationUseCase(inv).Execute(context.Background(), "tok")
		require.NoError(t, err)
		assert.Equal(t, "Acme 社", got.WorkspaceName)
	})
	t.Run("DB障害は使えないに畳まない", func(t *testing.T) {
		inv := &mockInvitationRepo{}
		boom := errors.New("db down")
		inv.On("FindDetailByTokenHash", mock.Anything, mock.Anything).Return(nil, boom)
		_, err := kb.NewPreviewInvitationUseCase(inv).Execute(context.Background(), "tok")
		assert.ErrorIs(t, err, boom)
	})
}

func Test_自分宛の一覧_確認済みemailで引く(t *testing.T) {
	t.Run("emailが無ければ断る", func(t *testing.T) {
		users := &mockUserRepo{}
		users.On("FindByID", mock.Anything, uint64(7)).Return(&domain.User{ID: 7, Email: ""}, nil)
		inv := &mockInvitationRepo{}
		_, err := kb.NewListMyInvitationsUseCase(inv, users).Execute(context.Background(), 7)
		assert.ErrorIs(t, err, kb.ErrInvitationEmailNotVerified)
		inv.AssertNotCalled(t, "ListOpenByEmail", mock.Anything, mock.Anything)
	})
	t.Run("ユーザーが居なければnot found", func(t *testing.T) {
		users := &mockUserRepo{}
		users.On("FindByID", mock.Anything, uint64(7)).Return(nil, nil)
		_, err := kb.NewListMyInvitationsUseCase(&mockInvitationRepo{}, users).Execute(context.Background(), 7)
		assert.ErrorIs(t, err, repository.ErrUserNotFound)
	})
	t.Run("emailは正規形で引く", func(t *testing.T) {
		users := &mockUserRepo{}
		users.On("FindByID", mock.Anything, uint64(7)).Return(&domain.User{ID: 7, Email: " Taro@Example.com "}, nil)
		inv := &mockInvitationRepo{}
		want := []domain.InvitationDetail{*detailOf(pendingInvitation(time.Now()))}
		inv.On("ListOpenByEmail", mock.Anything, invEmail).Return(want, nil)
		got, err := kb.NewListMyInvitationsUseCase(inv, users).Execute(context.Background(), 7)
		require.NoError(t, err)
		assert.Equal(t, want, got)
	})
}

func adminFacts() *domain.ScopeFacts {
	return &domain.ScopeFacts{Roles: []domain.GrantRole{domain.GrantRoleAdmin}}
}

func Test_招待承諾_宛先が一致し招いた人が今もadminのときだけ通る(t *testing.T) {
	now := time.Now()
	newAccept := func(inv *domain.Invitation, userEmail string, ws *domain.Workspace, facts *domain.ScopeFacts) (*kb.AcceptInvitationUseCase, *mockInvitationRepo) {
		invitations := &mockInvitationRepo{}
		invitations.On("FindByID", mock.Anything, invID).Return(inv, nil).Maybe()
		users := &mockUserRepo{}
		users.On("FindByID", mock.Anything, uint64(7)).Return(&domain.User{ID: 7, Email: userEmail}, nil)
		workspaces := &mockKnowledgeBaseRepo{}
		workspaces.On("FindWorkspaceByID", mock.Anything, invWS).Return(ws, nil).Maybe()
		perms := &mockKBPermissionRepo{}
		perms.On("WorkspacePermissionFactsForUser", mock.Anything, invWS, uint64(9)).Return(facts, nil).Maybe()
		return kb.NewAcceptInvitationUseCase(invitations, users, workspaces, perms), invitations
	}
	activeWS := &domain.Workspace{ID: invWS, Slug: "acme", Name: "Acme 社", IsActive: true}

	t.Run("通る", func(t *testing.T) {
		uc, invitations := newAccept(pendingInvitation(now), "Taro@example.com", activeWS, adminFacts())
		accepted := pendingInvitation(now)
		at, by := now, uint64(7)
		accepted.AcceptedAt, accepted.AcceptedByUserID = &at, &by
		invitations.On("Accept", mock.Anything, invID, uint64(7), invEmail).Return(accepted, nil)

		out, err := uc.Execute(context.Background(), kb.AcceptInvitationInput{InvitationID: invID, UserID: 7})
		require.NoError(t, err)
		assert.Equal(t, "acme", out.WorkspaceSlug)
		assert.NotNil(t, out.Invitation.AcceptedAt)
		invitations.AssertExpectations(t)
	})
	t.Run("宛先が違えば無いのと同じ", func(t *testing.T) {
		uc, invitations := newAccept(pendingInvitation(now), "someone-else@example.com", activeWS, adminFacts())
		_, err := uc.Execute(context.Background(), kb.AcceptInvitationInput{InvitationID: invID, UserID: 7})
		assert.ErrorIs(t, err, repository.ErrInvitationNotFound)
		invitations.AssertNotCalled(t, "Accept", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	})
	t.Run("emailが無ければ断る", func(t *testing.T) {
		uc, _ := newAccept(pendingInvitation(now), "", activeWS, adminFacts())
		_, err := uc.Execute(context.Background(), kb.AcceptInvitationInput{InvitationID: invID, UserID: 7})
		assert.ErrorIs(t, err, kb.ErrInvitationEmailNotVerified)
	})
	t.Run("期限切れは使えない", func(t *testing.T) {
		expired := pendingInvitation(now)
		expired.ExpiresAt = now.Add(-time.Minute)
		uc, _ := newAccept(expired, invEmail, activeWS, adminFacts())
		_, err := uc.Execute(context.Background(), kb.AcceptInvitationInput{InvitationID: invID, UserID: 7})
		assert.ErrorIs(t, err, repository.ErrInvitationNotOpen)
	})
	t.Run("招いた人がadminでなくなっていたら使えない", func(t *testing.T) {
		uc, invitations := newAccept(pendingInvitation(now), invEmail, activeWS, &domain.ScopeFacts{Roles: []domain.GrantRole{domain.GrantRoleEditor}})
		_, err := uc.Execute(context.Background(), kb.AcceptInvitationInput{InvitationID: invID, UserID: 7})
		assert.ErrorIs(t, err, kb.ErrInvitationInviterNotAdmin)
		invitations.AssertNotCalled(t, "Accept", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
	})
	t.Run("停止中のワークスペースは不在扱い", func(t *testing.T) {
		inactive := *activeWS
		inactive.IsActive = false
		uc, _ := newAccept(pendingInvitation(now), invEmail, &inactive, adminFacts())
		_, err := uc.Execute(context.Background(), kb.AcceptInvitationInput{InvitationID: invID, UserID: 7})
		assert.ErrorIs(t, err, repository.ErrWorkspaceNotFound)
	})
}

func Test_招待辞退_宛先を添えてrepositoryへ渡す(t *testing.T) {
	users := &mockUserRepo{}
	users.On("FindByID", mock.Anything, uint64(7)).Return(&domain.User{ID: 7, Email: "TARO@example.com"}, nil)
	inv := &mockInvitationRepo{}
	inv.On("Decline", mock.Anything, invID, uint64(7), invEmail).Return(nil)
	uc := kb.NewDeclineInvitationUseCase(inv, users)
	require.NoError(t, uc.Execute(context.Background(), kb.DeclineInvitationInput{InvitationID: invID, UserID: 7}))
	inv.AssertExpectations(t)

	err := uc.Execute(context.Background(), kb.DeclineInvitationInput{UserID: 7})
	assert.ErrorIs(t, err, repository.ErrInvitationNotFound)
}
