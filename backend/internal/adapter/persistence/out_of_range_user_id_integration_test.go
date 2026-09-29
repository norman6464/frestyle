//go:build integration

package persistence_test

import (
	"context"
	"database/sql"
	"math"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// decoyUserID は「巻き戻った値だけが一致する」おとりの users.id。
//
// users.id は bigint で、アプリの採番（bigserial）からは負の値は出てこない。ここで
// あえて負の行を作るのは、int64(userID) と素で変換したときに何が起きるかを
// テストから観測できるようにするため。uint64 の大きな値を int64 へ変換すると
// 必ず**負の数**へ巻き戻るので、負の id を持つ行を 1 つ置いておけば
// 「巻き戻った値が実在の行に当たる」状況を再現できる。
const decoyUserID int64 = -4242

// wrappedUserID は int64 へ素で変換すると decoyUserID になる uint64。
//
// uint64 → int64 の変換はビット列をそのまま読み替えるだけなので、
// 2^64 - 4242 は -4242 になる。この値は math.MaxInt64 を超えており、
// bigint に収まらない ＝ users のどの行の id にもなり得ない。
// にもかかわらず、素の変換を通すとおとりの行に一致してしまう。
func wrappedUserID() uint64 {
	id := decoyUserID
	return uint64(id)
}

// decoyFixture はおとりのユーザーと、その主体・役割を用意した状態。
type decoyFixture struct {
	kbPermFixture
	// principalID はおとりユーザーの主体（kind='user'）。
	principalID string
	// pageID はおとりが admin として編集できるページ。
	pageID string
}

// setupDecoy は「巻き戻った値が当たると全権が手に入る」状態を作る。
//
// おとりにはワークスペース全体の admin を張る。ここで返る値が拒否側でないと、
// 存在しないユーザー ID を名乗るだけで admin になれる＝権限昇格になる。
//
// おとりを作るのは setupKBPermission（alice / bob / carol を採番する）のあと。
// createUser は users_id_seq を max(id)+1 へ合わせ直すので、負の id が最大値の
// 状態で呼ばれるとシーケンスを負の値へ setval しようとして落ちる。
func setupDecoy(ctx context.Context, t *testing.T, sqlDB *sql.DB) decoyFixture {
	t.Helper()
	f := setupKBPermission(t, sqlDB)

	_, err := sqlDB.Exec(
		`INSERT INTO users (id, email, name, created_at, updated_at)
		 VALUES ($1, $2, 'decoy', now(), now())`,
		decoyUserID, "decoy+"+newID()+"@example.test",
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		// principals は users への FK が ON DELETE CASCADE なので
		// この 1 行を消せば派生も消える。membership_events（段 6）は記録 FK（RESTRICT）
		// なので、先にこのユーザーを指す行だけ消しておく必要がある。users は kbTables に
		// 含まれず TruncateAll では消えないため、負の id をテストの外へ残さない。
		_, cleanupErr := sqlDB.Exec(
			`DELETE FROM membership_events WHERE target_user_id = $1 OR actor_user_id = $1`, decoyUserID,
		)
		require.NoError(t, cleanupErr)
		_, cleanupErr = sqlDB.Exec(`DELETE FROM users WHERE id = $1`, decoyUserID)
		require.NoError(t, cleanupErr)
	})

	var principalID string
	require.NoError(t, sqlDB.QueryRow(
		`INSERT INTO principals (id, workspace_id, kind, user_id)
		 VALUES (gen_random_uuid(), $1, 'user', $2) RETURNING id::text`,
		f.ws, decoyUserID,
	).Scan(&principalID))

	_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, principalID, domain.GrantRoleAdmin, f.alice)
	require.NoError(t, err)
	_, err = f.perm.UpsertSpaceGrant(ctx, f.ws, f.spaceA, principalID, domain.GrantRoleAdmin)
	require.NoError(t, err)

	page := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "おとりが admin として編集できるページ")

	return decoyFixture{kbPermFixture: f, principalID: principalID, pageID: page.ID}
}

