//go:build integration

package persistence_test

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// tokenHashOf はテスト用のトークンから保存用の SHA-256 を作る（usecase の hashInvitationToken と同じ形）。
func tokenHashOf(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// emailOf はそのユーザーの users.email を正規形で返す（招待の宛先・承諾の照合に使う）。
func (f kbPermFixture) emailOf(t *testing.T, userID uint64) string {
	t.Helper()
	var email string
	require.NoError(t, f.db.QueryRow(`SELECT email FROM users WHERE id = $1`, userID).Scan(&email))
	return domain.NormalizeEmail(email)
}

// inviteWrite は userID の email 宛のワークスペース招待（期限 7 日・再送の境界 10 分前）の入力を作る。
func (f kbPermFixture) inviteWrite(t *testing.T, userID, inviter uint64, role domain.GrantRole, token string) repository.InvitationWrite {
	t.Helper()
	now := time.Now()
	return repository.InvitationWrite{
		WorkspaceID: f.ws, Scope: domain.InvitationScopeWorkspace, Role: role,
		Email: f.emailOf(t, userID), InviteeName: "招かれる人", TokenHash: tokenHashOf(token),
		ActorUserID: inviter, ExpiresAt: now.Add(7 * 24 * time.Hour), SentBefore: now.Add(-10 * time.Minute),
	}
}

// invite は inviter が userID の email 宛にワークスペース招待を出す。
func (f kbPermFixture) invite(ctx context.Context, t *testing.T, userID, inviter uint64, role domain.GrantRole) *domain.Invitation {
	t.Helper()
	inv, err := f.invitations.Upsert(ctx, f.inviteWrite(t, userID, inviter, role, "token-"+strconv.FormatUint(userID, 10)+"-"+strconv.FormatInt(time.Now().UnixNano(), 10)))
	require.NoError(t, err)
	return inv
}

// acceptInvitation は userID 本人として承諾する（所属・主体・役割がこの瞬間にできる）。
func (f kbPermFixture) acceptInvitation(ctx context.Context, t *testing.T, inv *domain.Invitation, userID uint64) *domain.Invitation {
	t.Helper()
	accepted, err := f.invitations.Accept(ctx, inv.ID, userID, f.emailOf(t, userID))
	require.NoError(t, err)
	return accepted
}

// backdateLastSent は再送の間隔（10 分）を空けた状態にする。
func (f kbPermFixture) backdateLastSent(t *testing.T, invitationID string) {
	t.Helper()
	_, err := f.db.Exec(`UPDATE invitations SET last_sent_at = now() - interval '11 minutes' WHERE id = $1`, invitationID)
	require.NoError(t, err)
}

// makeAdmin は userID をメンバーにして admin の役割を張る（招く側の下ごしらえ）。
func (f kbPermFixture) makeAdmin(ctx context.Context, t *testing.T, userID uint64) *domain.Principal {
	t.Helper()
	f.makeActiveMember(t, f.ws, userID)
	principal, err := f.perm.EnsureUserPrincipal(ctx, f.ws, userID)
	require.NoError(t, err)
	_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, principal.ID, domain.GrantRoleAdmin, userID)
	require.NoError(t, err)
	return principal
}

