//go:build integration

package persistence_test

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/kb"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// createUser は users に 1 行入れて id を返す。principals は users へ FK を持つため、
// 権限の結合テストは実在するユーザーを前提にする。骨格側のテストが created_by_user_id に
// 固定値（1 等）を使えるのは、testsupport.OpenTestDB が段 1 で用意する小さい連番の
// ベースラインユーザー（ensureBaselineTestUsers）が実在するため。
//
// users は kbTables に含めない（ほかの結合テストと共有するため消さない）。代わりに毎回
// 一意なアドレスで作る。users には有効なユーザーのメールを一意にする部分索引があり、
// 固定アドレスを使い回すとサブテストの 2 回目で衝突する。
//
// id はシーケンスに任せるが、その前に必ず現在の最大 id へ合わせ直す。同じパッケージには
// TRUNCATE ... RESTART IDENTITY のあとに id を明示指定して users を作るテストがあり、
// そちらが通ると行だけが進んでシーケンスは 1 のまま取り残される。ここで採番すると
// その明示 id にぶつかって users_pkey が重複する。どのテストと組んでも成り立つように、
// 実行順（-shuffle）に依存しない形で毎回そろえる。
func createUser(t *testing.T, db *sql.DB, namePrefix string) uint64 {
	t.Helper()
	_, err := db.Exec(
		`SELECT setval('users_id_seq', COALESCE((SELECT max(id) FROM users), 0) + 1, false)`,
	)
	require.NoError(t, err)
	var id uint64
	require.NoError(t, db.QueryRow(
		`INSERT INTO users (email, name, created_at, updated_at)
		 VALUES ($1, $2, now(), now()) RETURNING id`,
		namePrefix+"+"+newID()+"@example.test", namePrefix,
	).Scan(&id))
	return id
}

// kbPermFixture は権限の結合テストで使う共通の下ごしらえ。
type kbPermFixture struct {
	db   *sql.DB
	perm repository.KnowledgeBasePermissionRepository
	// invitations は email 宛の招待。bob 等をメンバーにする経路（invite → acceptInvitation）にも使う。
	invitations repository.InvitationRepository
	pages       repository.KnowledgeBaseRepository
	pageUC      kbUseCases
	ws          string
	otherWS     string
	spaceA      string
	spaceB      string
	otherSpc    string
	alice       uint64
	bob         uint64
	carol       uint64
}

func setupKBPermission(t *testing.T, sqlDB *sql.DB) kbPermFixture {
	t.Helper()
	testsupport.TruncateAll(t, sqlDB, kbTables...)
	f := kbPermFixture{
		db:          sqlDB,
		perm:        persistence.NewKnowledgeBasePermissionRepository(sqlDB),
		invitations: persistence.NewInvitationRepository(sqlDB),
		pages:       persistence.NewKnowledgeBaseRepository(sqlDB),
		pageUC:      newKbUseCases(sqlDB),
	}
	f.ws = createWorkspace(t, sqlDB, "perm-main")
	f.otherWS = createWorkspace(t, sqlDB, "perm-other")
	f.spaceA = createSpace(t, sqlDB, f.ws, "aaa")
	f.spaceB = createSpace(t, sqlDB, f.ws, "bbb")
	f.otherSpc = createSpace(t, sqlDB, f.otherWS, "ccc")
	f.alice = createUser(t, sqlDB, "alice")
	f.bob = createUser(t, sqlDB, "bob")
	f.carol = createUser(t, sqlDB, "carol")
	return f
}

// perm は 1 ページの実効権限を解いて返す（事実の収集 → 規則の適用の 2 段をまとめた小道具）。
func (f kbPermFixture) permFor(ctx context.Context, t *testing.T, pageID string, userID uint64) domain.PagePermission {
	t.Helper()
	facts, err := f.perm.PagePermissionFactsForUser(ctx, f.ws, pageID, userID)
	require.NoError(t, err)
	return domain.ResolvePagePermission(*facts)
}

// principalFor はユーザーの主体を用意して返す（ワークスペースへの所属追加も兼ねる）。
//
// EnsureUserPrincipal 自体は principal 行しか作らない（段 2 以降、所属の正本は
// workspace_members に分離され、AcceptWorkspaceInvitation のような実際の受諾経路は
// ActivateWorkspaceMembership を別途呼ぶ）。ここは「所属している体」を作るための
// 小道具なので、principal と揃えて workspace_members も active にしておく
// （でないと ListWorkspaceMembers / ListSpaceMembers の active フィルタに落ちる）。
func (f kbPermFixture) principalFor(ctx context.Context, t *testing.T, userID uint64) *domain.Principal {
	t.Helper()
	p, err := f.perm.EnsureUserPrincipal(ctx, f.ws, userID)
	require.NoError(t, err)
	f.makeActiveMember(t, f.ws, userID)
	return p
}

// makeActiveMember は workspace_members に active な所属行を用意する（無ければ作り、
// あれば active に揃える）。principalFor と違ってワークスペースを明示で選べるので、
// f.ws 以外（f.otherWS 等）の所属を作りたいテストから直接呼ぶ。
func (f kbPermFixture) makeActiveMember(t *testing.T, workspaceID string, userID uint64) {
	t.Helper()
	_, err := f.db.Exec(
		`INSERT INTO workspace_members (workspace_id, user_id, status, joined_at)
		 VALUES ($1, $2, 'active', now())
		 ON CONFLICT (workspace_id, user_id) DO UPDATE SET status = 'active'`,
		workspaceID, userID,
	)
	require.NoError(t, err)
}

// everyoneOf はそのスペースの「全員」の主体を用意して返す。
func (f kbPermFixture) everyoneOf(ctx context.Context, t *testing.T, spaceID string) *domain.Principal {
	t.Helper()
	p, err := f.perm.EnsureSpaceEveryonePrincipal(ctx, f.ws, spaceID)
	require.NoError(t, err)
	return p
}

// grantSpace はスペースの既定の役割を張る。
func (f kbPermFixture) grantSpace(ctx context.Context, t *testing.T, spaceID, principalID string, role domain.GrantRole) {
	t.Helper()
	_, err := f.perm.UpsertSpaceGrant(ctx, f.ws, spaceID, principalID, role)
	require.NoError(t, err)
}

// makePrivate はスペースを private にする。
//
// 権限は 2 段の付与（ワークスペース / スペース）を足し合わせ、届いた中で最も強い
// 役割で決まるので、grants の観点では同じスペースの中で 1 枚だけ隠すことはできない。
// private のスペースにはワークスペース全体の付与とスペース全員宛ての付与が届かず、
// そのスペースを名指しした付与だけが届く。
//
// （段 13 追記）pages.visibility='private' は grants とは別軸の唯一の例外で、ページ 1 枚を
// 作成者以外の全員から隠せる（TestPageVisibility_Integration 参照）。こちらは
// UpdatePageVisibility を経由する正規の口を持つ — ここで生の UPDATE を使うのは、
// スペースの visibility を変える repository の口がまだ無いため（作成時に決める列で、
// テストだけがあとから倒したい）。
func (f kbPermFixture) makePrivate(t *testing.T, spaceID string) {
	t.Helper()
	res, err := f.db.Exec(
		`UPDATE spaces SET visibility = 'private', updated_at = now()
		 WHERE workspace_id = $1 AND id = $2`, f.ws, spaceID,
	)
	require.NoError(t, err)
	n, err := res.RowsAffected()
	require.NoError(t, err)
	require.Equal(t, int64(1), n, "対象のスペースが見つかりません")
}

// viewablePageIDs はそのユーザーに見えるページの ID を一覧経路（1 クエリ）で返す。
// 1 ページずつの解決と答えが割れないことを確かめるのに使う。
func (f kbPermFixture) viewablePageIDs(ctx context.Context, t *testing.T, spaceID string, userID uint64) []string {
	t.Helper()
	out, err := kb.NewListViewablePagesUseCase(f.perm).Execute(ctx,
		kb.ListViewablePagesInput{WorkspaceID: f.ws, SpaceID: spaceID, UserID: userID})
	require.NoError(t, err)
	return pageIDs(out.Pages)
}

func TestKnowledgeBaseSiblingPositionsAround_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	t.Run("隣り合うキーを返し、端は空文字にする", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		root := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "根")
		a := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &root.ID, "A")
		b := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &root.ID, "B")
		c := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &root.ID, "C")

		found, prev, at, next, err := f.pages.SiblingPositionsAround(ctx, f.ws, f.spaceA, &root.ID, b.ID, "")
		require.NoError(t, err)

		assert.True(t, found)
		assert.Equal(t, a.Position, prev)
		assert.Equal(t, b.Position, at)
		assert.Equal(t, c.Position, next)

		// 先頭は手前が空文字（fracindex.Between の「端」）。
		_, prevOfFirst, _, _, err := f.pages.SiblingPositionsAround(ctx, f.ws, f.spaceA, &root.ID, a.ID, "")
		require.NoError(t, err)
		assert.Empty(t, prevOfFirst)

		// 末尾は次が空文字。
		_, _, _, nextOfLast, err := f.pages.SiblingPositionsAround(ctx, f.ws, f.spaceA, &root.ID, c.ID, "")
		require.NoError(t, err)
		assert.Empty(t, nextOfLast)
	})

	t.Run("動かす当人は隣人に数えない", func(t *testing.T) {
		// 除かないと自分自身との中間値を計算することになる。
		f := setupKBPermission(t, sqlDB)
		root := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "根")
		a := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &root.ID, "A")
		b := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &root.ID, "B")
		c := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &root.ID, "C")

		// B を動かしながら A の隣を尋ねると、A の次は C になる（B は居ないものとして扱う）。
		_, _, _, next, err := f.pages.SiblingPositionsAround(ctx, f.ws, f.spaceA, &root.ID, a.ID, b.ID)
		require.NoError(t, err)
		assert.Equal(t, c.Position, next)

		// 自分自身を隣に指定したら「兄弟ではない」。
		found, _, _, _, err := f.pages.SiblingPositionsAround(ctx, f.ws, f.spaceA, &root.ID, b.ID, b.ID)
		require.NoError(t, err)
		assert.False(t, found)
	})

	t.Run("別の親・別スペース・アーカイブ済み・不在をまとめて「兄弟ではない」にする", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		root := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "根")
		other := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "別の親")
		underOther := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &other.ID, "別の親の子")
		inSpaceB := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceB, nil, "別スペース")
		archived := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &root.ID, "アーカイブ")
		require.NoError(t, f.pages.ArchivePageSubtree(ctx, f.ws, archived.ID))

		for _, id := range []string{
			underOther.ID,
			inSpaceB.ID,
			archived.ID,
			"0198a000-0000-7000-8000-0000000000ff",
			"not-a-uuid",
		} {
			found, _, _, _, err := f.pages.SiblingPositionsAround(ctx, f.ws, f.spaceA, &root.ID, id, "")
			require.NoError(t, err, "id=%s", id)
			assert.False(t, found, "id=%s は root の現役の子ではない", id)
		}
	})

	t.Run("誰にも届いていない兄弟も並びには居るので隣人に数える", func(t *testing.T) {
		// 見えないだけで並びには居る。除くとキーが既存の行と衝突する。
		// このクエリは権限を一切見ない（見せるかどうかは呼び出し側の話）。
		f := setupKBPermission(t, sqlDB)
		root := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "根")
		a := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &root.ID, "A")
		unreachable := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &root.ID, "誰にも届いていない")
		// alice にはスペースの editor を張って A を届かせる。付与はスペース単位なので、同じ親の
		// 下の隣だけを隠すには private にする（作成者はベースラインのユーザーで、このワークスペースに
		// 所属していないので誰にも見えない）。
		alice := f.principalFor(ctx, t, f.alice)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleEditor)
		_, err := f.pages.UpdatePageVisibility(ctx, f.ws, unreachable.ID, domain.PageVisibilityPrivate)
		require.NoError(t, err)
		require.False(t, f.permFor(ctx, t, unreachable.ID, f.alice).CanView, "前提: 隣は alice に見えない")

		_, _, _, next, err := f.pages.SiblingPositionsAround(ctx, f.ws, f.spaceA, &root.ID, a.ID, "")
		require.NoError(t, err)
		assert.Equal(t, unreachable.Position, next, "権限に関わらず並びの隣を返す")
	})
}

