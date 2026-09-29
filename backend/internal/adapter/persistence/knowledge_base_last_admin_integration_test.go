//go:build integration

package persistence_test

import (
	"context"
	"database/sql"
	"sync"
	"testing"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 「ワークスペースの admin が 0 人になる」ことを本物の PostgreSQL に対して塞げているかを見る。
//
// # なぜ 0 人がそこまで問題なのか
//
// ナレッジの権限は principals / grants だけで閉じており、
// 「アプリの super_admin なら通る」という抜け道を意図的に持たない。admin が 0 人になると、
// そのワークスペースの権限を変えられる人は API のどこにも居なくなる — **元 admin を含めて
// 誰も復旧できず、DB を直接触るしかない。** ほかの不具合と違って「あとから直す」が効かない。
//
// # なぜ単体テストでは足りないのか
//
// 塞いでいるのは PostgreSQL の行ロック（FOR UPDATE）と、それを書き込みと同じ
// トランザクションが握り続けることなので、fake repository では再現も検証もできない。
// 実際にこの検査が無かった頃は、2 本同時に流すと 60 回中 59 回 admin が 0 人になった。

// countWorkspaceUserAdmins は kind='user' の主体が持つ admin の数を数える。
// 「残る admin」として数えてよいのはこれだけ（グループ宛ての admin は、中身が空でも
// 行としては残るので、数に入れると誰も権限を変えられないワークスペースが同じようにできる）。
func countWorkspaceUserAdmins(t *testing.T, db *sql.DB, workspaceID string) int {
	t.Helper()
	var n int
	require.NoError(t, db.QueryRow(`
		SELECT count(*) FROM workspace_grants wg
		JOIN principals p ON p.workspace_id = wg.workspace_id AND p.id = wg.principal_id
		WHERE wg.workspace_id = $1 AND wg."role" = 'admin' AND p.kind = 'user'`,
		workspaceID).Scan(&n))
	return n
}

func TestKnowledgeBaseLastWorkspaceAdmin_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	ctx := context.Background()

	// removeAdmin は「admin を外す」3 通りの操作。どれも同じ検査を通らなければならない。
	//
	//   grant取り消し … workspace_grants の行を消す
	//   降格         … 行は残すが役割を admin から落とす（消さないだけで外す操作）
	//   メンバー削除 … principal を消す。grant は FK の CASCADE で一緒に消える
	type removeAdmin struct {
		name string
		do   func(f kbPermFixture, principalID string) error
	}
	removals := []removeAdmin{
		{"grant取り消し", func(f kbPermFixture, principalID string) error {
			return f.perm.DeleteWorkspaceGrant(ctx, f.ws, principalID, f.alice)
		}},
		{"降格", func(f kbPermFixture, principalID string) error {
			_, err := f.perm.UpsertWorkspaceGrant(ctx, f.ws, principalID, domain.GrantRoleEditor, f.alice)
			return err
		}},
		{"メンバー削除", func(f kbPermFixture, principalID string) error {
			return f.perm.DeletePrincipal(ctx, f.ws, principalID)
		}},
	}

	// setupTwoAdmins は admin 2 人（alice / bob）のワークスペースを作る。
	setupTwoAdmins := func(t *testing.T) (kbPermFixture, string, string) {
		t.Helper()
		f := setupKBPermission(t, sqlDB)
		ids := make([]string, 0, 2)
		for _, uid := range []uint64{f.alice, f.bob} {
			p, err := f.perm.EnsureUserPrincipal(ctx, f.ws, uid)
			require.NoError(t, err)
			_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, p.ID, domain.GrantRoleAdmin, uid)
			require.NoError(t, err)
			ids = append(ids, p.ID)
		}
		return f, ids[0], ids[1]
	}

	for _, first := range removals {
		for _, second := range removals {
			t.Run("同時に走らせても0人にならない/"+first.name+"×"+second.name, func(t *testing.T) {
				// 競合はタイミング次第なので 1 回では捕まらない。回数を重ねて
				// 「1 度も 0 人にならない」ことを見る（検査が無い実装なら数回で落ちる）。
				const trials = 30
				for i := 0; i < trials; i++ {
					f, aliceP, bobP := setupTwoAdmins(t)

					var wg sync.WaitGroup
					start := make(chan struct{})
					errs := make([]error, 2)
					for k, target := range []string{aliceP, bobP} {
						wg.Add(1)
						go func(k int, target string) {
							defer wg.Done()
							<-start // 2 本をできるだけ同時に走らせる
							if k == 0 {
								errs[k] = first.do(f, target)
							} else {
								errs[k] = second.do(f, target)
							}
						}(k, target)
					}
					close(start)
					wg.Wait()

					require.GreaterOrEqual(t, countWorkspaceUserAdmins(t, sqlDB, f.ws), 1,
						"admin が 0 人になると API から復旧できない（試行 %d 回目）", i+1)
					// 片方は必ず断られる。両方成功したのに admin が残っている、という
					// 「数だけ合っている」状態を見逃さないため、断り方も固定する。
					refused := 0
					for _, err := range errs {
						if err != nil {
							require.ErrorIs(t, err, repository.ErrLastWorkspaceAdmin)
							refused++
						}
					}
					assert.Equal(t, 1, refused, "同時に外せるのは 1 人だけ（試行 %d 回目）", i+1)
				}
			})
		}
	}

	t.Run("先の取り消しに割り込まれた側は待ってから断る", func(t *testing.T) {
		// 競合の中身を決定的に固定する。回数任せの上のテストと違い、
		// 「後から来た側が待ち、待ったあとに読み直して断る」ことそのものを見る。
		//
		// 検査を DELETE の EXISTS へ畳んで単一文にしただけでは、ここが通らない。
		// PostgreSQL の既定は READ COMMITTED で EXISTS は行をロックしないため、
		// 後から来た側は「相手の admin はまだ在る」と読んだまま自分の相手を消せてしまう
		// （実測でこの形は admin 0 人を再現した）。
		f, aliceP, bobP := setupTwoAdmins(t)

		// alice の admin 行を握ったまま止まっているトランザクションを用意する。
		blocker, err := sqlDB.BeginTx(ctx, nil)
		require.NoError(t, err)
		defer func() { _ = blocker.Rollback() }()
		var locked string
		require.NoError(t, blocker.QueryRowContext(ctx,
			`SELECT principal_id::text FROM workspace_grants
			 WHERE workspace_id = $1 AND principal_id = $2 FOR UPDATE`,
			f.ws, aliceP).Scan(&locked))

		// その裏で bob の admin を外そうとする。alice の行のロック待ちで止まるはず。
		done := make(chan error, 1)
		go func() { done <- f.perm.DeleteWorkspaceGrant(ctx, f.ws, bobP, f.alice) }()
		select {
		case err := <-done:
			t.Fatalf("admin 行がロックされている間に取り消しが通ってしまった: %v", err)
		case <-time.After(500 * time.Millisecond):
			// 待っている ＝ 期待どおり
		}

		// alice の admin をこちらで消してからコミットする。
		// 待っていた側は、目覚めたときには「もう alice は admin ではない」と読み直す。
		_, err = blocker.ExecContext(ctx,
			`DELETE FROM workspace_grants WHERE workspace_id = $1 AND principal_id = $2`,
			f.ws, aliceP)
		require.NoError(t, err)
		require.NoError(t, blocker.Commit())

		require.ErrorIs(t, <-done, repository.ErrLastWorkspaceAdmin,
			"待たされたあとに読み直して断ること（待つ前の判断を使い回さない）")
		assert.Equal(t, 1, countWorkspaceUserAdmins(t, sqlDB, f.ws), "bob の admin は残る")
	})

	t.Run("adminを与える向きは検査に掛からない", func(t *testing.T) {
		// admin を増やす操作まで断ってしまうと、最後の admin から抜け出す唯一の手
		// （先に誰かへ admin を渡す）が塞がる。
		f := setupKBPermission(t, sqlDB)
		alice, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)
		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)

		bob, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.bob)
		require.NoError(t, err)
		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, bob.ID, domain.GrantRoleAdmin, f.bob)
		require.NoError(t, err, "2 人目の admin は最後の admin が居ても張れる")

		require.NoError(t, f.perm.DeleteWorkspaceGrant(ctx, f.ws, alice.ID, f.alice), "渡したあとは自分を外せる")
		assert.Equal(t, 1, countWorkspaceUserAdmins(t, sqlDB, f.ws))
	})

	t.Run("グループ宛てのadminは残る数に入らない", func(t *testing.T) {
		// グループ宛ての admin を「残る admin」に数えると、中身が空のグループが
		// 最後の admin として残り、結局誰も権限を変えられないワークスペースができる。
		f := setupKBPermission(t, sqlDB)
		alice, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)
		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)
		group, err := f.perm.CreateGroupPrincipal(ctx, f.ws, "管理チーム")
		require.NoError(t, err)
		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, group.ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)

		require.ErrorIs(t, f.perm.DeleteWorkspaceGrant(ctx, f.ws, alice.ID, f.alice),
			repository.ErrLastWorkspaceAdmin, "グループの admin では代わりにならない")
	})

	t.Run("元からadminでない相手は何度でも外せる", func(t *testing.T) {
		// 検査は「admin を減らす操作」だけを断る。冪等な取り消しまで 409 にしない。
		f := setupKBPermission(t, sqlDB)
		alice, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)
		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)
		bob, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.bob)
		require.NoError(t, err)
		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, bob.ID, domain.GrantRoleViewer, f.alice)
		require.NoError(t, err)

		require.NoError(t, f.perm.DeleteWorkspaceGrant(ctx, f.ws, bob.ID, f.alice))
		require.NoError(t, f.perm.DeleteWorkspaceGrant(ctx, f.ws, bob.ID, f.alice), "2 回目も成功（冪等）")
		require.NoError(t, f.perm.DeletePrincipal(ctx, f.ws, bob.ID))
		assert.Equal(t, 1, countWorkspaceUserAdmins(t, sqlDB, f.ws))
	})

	t.Run("エラーで断ったときは1行も書き換えない", func(t *testing.T) {
		f := setupKBPermission(t, sqlDB)
		alice, err := f.perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
		require.NoError(t, err)
		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleAdmin, f.alice)
		require.NoError(t, err)

		_, err = f.perm.UpsertWorkspaceGrant(ctx, f.ws, alice.ID, domain.GrantRoleEditor, f.alice)
		require.ErrorIs(t, err, repository.ErrLastWorkspaceAdmin)
		require.ErrorIs(t, f.perm.DeletePrincipal(ctx, f.ws, alice.ID), repository.ErrLastWorkspaceAdmin)

		grants, err := f.perm.ListWorkspaceGrants(ctx, f.ws)
		require.NoError(t, err)
		require.Len(t, grants, 1)
		assert.Equal(t, domain.GrantRoleAdmin, grants[0].Role, "降格も削除も無かったことになっている")
		_, err = f.perm.FindPrincipal(ctx, f.ws, alice.ID)
		require.NoError(t, err, "主体も残っている")
	})
}
