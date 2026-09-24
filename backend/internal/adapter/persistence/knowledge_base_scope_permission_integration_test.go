//go:build integration

package persistence_test

import (
	"context"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// scopeOf は入れ物（スペース）1 つの実効権限を解いて返す。
// 事実の収集（SQL）→ 規則の適用（domain）の 2 段を、本番と同じ順で通す小道具。
func scopeOf(ctx context.Context, t *testing.T, f kbPermFixture, spaceID string, userID uint64) domain.ScopePermission {
	t.Helper()
	facts, err := f.perm.SpacePermissionFactsForUser(ctx, f.ws, spaceID, userID)
	require.NoError(t, err)
	return domain.ResolveScopePermission(*facts)
}

// workspaceScopeOf はワークスペースそのものの実効権限を解いて返す。
func workspaceScopeOf(ctx context.Context, t *testing.T, f kbPermFixture, userID uint64) domain.ScopePermission {
	t.Helper()
	facts, err := f.perm.WorkspacePermissionFactsForUser(ctx, f.ws, userID)
	require.NoError(t, err)
	return domain.ResolveScopePermission(*facts)
}

// TestKnowledgeBaseScopePermission_Integration はページを介さない権限照会
// （スペース / ワークスペース単位）を実 PostgreSQL で固定する。
//
// この口は「対象がまだ存在しない操作」（空のスペースへの最初のページ作成 / スペースの作成）
// のためにあり、ページ単位の付与（page_grants）を見ない。見ないこと自体が正しい設計だが、
// 見ないまま**ページを名指しする操作**に使うと必ず狭い側へ倒れるので、
// 「ページ単位の答えと食い違わないこと」と「食い違ってよい範囲」の両方をここで固定する。
func TestKnowledgeBaseScopePermission_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	t.Run("非メンバーは何もできない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)

		assert.Equal(t, domain.ScopePermission{}, scopeOf(ctx, t, f, f.spaceA, f.alice),
			"principal が無い相手には役割が 1 つも届かない")
		assert.Equal(t, domain.ScopePermission{}, workspaceScopeOf(ctx, t, f, f.alice))
	})

	t.Run("所属しただけで役割が無ければ何もできない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.principalFor(ctx, t, f.alice)

		assert.Equal(t, domain.ScopePermission{}, scopeOf(ctx, t, f, f.spaceA, f.alice),
			"所属は入口であって権限ではない（grant が無ければ空）")
	})

	t.Run("ワークスペースのgrantは配下の全スペースに届く", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleEditor, f.alice)
		require.NoError(t, err)

		for _, space := range []string{f.spaceA, f.spaceB} {
			perm := scopeOf(ctx, t, f, space, f.alice)
			assert.True(t, perm.CanEdit, "grant を張っていないスペースにも届く")
			assert.False(t, perm.CanManage)
		}
	})

	t.Run("スペースとワークスペースの強い方が効く", func(t *testing.T) {
		cases := []struct {
			name      string
			workspace domain.GrantRole
			space     domain.GrantRole
			wantEdit  bool
			wantAdmin bool
		}{
			{name: "スペースの方が強い", workspace: domain.GrantRoleViewer, space: domain.GrantRoleEditor, wantEdit: true},
			{name: "ワークスペースの方が強い", workspace: domain.GrantRoleAdmin, space: domain.GrantRoleViewer, wantEdit: true, wantAdmin: true},
			{name: "どちらも弱い", workspace: domain.GrantRoleViewer, space: domain.GrantRoleCommenter},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				f := setupKBPermission(t, sqlDB)
				alice := f.principalFor(ctx, t, f.alice)
				_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, tc.workspace, f.alice)
				require.NoError(t, err)
				f.grantSpace(ctx, t, f.spaceA, alice.ID, tc.space)

				perm := scopeOf(ctx, t, f, f.spaceA, f.alice)
				assert.True(t, perm.CanView)
				assert.Equal(t, tc.wantEdit, perm.CanEdit,
					"弱い方を採るとスペースに viewer を張るだけでワークスペース管理者を締め出せてしまう")
				assert.Equal(t, tc.wantAdmin, perm.CanManage)
			})
		}
	})

	t.Run("グループ経由の役割も届く", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		f.principalFor(ctx, t, f.bob)
		group, err := f.perm.CreateGroupPrincipal(ctx, f.ws, "開発チーム")
		require.NoError(t, err)
		require.NoError(t, f.perm.AddGroupMember(ctx, f.ws, group.ID, alice.ID))
		f.grantSpace(ctx, t, f.spaceA, group.ID, domain.GrantRoleEditor)

		assert.True(t, scopeOf(ctx, t, f, f.spaceA, f.alice).CanEdit, "グループの役割が本人に届く")
		assert.False(t, scopeOf(ctx, t, f, f.spaceA, f.bob).CanEdit, "グループ外には届かない")
		assert.False(t, scopeOf(ctx, t, f, f.spaceB, f.alice).CanEdit, "別スペースには届かない")

		// 抜けた瞬間に効かなくなる。
		require.NoError(t, f.perm.RemoveGroupMember(ctx, f.ws, group.ID, alice.ID))
		assert.False(t, scopeOf(ctx, t, f, f.spaceA, f.alice).CanEdit)
	})

	t.Run("グループ経由の役割はワークスペース単位の判定にも届く", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		group, err := f.perm.CreateGroupPrincipal(ctx, f.ws, "管理チーム")
		require.NoError(t, err)
		require.NoError(t, f.perm.AddGroupMember(ctx, f.ws, group.ID, alice.ID))
		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, group.ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)

		assert.True(t, workspaceScopeOf(ctx, t, f, f.alice).CanManage)
		assert.False(t, workspaceScopeOf(ctx, t, f, f.bob).CanManage)
	})

	t.Run("スペース全員の主体経由の役割も届く", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.principalFor(ctx, t, f.alice)
		everyone := f.everyoneOf(ctx, t, f.spaceA)
		f.grantSpace(ctx, t, f.spaceA, everyone.ID, domain.GrantRoleEditor)

		assert.True(t, scopeOf(ctx, t, f, f.spaceA, f.alice).CanEdit, "そのスペースの全員に届く")
		assert.False(t, scopeOf(ctx, t, f, f.spaceB, f.alice).CanEdit, "別スペースの全員には届かない")

		// 非メンバーには届かない。「全員」はワークスペースのメンバーの中の全員という意味。
		assert.False(t, scopeOf(ctx, t, f, f.spaceA, f.bob).CanEdit,
			"所属していない相手にスペース全員の役割が届いてはいけない")
	})

	t.Run("スペース全員の主体はワークスペース単位の判定には数えない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.principalFor(ctx, t, f.alice)
		everyone := f.everyoneOf(ctx, t, f.spaceA)
		_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws, everyone.ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)

		assert.False(t, workspaceScopeOf(ctx, t, f, f.alice).CanManage,
			"どこか 1 つのスペースの全員に張った grant がテナント全体の権限に化けてはいけない")
		assert.True(t, scopeOf(ctx, t, f, f.spaceA, f.alice).CanManage,
			"そのスペースの中では効く（届く先はスペースに閉じる）")
	})

	t.Run("別テナントのスペースIDでは役割を返さない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)

		// f.otherSpc は別ワークスペースのスペース。実在は確かめるが、このテナントのものではない。
		_, err = f.perm.SpacePermissionFactsForUser(ctx, f.ws, f.otherSpc, f.alice)
		assert.ErrorIs(t, err, repository.ErrSpaceNotFound,
			"実在を確かめずに役割だけ集めると、ワークスペースの grant が他テナントのスペースに届いてしまう")

		_, err = f.perm.SpacePermissionFactsForUser(ctx, f.ws, newID(), f.alice)
		assert.ErrorIs(t, err, repository.ErrSpaceNotFound, "存在しないスペースも同じ扱い")

		_, err = f.perm.SpacePermissionFactsForUser(ctx, f.ws, "not-a-uuid", f.alice)
		assert.ErrorIs(t, err, repository.ErrSpaceNotFound, "形が UUID でない ID も同じ扱い")
	})

	t.Run("スペース単位とページ単位の答えはページ付与が無ければ一致する", func(t *testing.T) {
		// スペースの判定（役割の集合を domain が畳む）とページの判定（SQL が強さを返す）は
		// 実装が別なので、同じ既定に対して同じ答えになることを役割ごとに固定する。
		// ここが割れると「ページは編集できるのに直下に作れない」（逆も）になる。
		for _, role := range domain.ValidGrantRoles {
			t.Run(string(role), func(t *testing.T) {
				f := setupKBPermission(t, sqlDB)
				alice := f.principalFor(ctx, t, f.alice)
				f.grantSpace(ctx, t, f.spaceA, alice.ID, role)
				page := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "root")

				scope := scopeOf(ctx, t, f, f.spaceA, f.alice)
				pagePerm := f.permFor(ctx, t, page.ID, f.alice)

				assert.Equal(t, pagePerm.CanView, scope.CanView, "閲覧の答えが経路で割れている")
				assert.Equal(t, pagePerm.CanEdit, scope.CanEdit, "編集の答えが経路で割れている")
			})
		}
	})

	t.Run("スペース単位の答えはページ付与を見ない", func(t *testing.T) {
		// この口の限界をそのまま固定する。ページに付与を張ってもスペースの答えは変わらない
		// （ページ付与を集めていないため）。倒れる向きは常に狭い側なので、この口だけを見て
		// 「編集できない」と断ってはいけない — **ページを名指しする操作には使わない**。
		// 呼び出し側がそれを守っていることは handler の結合テストが確かめる。
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)
		page := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "root")
		f.grantPage(ctx, t, page.ID, alice.ID, domain.GrantRoleEditor)

		assert.True(t, f.permFor(ctx, t, page.ID, f.alice).CanEdit, "ページ単位ではページ付与が効く")
		scope := scopeOf(ctx, t, f, f.spaceA, f.alice)
		assert.True(t, scope.CanView, "スペースの既定（viewer）はそのまま返る")
		assert.False(t, scope.CanEdit,
			"スペース単位はページ付与を見ない（見ていない事実を答えに混ぜないための設計）")
	})
}