func TestKnowledgeBaseArchivedViewFacts_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	// listFor はその一覧に出るページ ID を返す（現役／アーカイブ済みを切り替える）。
	listFor := func(f kbPermFixture, t *testing.T, userID uint64, archived bool) []string {
		t.Helper()
		out, err := kb.NewListViewablePagesUseCase(f.perm).Execute(ctx,
			kb.ListViewablePagesInput{
				WorkspaceID: f.ws, SpaceID: f.spaceA, UserID: userID, Archived: archived,
			})
		require.NoError(t, err)
		return pageIDs(out.Pages)
	}

	t.Run("現役とアーカイブ済みが混ざらない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alive := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "現役")
		gone := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "アーカイブ")
		alice := f.principalFor(ctx, t, f.alice)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)
		require.NoError(t, f.pages.ArchivePageSubtree(ctx, f.ws, gone.ID))

		assert.Equal(t, []string{alive.ID}, listFor(f, t, f.alice, false))
		assert.Equal(t, []string{gone.ID}, listFor(f, t, f.alice, true))
	})

	t.Run("アーカイブ済みでも、届いていない相手には出ない", func(t *testing.T) {
		// **この検査が本命。** アーカイブ済みの一覧は現役と同じクエリで役割の事実を集め、
		// 絞り込みだけを切り替える。そこが噛み合わないと、アーカイブ済みページに役割の事実が
		// 付かず、届いている本人にまで出なくなる（逆に絞りが緩めば、届いていない相手へ題名が出る）。
		// fake は SQL を通らないので、このずれは実 PostgreSQL でしか露見しない。
		f := setupKBPermission(t, sqlDB)
		secret := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "秘密")
		f.principalFor(ctx, t, f.alice) // alice も所属はしている（届く付与が無いだけ）
		bob := f.principalFor(ctx, t, f.bob)
		// bob にだけスペースの付与を張る（スペース全員宛ての付与は張らない）。
		f.grantSpace(ctx, t, f.spaceA, bob.ID, domain.GrantRoleViewer)
		require.NoError(t, f.pages.ArchivePageSubtree(ctx, f.ws, secret.ID))

		assert.Empty(t, listFor(f, t, f.alice, true), "付与が届いていない相手には出ない")
		assert.Equal(t, []string{secret.ID}, listFor(f, t, f.bob, true), "届いている相手には出る")
	})

	t.Run("親がアーカイブ済みかを事実として返す", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		root := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "根")
		child := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &root.ID, "子")
		alice := f.principalFor(ctx, t, f.alice)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)
		require.NoError(t, f.pages.ArchivePageSubtree(ctx, f.ws, root.ID))

		out, err := kb.NewListViewablePagesUseCase(f.perm).Execute(ctx,
			kb.ListViewablePagesInput{
				WorkspaceID: f.ws, SpaceID: f.spaceA, UserID: f.alice, Archived: true,
			})
		require.NoError(t, err)

		// 先に両方が一覧に出ていることを確かめる。map の引きは**鍵が無くても false** を返すので、
		// 根が欠落していても「復帰できる側」の検査だけは通ってしまう。
		assert.ElementsMatch(t, []string{root.ID, child.ID}, pageIDs(out.Pages))
		assert.False(t, out.ParentArchived[root.ID], "根は復帰できる側")
		assert.True(t, out.ParentArchived[child.ID], "子だけを復帰させることはできない")
	})
}

// ページを名指しする操作の入口が見る事実を確かめる。
//
// 入口（handler の requirePagePermission → kb.CheckPagePermissionUseCase）は、閲覧できない相手を
// 存在しない ID と同じ 404 に落とす。ここで固定するのは、対象が引けない場合の返り方が
// 実在で変わらないことと、実在するが役割が無いページも同じ拒否へ倒れること。
//
// 役割はワークスペースとスペースの 2 段から届く（ページ単位の付与は持たない）。どの段から
// どう届くかは TestKnowledgeBasePermission_Integration が確かめる。
func TestKnowledgeBasePageGateFacts_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	t.Run("引けないページはどれも同じセンチネルになる", func(t *testing.T) {
		// 応答の差から「そのページ ID が実在するか」を読ませない。存在しない ID も
		// UUID ですらない文字列も他テナントのページも、返るものが同じであること。
		f := setupKBPermission(t, sqlDB)
		f.principalFor(ctx, t, f.alice)
		_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws,
			f.principalFor(ctx, t, f.alice).ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)
		other := mustCreatePage(ctx, t, f.pageUC, f.otherWS, f.otherSpc, nil, "他社のページ")

		for _, c := range []struct {
			name   string
			pageID string
		}{
			{"存在しない UUID", "0198a000-0000-7000-8000-0000000000ff"},
			{"UUID ですらない文字列", "not-a-uuid"},
			{"他テナントのページ", other.ID},
		} {
			_, err := f.perm.PagePermissionFactsForUser(ctx, f.ws, c.pageID, f.alice)
			assert.ErrorIs(t, err, repository.ErrPageNotFound, c.name)
		}
	})

	t.Run("実在するが役割が無いページは拒否へ倒れる", func(t *testing.T) {
		// 上の 3 つと返り方（値かエラーか）は違うが、呼び出し側では同じ拒否に落ちる。
		// どちらも DB への問い合わせは 1 回なので、時間差からも区別できない。
		f := setupKBPermission(t, sqlDB)
		page := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "root")
		f.principalFor(ctx, t, f.carol) // 所属はしているが役割を 1 つも持たない

		facts, err := f.perm.PagePermissionFactsForUser(ctx, f.ws, page.ID, f.carol)
		require.NoError(t, err)
		assert.Equal(t, domain.PagePermission{}, domain.ResolvePagePermission(*facts),
			"閲覧も編集もコメントもできない（入口は存在しない ID と同じ 404 にする）")
	})
}