// TestInvitationRepository_Integration は email 宛の招待（invitations）の書き込み規則を
// 実 PostgreSQL で固定する: 未決は宛先 × 場所ごとに 1 件（2 回目は再送）・承諾は所属と主体と
// 役割と監査を 1 トランザクションで作る・admin を失った人の未決の招待は同じトランザクションで
// 止まる・DDL の CHECK が不正な行を弾く。
func TestInvitationRepository_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	invitationRow := func(t *testing.T, id string) (revokedBy sql.NullInt64, sendCount int, acceptedBy sql.NullInt64) {
		t.Helper()
		require.NoError(t, sqlDB.QueryRow(
			`SELECT revoked_by_user_id, send_count, accepted_by_user_id FROM invitations WHERE id = $1`, id,
		).Scan(&revokedBy, &sendCount, &acceptedBy))
		return
	}

	t.Run("発行は未決の行を作りトークンから周辺つきで引ける", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		inv, err := f.invitations.Upsert(ctx, f.inviteWrite(t, f.bob, f.alice, domain.GrantRoleEditor, "tok-1"))
		require.NoError(t, err)
		assert.Equal(t, f.emailOf(t, f.bob), inv.Email)
		assert.Equal(t, f.alice, inv.InvitedByUserID)
		assert.Equal(t, f.alice, inv.LastSentByUserID)
		assert.Equal(t, 1, inv.SendCount)
		assert.True(t, inv.Open(time.Now()))
		assert.Nil(t, inv.SpaceID)
		assert.Nil(t, inv.PageID)

		detail, err := f.invitations.FindDetailByTokenHash(ctx, tokenHashOf("tok-1"))
		require.NoError(t, err)
		assert.Equal(t, inv.ID, detail.ID)
		assert.Equal(t, "perm-main", detail.WorkspaceSlug)
		assert.Equal(t, "alice", detail.InviterName, "招いた人の users.name")

		_, err = f.invitations.FindDetailByTokenHash(ctx, tokenHashOf("no-such"))
		assert.ErrorIs(t, err, repository.ErrInvitationNotFound)
	})

	t.Run("同じ宛先への2回目は再送になり間隔が空いていなければ断る", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		first, err := f.invitations.Upsert(ctx, f.inviteWrite(t, f.bob, f.alice, domain.GrantRoleEditor, "tok-1"))
		require.NoError(t, err)

		_, err = f.invitations.Upsert(ctx, f.inviteWrite(t, f.bob, f.carol, domain.GrantRoleViewer, "tok-2"))
		assert.ErrorIs(t, err, repository.ErrInvitationResendTooSoon, "直後は再送できない")

		f.backdateLastSent(t, first.ID)
		second, err := f.invitations.Upsert(ctx, f.inviteWrite(t, f.bob, f.carol, domain.GrantRoleViewer, "tok-2"))
		require.NoError(t, err)
		assert.Equal(t, first.ID, second.ID, "新しい行は作らず既存行を更新する")
		assert.Equal(t, 2, second.SendCount)
		assert.Equal(t, domain.GrantRoleViewer, second.Role, "役割は今回の値で上書き")
		assert.Equal(t, f.alice, second.InvitedByUserID, "最初に招いた人は保つ")
		assert.Equal(t, f.carol, second.LastSentByUserID, "届けた人は今回の実行者")

		_, err = f.invitations.FindDetailByTokenHash(ctx, tokenHashOf("tok-1"))
		assert.ErrorIs(t, err, repository.ErrInvitationNotFound, "前のトークンは使えない")
		_, err = f.invitations.FindDetailByTokenHash(ctx, tokenHashOf("tok-2"))
		require.NoError(t, err)

		var n int
		require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM invitations WHERE workspace_id = $1`, f.ws).Scan(&n))
		assert.Equal(t, 1, n)
	})

	t.Run("期限切れの未決の行も同じ宛先として再送で復活する", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		first, err := f.invitations.Upsert(ctx, f.inviteWrite(t, f.bob, f.alice, domain.GrantRoleEditor, "tok-1"))
		require.NoError(t, err)
		_, err = sqlDB.Exec(`UPDATE invitations SET expires_at = now() - interval '1 day', last_sent_at = now() - interval '8 days', created_at = now() - interval '8 days' WHERE id = $1`, first.ID)
		require.NoError(t, err)
		_, err = f.invitations.Accept(ctx, first.ID, f.bob, f.emailOf(t, f.bob))
		assert.ErrorIs(t, err, repository.ErrInvitationNotOpen, "期限切れは承諾できない")

		revived, err := f.invitations.Upsert(ctx, f.inviteWrite(t, f.bob, f.alice, domain.GrantRoleEditor, "tok-2"))
		require.NoError(t, err)
		assert.Equal(t, first.ID, revived.ID)
		assert.True(t, revived.Open(time.Now()), "期限が延びて承諾できる")
	})

	t.Run("辞退や取消の後は同じ宛先へ新しい行を作れる", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		first := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)
		require.NoError(t, f.invitations.Decline(ctx, first.ID, f.bob, f.emailOf(t, f.bob)))
		second := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)
		assert.NotEqual(t, first.ID, second.ID)
		require.NoError(t, f.invitations.Revoke(ctx, f.ws, second.ID, f.alice))
		third := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)
		assert.NotEqual(t, second.ID, third.ID)

		list, err := f.invitations.ListByWorkspace(ctx, f.ws, 100)
		require.NoError(t, err)
		require.Len(t, list, 3)
		assert.Equal(t, third.ID, list[0].ID, "新しい順")
		assert.Equal(t, domain.InvitationStatusPending, list[0].Status(time.Now()))
		assert.Equal(t, domain.InvitationStatusRevoked, list[1].Status(time.Now()))
		assert.Equal(t, domain.InvitationStatusDeclined, list[2].Status(time.Now()))
	})

	t.Run("承諾は所属と主体と役割と監査を同じトランザクションで作る", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		inv := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleCommenter)

		accepted := f.acceptInvitation(ctx, t, inv, f.bob)
		require.NotNil(t, accepted.AcceptedAt)
		require.NotNil(t, accepted.AcceptedByUserID)
		assert.Equal(t, f.bob, *accepted.AcceptedByUserID)

		member, err := f.perm.IsWorkspaceMember(ctx, f.ws, f.bob)
		require.NoError(t, err)
		assert.True(t, member)
		principal, err := f.perm.FindUserPrincipal(ctx, f.ws, f.bob)
		require.NoError(t, err)
		var role string
		require.NoError(t, sqlDB.QueryRow(
			`SELECT role FROM workspace_grants WHERE workspace_id = $1 AND principal_id = $2`, f.ws, principal.ID,
		).Scan(&role))
		assert.Equal(t, "commenter", role, "招待の役割が張られる")
		var status string
		var invitedBy sql.NullInt64
		require.NoError(t, sqlDB.QueryRow(
			`SELECT status, invited_by_user_id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, f.ws, f.bob,
		).Scan(&status, &invitedBy))
		assert.Equal(t, "active", status)
		assert.Equal(t, int64(f.alice), invitedBy.Int64, "誰に招かれて入ったかを所属にも残す")
		events, err := f.perm.ListMembershipEvents(ctx, f.ws)
		require.NoError(t, err)
		require.NotEmpty(t, events)
		assert.Equal(t, domain.MembershipEventInvitationAccepted, events[0].Action)
		require.NotNil(t, events[0].NewLabel)
		assert.Equal(t, "commenter", *events[0].NewLabel)
	})

	t.Run("居ない人は招けず承諾もできない（users への FK）", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		w := f.inviteWrite(t, f.bob, f.alice, domain.GrantRoleEditor, "tok-ghost")
		w.ActorUserID = 999999999
		_, err := f.invitations.Upsert(ctx, w)
		assert.ErrorIs(t, err, repository.ErrUserNotFound, "invited_by / sent_by の FK 違反は「居ない人」")
		var n int
		require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM invitation_sends WHERE workspace_id = $1`, f.ws).Scan(&n))
		assert.Zero(t, n, "招待も履歴も残らない（同じトランザクション）")

		inv := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)
		require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM invitation_sends WHERE invitation_id = $1`, inv.ID).Scan(&n))
		assert.Equal(t, 1, n, "発行 1 回 = 履歴 1 行")
	})

	t.Run("承諾は宛先が違えば無いのと同じで何も書かない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		inv := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)

		_, err := f.invitations.Accept(ctx, inv.ID, f.carol, f.emailOf(t, f.carol))
		assert.ErrorIs(t, err, repository.ErrInvitationNotFound)
		_, err = f.invitations.Accept(ctx, "0198a000-0000-7000-8000-0000000000ff", f.bob, f.emailOf(t, f.bob))
		assert.ErrorIs(t, err, repository.ErrInvitationNotFound)
		_, err = f.invitations.Accept(ctx, "not-a-uuid", f.bob, f.emailOf(t, f.bob))
		assert.ErrorIs(t, err, repository.ErrInvitationNotFound)

		for _, uid := range []uint64{f.bob, f.carol} {
			member, err := f.perm.IsWorkspaceMember(ctx, f.ws, uid)
			require.NoError(t, err)
			assert.False(t, member)
		}
		_, _, acceptedBy := invitationRow(t, inv.ID)
		assert.False(t, acceptedBy.Valid, "招待は未決のまま")
	})

	t.Run("承諾済み・取消済みは二度使えない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		inv := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)
		f.acceptInvitation(ctx, t, inv, f.bob)
		_, err := f.invitations.Accept(ctx, inv.ID, f.bob, f.emailOf(t, f.bob))
		assert.ErrorIs(t, err, repository.ErrInvitationNotOpen)
		assert.ErrorIs(t, f.invitations.Decline(ctx, inv.ID, f.bob, f.emailOf(t, f.bob)), repository.ErrInvitationNotOpen)
		assert.ErrorIs(t, f.invitations.Revoke(ctx, f.ws, inv.ID, f.alice), repository.ErrInvitationNotOpen, "承諾済みは取り消せない")

		revoked := f.invite(ctx, t, f.carol, f.alice, domain.GrantRoleEditor)
		require.NoError(t, f.invitations.Revoke(ctx, f.ws, revoked.ID, f.alice))
		require.NoError(t, f.invitations.Revoke(ctx, f.ws, revoked.ID, f.alice), "取消は冪等")
		_, err = f.invitations.Accept(ctx, revoked.ID, f.carol, f.emailOf(t, f.carol))
		assert.ErrorIs(t, err, repository.ErrInvitationNotOpen)
		assert.ErrorIs(t, f.invitations.Revoke(ctx, f.otherWS, revoked.ID, f.alice), repository.ErrInvitationNotFound, "別ワークスペースからは見えない")
	})

	t.Run("辞退は期限切れでもでき監査に残る", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		inv := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)
		_, err := sqlDB.Exec(`UPDATE invitations SET created_at = now() - interval '8 days', last_sent_at = now() - interval '8 days', expires_at = now() - interval '1 minute' WHERE id = $1`, inv.ID)
		require.NoError(t, err)

		require.NoError(t, f.invitations.Decline(ctx, inv.ID, f.bob, f.emailOf(t, f.bob)))
		assert.ErrorIs(t, f.invitations.Decline(ctx, inv.ID, f.bob, f.emailOf(t, f.carol)), repository.ErrInvitationNotFound, "宛先違いは無いのと同じ")
		events, err := f.perm.ListMembershipEvents(ctx, f.ws)
		require.NoError(t, err)
		require.Len(t, events, 1)
		assert.Equal(t, domain.MembershipEventInvitationDeclined, events[0].Action)
		assert.Equal(t, f.bob, events[0].ActorUserID)
	})

	t.Run("再送は未決の行だけで間隔が要る", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		inv := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)
		refresh := func(id, token string) (*domain.Invitation, error) {
			now := time.Now()
			return f.invitations.Refresh(ctx, repository.InvitationRefresh{
				WorkspaceID: f.ws, InvitationID: id, TokenHash: tokenHashOf(token),
				ExpiresAt: now.Add(7 * 24 * time.Hour), SentBefore: now.Add(-10 * time.Minute), ActorUserID: f.carol,
			})
		}
		_, err := refresh(inv.ID, "tok-r1")
		assert.ErrorIs(t, err, repository.ErrInvitationResendTooSoon)

		f.backdateLastSent(t, inv.ID)
		resent, err := refresh(inv.ID, "tok-r1")
		require.NoError(t, err)
		assert.Equal(t, 2, resent.SendCount)
		assert.Equal(t, f.carol, resent.LastSentByUserID)
		assert.Equal(t, f.alice, resent.InvitedByUserID)
		_, err = f.invitations.FindDetailByTokenHash(ctx, tokenHashOf("tok-r1"))
		require.NoError(t, err)
		// 再送も送信履歴に 1 行残る（発行 1 + 再送 1。1 日の上限はこれを数える）。
		byCarol, err := f.invitations.CountSentBySince(ctx, f.carol, time.Now().Add(-time.Hour))
		require.NoError(t, err)
		assert.Equal(t, int64(1), byCarol)
		toBob, err := f.invitations.CountSentToEmailSince(ctx, f.emailOf(t, f.bob), time.Now().Add(-time.Hour))
		require.NoError(t, err)
		assert.Equal(t, int64(2), toBob)

		_, err = refresh("0198a000-0000-7000-8000-0000000000ff", "tok-r2")
		assert.ErrorIs(t, err, repository.ErrInvitationNotFound)
		require.NoError(t, f.invitations.Revoke(ctx, f.ws, inv.ID, f.alice))
		f.backdateLastSent(t, inv.ID)
		_, err = refresh(inv.ID, "tok-r3")
		assert.ErrorIs(t, err, repository.ErrInvitationNotOpen)
	})

	t.Run("除名されたadminの未決の招待は同じトランザクションで取り消される", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.makeAdmin(ctx, t, f.alice)
		f.makeAdmin(ctx, t, f.bob) // alice を外しても admin が残るように
		pending := f.invite(ctx, t, f.carol, f.alice, domain.GrantRoleEditor)
		accepted := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleViewer)
		// bob は既に active。承諾は役割を上書きしないが、結果（accepted）は残る。
		f.acceptInvitation(ctx, t, accepted, f.bob)

		require.NoError(t, f.perm.LeaveWorkspaceMembership(ctx, f.ws, f.alice, f.bob))

		revokedBy, _, _ := invitationRow(t, pending.ID)
		require.True(t, revokedBy.Valid, "未決の招待は止まる")
		assert.Equal(t, int64(f.bob), revokedBy.Int64, "止めたのは除名を行った人")
		revokedBy, _, _ = invitationRow(t, accepted.ID)
		assert.False(t, revokedBy.Valid, "結果が出ている行は触らない")
	})

	t.Run("降格されたadminの未決の招待も取り消され他の役割の変更では触らない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.makeAdmin(ctx, t, f.alice)
		f.makeAdmin(ctx, t, f.bob)
		pending := f.invite(ctx, t, f.carol, f.alice, domain.GrantRoleEditor)

		// admin → admin（同じ）では何も起きない。
		_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleAdmin, f.bob)
		require.NoError(t, err)
		revokedBy, _, _ := invitationRow(t, pending.ID)
		assert.False(t, revokedBy.Valid)

		// admin → editor で止まる。
		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleEditor, f.bob)
		require.NoError(t, err)
		revokedBy, _, _ = invitationRow(t, pending.ID)
		require.True(t, revokedBy.Valid)
		assert.Equal(t, int64(f.bob), revokedBy.Int64)

		// 剥奪（DeleteWorkspaceGrant）でも止まる。
		f2 := setupKBPermission(t, sqlDB)
		alice2 := f2.makeAdmin(ctx, t, f2.alice)
		f2.makeAdmin(ctx, t, f2.bob)
		pending2 := f2.invite(ctx, t, f2.carol, f2.alice, domain.GrantRoleEditor)
		require.NoError(t, f2.perm.DeleteWorkspaceGrant(ctx, f2.ws, alice2.ID, f2.bob))
		revokedBy, _, _ = invitationRow(t, pending2.ID)
		assert.True(t, revokedBy.Valid)
	})

	t.Run("自分宛の一覧は未決かつ期限内だけで全ワークスペース横断", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		open := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)
		expired := f.invite(ctx, t, f.carol, f.alice, domain.GrantRoleEditor)
		// 期限切れを作るときは created_at も過去へ動かす（ck_invitations_expires_after_created）。
		_, err := sqlDB.Exec(`UPDATE invitations SET created_at = now() - interval '8 days', last_sent_at = now() - interval '8 days', expires_at = now() - interval '1 minute' WHERE id = $1`, expired.ID)
		require.NoError(t, err)
		// 別ワークスペースからの招待も自分宛なら並ぶ。
		w := f.inviteWrite(t, f.bob, f.alice, domain.GrantRoleViewer, "tok-other")
		w.WorkspaceID = f.otherWS
		other, err := f.invitations.Upsert(ctx, w)
		require.NoError(t, err)

		mine, err := f.invitations.ListOpenByEmail(ctx, f.emailOf(t, f.bob))
		require.NoError(t, err)
		require.Len(t, mine, 2)
		assert.Equal(t, other.ID, mine[0].ID, "新しい順")
		assert.Equal(t, "perm-other", mine[0].WorkspaceSlug)
		assert.Equal(t, open.ID, mine[1].ID)
		assert.Equal(t, "perm-main", mine[1].WorkspaceSlug)
		assert.Equal(t, "alice", mine[1].InviterName)

		carols, err := f.invitations.ListOpenByEmail(ctx, f.emailOf(t, f.carol))
		require.NoError(t, err)
		assert.Empty(t, carols, "期限切れは出ない")

		n, err := f.invitations.CountOpenInWorkspace(ctx, f.ws)
		require.NoError(t, err)
		assert.Equal(t, int64(1), n, "期限切れは未決の件数に入らない")
		sent, err := f.invitations.CountSentBySince(ctx, f.alice, time.Now().Add(-time.Hour))
		require.NoError(t, err)
		assert.Equal(t, int64(3), sent, "送信履歴（invitation_sends）を数える。招待行の last_sent_at を動かしても送った事実は残る")
		toBob, err := f.invitations.CountSentToEmailSince(ctx, f.emailOf(t, f.bob), time.Now().Add(-time.Hour))
		require.NoError(t, err)
		assert.Equal(t, int64(2), toBob, "全ワークスペース横断で数える")
	})

	t.Run("同じ招待への同時承諾は1回しか通らない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		inv := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)
		email := f.emailOf(t, f.bob)

		const tries = 6
		errs := make([]error, tries)
		var wg sync.WaitGroup
		for i := 0; i < tries; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				_, errs[i] = f.invitations.Accept(ctx, inv.ID, f.bob, email)
			}(i)
		}
		wg.Wait()
		succeeded := 0
		for _, err := range errs {
			if err == nil {
				succeeded++
			} else {
				assert.ErrorIs(t, err, repository.ErrInvitationNotOpen)
			}
		}
		assert.Equal(t, 1, succeeded, "FOR UPDATE で直列化され、2 回目以降は結果が出た行を見る")
		events, err := f.perm.ListMembershipEvents(ctx, f.ws)
		require.NoError(t, err)
		assert.Len(t, events, 1, "監査も 1 行")
	})

	t.Run("DDLの制約が不正な行を弾く", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		insert := func(columns, values string, args ...any) error {
			_, err := sqlDB.Exec(`INSERT INTO invitations (`+columns+`) VALUES (`+values+`)`, args...)
			return err
		}
		base := "id, workspace_id, scope, role, email, token_hash, invited_by_user_id, expires_at, last_sent_by_user_id"
		hash := tokenHashOf("ddl")
		expires := time.Now().Add(time.Hour)
		cases := []struct {
			name, columns, values string
			args                  []any
			constraint            string
		}{
			{"未知のscope", base, "$1,$2,'team','editor','a@example.test',$3,$4,$5,$4", []any{newID(), f.ws, hash, int64(f.alice), expires}, "ck_invitations_scope"},
			{"未知のrole", base, "$1,$2,'workspace','owner','a@example.test',$3,$4,$5,$4", []any{newID(), f.ws, hash, int64(f.alice), expires}, "ck_invitations_role"},
			{"正規形でないemail", base, "$1,$2,'workspace','editor','Taro@Example.test',$3,$4,$5,$4", []any{newID(), f.ws, hash, int64(f.alice), expires}, "ck_invitations_email_normalized"},
			{"@の無いemail", base, "$1,$2,'workspace','editor','taro',$3,$4,$5,$4", []any{newID(), f.ws, hash, int64(f.alice), expires}, "ck_invitations_email_normalized"},
			{"32バイトでないtoken_hash", base, "$1,$2,'workspace','editor','a@example.test',$3,$4,$5,$4", []any{newID(), f.ws, hash[:31], int64(f.alice), expires}, "ck_invitations_token_hash_len"},
			{"workspace宛にspace_id", base + ", space_id", "$1,$2,'workspace','editor','a@example.test',$3,$4,$5,$4,$6", []any{newID(), f.ws, hash, int64(f.alice), expires, f.spaceA}, "ck_invitations_target"},
			{"space宛にspace_idが無い", base, "$1,$2,'space','editor','a@example.test',$3,$4,$5,$4", []any{newID(), f.ws, hash, int64(f.alice), expires}, "ck_invitations_target"},
			{"space宛のadmin", base + ", space_id", "$1,$2,'space','admin','a@example.test',$3,$4,$5,$4,$6", []any{newID(), f.ws, hash, int64(f.alice), expires, f.spaceA}, "ck_invitations_scoped_role_not_admin"},
			{"別テナントのspace", base + ", space_id", "$1,$2,'space','editor','a@example.test',$3,$4,$5,$4,$6", []any{newID(), f.ws, hash, int64(f.alice), expires, f.otherSpc}, "fk_invitations_space"},
			{"作った瞬間に期限切れ", base, "$1,$2,'workspace','editor','a@example.test',$3,$4,$5,$4", []any{newID(), f.ws, hash, int64(f.alice), time.Now().Add(-time.Hour)}, "ck_invitations_expires_after_created"},
			{"承諾の時刻だけで人が無い", base + ", accepted_at", "$1,$2,'workspace','editor','a@example.test',$3,$4,$5,$4,now()", []any{newID(), f.ws, hash, int64(f.alice), expires}, "ck_invitations_accepted_pair"},
			{"承諾と辞退が両方", base + ", accepted_at, accepted_by_user_id, declined_at, declined_by_user_id", "$1,$2,'workspace','editor','a@example.test',$3,$4,$5,$4,now(),$4,now(),$4", []any{newID(), f.ws, hash, int64(f.alice), expires}, "ck_invitations_single_outcome"},
			{"send_countが0", base + ", send_count", "$1,$2,'workspace','editor','a@example.test',$3,$4,$5,$4,0", []any{newID(), f.ws, hash, int64(f.alice), expires}, "ck_invitations_send_count"},
			{"居ない人が招いた", base, "$1,$2,'workspace','editor','a@example.test',$3,$4,$5,$4", []any{newID(), f.ws, hash, int64(999999999), expires}, "fk_invitations_invited_by"},
		}
		for _, c := range cases {
			t.Run(c.name, func(t *testing.T) {
				err := insert(c.columns, c.values, c.args...)
				require.Error(t, err)
				assert.ErrorContains(t, err, c.constraint)
			})
		}
		t.Run("同じ宛先x場所の未決は2件作れない", func(t *testing.T) {
			require.NoError(t, insert(base, "$1,$2,'workspace','editor','dup@example.test',$3,$4,$5,$4", newID(), f.ws, tokenHashOf("dup-1"), int64(f.alice), expires))
			err := insert(base, "$1,$2,'workspace','editor','dup@example.test',$3,$4,$5,$4", newID(), f.ws, tokenHashOf("dup-2"), int64(f.alice), expires)
			require.Error(t, err)
			assert.ErrorContains(t, err, "uq_invitations_open_target")
			// 別のスペース宛なら別の場所なので作れる。
			require.NoError(t, insert(base+", space_id", "$1,$2,'space','editor','dup@example.test',$3,$4,$5,$4,$6", newID(), f.ws, tokenHashOf("dup-3"), int64(f.alice), expires, f.spaceA))
		})
		t.Run("承諾の時刻は期限内でなければならない", func(t *testing.T) {
			err := insert(base+", accepted_at, accepted_by_user_id", "$1,$2,'workspace','editor','late@example.test',$3,$4,$5,$4,$5::timestamptz + interval '1 minute',$4", newID(), f.ws, tokenHashOf("late"), int64(f.alice), expires)
			require.Error(t, err)
			assert.ErrorContains(t, err, "ck_invitations_accepted_in_time")
		})
	})

	t.Run("ワークスペースが消えると招待も送信履歴も消え、記録の残る人は消せない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		inv := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)
		_, err := sqlDB.Exec(`DELETE FROM users WHERE id = $1`, f.alice)
		require.Error(t, err, "招いた記録が残る users 行は RESTRICT で消せない")
		assert.ErrorContains(t, err, "fk_invitation")

		_, err = sqlDB.Exec(`DELETE FROM workspaces WHERE id = $1`, f.ws)
		require.NoError(t, err)
		_, err = f.invitations.FindByID(ctx, inv.ID)
		assert.ErrorIs(t, err, repository.ErrInvitationNotFound)
		var n int
		require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM invitation_sends WHERE invitation_id = $1`, inv.ID).Scan(&n))
		assert.Zero(t, n)
	})

	t.Run("FindActiveIDByEmailは正規形で引き退会者は出ない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		users := persistence.NewUserRepository(sqlDB)
		raw := f.emailOf(t, f.bob)
		id, found, err := users.FindActiveIDByEmail(ctx, "  "+raw+" ")
		require.NoError(t, err)
		require.True(t, found)
		assert.Equal(t, f.bob, id)

		_, found, err = users.FindActiveIDByEmail(ctx, "nobody@example.test")
		require.NoError(t, err)
		assert.False(t, found)

		require.NoError(t, users.SoftDelete(ctx, f.bob))
		_, found, err = users.FindActiveIDByEmail(ctx, raw)
		require.NoError(t, err)
		assert.False(t, found, "退会した人は引かない")
	})
}
