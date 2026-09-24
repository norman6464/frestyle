//go:build integration

package persistence_test

import (
	"context"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestKnowledgeBaseProvisionWorkspace_Integration はワークスペース作成が
// 「作成者を入れたところまで」を 1 トランザクションで行うことを実 PostgreSQL で固定する。
//
// ここが崩れると誰も入れないワークスペースが残る（全経路の middleware が所属を確かめ、
// 非メンバーには 404 を返すため、作成者にも見えない）。
func TestKnowledgeBaseProvisionWorkspace_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	t.Run("作成者はメンバーになりadminになる", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		provisioner := persistence.NewWorkspaceProvisioner(sqlDB)

		ws, err := provisioner.ProvisionWorkspace(ctx, repository.WorkspaceProvisionInput{
			Slug: "brand-new", Name: "新チーム", OwnerUserID: f.alice,
		})
		require.NoError(t, err)
		require.NotEmpty(t, ws.ID)
		assert.Equal(t, "brand-new", ws.Slug)

		member, err := f.perm.IsWorkspaceMember(ctx, ws.ID, f.alice)
		require.NoError(t, err)
		assert.True(t, member, "作成者は principal を持つ（＝ メンバー）")

		facts, err := f.perm.WorkspacePermissionFactsForUser(ctx, ws.ID, f.alice)
		require.NoError(t, err)
		assert.True(t, domain.ResolveScopePermission(*facts).CanManage,
			"作成者は admin なので自分のワークスペースを設定できる")

		listed, err := f.perm.ListMemberWorkspaces(ctx, f.alice)
		require.NoError(t, err)
		require.Len(t, listed, 1)
		assert.Equal(t, ws.ID, listed[0].Workspace.ID, "作った本人の所属一覧に出る")

		// ほかの人は入れない（作成が既存のアクセスを増やさない）。
		other, err := f.perm.ListMemberWorkspaces(ctx, f.bob)
		require.NoError(t, err)
		assert.Empty(t, other)

		// 段 6・監査: 招待の手順を踏まない所属追加として member_added が 1 件残り、
		// 本人が自分自身の actor になる。
		events, err := f.perm.ListMembershipEvents(ctx, ws.ID)
		require.NoError(t, err)
		require.Len(t, events, 1)
		assert.Equal(t, domain.MembershipEventMemberAdded, events[0].Action)
		assert.Equal(t, f.alice, events[0].TargetUserID)
		assert.Equal(t, f.alice, events[0].ActorUserID)
		require.NotNil(t, events[0].NewLabel)
		assert.Equal(t, "admin", *events[0].NewLabel)
		assert.Nil(t, events[0].OldLabel)
	})

	t.Run("slugの重複は業務上の衝突として返す", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		provisioner := persistence.NewWorkspaceProvisioner(sqlDB)

		// setupKBPermission が作った "perm-main" と同じ slug。
		_, err := provisioner.ProvisionWorkspace(ctx, repository.WorkspaceProvisionInput{
			Slug: "perm-main", Name: "横取り", OwnerUserID: f.alice,
		})
		assert.ErrorIs(t, err, repository.ErrWorkspaceSlugTaken)

		member, err := f.perm.IsWorkspaceMember(ctx, f.ws, f.alice)
		require.NoError(t, err)
		assert.False(t, member, "失敗した作成が既存ワークスペースへの所属を作ってはいけない")
	})

	t.Run("個人ワークスペースの重複作成はErrPersonalWorkspaceAlreadyExists", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		provisioner := persistence.NewWorkspaceProvisioner(sqlDB)
		owner := f.alice

		_, err := provisioner.ProvisionWorkspace(ctx, repository.WorkspaceProvisionInput{
			Slug: "personal-1", Name: "個人 1", OwnerUserID: owner, PersonalOwnerUserID: &owner,
		})
		require.NoError(t, err)

		// 同じ人がもう 1 つ作ろうとすると uq_workspaces_personal_owner に当たる。
		// slug は別物なので、ErrWorkspaceSlugTaken ではなく専用エラーで区別できることを固定する。
		_, err = provisioner.ProvisionWorkspace(ctx, repository.WorkspaceProvisionInput{
			Slug: "personal-2", Name: "個人 2", OwnerUserID: owner, PersonalOwnerUserID: &owner,
		})
		assert.ErrorIs(t, err, repository.ErrPersonalWorkspaceAlreadyExists)

		var count int
		require.NoError(t, sqlDB.QueryRow(
			`SELECT count(*) FROM workspaces WHERE slug = 'personal-2'`,
		).Scan(&count))
		assert.Zero(t, count, "失敗した 2 個目の行が残ってはいけない")
	})

	t.Run("途中で失敗したらワークスペースの行も残らない", func(t *testing.T) {
		setupKBPermission(t, sqlDB)
		provisioner := persistence.NewWorkspaceProvisioner(sqlDB)

		// 存在しないユーザーを作成者にすると principals の FK で落ちる。
		// workspaces の INSERT は済んでいるので、トランザクションでなければ行が残る。
		_, err := provisioner.ProvisionWorkspace(ctx, repository.WorkspaceProvisionInput{
			Slug: "orphan", Name: "孤児", OwnerUserID: 999_999_999,
		})
		require.Error(t, err)

		var count int
		require.NoError(t, sqlDB.QueryRow(
			`SELECT count(*) FROM workspaces WHERE slug = 'orphan'`,
		).Scan(&count))
		assert.Zero(t, count, "誰も入れないワークスペースが slug だけ占有して残ってはいけない")
	})
}

// TestKnowledgeBaseCreateSpace_Integration はスペース作成を実 PostgreSQL で固定する。
func TestKnowledgeBaseCreateSpace_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	t.Run("作ったスペースは同じワークスペースから引ける", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		space := &domain.Space{WorkspaceID: f.ws, Key: "ops", Name: "運用部"}
		require.NoError(t, f.pages.CreateSpace(ctx, space))
		require.NotEmpty(t, space.ID)
		assert.False(t, space.CreatedAt.IsZero(), "DB で確定した行で上書きされる")

		got, err := f.pages.FindSpace(ctx, f.ws, space.ID)
		require.NoError(t, err)
		assert.Equal(t, "ops", got.Key)

		_, err = f.pages.FindSpace(ctx, f.otherWS, space.ID)
		assert.ErrorIs(t, err, repository.ErrSpaceNotFound, "別テナントからは引けない")
	})

	t.Run("keyの重複は同じワークスペース内でだけ衝突する", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		// setupKBPermission が f.ws に "aaa" を作っている。
		dup := &domain.Space{WorkspaceID: f.ws, Key: "aaa", Name: "重複"}
		assert.ErrorIs(t, f.pages.CreateSpace(ctx, dup), repository.ErrSpaceKeyTaken)

		// 別ワークスペースなら同じ key を使える（key はワークスペース内で一意）。
		ok := &domain.Space{WorkspaceID: f.otherWS, Key: "aaa", Name: "別テナントの同名"}
		assert.NoError(t, f.pages.CreateSpace(ctx, ok))
	})

	t.Run("存在しないワークスペースには作れない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		missing := &domain.Space{WorkspaceID: newID(), Key: "ghost", Name: "亡霊"}
		assert.ErrorIs(t, f.pages.CreateSpace(ctx, missing), repository.ErrWorkspaceNotFound)

		broken := &domain.Space{WorkspaceID: "not-a-uuid", Key: "ghost", Name: "亡霊"}
		assert.ErrorIs(t, f.pages.CreateSpace(ctx, broken), repository.ErrWorkspaceNotFound)
	})
}