func TestKnowledgeBasePermission_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	t.Run("メンバー追加は冪等で所属判定に効く", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)

		member, err := f.perm.IsWorkspaceMember(ctx, f.ws, f.alice)
		require.NoError(t, err)
		assert.False(t, member, "principal が無ければ非メンバー")

		first, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)
		second, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)
		assert.Equal(t, first.ID, second.ID, "2 回呼んでも主体は 1 つ")

		member, err = f.perm.IsWorkspaceMember(ctx, f.ws, f.alice)
		require.NoError(t, err)
		assert.True(t, member)

		// 別ワークスペースの所属は独立している。
		member, err = f.perm.IsWorkspaceMember(ctx, f.otherWS, f.alice)
		require.NoError(t, err)
		assert.False(t, member, "同じユーザーでも別テナントでは非メンバー")
	})

	t.Run("複数人まとめての所属判定はIsWorkspaceMemberと同じ答えを返す", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.principalFor(ctx, t, f.alice)
		f.principalFor(ctx, t, f.bob)
		// carol は主体を作らない（非メンバーのまま）。

		out, err := f.perm.IsWorkspaceMemberBulk(ctx, f.ws, []uint64{f.alice, f.bob, f.carol})
		require.NoError(t, err)
		assert.Equal(t, map[uint64]bool{f.alice: true, f.bob: true}, out,
			"メンバーの2人だけが集合に含まれる。非メンバーはキーごと出ない")

		// 空スライスは問い合わせを出さずに空集合を返す。
		out, err = f.perm.IsWorkspaceMemberBulk(ctx, f.ws, nil)
		require.NoError(t, err)
		assert.Empty(t, out)

		// 別ワークスペースの所属は独立している（単体版と同じ境界）。
		out, err = f.perm.IsWorkspaceMemberBulk(ctx, f.otherWS, []uint64{f.alice})
		require.NoError(t, err)
		assert.Empty(t, out, "同じユーザーでも別テナントでは非メンバー")
	})

	t.Run("退会・停止したユーザーは所属していても集合から外れる", func(t *testing.T) {
		// メンション通知の宛先解決に使う経路（段 5）。principal 行はユーザーの退会・停止
		// だけでは消えないため、users 側を突き合わせないと退会済み・停止中のユーザーへも
		// 通知が飛んでしまう。
		f := setupKBPermission(t, sqlDB)
		f.principalFor(ctx, t, f.alice)
		f.principalFor(ctx, t, f.bob)
		_, err := f.db.Exec(`UPDATE users SET status = 'deactivated', deleted_at = now() WHERE id = $1`, f.alice)
		require.NoError(t, err)
		_, err = f.db.Exec(`UPDATE users SET status = 'suspended' WHERE id = $1`, f.bob)
		require.NoError(t, err)

		out, err := f.perm.IsWorkspaceMemberBulk(ctx, f.ws, []uint64{f.alice, f.bob})
		require.NoError(t, err)
		assert.Empty(t, out, "退会済み・停止中のどちらも通知先には含めない")
	})

	t.Run("別ワークスペースのprincipalにgrantを張れない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		// alice を「別ワークスペース」のメンバーにして、その主体 ID を本命ワークスペースで使う。
		foreign, err := f.perm.EnsureUserPrincipal(ctx, f.otherWS, f.alice)
		require.NoError(t, err)

		_, err = f.perm.UpsertSpaceGrant(ctx, f.ws, f.spaceA, foreign.ID, domain.GrantRoleAdmin)
		requirePgError(t, err, sqlStateForeignKeyViolation, "fk_space_grants_principal")

		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, foreign.ID, domain.GrantRoleAdmin, f.alice)
		requirePgError(t, err, sqlStateForeignKeyViolation, "fk_workspace_grants_principal")
	})

	t.Run("存在しないユーザーのprincipalは作れない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		// 弾いているのは DB の FK。まず生の INSERT で制約が効いていることを確かめる。
		_, err := f.db.Exec(
			`INSERT INTO principals (id, workspace_id, kind, user_id)
			 VALUES (gen_random_uuid(), $1, 'user', 999999999)`, f.ws,
		)
		requirePgError(t, err, sqlStateForeignKeyViolation, "fk_principals_user")

		// repository はそれを ErrUserNotFound へ翻訳する。制約違反のまま上へ流すと
		// 「ユーザー ID を間違えた」という入力の誤りが HTTP の入口で 500 になり、
		// 呼び出し側が DB 障害と区別できない（再試行すべきだと誤解する）。
		_, err = f.perm.EnsureUserPrincipal(ctx, f.ws, 999999999)
		require.ErrorIs(t, err, repository.ErrUserNotFound)
	})

	t.Run("グループ名の重複は一意制約として返る", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		_, err := f.perm.CreateGroupPrincipal(ctx, f.ws, "重複する名前")
		require.NoError(t, err)

		// 名前はワークスペース内で一意（uq_principals_group_name）。同名が 2 つあると
		// 権限を張る先を人が選べない。ここも制約違反のままではなくセンチネルで返す。
		_, err = f.perm.CreateGroupPrincipal(ctx, f.ws, "重複する名前")
		require.ErrorIs(t, err, repository.ErrPrincipalGroupNameTaken)

		// 別ワークスペースなら同じ名前を使える（一意なのはワークスペース内だけ）。
		_, err = f.perm.CreateGroupPrincipal(ctx, f.otherWS, "重複する名前")
		require.NoError(t, err)
	})

	t.Run("ユーザーを消すと権限も消える", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		principal, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.bob)
		require.NoError(t, err)
		_, err = f.perm.UpsertSpaceGrant(ctx, f.ws, f.spaceA, principal.ID, domain.GrantRoleEditor)
		require.NoError(t, err)

		_, err = f.db.Exec(`DELETE FROM users WHERE id = $1`, f.bob)
		require.NoError(t, err)

		grants, err := f.perm.ListSpaceGrants(ctx, f.ws, f.spaceA)
		require.NoError(t, err)
		assert.Empty(t, grants, "ユーザーが消えたら principal も grant も残らない（別人への引き継ぎを作らない）")
	})

	t.Run("グループの入れ子はDBが弾く", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		outer, err := f.perm.CreateGroupPrincipal(ctx, f.ws, "外側")
		require.NoError(t, err)
		inner, err := f.perm.CreateGroupPrincipal(ctx, f.ws, "内側")
		require.NoError(t, err)

		err = f.perm.AddGroupMember(ctx, f.ws, outer.ID, inner.ID)
		requirePgError(t, err, sqlStateForeignKeyViolation, "fk_principal_members_member")

		alice, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)
		err = f.perm.AddGroupMember(ctx, f.ws, alice.ID, inner.ID)
		requirePgError(t, err, sqlStateForeignKeyViolation, "fk_principal_members_group")
	})

	t.Run("kindごとに使う列がCHECKで固定されている", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)

		// kind='user' なのに user_id が無い。
		_, err := f.db.Exec(
			`INSERT INTO principals (id, workspace_id, kind) VALUES (gen_random_uuid(), $1, 'user')`, f.ws,
		)
		requirePgError(t, err, sqlStateCheckViolation, "ck_principals_user_id")

		// kind='group' なのに user_id が入っている。
		_, err = f.db.Exec(
			`INSERT INTO principals (id, workspace_id, kind, user_id, name)
			 VALUES (gen_random_uuid(), $1, 'group', $2, '開発')`, f.ws, f.alice,
		)
		requirePgError(t, err, sqlStateCheckViolation, "ck_principals_user_id")

		// kind='group' なのに名前が空。
		_, err = f.db.Exec(
			`INSERT INTO principals (id, workspace_id, kind) VALUES (gen_random_uuid(), $1, 'group')`, f.ws,
		)
		requirePgError(t, err, sqlStateCheckViolation, "ck_principals_name")

		// kind='space_all' なのに対象スペースが無い。
		_, err = f.db.Exec(
			`INSERT INTO principals (id, workspace_id, kind) VALUES (gen_random_uuid(), $1, 'space_all')`, f.ws,
		)
		requirePgError(t, err, sqlStateCheckViolation, "ck_principals_space_id")

		// 既知でない kind。
		_, err = f.db.Exec(
			`INSERT INTO principals (id, workspace_id, kind) VALUES (gen_random_uuid(), $1, 'robot')`, f.ws,
		)
		requirePgError(t, err, sqlStateCheckViolation, "ck_principals_kind")
	})

	t.Run("スペース全員のprincipalは別テナントのスペースを指せない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		_, err := f.db.Exec(
			`INSERT INTO principals (id, workspace_id, kind, space_id)
			 VALUES (gen_random_uuid(), $1, 'space_all', $2)`, f.ws, f.otherSpc,
		)
		requirePgError(t, err, sqlStateForeignKeyViolation, "fk_principals_space")
	})

	t.Run("既定はスペースのgrantで決まる", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		page := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "root")
		alice, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)

		assert.False(t, f.permFor(ctx, t, page.ID, f.alice).CanView, "grant が無ければ見えない")

		_, err = f.perm.UpsertSpaceGrant(ctx, f.ws, f.spaceA, alice.ID, domain.GrantRoleViewer)
		require.NoError(t, err)
		got := f.permFor(ctx, t, page.ID, f.alice)
		assert.True(t, got.CanView)
		assert.False(t, got.CanEdit, "viewer は編集できない")

		_, err = f.perm.UpsertSpaceGrant(ctx, f.ws, f.spaceA, alice.ID, domain.GrantRoleEditor)
		require.NoError(t, err)
		assert.True(t, f.permFor(ctx, t, page.ID, f.alice).CanEdit, "同じ主体の grant は 1 行のまま更新される")

		grants, err := f.perm.ListSpaceGrants(ctx, f.ws, f.spaceA)
		require.NoError(t, err)
		require.Len(t, grants, 1, "upsert なので行は増えない")

		require.NoError(t, f.perm.DeleteSpaceGrant(ctx, f.ws, f.spaceA, alice.ID))
		assert.False(t, f.permFor(ctx, t, page.ID, f.alice).CanView, "剥がせば見えなくなる")
	})

	t.Run("ワークスペースのgrantは全スペースに効きスペースのgrantで降格しない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		pageA := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "A ルート")
		pageB := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceB, nil, "B ルート")
		alice, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)

		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)
		assert.True(t, f.permFor(ctx, t, pageA.ID, f.alice).CanEdit, "スペース A に grant が無くても効く")
		assert.True(t, f.permFor(ctx, t, pageB.ID, f.alice).CanEdit, "スペース B にも効く")

		// スペース側で弱い役割を張っても、強い方（ワークスペースの admin）が採られる。
		_, err = f.perm.UpsertSpaceGrant(ctx, f.ws, f.spaceA, alice.ID, domain.GrantRoleViewer)
		require.NoError(t, err)
		assert.True(t, f.permFor(ctx, t, pageA.ID, f.alice).CanEdit,
			"スペースに viewer を張るだけでワークスペース管理者を締め出せてはいけない")

		// 取り消す前に別の admin を用意する。ユーザーの admin が 0 人になる取り消しは
		// repository が断るので、そこで落ちると本題（役割の合成規則）が確かめられない。
		keepAdmin(ctx, t, f, f.bob)

		require.NoError(t, f.perm.DeleteWorkspaceGrant(ctx, f.ws, alice.ID, f.alice))
		got := f.permFor(ctx, t, pageA.ID, f.alice)
		assert.True(t, got.CanView, "スペースの viewer が残る")
		assert.False(t, got.CanEdit)
	})

	t.Run("グループ経由とスペース全員の権限が効く", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		page := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "root")
		_, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)
		_, err = f.perm.EnsureUserPrincipal(ctx, f.ws, f.bob)
		require.NoError(t, err)

		everyone, err := f.perm.EnsureSpaceEveryonePrincipal(ctx, f.ws, f.spaceA)
		require.NoError(t, err)
		_, err = f.perm.UpsertSpaceGrant(ctx, f.ws, f.spaceA, everyone.ID, domain.GrantRoleViewer)
		require.NoError(t, err)
		assert.True(t, f.permFor(ctx, t, page.ID, f.alice).CanView, "スペース全員の grant はメンバーに効く")
		assert.False(t, f.permFor(ctx, t, page.ID, f.carol).CanView, "非メンバーには効かない")

		group, err := f.perm.CreateGroupPrincipal(ctx, f.ws, "開発")
		require.NoError(t, err)
		_, err = f.perm.UpsertSpaceGrant(ctx, f.ws, f.spaceA, group.ID, domain.GrantRoleEditor)
		require.NoError(t, err)
		bobPrincipal, err := f.perm.FindUserPrincipal(ctx, f.ws, f.bob)
		require.NoError(t, err)
		require.NoError(t, f.perm.AddGroupMember(ctx, f.ws, group.ID, bobPrincipal.ID))

		assert.True(t, f.permFor(ctx, t, page.ID, f.bob).CanEdit, "グループ経由で editor")
		assert.False(t, f.permFor(ctx, t, page.ID, f.alice).CanEdit, "グループに入っていない人は viewer のまま")

		require.NoError(t, f.perm.RemoveGroupMember(ctx, f.ws, group.ID, bobPrincipal.ID))
		assert.False(t, f.permFor(ctx, t, page.ID, f.bob).CanEdit, "外せば既定に戻る")
	})

	t.Run("第三者への付与を足しても届いていない人には見えないまま", func(t *testing.T) {
		// 付与は名指しした相手にだけ足される。誰かのために 1 行張ったことが、
		// 無関係な人へ波及しないことを固定する（波及すると、権限設定の 1 操作が
		// 意図しない相手にまで及ぶ）。
		f := setupKBPermission(t, sqlDB)
		parent := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "人事・機密")
		child := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &parent.ID, "査定シート")
		grand := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &child.ID, "評価コメント")

		alice := f.principalFor(ctx, t, f.alice)
		f.principalFor(ctx, t, f.bob)
		carol := f.principalFor(ctx, t, f.carol)

		// このスペースは alice にだけ届く（スペース全員宛ての付与は張らない）。
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleEditor)
		for _, page := range []*domain.Page{parent, child, grand} {
			got := f.permFor(ctx, t, page.ID, f.bob)
			require.False(t, got.CanView, "付与が届いていない時点で bob には見えない")
			require.False(t, got.CanEdit)
		}
		require.Empty(t, f.viewablePageIDs(ctx, t, f.spaceA, f.bob))

		// 「carol にだけ読ませる」という通常運用の付与を同じスペースへ 1 行足す。
		f.grantSpace(ctx, t, f.spaceA, carol.ID, domain.GrantRoleViewer)

		for _, page := range []*domain.Page{parent, child, grand} {
			got := f.permFor(ctx, t, page.ID, f.bob)
			assert.False(t, got.CanView, "第三者への付与 1 行で無関係な人に開いてはいけない")
			assert.False(t, got.CanEdit, "読めないページを編集できてもいけない")
		}
		assert.Empty(t, f.viewablePageIDs(ctx, t, f.spaceA, f.bob), "ツリー一覧にも露出しない")

		// 足した本人には届き、先に張ってあった相手の権限は下がらない。
		aliceOnChild := f.permFor(ctx, t, child.ID, f.alice)
		assert.True(t, aliceOnChild.CanView, "先に付与を持つ本人はそのまま")
		assert.True(t, aliceOnChild.CanEdit, "弱い付与を隣に足しても降格しない")
		assert.True(t, f.permFor(ctx, t, child.ID, f.carol).CanView, "名指しした本人には届く")
		assert.ElementsMatch(t, []string{parent.ID, child.ID, grand.ID},
			f.viewablePageIDs(ctx, t, f.spaceA, f.alice), "先に張ってあった付与は木全体に効き続ける")
	})

	t.Run("主体を消してもほかの人の見え方は変わらない", func(t *testing.T) {
		// 引き金は攻撃ではなく通常運用（退職者のオフボーディング・部署の統廃合）。
		// 主体を消すと、その主体宛ての付与も FK の CASCADE で一緒に消える。消えるのは
		// **その人に届いていた分だけ**で、ほかの誰かに届く／届かないは 1 つも動かない。
		f := setupKBPermission(t, sqlDB)
		// 付与はスペース単位なので、宛先の違う棚は別のスペースに置く。
		root := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "人事・機密")
		child := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &root.ID, "査定シート")
		byGroup := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceB, nil, "部署だけの棚")

		alice := f.principalFor(ctx, t, f.alice)
		f.principalFor(ctx, t, f.bob)
		f.principalFor(ctx, t, f.carol)
		group, err := f.perm.CreateGroupPrincipal(ctx, f.ws, "人事部")
		require.NoError(t, err)

		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)
		f.grantSpace(ctx, t, f.spaceB, group.ID, domain.GrantRoleViewer)
		require.False(t, f.permFor(ctx, t, root.ID, f.bob).CanView, "bob へ届く付与は最初から無い")
		require.False(t, f.permFor(ctx, t, byGroup.ID, f.bob).CanView)
		require.Empty(t, f.viewablePageIDs(ctx, t, f.spaceA, f.bob))
		require.Empty(t, f.viewablePageIDs(ctx, t, f.spaceB, f.bob))

		// 退職者を外す（付与が張られていた本人）。
		require.NoError(t, kb.NewRemoveWorkspaceMemberUseCase(f.perm).Execute(ctx,
			kb.RemoveWorkspaceMemberInput{WorkspaceID: f.ws, UserID: f.alice, ActorUserID: f.alice}))
		// 部署の統廃合でグループを消す（付与が張られていた主体）。
		require.NoError(t, f.perm.DeletePrincipal(ctx, f.ws, group.ID))

		for _, page := range []*domain.Page{root, child, byGroup} {
			got := f.permFor(ctx, t, page.ID, f.bob)
			assert.False(t, got.CanView, "主体が消えても他人へ開かない: "+page.Title)
			assert.False(t, got.CanEdit, "読めないページを編集できてもいけない: "+page.Title)
		}
		for _, space := range []string{f.spaceA, f.spaceB} {
			assert.Empty(t, f.viewablePageIDs(ctx, t, space, f.bob), "ツリー一覧にも出ない")
			assert.Empty(t, f.viewablePageIDs(ctx, t, space, f.carol))

			// 主体ごと消えたので、どちらのスペースにも行が 1 つも残らない。
			rows, err := f.perm.ListSpaceGrants(ctx, f.ws, space)
			require.NoError(t, err)
			assert.Empty(t, rows, "載っていた主体ごと付与の行は消えている")
		}

		// 閉じたままにするのが目的で、開き直せなくなるわけではない。
		bob, err := f.perm.FindUserPrincipal(ctx, f.ws, f.bob)
		require.NoError(t, err)
		f.grantSpace(ctx, t, f.spaceA, bob.ID, domain.GrantRoleViewer)
		assert.True(t, f.permFor(ctx, t, root.ID, f.bob).CanView, "張り直せば見える")
		assert.False(t, f.permFor(ctx, t, root.ID, f.carol).CanView, "張っていない人は見えないまま")
	})

	t.Run("見え方が変わるのはその人の付与を触ったときだけ", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		root := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "root")

		alice := f.principalFor(ctx, t, f.alice)
		f.principalFor(ctx, t, f.bob)
		carol := f.principalFor(ctx, t, f.carol)

		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)
		f.grantSpace(ctx, t, f.spaceA, carol.ID, domain.GrantRoleViewer)
		require.False(t, f.permFor(ctx, t, root.ID, f.bob).CanView)

		// 他人の付与を剥がしても、自分の見え方は動かない。
		require.NoError(t, f.perm.DeleteSpaceGrant(ctx, f.ws, f.spaceA, carol.ID))
		assert.False(t, f.permFor(ctx, t, root.ID, f.bob).CanView, "他人の行を消しても開かない")
		assert.True(t, f.permFor(ctx, t, root.ID, f.alice).CanView, "残っている本人はそのまま")
		assert.False(t, f.permFor(ctx, t, root.ID, f.carol).CanView, "剥がした本人は見えなくなる")

		// 最後の 1 行を消しても、届く段がほかに無いので誰にも開かない。
		require.NoError(t, f.perm.DeleteSpaceGrant(ctx, f.ws, f.spaceA, alice.ID))
		assert.False(t, f.permFor(ctx, t, root.ID, f.alice).CanView)
		assert.False(t, f.permFor(ctx, t, root.ID, f.bob).CanView, "行が 0 になっても全開にはならない")
		rows, err := f.perm.ListSpaceGrants(ctx, f.ws, f.spaceA)
		require.NoError(t, err)
		assert.Empty(t, rows)
	})

	t.Run("編集できるのは編集の付与が届いた人だけ", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		root := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "規程集")
		child := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &root.ID, "就業規則")

		// スペース全員には viewer（読み取り専用のスペース）。
		f.grantSpace(ctx, t, f.spaceA, f.everyoneOf(ctx, t, f.spaceA).ID, domain.GrantRoleViewer)
		alice := f.principalFor(ctx, t, f.alice)
		f.principalFor(ctx, t, f.bob)
		carol := f.principalFor(ctx, t, f.carol)

		// このスペースは「alice だけが編集できる」。
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleEditor)
		require.True(t, f.permFor(ctx, t, child.ID, f.bob).CanView, "閲覧の既定は viewer のまま")
		require.False(t, f.permFor(ctx, t, child.ID, f.bob).CanEdit)

		// 「carol にも読ませる」つもりの付与を 1 行足す。
		f.grantSpace(ctx, t, f.spaceA, carol.ID, domain.GrantRoleViewer)

		assert.False(t, f.permFor(ctx, t, child.ID, f.bob).CanEdit,
			"読み取り専用のスペースが全員に開いてはいけない（データ破壊になる）")
		assert.True(t, f.permFor(ctx, t, child.ID, f.alice).CanEdit, "編集を張られた本人はそのまま")
		assert.False(t, f.permFor(ctx, t, child.ID, f.carol).CanEdit, "viewer を足しても編集にはならない")
		assert.True(t, f.permFor(ctx, t, child.ID, f.carol).CanView)
	})

	t.Run("一覧は別ワークスペースのスペースとアーカイブ済みを返さない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		root := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "root")
		leaving := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &root.ID, "アーカイブする子")
		f.grantSpace(ctx, t, f.spaceA, f.principalFor(ctx, t, f.alice).ID, domain.GrantRoleEditor)
		require.ElementsMatch(t, []string{root.ID, leaving.ID}, f.viewablePageIDs(ctx, t, f.spaceA, f.alice))

		require.NoError(t, f.pageUC.archive.Execute(ctx, kb.ArchivePageInput{
			WorkspaceID: f.ws, PageID: leaving.ID,
		}))
		assert.ElementsMatch(t, []string{root.ID}, f.viewablePageIDs(ctx, t, f.spaceA, f.alice),
			"アーカイブ済みは一覧に出ない")

		// 別ワークスペースのスペース ID を渡しても 1 枚も返さない（事実の収集の時点で塞ぐ）。
		mustCreatePage(ctx, t, f.pageUC, f.otherWS, f.otherSpc, nil, "別テナントのページ")
		foreign, err := f.perm.ListSpacePageViewFacts(ctx, f.ws, f.otherSpc, f.alice, false)
		require.NoError(t, err)
		assert.Empty(t, foreign, "テナント越えの spaceID では 0 件")
	})

	// ListSpacePageViewFacts は knowledge_base_permission_repository.go の 3 箇所ある
	// 手組みの sqlcgen.Page{} リテラルの 1 つを通る。Icon / Cover / LastEditedByUserID の
	// 列挙し忘れは「木・検索・参照解決だけアイコンが抜ける」形でコンパイルは通ってしまうため、
	// この結合テストで固定する。
	t.Run("ListSpacePageViewFacts はアイコンと最終編集者を返す", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		page := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "顔のあるページ")
		f.grantSpace(ctx, t, f.spaceA, f.everyoneOf(ctx, t, f.spaceA).ID, domain.GrantRoleViewer)

		icon := &domain.PageIcon{Type: domain.PageIconTypeEmoji, Value: "📘"}
		_, err := f.pages.UpdatePageIcon(ctx, f.ws, page.ID, icon)
		require.NoError(t, err)
		require.NoError(t, f.pages.TouchPageLastEditedBy(ctx, f.ws, page.ID, f.alice))

		rows, err := f.perm.ListSpacePageViewFacts(ctx, f.ws, f.spaceA, f.alice, false)
		require.NoError(t, err)
		var got *repository.PageWithViewFacts
		for i := range rows {
			if rows[i].Page.ID == page.ID {
				got = &rows[i]
			}
		}
		require.NotNil(t, got, "対象ページが一覧に含まれる")
		require.NotNil(t, got.Page.Icon, "手組みの Page リテラルに Icon が抜けていない")
		assert.Equal(t, *icon, *got.Page.Icon)
		require.NotNil(t, got.Page.LastEditedByUserID)
		assert.Equal(t, f.alice, *got.Page.LastEditedByUserID)
	})

	t.Run("スペースごとの付与は別スペースのページへ漏れない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		// スペース A と B に、それぞれ独立した木を作る。
		aRoot := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "A ルート")
		aChild := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &aRoot.ID, "A 子")
		bRoot := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceB, nil, "B ルート")

		alice, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)
		_, err = f.perm.EnsureUserPrincipal(ctx, f.ws, f.bob)
		require.NoError(t, err)
		// スペース B だけ全員 editor。A にはスペース全員宛ての付与を置かない。
		everyoneB, err := f.perm.EnsureSpaceEveryonePrincipal(ctx, f.ws, f.spaceB)
		require.NoError(t, err)
		_, err = f.perm.UpsertSpaceGrant(ctx, f.ws, f.spaceB, everyoneB.ID, domain.GrantRoleEditor)
		require.NoError(t, err)

		// スペース A に alice への付与を張っても、B の木には 1 つも影響しない。
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)
		assert.True(t, f.permFor(ctx, t, aChild.ID, f.alice).CanView, "A の木は張った本人にだけ届く")
		assert.False(t, f.permFor(ctx, t, aChild.ID, f.bob).CanView,
			"A の木は bob へ届かない（B の全員宛ての付与は A のページに効かない）")
		assert.True(t, f.permFor(ctx, t, bRoot.ID, f.bob).CanView, "B の木は無関係のまま")
		assert.True(t, f.permFor(ctx, t, bRoot.ID, f.alice).CanView,
			"B は全員 editor なので alice にも見える")

		// スペース全員の grant もスペースごとに独立している。
		require.NoError(t, f.perm.DeleteSpaceGrant(ctx, f.ws, f.spaceB, everyoneB.ID))
		assert.False(t, f.permFor(ctx, t, bRoot.ID, f.bob).CanView)
		assert.True(t, f.permFor(ctx, t, aChild.ID, f.alice).CanView, "B の grant を剥がしても A は変わらない")
	})

	t.Run("ページを別のスペースへ動かすと実効権限が変わる", func(t *testing.T) {
		// 見せたくないものは private のスペースへ置く、という運用をそのまま通す。
		//
		// ここで見るのは**スペースをまたぐ移動**だけ（下の move はどちらも NewSpaceID を渡す）。
		// 付与はワークスペースとスペースの 2 段だけなので、同じスペースの中で親を替えても
		// 見え方は変わらない（ページの位置は役割に効かない）。
		f := setupKBPermission(t, sqlDB)
		open := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "公開の親")
		moving := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &open.ID, "動くページ")

		// スペース A は全員 editor。スペース B は private で alice だけ。
		everyone, err := f.perm.EnsureSpaceEveryonePrincipal(ctx, f.ws, f.spaceA)
		require.NoError(t, err)
		_, err = f.perm.UpsertSpaceGrant(ctx, f.ws, f.spaceA, everyone.ID, domain.GrantRoleEditor)
		require.NoError(t, err)
		alice, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)
		_, err = f.perm.EnsureUserPrincipal(ctx, f.ws, f.bob)
		require.NoError(t, err)
		f.makePrivate(t, f.spaceB)
		f.grantSpace(ctx, t, f.spaceB, alice.ID, domain.GrantRoleEditor)

		assert.True(t, f.permFor(ctx, t, moving.ID, f.bob).CanView, "スペース A では bob も見える")

		_, err = f.pageUC.move.Execute(ctx, kb.MovePageInput{
			WorkspaceID: f.ws, PageID: moving.ID, NewSpaceID: f.spaceB,
		})
		require.NoError(t, err)
		assert.False(t, f.permFor(ctx, t, moving.ID, f.bob).CanView, "private のスペースへ移すと見えなくなる")
		assert.True(t, f.permFor(ctx, t, moving.ID, f.alice).CanView, "そのスペースへ張られた本人には見える")

		_, err = f.pageUC.move.Execute(ctx, kb.MovePageInput{
			WorkspaceID: f.ws, PageID: moving.ID, NewSpaceID: f.spaceA,
		})
		require.NoError(t, err)
		assert.True(t, f.permFor(ctx, t, moving.ID, f.bob).CanView, "戻せばまた見える（付与の行は 1 つも触っていない）")
	})

	t.Run("閲覧可能ページ一覧は届いていないページを落とす", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		// 付与はスペース単位なので、見せたくない木は別のスペース（alice だけが届く）に置く。
		open := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "公開")
		secret := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceB, nil, "秘密")
		secretChild := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceB, &secret.ID, "秘密の子")

		// スペース全員宛ての付与は張らない。届くのは本人宛てのスペースの付与だけ。
		alice, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)
		bob, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.bob)
		require.NoError(t, err)
		f.grantSpace(ctx, t, f.spaceA, bob.ID, domain.GrantRoleViewer)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)
		f.grantSpace(ctx, t, f.spaceB, alice.ID, domain.GrantRoleViewer)

		listUC := kb.NewListViewablePagesUseCase(f.perm)
		bobPages, err := listUC.Execute(ctx, kb.ListViewablePagesInput{
			WorkspaceID: f.ws, SpaceID: f.spaceA, UserID: f.bob,
		})
		require.NoError(t, err)
		assert.ElementsMatch(t, []string{open.ID}, pageIDs(bobPages.Pages), "届いているスペースのページは出る")
		bobSecret, err := listUC.Execute(ctx, kb.ListViewablePagesInput{
			WorkspaceID: f.ws, SpaceID: f.spaceB, UserID: f.bob,
		})
		require.NoError(t, err)
		assert.Empty(t, bobSecret.Pages, "秘密の木は丸ごと落ちる")

		alicePages, err := listUC.Execute(ctx, kb.ListViewablePagesInput{
			WorkspaceID: f.ws, SpaceID: f.spaceB, UserID: f.alice,
		})
		require.NoError(t, err)
		assert.ElementsMatch(t,
			[]string{secret.ID, secretChild.ID}, pageIDs(alicePages.Pages),
			"付与された人には子孫まで見える")

		carolPages, err := listUC.Execute(ctx, kb.ListViewablePagesInput{
			WorkspaceID: f.ws, SpaceID: f.spaceA, UserID: f.carol,
		})
		require.NoError(t, err)
		assert.Empty(t, carolPages.Pages, "非メンバーには 1 枚も見えない")
		assert.Empty(t, carolPages.HasHiddenChildren, "印も返さない（実在が漏れる）")
	})

	t.Run("一覧は所属グループとスペース全員の付与を1ページ解決と同じに畳む", func(t *testing.T) {
		// 一覧は 1 ページの解決とは別に書かれた同型の集計で、片方だけ壊れても
		// もう片方のテストでは気づけない。自分宛ての付与しか置かない配役では、
		// 一覧側の所属グループ・スペース全員の枝を落としても素通りするため、
		// 3 つの主体すべてが一覧経路にも効いていることをここで固定する。
		// 付与はスペース単位なので、経路ごとに別のスペースを用意する。
		f := setupKBPermission(t, sqlDB)
		spaceEveryone := createSpace(t, sqlDB, f.ws, "everyone")
		spaceNobody := createSpace(t, sqlDB, f.ws, "nobody")
		mine := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "自分宛てのページ")
		byGroup := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceB, nil, "部署宛てのページ")
		byGroupChild := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceB, &byGroup.ID, "その子")
		byEveryone := mustCreatePage(ctx, t, f.pageUC, f.ws, spaceEveryone, nil, "全員宛てのページ")
		unreachable := mustCreatePage(ctx, t, f.pageUC, f.ws, spaceNobody, nil, "誰にも張っていないページ")

		// viewableAcross は全スペースの一覧をつないで返す（一覧はスペースごとに引く）。
		viewableAcross := func(userID uint64) []string {
			t.Helper()
			var ids []string
			for _, space := range []string{f.spaceA, f.spaceB, spaceEveryone, spaceNobody} {
				ids = append(ids, f.viewablePageIDs(ctx, t, space, userID)...)
			}
			return ids
		}

		alice := f.principalFor(ctx, t, f.alice)
		f.principalFor(ctx, t, f.bob)
		group, err := f.perm.CreateGroupPrincipal(ctx, f.ws, "総務")
		require.NoError(t, err)
		require.NoError(t, f.perm.AddGroupMember(ctx, f.ws, group.ID, alice.ID))

		// 自分宛て。
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)
		// 所属グループ宛て（自分の主体だけを見ていると一覧で無視される）。
		f.grantSpace(ctx, t, f.spaceB, group.ID, domain.GrantRoleViewer)
		// スペース全員宛て（所属している人にだけ届く）。
		f.grantSpace(ctx, t, spaceEveryone, f.everyoneOf(ctx, t, spaceEveryone).ID, domain.GrantRoleViewer)

		aliceViewable := viewableAcross(f.alice)
		assert.ElementsMatch(t,
			[]string{mine.ID, byGroup.ID, byGroupChild.ID, byEveryone.ID}, aliceViewable,
			"自分・所属グループ・スペース全員の 3 経路とも一覧に効く")

		// 1 ページずつの解決と一覧が同じ答えになること（別々に書かれた集計なので突き合わせる）。
		for _, page := range []*domain.Page{mine, byGroup, byGroupChild, byEveryone, unreachable} {
			assert.Equal(t, f.permFor(ctx, t, page.ID, f.alice).CanView,
				slices.Contains(aliceViewable, page.ID), "1 ページ解決と一覧が割れている: "+page.Title)
		}

		// bob はグループに入っていないので、全員宛ての 1 枚だけが見える。
		assert.ElementsMatch(t, []string{byEveryone.ID}, viewableAcross(f.bob))

		// グループから外すと、グループ宛ての付与は届かなくなる。
		require.NoError(t, f.perm.RemoveGroupMember(ctx, f.ws, group.ID, alice.ID))
		assert.ElementsMatch(t, []string{mine.ID, byEveryone.ID},
			viewableAcross(f.alice), "所属が消えればグループ宛ての付与も届かない")
	})

	t.Run("メンバー削除のusecaseは主体ごと消す", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		page := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "root")
		alice, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)
		_, err = f.perm.UpsertSpaceGrant(ctx, f.ws, f.spaceA, alice.ID, domain.GrantRoleEditor)
		require.NoError(t, err)
		require.True(t, f.permFor(ctx, t, page.ID, f.alice).CanEdit)

		removeUC := kb.NewRemoveWorkspaceMemberUseCase(f.perm)
		require.NoError(t, removeUC.Execute(ctx, kb.RemoveWorkspaceMemberInput{WorkspaceID: f.ws, UserID: f.alice, ActorUserID: f.alice}))
		assert.False(t, f.permFor(ctx, t, page.ID, f.alice).CanView, "所属を外すと権限も消える")
		require.NoError(t, removeUC.Execute(ctx, kb.RemoveWorkspaceMemberInput{WorkspaceID: f.ws, UserID: f.alice, ActorUserID: f.alice}),
			"二度目は冪等に成功する")

		require.ErrorIs(t, f.perm.DeletePrincipal(ctx, f.ws, alice.ID), repository.ErrPrincipalNotFound)
	})

	t.Run("2段のgrantをusecase経由で張って一覧を引ける", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		page := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "root")
		alice, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)
		bob, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.bob)
		require.NoError(t, err)

		grantWS := kb.NewGrantWorkspaceRoleUseCase(f.perm)
		_, err = grantWS.Execute(ctx, kb.GrantWorkspaceRoleInput{
			WorkspaceID: f.ws, PrincipalID: alice.ID, Role: domain.GrantRoleAdmin, ActorUserID: f.alice,
		})
		require.NoError(t, err)
		wsGrants, err := f.perm.ListWorkspaceGrants(ctx, f.ws)
		require.NoError(t, err)
		require.Len(t, wsGrants, 1)
		assert.Equal(t, domain.GrantRoleAdmin, wsGrants[0].Role)

		// 2 段目（スペース）。bob はここで初めて役割を得る。
		_, err = kb.NewGrantSpaceRoleUseCase(f.perm).Execute(ctx, kb.GrantSpaceRoleInput{
			WorkspaceID: f.ws, SpaceID: f.spaceA, PrincipalID: bob.ID, Role: domain.GrantRoleEditor,
		})
		require.NoError(t, err)
		spaceGrants, err := f.perm.ListSpaceGrants(ctx, f.ws, f.spaceA)
		require.NoError(t, err)
		require.Len(t, spaceGrants, 1)
		assert.Equal(t, domain.GrantRoleEditor, spaceGrants[0].Role)
		assert.True(t, f.permFor(ctx, t, page.ID, f.bob).CanEdit, "スペースの付与で編集できる")
		assert.False(t, scopeOf(ctx, t, f, f.spaceA, f.bob).CanManage, "editor では権限を変えられない")

		require.NoError(t, kb.NewRevokeSpaceRoleUseCase(f.perm).Execute(ctx,
			kb.RevokeSpaceRoleInput{WorkspaceID: f.ws, SpaceID: f.spaceA, PrincipalID: bob.ID}))
		assert.False(t, f.permFor(ctx, t, page.ID, f.bob).CanView, "剥がせば届かない")

		// 取り消す前に別の admin を用意する（0 人になる取り消しは repository が断る）。
		keepAdmin(ctx, t, f, f.carol)
		require.NoError(t, kb.NewRevokeWorkspaceRoleUseCase(f.perm).Execute(ctx,
			kb.RevokeWorkspaceRoleInput{WorkspaceID: f.ws, PrincipalID: alice.ID, ActorUserID: f.alice}))
		assert.False(t, f.permFor(ctx, t, page.ID, f.alice).CanView)
	})

	t.Run("グループ操作のusecaseが権限に効く", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		page := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "root")
		bobPrincipal, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.bob)
		require.NoError(t, err)
		// 招待の受諾（AcceptWorkspaceInvitation）は既定で editor を付ける。この試験は
		// 「グループ経由の権限」だけを見たいので、既定の役割を外して素の状態
		// （役割なしのメンバー）から始める。
		require.NoError(t, f.perm.GrantWorkspaceRoleIfAbsent(ctx, f.ws, bobPrincipal.ID, domain.GrantRoleEditor))
		require.NoError(t, kb.NewRevokeWorkspaceRoleUseCase(f.perm).Execute(ctx,
			kb.RevokeWorkspaceRoleInput{WorkspaceID: f.ws, PrincipalID: bobPrincipal.ID, ActorUserID: f.bob}))
		assert.False(t, f.permFor(ctx, t, page.ID, f.bob).CanView, "役割を外した直後は見えない")
		group, err := kb.NewCreatePrincipalGroupUseCase(f.perm).Execute(ctx,
			kb.CreatePrincipalGroupInput{WorkspaceID: f.ws, Name: "開発"})
		require.NoError(t, err)
		_, err = kb.NewGrantSpaceRoleUseCase(f.perm).Execute(ctx, kb.GrantSpaceRoleInput{
			WorkspaceID: f.ws, SpaceID: f.spaceA, PrincipalID: group.ID, Role: domain.GrantRoleEditor,
		})
		require.NoError(t, err)

		addUC := kb.NewAddGroupMemberUseCase(f.perm)
		require.NoError(t, addUC.Execute(ctx, kb.AddGroupMemberInput{
			WorkspaceID: f.ws, GroupPrincipalID: group.ID, MemberUserID: f.bob,
		}))
		require.NoError(t, addUC.Execute(ctx, kb.AddGroupMemberInput{
			WorkspaceID: f.ws, GroupPrincipalID: group.ID, MemberUserID: f.bob,
		}), "同じ人を二度加えても冪等")
		assert.True(t, f.permFor(ctx, t, page.ID, f.bob).CanEdit)

		removeUC := kb.NewRemoveGroupMemberUseCase(f.perm)
		require.NoError(t, removeUC.Execute(ctx, kb.RemoveGroupMemberInput{
			WorkspaceID: f.ws, GroupPrincipalID: group.ID, MemberUserID: f.bob,
		}))
		assert.False(t, f.permFor(ctx, t, page.ID, f.bob).CanView)

		// スペース全員の主体も usecase 経由で用意でき、二度呼んでも増えない。
		everyoneUC := kb.NewEnsureSpaceEveryonePrincipalUseCase(f.perm)
		first, err := everyoneUC.Execute(ctx, kb.EnsureSpaceEveryonePrincipalInput{WorkspaceID: f.ws, SpaceID: f.spaceA})
		require.NoError(t, err)
		second, err := everyoneUC.Execute(ctx, kb.EnsureSpaceEveryonePrincipalInput{WorkspaceID: f.ws, SpaceID: f.spaceA})
		require.NoError(t, err)
		assert.Equal(t, first.ID, second.ID)
	})

	t.Run("形式が不正なIDは存在しないものとして扱う", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		const bad = "not-a-uuid"

		_, err := f.perm.FindPrincipal(ctx, bad, bad)
		require.ErrorIs(t, err, repository.ErrPrincipalNotFound)
		_, err = f.perm.FindUserPrincipal(ctx, bad, f.alice)
		require.ErrorIs(t, err, repository.ErrPrincipalNotFound)
		require.ErrorIs(t, f.perm.DeletePrincipal(ctx, bad, bad), repository.ErrPrincipalNotFound)
		_, err = f.perm.PagePermissionFactsForUser(ctx, bad, bad, f.alice)
		require.ErrorIs(t, err, repository.ErrPageNotFound)

		member, err := f.perm.IsWorkspaceMember(ctx, bad, f.alice)
		require.NoError(t, err)
		assert.False(t, member)

		// 一覧系は空を返す（URL 由来の生文字列を DB エラーにしない）。
		wsGrants, err := f.perm.ListWorkspaceGrants(ctx, bad)
		require.NoError(t, err)
		assert.Empty(t, wsGrants)
		spGrants, err := f.perm.ListSpaceGrants(ctx, bad, bad)
		require.NoError(t, err)
		assert.Empty(t, spGrants)
		facts, err := f.perm.ListSpacePageViewFacts(ctx, bad, bad, f.alice, false)
		require.NoError(t, err)
		assert.Empty(t, facts)

		require.NoError(t, f.perm.RemoveGroupMember(ctx, bad, bad, bad))
		require.NoError(t, f.perm.DeleteWorkspaceGrant(ctx, bad, bad, f.alice))
		require.NoError(t, f.perm.DeleteSpaceGrant(ctx, bad, bad, bad))
		require.ErrorIs(t, f.perm.AddGroupMember(ctx, bad, bad, bad), repository.ErrPrincipalNotFound)
		_, err = f.perm.EnsureUserPrincipal(ctx, bad, f.alice)
		require.ErrorIs(t, err, repository.ErrWorkspaceNotFound)
		_, err = f.perm.EnsureSpaceEveryonePrincipal(ctx, bad, bad)
		require.ErrorIs(t, err, repository.ErrSpaceNotFound)
		_, err = f.perm.CreateGroupPrincipal(ctx, bad, "x")
		require.ErrorIs(t, err, repository.ErrWorkspaceNotFound)
		_, err = f.perm.UpsertWorkspaceGrant(ctx, bad, bad, domain.GrantRoleViewer, f.alice)
		require.ErrorIs(t, err, repository.ErrPrincipalNotFound)
		_, err = f.perm.UpsertSpaceGrant(ctx, bad, bad, bad, domain.GrantRoleViewer)
		require.ErrorIs(t, err, repository.ErrPrincipalNotFound)
	})

	t.Run("別テナントの所属は解決に持ち込まれない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		page := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "root")
		// alice は「別ワークスペース」だけのメンバーで、そちらでは admin。
		foreign, err := f.perm.EnsureUserPrincipal(ctx, f.otherWS, f.alice)
		require.NoError(t, err)
		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.otherWS, foreign.ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)
		// こちらのスペースは全員 editor。
		everyone, err := f.perm.EnsureSpaceEveryonePrincipal(ctx, f.ws, f.spaceA)
		require.NoError(t, err)
		_, err = f.perm.UpsertSpaceGrant(ctx, f.ws, f.spaceA, everyone.ID, domain.GrantRoleEditor)
		require.NoError(t, err)

		facts, err := f.perm.PagePermissionFactsForUser(ctx, f.ws, page.ID, f.alice)
		require.NoError(t, err)
		assert.False(t, facts.Member, "別テナントの主体をこちらの所属として拾ってはいけない")
		assert.Nil(t, facts.Role, "別テナントの grant を持ち込んではいけない")
		assert.False(t, domain.ResolvePagePermission(*facts).CanView,
			"スペース全員の grant は非メンバーには効かない")
	})

	t.Run("別ワークスペースのページは解決できない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		foreignPage := mustCreatePage(ctx, t, f.pageUC, f.otherWS, f.otherSpc, nil, "別テナントのページ")

		_, err := f.perm.PagePermissionFactsForUser(ctx, f.ws, foreignPage.ID, f.alice)
		require.ErrorIs(t, err, repository.ErrPageNotFound, "テナント越えは「無い」と同じ扱い")
	})
}