// TestKnowledgeBaseMemberWorkspaces_Integration は所属ワークスペース一覧を実 PostgreSQL で固定する。
// ナレッジで唯一テナントを跨いで読む口なので、絞り込みが緩むと全テナントが漏れる。
func TestKnowledgeBaseMemberWorkspaces_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	t.Run("所属しているものだけをslug順で返す", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		// slug が昇順にならない順で所属させ、並びがクエリ側で決まることを見る。
		_, err := f.perm.EnsureUserPrincipal(ctx, f.otherWS, f.alice)
		require.NoError(t, err)
		_, err = f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)

		got, err := f.perm.ListMemberWorkspaces(ctx, f.alice)
		require.NoError(t, err)
		require.Len(t, got, 2)
		assert.Equal(t, "perm-main", got[0].Workspace.Slug)
		assert.Equal(t, "perm-other", got[1].Workspace.Slug)
	})

	t.Run("所属していないワークスペースは漏らさない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		_, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)
		// bob は別テナントだけ。alice の一覧に混ざってはいけない。
		_, err = f.perm.EnsureUserPrincipal(ctx, f.otherWS, f.bob)
		require.NoError(t, err)

		got, err := f.perm.ListMemberWorkspaces(ctx, f.alice)
		require.NoError(t, err)
		require.Len(t, got, 1)
		assert.Equal(t, "perm-main", got[0].Workspace.Slug)

		none, err := f.perm.ListMemberWorkspaces(ctx, f.carol)
		require.NoError(t, err)
		assert.Empty(t, none, "どこにも所属していなければ 0 件")
	})

	t.Run("ユーザー以外の主体は所属として数えない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		// グループやスペース全員の主体は「誰かの所属」ではない。
		_, err := f.perm.CreateGroupPrincipal(ctx, f.ws, "開発チーム")
		require.NoError(t, err)
		_, err = f.perm.EnsureSpaceEveryonePrincipal(ctx, f.ws, f.spaceA)
		require.NoError(t, err)

		got, err := f.perm.ListMemberWorkspaces(ctx, f.alice)
		require.NoError(t, err)
		assert.Empty(t, got)
	})

	t.Run("所属を消すと一覧から消える", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		principal, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)
		require.NoError(t, f.perm.DeletePrincipal(ctx, f.ws, principal.ID))

		got, err := f.perm.ListMemberWorkspaces(ctx, f.alice)
		require.NoError(t, err)
		assert.Empty(t, got, "所属は principals の行が唯一の表現")
	})

	// 停止中のワークスペースは一覧に出さない。個々の解決（slug / id）が「無いもの」として
	// 扱うのに一覧にだけ残ると、開けない行が並ぶだけで意味が無い。
	//
	// 変異確認: ListMemberWorkspaces の SQL から `AND w.is_active = true` を外すと、
	// このテストの Len(got, 1) が 2 に増えて落ちる。
	t.Run("停止中のワークスペースは一覧に出ない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		_, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)
		_, err = f.perm.EnsureUserPrincipal(ctx, f.otherWS, f.alice)
		require.NoError(t, err)
		_, err = sqlDB.Exec(`UPDATE workspaces SET is_active = false WHERE id = $1`, f.otherWS)
		require.NoError(t, err)

		got, err := f.perm.ListMemberWorkspaces(ctx, f.alice)
		require.NoError(t, err)
		require.Len(t, got, 1, "停止した perm-other は落ちる")
		assert.Equal(t, "perm-main", got[0].Workspace.Slug)
	})

	// 一覧が返すのは役割の事実で、何ができるかは domain が決める。1 件ずつの判定
	// （WorkspacePermissionFactsForUser）と同じ主体（自分自身 + 所属グループ）を集めているかを、
	// 解いた結果で確かめる。
	t.Run("役割の事実を返し1件ずつの判定と同じ結果に解ける", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)
		bob := f.principalFor(ctx, t, f.bob)
		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, bob.ID, domain.GrantRoleEditor, f.bob)
		require.NoError(t, err)
		// carol は所属だけで grant が無い（LEFT JOIN が一致しない側）。role が NULL の行を
		// 落ちずに畳み、役割なしの 1 件として返すことを見る。
		f.principalFor(ctx, t, f.carol)

		for _, tc := range []struct {
			name      string
			userID    uint64
			canEdit   bool
			canManage bool
		}{
			{"admin grant を持つ本人", f.alice, true, true},
			{"editor grant は作成できるが管理はできない", f.bob, true, false},
			{"grant が無い所属は何もできない", f.carol, false, false},
		} {
			got, err := f.perm.ListMemberWorkspaces(ctx, tc.userID)
			require.NoError(t, err)
			require.Len(t, got, 1, tc.name)
			perm := domain.ResolveScopePermission(got[0].Facts)
			assert.Equal(t, tc.canEdit, perm.CanEdit, tc.name)
			assert.Equal(t, tc.canManage, perm.CanManage, tc.name)

			one, err := f.perm.WorkspacePermissionFactsForUser(ctx, f.ws, tc.userID)
			require.NoError(t, err)
			assert.Equal(t, domain.ResolveScopePermission(*one), perm, "1 件ずつの判定と一致する: "+tc.name)
		}
	})

	// 所属グループ宛ての grant も一覧に届く。ワークスペースの削除やチケットの作成は 1 件ずつの
	// 判定でグループを数えるので、一覧だけが本人宛てしか見ないと「操作できるのにボタンが出ない」。
	//
	// 変異確認: SQL の mine からグループの UNION を外すと、このテストの CanManage が false になって落ちる。
	t.Run("所属グループ宛ての役割も届き1件に畳まれる", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleViewer, f.alice)
		require.NoError(t, err)
		group, err := f.perm.CreateGroupPrincipal(ctx, f.ws, "管理チーム")
		require.NoError(t, err)
		require.NoError(t, f.perm.AddGroupMember(ctx, f.ws, group.ID, alice.ID))
		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, group.ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)

		got, err := f.perm.ListMemberWorkspaces(ctx, f.alice)
		require.NoError(t, err)
		require.Len(t, got, 1, "役割が 2 つ届いてもワークスペースは 1 件")
		assert.ElementsMatch(t, []domain.GrantRole{domain.GrantRoleViewer, domain.GrantRoleAdmin}, got[0].Facts.Roles)
		assert.True(t, domain.ResolveScopePermission(got[0].Facts).CanManage)
	})
}
