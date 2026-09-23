//go:build integration

package persistence_test

import (
	"context"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMembershipEvents_Integration は段 6（監査）の書き込み経路を実 PostgreSQL で固定する。
// membership_events は「なぜこの人が今の役割・所属になっているか」を後から説明するための
// 追記専用の記録なので、ここでは「対象の書き込みと同じトランザクションで、正しい
// action・target・actor・old/new label が 1 行ずつ残ること」だけを見る
// （合成・実効権限の規則そのものは TestKnowledgeBasePermission_Integration が持つ）。
func TestMembershipEvents_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	// lastEvent はそのワークスペースの直近 1 件を返す（新しい順で先頭）。
	lastEvent := func(t *testing.T, f kbPermFixture) domain.MembershipEvent {
		t.Helper()
		events, err := f.perm.ListMembershipEvents(ctx, f.ws)
		require.NoError(t, err)
		require.NotEmpty(t, events, "記録が無い")
		return events[0]
	}

	t.Run("招待の発行は所属の変化ではないので記録しない", func(t *testing.T) {
		// 招待そのもの（誰がいつ誰を招いたか）は invitations 表が持つ。membership_events は
		// 「この人がなぜ今の所属・役割か」の記録なので、承諾して初めて 1 行残る。
		f := setupKBPermission(t, sqlDB)
		f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)

		events, err := f.perm.ListMembershipEvents(ctx, f.ws)
		require.NoError(t, err)
		assert.Empty(t, events)
	})

	t.Run("承諾は本人がactorで新ラベルは招待の役割", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.acceptInvitation(ctx, t, f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor), f.bob)

		e := lastEvent(t, f)
		assert.Equal(t, domain.MembershipEventInvitationAccepted, e.Action)
		assert.Equal(t, f.bob, e.TargetUserID)
		assert.Equal(t, f.bob, e.ActorUserID, "承諾は本人の操作")
		assert.Nil(t, e.OldLabel)
		require.NotNil(t, e.NewLabel)
		assert.Equal(t, "editor", *e.NewLabel)
	})

	t.Run("辞退は本人がactorで新旧ラベルとも空", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		inv := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)
		require.NoError(t, f.invitations.Decline(ctx, inv.ID, f.bob, f.emailOf(t, f.bob)))

		e := lastEvent(t, f)
		assert.Equal(t, domain.MembershipEventInvitationDeclined, e.Action)
		assert.Equal(t, f.bob, e.TargetUserID)
		assert.Equal(t, f.bob, e.ActorUserID)
		assert.Nil(t, e.OldLabel)
		assert.Nil(t, e.NewLabel)
	})

	t.Run("自分で退出するとleftで自分がactor旧ラベルは退出前の役割", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.acceptInvitation(ctx, t, f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor), f.bob)

		require.NoError(t, f.perm.LeaveWorkspaceMembership(ctx, f.ws, f.bob, f.bob))

		e := lastEvent(t, f)
		assert.Equal(t, domain.MembershipEventLeft, e.Action)
		assert.Equal(t, f.bob, e.TargetUserID)
		assert.Equal(t, f.bob, e.ActorUserID)
		require.NotNil(t, e.OldLabel)
		assert.Equal(t, "editor", *e.OldLabel, "受諾で付いた既定の役割")
		assert.Nil(t, e.NewLabel)
	})

	t.Run("adminが外すとmember_removedで外した人がactor", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.acceptInvitation(ctx, t, f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor), f.bob)

		require.NoError(t, kb.NewRemoveWorkspaceMemberUseCase(f.perm).Execute(ctx, kb.RemoveWorkspaceMemberInput{
			WorkspaceID: f.ws, UserID: f.bob, ActorUserID: f.alice,
		}))

		e := lastEvent(t, f)
		assert.Equal(t, domain.MembershipEventMemberRemoved, e.Action)
		assert.Equal(t, f.bob, e.TargetUserID)
		assert.Equal(t, f.alice, e.ActorUserID, "外した alice が actor")
	})

	t.Run("非メンバーの退出は何も変わっていないので記録しない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		require.NoError(t, f.perm.LeaveWorkspaceMembership(ctx, f.ws, f.bob, f.alice))

		events, err := f.perm.ListMembershipEvents(ctx, f.ws)
		require.NoError(t, err)
		assert.Empty(t, events)
	})

	t.Run("役割の変更は旧役割と新役割の両方を残す", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleViewer, f.alice)
		require.NoError(t, err)

		_, err = kb.NewGrantWorkspaceRoleUseCase(f.perm).Execute(ctx, kb.GrantWorkspaceRoleInput{
			WorkspaceID: f.ws, PrincipalID: alice.ID, Role: domain.GrantRoleEditor, ActorUserID: f.bob,
		})
		require.NoError(t, err)

		e := lastEvent(t, f)
		assert.Equal(t, domain.MembershipEventRoleChanged, e.Action)
		assert.Equal(t, f.alice, e.TargetUserID)
		assert.Equal(t, f.bob, e.ActorUserID)
		require.NotNil(t, e.OldLabel)
		assert.Equal(t, "viewer", *e.OldLabel)
		require.NotNil(t, e.NewLabel)
		assert.Equal(t, "editor", *e.NewLabel)
	})

	t.Run("同じ役割への張り直しは実質変化が無いので記録しない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleEditor, f.alice)
		require.NoError(t, err)
		events, err := f.perm.ListMembershipEvents(ctx, f.ws)
		require.NoError(t, err)
		require.Len(t, events, 1)

		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleEditor, f.alice)
		require.NoError(t, err)
		events, err = f.perm.ListMembershipEvents(ctx, f.ws)
		require.NoError(t, err)
		assert.Len(t, events, 1, "editor → editor は変化が無い")
	})

	t.Run("役割の剥奪は新ラベルが空になる", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)
		// 取り消す前に別の admin を用意する（0 人になる取り消しは repository が断る）。
		bob := f.principalFor(ctx, t, f.bob)
		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, bob.ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)

		require.NoError(t, kb.NewRevokeWorkspaceRoleUseCase(f.perm).Execute(ctx, kb.RevokeWorkspaceRoleInput{
			WorkspaceID: f.ws, PrincipalID: alice.ID, ActorUserID: f.bob,
		}))

		e := lastEvent(t, f)
		assert.Equal(t, domain.MembershipEventRoleChanged, e.Action)
		assert.Equal(t, f.alice, e.TargetUserID)
		assert.Equal(t, f.bob, e.ActorUserID)
		require.NotNil(t, e.OldLabel)
		assert.Equal(t, "admin", *e.OldLabel)
		assert.Nil(t, e.NewLabel)
	})

	t.Run("グループやスペース全員への付与は人でないので記録しない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		group, err := f.perm.CreateGroupPrincipal(ctx, f.ws, "開発チーム")
		require.NoError(t, err)
		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, group.ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)

		everyone := f.everyoneOf(ctx, t, f.spaceA)
		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, everyone.ID, domain.GrantRoleViewer, f.alice)
		require.NoError(t, err)

		events, err := f.perm.ListMembershipEvents(ctx, f.ws)
		require.NoError(t, err)
		assert.Empty(t, events, "group / space_all は特定の 1 人を指さないので対象外")
	})

	t.Run("別テナントの記録は混ざらない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.acceptInvitation(ctx, t, f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor), f.bob)

		otherEvents, err := f.perm.ListMembershipEvents(ctx, f.otherWS)
		require.NoError(t, err)
		assert.Empty(t, otherEvents)
	})

	t.Run("ワークスペースを消すと記録も一緒に消える", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.acceptInvitation(ctx, t, f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor), f.bob)
		events, err := f.perm.ListMembershipEvents(ctx, f.ws)
		require.NoError(t, err)
		require.NotEmpty(t, events)

		_, err = f.db.Exec(`DELETE FROM workspace_members WHERE workspace_id = $1`, f.ws)
		require.NoError(t, err)
		_, err = f.db.Exec(`DELETE FROM workspaces WHERE id = $1`, f.ws)
		require.NoError(t, err)

		var remaining int
		require.NoError(t, sqlDB.QueryRow(
			`SELECT count(*) FROM membership_events WHERE workspace_id = $1`, f.ws,
		).Scan(&remaining))
		assert.Zero(t, remaining, "workspace_id の CASCADE で一緒に消える")
	})
}