// keepAdmin は userID をワークスペースの admin にする。
//
// 「最後の admin は外せない」は repository が書き込みと同じトランザクションで守っている。
// admin の取り消しそのものが本題でないテストは、先に 2 人目を用意してからでないと
// その検査に引っかかって、確かめたかったこと（役割の合成規則など）へ辿り着けない。
func keepAdmin(ctx context.Context, t *testing.T, f kbPermFixture, userID uint64) {
	t.Helper()
	p, err := f.perm.EnsureUserPrincipal(ctx, f.ws, userID)
	require.NoError(t, err)
	_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, p.ID, domain.GrantRoleAdmin, userID)
	require.NoError(t, err)
}

// pageIDs はページの ID だけを取り出す（一覧の比較用）。
func pageIDs(pages []domain.Page) []string {
	ids := make([]string, 0, len(pages))
	for _, p := range pages {
		ids = append(ids, p.ID)
	}
	return ids
}

func TestKnowledgeBaseSearchViewFacts_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	searchFor := func(f kbPermFixture, t *testing.T, userID uint64, query string) []string {
		t.Helper()
		results, err := kb.NewSearchViewablePagesUseCase(f.perm).Execute(ctx,
			kb.SearchViewablePagesInput{WorkspaceID: f.ws, UserID: userID, Query: query})
		require.NoError(t, err)
		ids := make([]string, 0, len(results))
		for _, r := range results {
			ids = append(ids, r.Page.ID)
		}
		return ids
	}

	t.Run("題名の部分一致でスペースを跨いで返り、届いていないページは出ない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		// スペース C は private。ワークスペース全体の付与もスペース全員の付与も届かず、
		// そのスペースを名指しした付与だけが届く（＝ 見せないための置き場）。
		spaceC := createSpace(t, sqlDB, f.ws, "ccc-private")
		f.makePrivate(t, spaceC)

		inA := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "Docker 手順")
		inB := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceB, nil, "docker 入門")
		secret := mustCreatePage(ctx, t, f.pageUC, f.ws, spaceC, nil, "Docker 機密")
		_ = mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "無関係")

		alice := f.principalFor(ctx, t, f.alice)
		bob := f.principalFor(ctx, t, f.bob)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)
		f.grantSpace(ctx, t, f.spaceB, alice.ID, domain.GrantRoleViewer)
		f.grantSpace(ctx, t, f.spaceA, bob.ID, domain.GrantRoleViewer)
		// 機密のスペースへ入れるのは bob だけ（1 ページ解決と同じ見方で、検索にも効くこと）。
		f.grantSpace(ctx, t, spaceC, bob.ID, domain.GrantRoleViewer)

		got := searchFor(f, t, f.alice, "docker")
		// 並びは題名順（"Docker 手順" < "docker 入門" は ILIKE ではなく ORDER BY title 依存）。
		// 順序はロケールに寄るので、集合として確かめる。
		assert.ElementsMatch(t, []string{inA.ID, inB.ID}, got)
		// bob は private スペースへ入れるので機密も出る。一方 B の付与は無いので
		// B のページは出ない（スペースごとの権限が検索でも効いている確認を兼ねる）。
		assert.ElementsMatch(t, []string{inA.ID, secret.ID}, searchFor(f, t, f.bob, "docker"))
	})

	t.Run("付与の届かない木は検索に出ない", func(t *testing.T) {
		// 一覧（木）では届いていない枝の中身は出ない。検索が別の判定を持つと
		// 「木には出ないのに検索では出る」穴になる — 同じ ResolvePageView を通る確認。
		f := setupKBPermission(t, sqlDB)
		parent := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "親")
		child := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, &parent.ID, "Docker 子")
		alice := f.principalFor(ctx, t, f.alice)
		// alice が持つのは別スペースの付与だけ（この木へは 1 つも届かない）。
		f.grantSpace(ctx, t, f.spaceB, alice.ID, domain.GrantRoleViewer)

		assert.Empty(t, searchFor(f, t, f.alice, "docker"), "届いていない木の子 %s が検索に出ている", child.ID)

		// この木のスペースへ付与を張ると出る（上の Empty が空振りでないことの確認。
		// 親は題名が一致しないので出ない）。
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)
		assert.Equal(t, []string{child.ID}, searchFor(f, t, f.alice, "docker"),
			"スペースの付与は検索の経路にも効く")
	})

	t.Run("ワークスペースの境界を越えない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		mine := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "共通の題名")
		_ = mustCreatePage(ctx, t, f.pageUC, f.otherWS, f.otherSpc, nil, "共通の題名")
		alice := f.principalFor(ctx, t, f.alice)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)

		assert.Equal(t, []string{mine.ID}, searchFor(f, t, f.alice, "共通"))
	})

	t.Run("LIKE の記号は文字として扱う（% で全件は返らない）", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		literal := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "進捗 100% の報告")
		_ = mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "無関係")
		alice := f.principalFor(ctx, t, f.alice)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)

		assert.Equal(t, []string{literal.ID}, searchFor(f, t, f.alice, "100%"),
			"% がワイルドカードのまま渡ると全件一致になる")
	})

	t.Run("アーカイブ済みは検索に出ない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		gone := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "Docker 旧版")
		alice := f.principalFor(ctx, t, f.alice)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)
		require.NoError(t, f.pages.ArchivePageSubtree(ctx, f.ws, gone.ID))

		assert.Empty(t, searchFor(f, t, f.alice, "docker"))
	})

	t.Run("打ち間違いを pg_trgm の word_similarity であいまい検索で拾う", func(t *testing.T) {
		// 「コート」は「コード」の 1 文字違いの打ち間違い。ILIKE '%needle%' の中間一致
		// では文字が異なるため絶対に拾えない（拾えてしまったら ILIKE 側の実装が壊れている）。
		// word_similarity の OR 枝が実際に効いていることをこのテストで確かめる
		// （schema.hcl 冒頭「pg_trgm 拡張について」・2026-09-09 決定）。
		f := setupKBPermission(t, sqlDB)
		typo := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "認証コードの発行手順")
		_ = mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "無関係")
		alice := f.principalFor(ctx, t, f.alice)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)

		assert.Equal(t, []string{typo.ID}, searchFor(f, t, f.alice, "認証コート"),
			"打ち間違い「認証コート」が word_similarity のあいまい検索で拾えていない")
	})
}

