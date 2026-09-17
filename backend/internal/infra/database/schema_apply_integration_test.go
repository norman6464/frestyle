//go:build integration

// Package database_test は起動時に適用するスキーマ（database.ApplySchema）そのものを
// 本物の PostgreSQL に対して検証する。
//
// testsupport.OpenTestDB は ApplySchema を呼ぶだけで、テーブルの並びや制約の詳細までは
// 見ない。ここで実際に張られた表・制約・索引を突き合わせ、schema.hcl の変更が
// schema.gen.sql と食い違ったまま出荷される事故を防ぐ。
package database_test

import (
	"database/sql"
	"testing"
	"time"

	"github.com/norman6464/frestyle/backend/internal/infra/database"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/stretchr/testify/require"
)

// TestApplySchema_Integration はまっさらな DB へ ApplySchema を流し、期待する形になることを固定する。
func TestApplySchema_Integration(t *testing.T) {
	db := testsupport.OpenTestDB(t)
	ctx := t.Context()
	resetPublicSchema(t, db)

	require.NoError(t, database.ApplySchema(ctx, db))

	t.Run("中核テーブルが揃っている", func(t *testing.T) {
		for _, table := range []string{
			"users", "user_oidc_identities",
			"notifications",
		} {
			require.True(t, tableExists(t, db, table), "中核テーブル %s が無い", table)
		}
	})

	t.Run("roles マスタは作られない", func(t *testing.T) {
		// アプリ全体のロール（かつての users.role）は撤去済み。参照先マスタも作らない。
		require.False(t, tableExists(t, db, "roles"), "roles テーブルが残っている")
	})

	t.Run("退役済みのテナント移行期テーブルは作られない", func(t *testing.T) {
		// companies / company_applications / company_exercises はテナントの正本が
		// workspaces へ完全移行済みのレガシー（退役 PR で撤去）。
		for _, table := range []string{"companies", "company_applications", "company_exercises"} {
			require.False(t, tableExists(t, db, table), "退役済みのテーブル %s が残っている", table)
		}
	})

	t.Run("退役済みの演習テーブルは作られない", func(t *testing.T) {
		for _, table := range []string{"master_exercises", "master_exercise_examples", "exercise_submissions"} {
			require.False(t, tableExists(t, db, table), "退役済みのテーブル %s が残っている", table)
		}
	})

	t.Run("ナレッジと権限モデルが揃っている", func(t *testing.T) {
		for _, table := range []string{
			"workspaces", "spaces", "pages", "blocks", "page_paths", "page_snapshots",
			"principals", "principal_members", "workspace_grants", "space_grants",
			"page_grants", "share_links",
		} {
			require.True(t, tableExists(t, db, table), "ナレッジのテーブル %s が無い", table)
		}
	})

	t.Run("権限を打ち消す置き場は作られない", func(t *testing.T) {
		// 権限は 3 段の付与（workspace / space / page）を足し合わせ、届いた中で
		// 最も強い役割で決まる。下の段が上の段を弱める仕組みは持たないので、その
		// 置き場だったテーブルが DDL に戻っていないことを見る。
		for _, table := range []string{"page_restrictions", "page_allow_lists"} {
			require.False(t, tableExists(t, db, table),
				"使わないテーブル %s が作られている（狭める側の仕組みは持たない）", table)
		}
	})

	t.Run("workspace_membersが所属の正本になっている（段2）", func(t *testing.T) {
		// users.workspace_id（1 人 1 ワークスペースの単一列）は撤去済み。
		// 所属は workspace_members（複数所属を許す）が正本。
		require.False(t, columnExists(t, db, "users", "workspace_id"))
		require.False(t, constraintExists(t, db, "users", "fk_users_workspace"))
		require.True(t, tableExists(t, db, "workspace_members"))
		require.True(t, constraintExists(t, db, "workspace_members", "fk_workspace_members_workspace"))
		require.True(t, constraintExists(t, db, "workspace_members", "fk_workspace_members_user"))
		require.True(t, constraintExists(t, db, "workspace_members", "fk_workspace_members_invited_by"))
		require.True(t, constraintExists(t, db, "workspace_members", "ck_workspace_members_status"))
	})

	t.Run("役割・識別子まわりの制約が張られている", func(t *testing.T) {
		require.True(t, constraintExists(t, db, "user_oidc_identities", "fk_user_oidc_identities_user"))
		require.True(t, constraintExists(t, db, "user_oidc_identities", "ck_user_oidc_identities_not_empty"))
		require.True(t, indexExists(t, db, "uq_users_email_active"))
	})

	t.Run("users.id への外部キーが表全体に張られている", func(t *testing.T) {
		// 段 1: 持ち物（CASCADE）3 列・記録（RESTRICT）16 列。削除時の実際の挙動は
		// users_foreign_key_integration_test.go の TestUsersForeignKey_Integration で確かめる。
		// ここでは代表列だけ存在を確認する（全 19 列を並べても on_delete の向きまでは見えないため）。
		require.True(t, constraintExists(t, db, "profiles", "fk_profiles_user"))
		require.True(t, constraintExists(t, db, "pages", "fk_pages_created_by"))
		require.True(t, constraintExists(t, db, "tickets", "fk_tickets_created_by"))
		require.True(t, constraintExists(t, db, "ticket_comment_reactions", "fk_ticket_comment_reactions_user"))

		// profiles.user_id は bigserial（独自シーケンス付き）から素の bigint に直した
		// （段 1）。default が残っていない ＝ 独自のシーケンスをもう持たないことを確認する。
		var hasDefault bool
		require.NoError(t, db.QueryRowContext(
			t.Context(),
			`SELECT column_default IS NOT NULL FROM information_schema.columns
			  WHERE table_schema = current_schema() AND table_name = 'profiles' AND column_name = 'user_id'`,
		).Scan(&hasDefault))
		require.False(t, hasDefault, "profiles.user_id が bigserial の default を残している")
	})

	t.Run("password_hash は撤去されている（段 4）", func(t *testing.T) {
		// ログイン経路は発行者のトークン検証に一本化されており、ローカルのパスワード
		// 照合は行わない。列を残すと「パスワードログインもある」という誤解を招くため落とした。
		// share_links.password_hash（共有リンクを開くための別物のパスワード）は対象外。
		require.False(t, columnExists(t, db, "users", "password_hash"))
		require.True(t, columnExists(t, db, "share_links", "password_hash"))
	})

	t.Run("is_active は status に統合されている（段 3）", func(t *testing.T) {
		require.False(t, columnExists(t, db, "users", "is_active"))
		require.True(t, columnExists(t, db, "users", "status"))
		require.True(t, constraintExists(t, db, "users", "ck_users_status"))
		require.True(t, constraintExists(t, db, "users", "ck_users_status_deleted_at"))

		// workspaces.is_active は別物（テナントの有効/無効）で対象外。
		require.True(t, columnExists(t, db, "workspaces", "is_active"))
	})

	t.Run("users.status の CHECK 制約が張られている", func(t *testing.T) {
		insertUser := func(t *testing.T, email, status string, deletedAt *time.Time) error {
			t.Helper()
			_, err := db.ExecContext(
				ctx,
				`INSERT INTO users (email, name, status, deleted_at, created_at, updated_at)
				 VALUES ($1, $1, $2, $3, now(), now())`,
				email, status, deletedAt,
			)
			return err
		}
		now := time.Now()

		require.ErrorContains(t, insertUser(t, "bogus-status@example.test", "banned", nil), "ck_users_status")
		require.ErrorContains(t, insertUser(t, "active-but-deleted@example.test", "active", &now), "ck_users_status_deleted_at")
		require.ErrorContains(t, insertUser(t, "deactivated-but-not-deleted@example.test", "deactivated", nil), "ck_users_status_deleted_at")
		require.NoError(t, insertUser(t, "consistent-active@example.test", "active", nil))
		require.NoError(t, insertUser(t, "consistent-suspended@example.test", "suspended", nil))
		require.NoError(t, insertUser(t, "consistent-deactivated@example.test", "deactivated", &now))
	})
}