// Test_範囲外のユーザーIDが巻き戻って別人の権限にならないこと_Integration は、
// bigint に収まらない uint64 のユーザー ID が int64 へ巻き戻り、
// 別の行に一致してしまうことがないのを実 DB で固定する。
//
// なぜ危ないか: domain のユーザー ID は uint64、DB の principals.user_id は bigint（int64）。
// int64(userID) と素で書くと math.MaxInt64 を超える値の最上位ビットが符号ビットとして
// 読み替えられ、値が負数へ巻き戻る。巻き戻った値は入力とは無関係な行を指す。
// ユーザー ID は URL のパスから ParseUint(..., 10, 64) で受けるので、
// 2^63 以上の値を利用者が指定できる。
//
// なぜ読み取りは「該当なし」で正しいか: bigint に収まらない id を持つユーザーは
// users に存在し得ない。つまりクエリを投げても必ず 0 行になる入力なので、
// 0 行のときと同じ値を返すのが正しい。
//
// なぜ拒否側へ倒すか: ここで「許可」側（メンバーである・役割を持つ・閲覧できる）を
// 返すと、存在しないユーザー ID を名乗るだけで権限が湧く＝権限昇格になる。
func Test_範囲外のユーザーIDが巻き戻って別人の権限にならないこと_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	t.Run("前提: 巻き戻り先のおとりは実在し全権を持つ", func(t *testing.T) {
		f := setupDecoy(ctx, t, sqlDB)

		// 素の変換なら当たってしまう値であることを、テスト自身が示しておく。
		require.Greater(t, wrappedUserID(), uint64(math.MaxInt64),
			"検証に使う ID は bigint の範囲外であること")
		//nolint:gosec // 巻き戻りを再現するのがこのテストの目的
		require.Equal(t, decoyUserID, int64(wrappedUserID()),
			"素の int64 変換でおとりの id へ巻き戻ること")

		// おとりが admin であることを SQL 側で確かめる。これが成り立っていないと
		// 以下の「拒否側に倒れている」という主張が空振りになる。
		var role string
		require.NoError(t, sqlDB.QueryRow(
			`SELECT wg.role FROM workspace_grants wg
			  JOIN principals p ON p.workspace_id = wg.workspace_id AND p.id = wg.principal_id
			 WHERE wg.workspace_id = $1 AND p.user_id = $2`, f.ws, decoyUserID,
		).Scan(&role))
		assert.Equal(t, string(domain.GrantRoleAdmin), role)
	})

	t.Run("所属判定は非メンバーへ倒れる", func(t *testing.T) {
		f := setupDecoy(ctx, t, sqlDB)

		member, err := f.perm.IsWorkspaceMember(ctx, f.ws, wrappedUserID())

		require.NoError(t, err)
		assert.False(t, member, "巻き戻った値でおとりの所属を拾わないこと")
	})

	t.Run("複数人版の所属判定も巻き戻った値をおとりへ一致させない", func(t *testing.T) {
		f := setupDecoy(ctx, t, sqlDB)

		out, err := f.perm.IsWorkspaceMemberBulk(ctx, f.ws, []uint64{wrappedUserID(), f.alice})

		require.NoError(t, err)
		assert.False(t, out[wrappedUserID()], "巻き戻った値でおとりの所属を拾わないこと")
		assert.NotContains(t, out, wrappedUserID(), "非メンバーはキーごと出ない")
	})

	t.Run("主体の取得はnot foundへ倒れる", func(t *testing.T) {
		f := setupDecoy(ctx, t, sqlDB)

		_, err := f.perm.FindUserPrincipal(ctx, f.ws, wrappedUserID())

		assert.ErrorIs(t, err, repository.ErrPrincipalNotFound,
			"0 行のときと同じ not found を返すこと")
	})

	t.Run("所属ワークスペースの一覧は0件になる", func(t *testing.T) {
		f := setupDecoy(ctx, t, sqlDB)

		got, err := f.perm.ListMemberWorkspaces(ctx, wrappedUserID())

		require.NoError(t, err)
		assert.NotNil(t, got, "0 件でも nil スライスを返さないこと")
		assert.Empty(t, got, "テナントを跨いで読む唯一の口が別人の所属を返さないこと")
	})

	t.Run("ページの実効権限は閲覧も編集も不可になる", func(t *testing.T) {
		f := setupDecoy(ctx, t, sqlDB)

		facts, err := f.perm.PagePermissionFactsForUser(ctx, f.ws, f.pageID, wrappedUserID())

		require.NoError(t, err)
		perm := domain.ResolvePagePermission(*facts)
		assert.False(t, perm.CanView, "おとりの admin を引き継がないこと")
		assert.False(t, perm.CanEdit)
		assert.False(t, facts.Member, "メンバー扱いにしないこと")
		assert.Nil(t, facts.Role, "役割を持たせないこと")
	})

	t.Run("閲覧できるページの一覧は0件になる", func(t *testing.T) {
		f := setupDecoy(ctx, t, sqlDB)

		rows, err := f.perm.ListSpacePageViewFacts(ctx, f.ws, f.spaceA, wrappedUserID(), false)

		require.NoError(t, err)
		assert.NotNil(t, rows, "0 件でも nil スライスを返さないこと")
		assert.Empty(t, rows, "見えないページのタイトルを渡さないこと")

		// usecase まで通しても 1 枚も見えないこと（ふるいの前で漏れていないか）。
		pages := f.viewablePageIDs(ctx, t, f.spaceA, wrappedUserID())
		assert.Empty(t, pages)
	})

	t.Run("スペースの実効権限はすべて不可になる", func(t *testing.T) {
		f := setupDecoy(ctx, t, sqlDB)

		facts, err := f.perm.SpacePermissionFactsForUser(ctx, f.ws, f.spaceA, wrappedUserID())

		require.NoError(t, err)
		perm := domain.ResolveScopePermission(*facts)
		assert.False(t, perm.CanView)
		assert.False(t, perm.CanEdit)
		assert.False(t, perm.CanManage, "権限そのものを書き換えられる側へ倒さないこと")
	})

	t.Run("ワークスペースの実効権限はすべて不可になる", func(t *testing.T) {
		f := setupDecoy(ctx, t, sqlDB)

		facts, err := f.perm.WorkspacePermissionFactsForUser(ctx, f.ws, wrappedUserID())

		require.NoError(t, err)
		perm := domain.ResolveScopePermission(*facts)
		assert.False(t, perm.CanView)
		assert.False(t, perm.CanEdit)
		assert.False(t, perm.CanManage, "権限そのものを書き換えられる側へ倒さないこと")
	})

	t.Run("サブツリーの一括編集は許可されない", func(t *testing.T) {
		f := setupDecoy(ctx, t, sqlDB)

		rows, err := f.perm.ListSubtreePagePermissionFacts(ctx, f.ws, f.pageID, wrappedUserID())
		require.NoError(t, err)
		assert.NotNil(t, rows, "0 件でも nil スライスを返さないこと")
		assert.Empty(t, rows)

		// 呼び出し側は 0 行を「許可には倒さない」と決めているので false になる。
		ok, err := kb.NewCanEditPageSubtreeUseCase(f.perm).Execute(ctx,
			kb.CanEditPageSubtreeInput{WorkspaceID: f.ws, PageID: f.pageID, UserID: wrappedUserID()})
		require.NoError(t, err)
		assert.False(t, ok)
	})

	t.Run("メンバー追加は成功を返さない", func(t *testing.T) {
		f := setupDecoy(ctx, t, sqlDB)

		_, err := f.perm.EnsureUserPrincipal(ctx, f.ws, wrappedUserID())

		// 巻き戻ればおとりの主体が「既にある」として返ってしまう。1 行も書けていない
		// のに成功を返さないこと（実在し得ないユーザーなので not found と同じ扱い）。
		require.Error(t, err)
		assert.ErrorIs(t, err, repository.ErrUserNotFound)
	})

	t.Run("ページ作成は成功を返さない", func(t *testing.T) {
		f := setupDecoy(ctx, t, sqlDB)
		before := countPages(t, sqlDB, f.ws)

		err := f.pages.CreatePage(ctx, &domain.Page{
			// position は既存のルートページ（fixture が採番したもの）と衝突しない値にする。
			// 衝突すると uq_pages_space_position で落ち、変換の検査を通ったかどうかに
			// 関わらずエラーになってしまい、この検証が空振りする。
			WorkspaceID: f.ws, SpaceID: f.spaceA, Position: "zzz9",
			Title: "巻き戻った作成者", CreatedByUserID: wrappedUserID(),
		})

		// int64 の範囲に収まらない値は toInt64ID がアプリ側で弾く（段 1 で追加した
		// pages.created_by_user_id への FK に頼らず、そもそも DB まで届かない）。
		require.Error(t, err)
		assert.Equal(t, before, countPages(t, sqlDB, f.ws), "1 行も書かれていないこと")
	})

	t.Run("ワークスペース作成は成功を返さない", func(t *testing.T) {
		f := setupDecoy(ctx, t, sqlDB)
		slug := "wrapped-owner-" + newID()[:8]

		_, err := persistence.NewWorkspaceProvisioner(f.db).ProvisionWorkspace(ctx,
			repository.WorkspaceProvisionInput{Slug: slug, Name: "n", OwnerUserID: wrappedUserID()})

		// 巻き戻るとおとりが FK を満たし、おとりを admin とするワークスペースが実際にできる。
		require.Error(t, err)
		var n int
		require.NoError(t, sqlDB.QueryRow(
			`SELECT count(*) FROM workspaces WHERE slug = $1`, slug,
		).Scan(&n))
		assert.Zero(t, n, "1 行も書かれていないこと")
	})
}