func TestKnowledgeBaseUpdateSpaceName_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	t.Run("名前だけが変わり key は変わらない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		require.NoError(t, f.pages.UpdateSpaceName(ctx, f.ws, f.spaceA, "改組後の名前"))
		sp, err := f.pages.FindSpace(ctx, f.ws, f.spaceA)
		require.NoError(t, err)
		assert.Equal(t, "改組後の名前", sp.Name)
		assert.Equal(t, "aaa", sp.Key)
	})

	t.Run("別ワークスペースのスペース ID は not found", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		err := f.pages.UpdateSpaceName(ctx, f.ws, f.otherSpc, "越境")
		assert.ErrorIs(t, err, repository.ErrSpaceNotFound)
		// 相手側の名前が変わっていないこと（0 件更新の確認を裏からも取る）。
		sp, ferr := f.pages.FindSpace(ctx, f.otherWS, f.otherSpc)
		require.NoError(t, ferr)
		assert.NotEqual(t, "越境", sp.Name)
	})
}

// ページ参照の題名解決に使う ID 指定の可視事実。検索と同じ規則で判定されることと、
// 境界（他ワークスペース・不正 ID・private のスペース）を実 PostgreSQL で確かめる。
func TestKnowledgeBaseViewFactsByIDs_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	t.Run("指定IDの現役ページだけが返り、届いていないページは閲覧不可で載る", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		// 機密は private のスペースへ置く。alice はワークスペース全体の付与を持つが、
		// private のスペースにはそれが届かない（この口が visibility を見ている確認）。
		secretSpace := createSpace(t, sqlDB, f.ws, "secret")
		f.makePrivate(t, secretSpace)

		visible := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "見えるページ")
		secret := mustCreatePage(ctx, t, f.pageUC, f.ws, secretSpace, nil, "機密ページ")
		other := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "頼んでいないページ")
		archived := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "アーカイブしたページ")
		require.NoError(t, f.pages.ArchivePageSubtree(ctx, f.ws, archived.ID))

		alice := f.principalFor(ctx, t, f.alice)
		_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleViewer, f.alice)
		require.NoError(t, err)

		rows, err := f.perm.ListWorkspacePageViewFactsByIDs(ctx, f.ws, f.alice,
			[]string{visible.ID, secret.ID, archived.ID, "not-a-uuid"})
		require.NoError(t, err)
		require.Len(t, rows, 3,
			"頼んだ ID のページが返る（不正 ID は静かに落ちる。アーカイブ済みは行として返り、除外は用途側の判断）")

		byID := map[string]bool{}
		archivedAt := map[string]bool{}
		for _, row := range rows {
			byID[row.Page.ID] = domain.ResolvePageView(row.Role, row.Page.Visibility, row.Page.CreatedByUserID == f.alice)
			archivedAt[row.Page.ID] = row.Page.ArchivedAt != nil
		}
		assert.True(t, byID[visible.ID], "付与が届くページは閲覧できる")
		assert.False(t, byID[secret.ID],
			"private のスペースへワークスペース全体の付与は届かない（検索と同じ規則）")
		assert.True(t, archivedAt[archived.ID], "アーカイブ済みは ArchivedAt 付きで返る（呼び出し側が除外を判断できる）")
		assert.False(t, archivedAt[visible.ID])
		// 頼んでいない ID は返らない（ID で絞る口が全件の口にならない証拠）。
		_, unrequested := byID[other.ID]
		assert.False(t, unrequested)
	})

	t.Run("他ワークスペースのIDは返らない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		// alice は f.ws の正規メンバー（境界を跨げないことを、権限がある状態で確かめる）。
		// fixture をもう 1 つ作らないのは、setupKBPermission が先頭で TruncateAll を
		// 実行し、先に作った fixture の行が全部消えてしまうため。
		alice := f.principalFor(ctx, t, f.alice)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleViewer)
		foreign := mustCreatePage(ctx, t, f.pageUC, f.otherWS, f.otherSpc, nil, "よそのページ")

		rows, err := f.perm.ListWorkspacePageViewFactsByIDs(ctx, f.ws, f.alice, []string{foreign.ID})
		require.NoError(t, err)
		assert.Empty(t, rows, "ワークスペース境界を跨いで題名を引けない")
	})
}