// resetPublicSchema は public schema を作り直して、まっさらな DB を再現する。
// 結合テストは serializeIntegration で 1 テスト関数ずつ直列に走るので、他のテストと
// 衝突しない（このテストが最後にスキーマを作り直して返す）。
func resetPublicSchema(t *testing.T, db *sql.DB) {
	t.Helper()
	_, err := db.ExecContext(t.Context(), `DROP SCHEMA public CASCADE`)
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `CREATE SCHEMA public`)
	require.NoError(t, err)
}

func tableExists(t *testing.T, db *sql.DB, table string) bool {
	t.Helper()
	var n int64
	require.NoError(t, db.QueryRowContext(t.Context(),
		`SELECT count(*) FROM information_schema.tables
		  WHERE table_schema = current_schema() AND table_name = $1`, table).Scan(&n))
	return n > 0
}

func columnExists(t *testing.T, db *sql.DB, table, column string) bool {
	t.Helper()
	var n int64
	require.NoError(t, db.QueryRowContext(t.Context(),
		`SELECT count(*) FROM information_schema.columns
		  WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
		table, column).Scan(&n))
	return n > 0
}

func constraintExists(t *testing.T, db *sql.DB, table, name string) bool {
	t.Helper()
	var n int64
	require.NoError(t, db.QueryRowContext(t.Context(),
		`SELECT count(*) FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass`,
		name, table).Scan(&n))
	return n > 0
}

func indexExists(t *testing.T, db *sql.DB, name string) bool {
	t.Helper()
	var n int64
	require.NoError(t, db.QueryRowContext(t.Context(),
		`SELECT count(*) FROM pg_indexes
		  WHERE schemaname = current_schema() AND indexname = $1`, name).Scan(&n))
	return n > 0
}