// countPages はワークスペース内のページ数を返す。
func countPages(t *testing.T, db *sql.DB, workspaceID string) int {
	t.Helper()
	var n int
	require.NoError(t, db.QueryRow(
		`SELECT count(*) FROM pages WHERE workspace_id = $1`, workspaceID,
	).Scan(&n))
	return n
}

// Test_範囲外のユーザーIDの通知は0件を返すこと_Integration は、通知の一覧が
// 巻き戻った user_id で別ユーザー宛の通知を返さないことを固定する。
//
// notifications.user_id は段 1 で users への FK（fk_notifications_user、持ち物・CASCADE）を
// 持つため、setupDecoy と同じくおとりの users 行を先に置いてから通知を作る。
func Test_範囲外のユーザーIDの通知は0件を返すこと_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	testsupport.TruncateAll(t, sqlDB, "notifications", "users", "user_oidc_identities")
	_, err := sqlDB.Exec(
		`INSERT INTO users (id, email, name, created_at, updated_at)
		 VALUES ($1, $2, 'decoy', now(), now())`,
		decoyUserID, "decoy+"+newID()+"@example.test",
	)
	require.NoError(t, err)
	_, err = sqlDB.Exec(
		`INSERT INTO notifications (user_id, type, title, body, is_read, created_at)
		 VALUES ($1, 'info', 't', 'b', false, now())`, decoyUserID,
	)
	require.NoError(t, err)

	got, err := persistence.NewNotificationRepository(sqlDB).ListByUserID(ctx, wrappedUserID())

	require.NoError(t, err)
	assert.NotNil(t, got, "0 件でも nil スライスを返さないこと")
	assert.Empty(t, got, "巻き戻った user_id で別ユーザー宛の通知を拾わないこと")
}