// ワークスペースの人の一覧。担当の表示名と発言での名指しに使うので、人だけを返し、
// 人でない主体（グループ / スペース全員）は含めない。
func TestKnowledgeBaseListWorkspaceMembers_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	t.Run("人だけを名前順で返し_principalIdとuserIdを対で持つ", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		bob := f.principalFor(ctx, t, f.bob)
		// 人でない主体を混ぜる。どちらも一覧に出てはいけない。
		f.everyoneOf(ctx, t, f.spaceA)
		_, err := f.perm.CreateGroupPrincipal(ctx, f.ws, "開発チーム")
		require.NoError(t, err)

		members, err := f.perm.ListWorkspaceMembers(ctx, f.ws)
		require.NoError(t, err)

		require.Len(t, members, 2, "人でない主体（スペース全員 / グループ）は含めない")
		assert.Equal(t, "alice", members[0].Name, "並びは表示名の順")
		assert.Equal(t, "bob", members[1].Name)
		assert.Equal(t, alice.ID, members[0].PrincipalID)
		assert.Equal(t, f.alice, members[0].UserID)
		assert.Equal(t, bob.ID, members[1].PrincipalID)
		assert.Equal(t, f.bob, members[1].UserID)
	})

	t.Run("消えたユーザーは落とす", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.principalFor(ctx, t, f.alice)
		f.principalFor(ctx, t, f.bob)
		_, err := f.db.Exec(`UPDATE users SET status = 'deactivated', deleted_at = now() WHERE id = $1`, f.bob)
		require.NoError(t, err)

		members, err := f.perm.ListWorkspaceMembers(ctx, f.ws)
		require.NoError(t, err)

		require.Len(t, members, 1, "消えたユーザーは名指しても届かず担当にも選べない")
		assert.Equal(t, f.alice, members[0].UserID)
	})

	t.Run("他ワークスペースの人は返らない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.principalFor(ctx, t, f.alice)
		_, err := f.perm.EnsureUserPrincipal(ctx, f.otherWS, f.carol)
		require.NoError(t, err)

		members, err := f.perm.ListWorkspaceMembers(ctx, f.ws)
		require.NoError(t, err)

		require.Len(t, members, 1)
		assert.Equal(t, f.alice, members[0].UserID, "よそのワークスペースの所属は混ざらない")
	})

	t.Run("停止中のユーザーも落とす", func(t *testing.T) {
		// 「消えたユーザーは落とす」（退会 = deactivated）とは別の状態。旧クエリは
		// status <> 'deactivated' しか見ておらず、停止（suspended）は漏れて残っていた
		// （段 5 の修理対象）。
		f := setupKBPermission(t, sqlDB)
		f.principalFor(ctx, t, f.alice)
		f.principalFor(ctx, t, f.bob)
		_, err := f.db.Exec(`UPDATE users SET status = 'suspended' WHERE id = $1`, f.bob)
		require.NoError(t, err)

		members, err := f.perm.ListWorkspaceMembers(ctx, f.ws)
		require.NoError(t, err)

		require.Len(t, members, 1, "停止中も名指し・担当の候補から外す")
		assert.Equal(t, f.alice, members[0].UserID)
	})

	t.Run("所属が有効でないと落とすしアイコンと状態メッセージも返る", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		_, err := f.db.Exec(
			`INSERT INTO profiles (user_id, bio, avatar_url, status_text, updated_at)
			 VALUES ($1, '', $2, $3, now())`,
			f.alice, "https://example.test/alice.png", "会議中",
		)
		require.NoError(t, err)

		// principal だけを作り、workspace_members は意図的に left のまま残す
		// （不変条件が崩れた状態を人為的に作る。principal(kind=user) がある ⟺ workspace_members が
		// active、という段 2 の不変条件はアプリ側の約束でしかなく DB 制約では縛られていないため、
		// 崩れた場合の防御を workspace_members 側の JOIN 単独でも確かめておく）。
		leftPrincipal, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.bob)
		require.NoError(t, err)
		_, err = f.db.Exec(
			`INSERT INTO workspace_members (workspace_id, user_id, status, joined_at, left_at)
			 VALUES ($1, $2, 'left', now(), now())`,
			f.ws, f.bob,
		)
		require.NoError(t, err)

		members, err := f.perm.ListWorkspaceMembers(ctx, f.ws)
		require.NoError(t, err)

		require.Len(t, members, 1)
		assert.Equal(t, alice.ID, members[0].PrincipalID)
		assert.Equal(t, "https://example.test/alice.png", members[0].AvatarURL)
		assert.Equal(t, "会議中", members[0].StatusMessage)
		for _, m := range members {
			assert.NotEqual(t, leftPrincipal.ID, m.PrincipalID, "所属を終えた人は残らない")
		}
	})
}

// TestWorkspaceMembership_Integration は段 2（招待→受諾フロー）の主体・権限・
// workspace_members の書き込みそのものを実 PostgreSQL で確かめる。
func TestWorkspaceMembership_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	// membershipStatus は workspace_members.status を直接読む（repository には
	// 行そのものを返す口が無いため、検証用に SQL で見る）。
	membershipStatus := func(t *testing.T, workspaceID string, userID uint64) (status string, ok bool) {
		t.Helper()
		err := sqlDB.QueryRow(
			`SELECT status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
			workspaceID, userID,
		).Scan(&status)
		if errors.Is(err, sql.ErrNoRows) {
			return "", false
		}
		require.NoError(t, err)
		return status, true
	}

	t.Run("招待だけでは所属もprincipalも権限も発生しない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)

		f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)

		_, ok := membershipStatus(t, f.ws, f.bob)
		assert.False(t, ok, "workspace_members に行を作らない（承諾するまで）")
		_, err := f.perm.FindUserPrincipal(ctx, f.ws, f.bob)
		assert.ErrorIs(t, err, repository.ErrPrincipalNotFound, "承諾するまで principal は無い")
		member, err := f.perm.IsWorkspaceMember(ctx, f.ws, f.bob)
		require.NoError(t, err)
		assert.False(t, member)
	})

	t.Run("承諾するとactiveになりprincipalができ招待の役割が届く", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		inv := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)

		f.acceptInvitation(ctx, t, inv, f.bob)

		status, ok := membershipStatus(t, f.ws, f.bob)
		require.True(t, ok)
		assert.Equal(t, "active", status)
		member, err := f.perm.IsWorkspaceMember(ctx, f.ws, f.bob)
		require.NoError(t, err)
		assert.True(t, member)
		principal, err := f.perm.FindUserPrincipal(ctx, f.ws, f.bob)
		require.NoError(t, err)
		assert.Equal(t, domain.PrincipalKindUser, principal.Kind)

		page := mustCreatePage(ctx, t, f.pageUC, f.ws, f.spaceA, nil, "承諾後に見えるはず")
		assert.True(t, f.permFor(ctx, t, page.ID, f.bob).CanEdit, "招待の役割（editor）が届く")

		mine, err := f.invitations.ListOpenByEmail(ctx, f.emailOf(t, f.bob))
		require.NoError(t, err)
		assert.Empty(t, mine, "承諾済みは自分宛の一覧から消える")
	})

	t.Run("辞退すると所属の行は作られず主体も無い", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		inv := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)

		require.NoError(t, f.invitations.Decline(ctx, inv.ID, f.bob, f.emailOf(t, f.bob)))

		_, ok := membershipStatus(t, f.ws, f.bob)
		assert.False(t, ok, "辞退は workspace_members に何も書かない")
		_, err := f.perm.FindUserPrincipal(ctx, f.ws, f.bob)
		assert.ErrorIs(t, err, repository.ErrPrincipalNotFound)

		// 辞退済みの招待はもう承諾できない。
		_, err = f.invitations.Accept(ctx, inv.ID, f.bob, f.emailOf(t, f.bob))
		assert.ErrorIs(t, err, repository.ErrInvitationNotOpen)
	})

	t.Run("辞退のあとは新しい招待を出して承諾できる", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		first := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)
		require.NoError(t, f.invitations.Decline(ctx, first.ID, f.bob, f.emailOf(t, f.bob)))

		second := f.invite(ctx, t, f.bob, f.carol, domain.GrantRoleViewer)
		assert.NotEqual(t, first.ID, second.ID, "辞退した行は再利用せず新しい行を作る")

		f.acceptInvitation(ctx, t, second, f.bob)
		status, ok := membershipStatus(t, f.ws, f.bob)
		require.True(t, ok)
		assert.Equal(t, "active", status)
	})

	t.Run("既にactiveな相手が承諾しても役割は上書きしない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.acceptInvitation(ctx, t, f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor), f.bob)
		principal, err := f.perm.FindUserPrincipal(ctx, f.ws, f.bob)
		require.NoError(t, err)
		// admin へ格上げしてから viewer で招き直して承諾しても admin のまま
		// （役割は無いときだけ与える。変更は権限画面の操作で行う）。
		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, principal.ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)

		f.acceptInvitation(ctx, t, f.invite(ctx, t, f.bob, f.carol, domain.GrantRoleViewer), f.bob)

		status, ok := membershipStatus(t, f.ws, f.bob)
		require.True(t, ok)
		assert.Equal(t, "active", status, "active はそのまま")
		var role string
		require.NoError(t, f.db.QueryRow(
			`SELECT role FROM workspace_grants WHERE workspace_id = $1 AND principal_id = $2`,
			f.ws, principal.ID,
		).Scan(&role))
		assert.Equal(t, "admin", role, "招き直しで admin が viewer に落ちない")
	})

	t.Run("退出すると主体が消え記録はleftのまま残る", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.acceptInvitation(ctx, t, f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor), f.bob)

		require.NoError(t, f.perm.LeaveWorkspaceMembership(ctx, f.ws, f.bob, f.bob))

		status, ok := membershipStatus(t, f.ws, f.bob)
		require.True(t, ok, "記録は消えない")
		assert.Equal(t, "left", status)
		_, err := f.perm.FindUserPrincipal(ctx, f.ws, f.bob)
		assert.ErrorIs(t, err, repository.ErrPrincipalNotFound, "principal は消える")
	})

	t.Run("退出した人を招き直して承諾するとleftからactiveへ戻る", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.acceptInvitation(ctx, t, f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor), f.bob)
		require.NoError(t, f.perm.LeaveWorkspaceMembership(ctx, f.ws, f.bob, f.bob))

		f.acceptInvitation(ctx, t, f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleViewer), f.bob)

		status, ok := membershipStatus(t, f.ws, f.bob)
		require.True(t, ok)
		assert.Equal(t, "active", status)
		var leftAt sql.NullTime
		require.NoError(t, f.db.QueryRow(
			`SELECT left_at FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, f.ws, f.bob,
		).Scan(&leftAt))
		assert.False(t, leftAt.Valid, "戻ったら left_at は消える")
	})

	t.Run("非メンバーの退出は何もしない（冪等）", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		require.NoError(t, f.perm.LeaveWorkspaceMembership(ctx, f.ws, f.bob, f.alice))
		_, ok := membershipStatus(t, f.ws, f.bob)
		assert.False(t, ok, "行自体を作らない")
	})

	t.Run("承諾は実在しないユーザーだとErrUserNotFound", func(t *testing.T) {
		// workspace_members.user_id は users への FK。宛先が一致しても、その id の行が
		// 無ければ制約違反になる — 入力の誤りであってサーバの故障ではない。
		f := setupKBPermission(t, sqlDB)
		inv := f.invite(ctx, t, f.bob, f.alice, domain.GrantRoleEditor)
		_, err := f.invitations.Accept(ctx, inv.ID, 999999999, f.emailOf(t, f.bob))
		assert.ErrorIs(t, err, repository.ErrUserNotFound)
		_, ok := membershipStatus(t, f.ws, 999999999)
		assert.False(t, ok)
	})

	t.Run("ck_workspace_members_statusは4値以外を拒否する", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		_, err := f.db.Exec(
			`INSERT INTO workspace_members (workspace_id, user_id, status) VALUES ($1, $2, 'banned')`,
			f.ws, f.bob,
		)
		require.ErrorContains(t, err, "ck_workspace_members_status")
	})

	t.Run("自分でワークスペースを作ると直接activeになる", func(t *testing.T) {
		provisioner := persistence.NewWorkspaceProvisioner(sqlDB)
		testsupport.TruncateAll(t, sqlDB, kbTables...)
		owner := createUser(t, sqlDB, "owner")

		ws, err := provisioner.ProvisionWorkspace(ctx, repository.WorkspaceProvisionInput{
			Slug: "self-made", Name: "自作ワークスペース", OwnerUserID: owner,
		})
		require.NoError(t, err)

		status, ok := membershipStatus(t, ws.ID, owner)
		require.True(t, ok)
		assert.Equal(t, "active", status, "招待の手順を踏まず直接 active")
	})
}

// TestListWorkspaceMembersForAdmin_Integration はメンバー管理画面（段 7）向けの一覧を
// 実 PostgreSQL で検証する。ListWorkspaceMembers（名指し用）と違い、停止中のアカウントを
// 落とさないこと・ワークスペース全体の役割を一緒に返すことがこの一覧の存在理由なので、
// そこだけを見る（合成・実効権限の規則そのものは TestKnowledgeBasePermission_Integration が持つ）。
func TestListWorkspaceMembersForAdmin_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	users := persistence.NewUserRepository(sqlDB)

	t.Run("停止中でも一覧から落ちない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.principalFor(ctx, t, f.alice)
		f.principalFor(ctx, t, f.bob)
		require.NoError(t, users.UpdateActive(ctx, f.bob, false))

		got, err := f.perm.ListWorkspaceMembersForAdmin(ctx, f.ws)
		require.NoError(t, err)

		byUserID := map[uint64]domain.AdminWorkspaceMember{}
		for _, m := range got {
			byUserID[m.UserID] = m
		}
		require.Contains(t, byUserID, f.bob, "ListWorkspaceMembers と違い、停止中でも消えない")
		assert.Equal(t, domain.UserStatusSuspended, byUserID[f.bob].AccountStatus)
		assert.Equal(t, domain.UserStatusActive, byUserID[f.alice].AccountStatus)
	})

	t.Run("ワークスペース全体の役割を一緒に返す。持たない相手はnil", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alicePrincipal := f.principalFor(ctx, t, f.alice)
		_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws, alicePrincipal.ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)
		f.principalFor(ctx, t, f.bob) // 役割は張らない

		got, err := f.perm.ListWorkspaceMembersForAdmin(ctx, f.ws)
		require.NoError(t, err)

		byUserID := map[uint64]domain.AdminWorkspaceMember{}
		for _, m := range got {
			byUserID[m.UserID] = m
		}
		require.NotNil(t, byUserID[f.alice].Role)
		assert.Equal(t, domain.GrantRoleAdmin, *byUserID[f.alice].Role)
		assert.Nil(t, byUserID[f.bob].Role, "役割を持たない相手は nil のまま")
	})

	t.Run("退出済みは落ちる", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.principalFor(ctx, t, f.alice)
		f.principalFor(ctx, t, f.bob)
		require.NoError(t, f.perm.LeaveWorkspaceMembership(ctx, f.ws, f.bob, f.bob))

		got, err := f.perm.ListWorkspaceMembersForAdmin(ctx, f.ws)
		require.NoError(t, err)

		for _, m := range got {
			assert.NotEqual(t, f.bob, m.UserID, "退出済みは一覧に残らない")
		}
	})
}

// TestListSpaceMembers_Integration はスペースメンバーの読み取り（段9）の継承規則を固定する:
// 直接付与・グループ経由・スペース全員・ワークスペース全体からの継承、private スペースへの
// 非到達、複数経路のうち最も強い役割（同点は direct 優先）、テナント分離、停止/退出の除外。
func TestListSpaceMembers_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()
	users := persistence.NewUserRepository(sqlDB)

	byUserID := func(members []domain.SpaceMember) map[uint64]domain.SpaceMember {
		out := map[uint64]domain.SpaceMember{}
		for _, m := range members {
			out[m.UserID] = m
		}
		return out
	}

	t.Run("直接付与はdirect", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleEditor)

		got, err := f.perm.ListSpaceMembers(ctx, f.ws, f.spaceA)
		require.NoError(t, err)
		m := byUserID(got)
		require.Contains(t, m, f.alice)
		assert.Equal(t, domain.GrantRoleEditor, m[f.alice].Role)
		assert.Equal(t, "direct", m[f.alice].Via)
	})

	t.Run("グループ経由はgroup", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		bobPrincipal := f.principalFor(ctx, t, f.bob)
		group, err := f.perm.CreateGroupPrincipal(ctx, f.ws, "開発")
		require.NoError(t, err)
		require.NoError(t, f.perm.AddGroupMember(ctx, f.ws, group.ID, bobPrincipal.ID))
		f.grantSpace(ctx, t, f.spaceA, group.ID, domain.GrantRoleCommenter)

		got, err := f.perm.ListSpaceMembers(ctx, f.ws, f.spaceA)
		require.NoError(t, err)
		m := byUserID(got)
		require.Contains(t, m, f.bob)
		assert.Equal(t, domain.GrantRoleCommenter, m[f.bob].Role)
		assert.Equal(t, "group", m[f.bob].Via)
	})

	t.Run("スペース全員はgroup", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.principalFor(ctx, t, f.carol)
		everyone := f.everyoneOf(ctx, t, f.spaceA)
		f.grantSpace(ctx, t, f.spaceA, everyone.ID, domain.GrantRoleViewer)

		got, err := f.perm.ListSpaceMembers(ctx, f.ws, f.spaceA)
		require.NoError(t, err)
		m := byUserID(got)
		require.Contains(t, m, f.carol)
		assert.Equal(t, domain.GrantRoleViewer, m[f.carol].Role)
		assert.Equal(t, "group", m[f.carol].Via)
	})

	t.Run("ワークスペース全体はworkspace_visibilityのスペースにだけ届く", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleEditor, f.alice)
		require.NoError(t, err)

		got, err := f.perm.ListSpaceMembers(ctx, f.ws, f.spaceA)
		require.NoError(t, err)
		m := byUserID(got)
		require.Contains(t, m, f.alice)
		assert.Equal(t, domain.GrantRoleEditor, m[f.alice].Role)
		assert.Equal(t, "workspace", m[f.alice].Via)

		f.makePrivate(t, f.spaceB)
		gotPrivate, err := f.perm.ListSpaceMembers(ctx, f.ws, f.spaceB)
		require.NoError(t, err)
		assert.NotContains(t, byUserID(gotPrivate), f.alice,
			"private スペースにはワークスペース全体の付与を届かせない")
	})

	// 変異確認: ListSpaceMembers（knowledge_base_permission_repository.go）の
	// role.Rank() > cur.role.Rank() を「常に false」に壊すと、workspace 経由の viewer が
	// 残ってこのテストが落ちる。
	t.Run("複数経路のうち最も強い役割_同点はdirect優先", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleViewer, f.alice)
		require.NoError(t, err)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleAdmin)

		got, err := f.perm.ListSpaceMembers(ctx, f.ws, f.spaceA)
		require.NoError(t, err)
		m := byUserID(got)
		require.Contains(t, m, f.alice)
		assert.Equal(t, domain.GrantRoleAdmin, m[f.alice].Role, "強い方（space の admin）を採る")
		assert.Equal(t, "direct", m[f.alice].Via)
	})

	t.Run("別ワークスペースの人は混ざらない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleEditor)
		// otherWS の bob にも同じ強さの付与をしておく（テナント越えで紛れ込まないことを見る）。
		f.makeActiveMember(t, f.otherWS, f.bob)
		bobOther, err := f.perm.EnsureUserPrincipal(ctx, f.otherWS, f.bob)
		require.NoError(t, err)
		_, err = f.perm.UpsertSpaceGrant(ctx, f.otherWS, f.otherSpc, bobOther.ID, domain.GrantRoleEditor)
		require.NoError(t, err)

		got, err := f.perm.ListSpaceMembers(ctx, f.ws, f.spaceA)
		require.NoError(t, err)
		m := byUserID(got)
		require.Contains(t, m, f.alice)
		assert.NotContains(t, m, f.bob)
	})

	t.Run("停止中・退出済みは落ちる", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleEditor)
		bob := f.principalFor(ctx, t, f.bob)
		f.grantSpace(ctx, t, f.spaceA, bob.ID, domain.GrantRoleEditor)
		carol := f.principalFor(ctx, t, f.carol)
		f.grantSpace(ctx, t, f.spaceA, carol.ID, domain.GrantRoleEditor)

		require.NoError(t, users.UpdateActive(ctx, f.bob, false))
		require.NoError(t, f.perm.LeaveWorkspaceMembership(ctx, f.ws, f.carol, f.carol))

		got, err := f.perm.ListSpaceMembers(ctx, f.ws, f.spaceA)
		require.NoError(t, err)
		m := byUserID(got)
		assert.Contains(t, m, f.alice)
		assert.NotContains(t, m, f.bob, "停止中は落ちる")
		assert.NotContains(t, m, f.carol, "退出済みは落ちる")
	})
}

// TestListMySpaces_Integration は ListSpaceMembers の向きを逆にしたもの（段 14。
// GET /me/spaces 用。1 人→全スペース）を実 PostgreSQL で検証する。継承規則そのものは
// TestListSpaceMembers_Integration と共有の SQL（space_reachable 相当）なので、ここでは
// 向きを変えたことで壊れやすい観点（複数スペースへの展開・テナント分離・役割未設定は
// 空）に絞る。
func TestListMySpaces_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	byID := func(spaces []domain.MySpace) map[string]domain.MySpace {
		out := map[string]domain.MySpace{}
		for _, s := range spaces {
			out[s.ID] = s
		}
		return out
	}

	t.Run("直接付与されたスペースだけが返る", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleEditor)

		got, err := f.perm.ListMySpaces(ctx, f.ws, f.alice)
		require.NoError(t, err)
		m := byID(got)
		require.Contains(t, m, f.spaceA)
		assert.Equal(t, "aaa", m[f.spaceA].Name)
		assert.Equal(t, domain.GrantRoleEditor, m[f.spaceA].Role)
		assert.NotContains(t, m, f.spaceB, "役割を持たないスペースは返らない")
	})

	t.Run("ワークスペース全体の付与は複数スペースへ展開されるがprivateには届かない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleViewer, f.alice)
		require.NoError(t, err)
		f.makePrivate(t, f.spaceB)

		got, err := f.perm.ListMySpaces(ctx, f.ws, f.alice)
		require.NoError(t, err)
		m := byID(got)
		require.Contains(t, m, f.spaceA)
		assert.Equal(t, domain.GrantRoleViewer, m[f.spaceA].Role)
		assert.NotContains(t, m, f.spaceB, "private スペースにはワークスペース全体の付与を届かせない")
	})

	// 変異確認: knowledgeBasePermissionRepository.ListMySpaces の role.Rank() 比較を
	// 「常に false」に壊すと、workspace 経由の viewer が残ってこのテストが落ちる。
	t.Run("同じスペースへの複数経路は最も強い役割に集約する", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleViewer, f.alice)
		require.NoError(t, err)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleAdmin)

		got, err := f.perm.ListMySpaces(ctx, f.ws, f.alice)
		require.NoError(t, err)
		m := byID(got)
		require.Contains(t, m, f.spaceA)
		assert.Equal(t, domain.GrantRoleAdmin, m[f.spaceA].Role, "強い方（space の admin）を採る")
	})

	t.Run("別ワークスペースのスペースは混ざらない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice := f.principalFor(ctx, t, f.alice)
		f.grantSpace(ctx, t, f.spaceA, alice.ID, domain.GrantRoleEditor)
		// 別ワークスペースにも同じユーザーへ同じ強さの付与をしておく（テナント越えで
		// 紛れ込まないことを見る）。
		f.makeActiveMember(t, f.otherWS, f.alice)
		aliceOther, err := f.perm.EnsureUserPrincipal(ctx, f.otherWS, f.alice)
		require.NoError(t, err)
		_, err = f.perm.UpsertSpaceGrant(ctx, f.otherWS, f.otherSpc, aliceOther.ID, domain.GrantRoleEditor)
		require.NoError(t, err)

		got, err := f.perm.ListMySpaces(ctx, f.ws, f.alice)
		require.NoError(t, err)
		m := byID(got)
		require.Contains(t, m, f.spaceA)
		assert.NotContains(t, m, f.otherSpc)
	})

	t.Run("役割を何も持たなければ空", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		f.principalFor(ctx, t, f.alice)

		got, err := f.perm.ListMySpaces(ctx, f.ws, f.alice)
		require.NoError(t, err)
		assert.Empty(t, got)
	})
}
