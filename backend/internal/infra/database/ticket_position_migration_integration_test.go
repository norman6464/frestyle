//go:build integration

// Package database_test のこのファイルは、チケットの並び順を tickets.position から
// ticket_backlog_ranks へ移す移行そのものを検証する。
//
// まっさらな DB に最終形のスキーマを当てるテストでは、この移行は一度も走らない —— 列が
// 最初から無いので、移送し忘れても壊れ方が見えない。そこで「移行前の姿」を手で作り直し、
// 手順どおりに流せば並びが保たれること、要点を省くと失敗することの両方を固定する。
//
// 本番への移送は 2026-09-13 に実施済み（現役 6 件）。このテストが残っているのは、
// 移送の考え方——どこから写し、何を写さないか——を後から読めるようにするため。
//
// 移行前と移行後で**一意制約の形が変わる**のがこの移行の要。
//
//	移行前 tickets      … (space_id, position) の部分 UNIQUE
//	                      （WHERE archived_at IS NULL AND deleted_at IS NULL）
//	移行後 ranks        … (workspace_id, project_id, position) の UNIQUE（表の行すべて）
//
// つまりアーカイブ済み・削除済みは移行前だと現役と同じ position を持てる。そのまま全件を
// 移すと移送先で必ずぶつかる。01 が現役だけを退避しているのはそのため。
package database_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTicketPositionMigration_Integration(t *testing.T) {
	db := testsupport.OpenTestDB(t)
	ctx := t.Context()

	workspace := uuid.NewString()
	project := uuid.NewString()

	// legacy_tickets / legacy_ranks は移行前後の 2 つの表を最小限で再現したもの。実テーブルと
	// 名前を分け、他の結合テストの TruncateAll / FK と無関係に単独で作って消せるようにする。
	setup := func(t *testing.T) {
		t.Helper()
		for _, ddl := range []string{
			`DROP TABLE IF EXISTS legacy_ranks`,
			`DROP TABLE IF EXISTS migration_ticket_positions`,
			`DROP TABLE IF EXISTS legacy_tickets`,
			`CREATE TABLE legacy_tickets (
				id uuid PRIMARY KEY,
				workspace_id uuid NOT NULL,
				project_id uuid NOT NULL,
				number bigint NOT NULL,
				"position" text COLLATE "C" NOT NULL,
				archived_at timestamptz NULL,
				deleted_at timestamptz NULL
			)`,
			// 移行前の部分 UNIQUE。現役だけを見るので、アーカイブ済み・削除済みは
			// 現役と同じ position を持てる。
			`CREATE UNIQUE INDEX uq_legacy_tickets_position ON legacy_tickets (project_id, "position")
			 WHERE archived_at IS NULL AND deleted_at IS NULL`,
			// 移行後の並び順の表。UNIQUE は表の行すべてに効く（部分ではない）。
			`CREATE TABLE legacy_ranks (
				workspace_id uuid NOT NULL,
				project_id uuid NOT NULL,
				ticket_id uuid NOT NULL,
				"position" text COLLATE "C" NOT NULL,
				PRIMARY KEY (workspace_id, ticket_id),
				CONSTRAINT uq_legacy_ranks_position UNIQUE (workspace_id, project_id, "position")
			)`,
		} {
			_, err := db.ExecContext(ctx, ddl)
			require.NoError(t, err, ddl)
		}
		t.Cleanup(func() {
			for _, ddl := range []string{
				`DROP TABLE IF EXISTS legacy_ranks`,
				`DROP TABLE IF EXISTS migration_ticket_positions`,
				`DROP TABLE IF EXISTS legacy_tickets`,
			} {
				_, _ = db.ExecContext(ctx, ddl)
			}
		})
	}

	// seed は現役 3 件に加えて、「現役と同じ position を持つアーカイブ済み・削除済み」を
	// 1 件ずつ置く。移行前の部分 UNIQUE ではこれが正当な状態である（＝本番にも有り得る）。
	seed := func(t *testing.T) (live []string) {
		t.Helper()
		insert := func(pos string, archived, deleted bool, number int) string {
			id := uuid.NewString()
			var archivedAt, deletedAt any
			if archived {
				archivedAt = "2026-09-01T00:00:00Z"
			}
			if deleted {
				deletedAt = "2026-09-01T00:00:00Z"
			}
			_, err := db.ExecContext(ctx,
				`INSERT INTO legacy_tickets (id, workspace_id, project_id, number, "position", archived_at, deleted_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				id, workspace, project, number, pos, archivedAt, deletedAt)
			require.NoError(t, err)
			return id
		}
		a := insert("a0", false, false, 1)
		b := insert("a1", false, false, 2)
		c := insert("a2", false, false, 3)
		insert("a1", true, false, 4) // 現役の b と同じ鍵を持つアーカイブ済み
		insert("a2", false, true, 5) // 現役の c と同じ鍵を持つ削除済み
		return []string{a, b, c}
	}

	// capture は 01 の本体（現役だけを中継表へ退避）。
	capture := func(t *testing.T, where string) error {
		t.Helper()
		_, err := db.ExecContext(ctx,
			`CREATE TABLE IF NOT EXISTS migration_ticket_positions (
				ticket_id uuid PRIMARY KEY,
				position text NOT NULL
			)`)
		require.NoError(t, err)
		_, err = db.ExecContext(ctx,
			`INSERT INTO migration_ticket_positions (ticket_id, position)
			 SELECT id, "position" FROM legacy_tickets `+where+`
			 ON CONFLICT (ticket_id) DO NOTHING`)
		return err
	}

	// backfill は 02 の本体（中継表から並び順の表へ移す）。
	backfill := func(t *testing.T) error {
		t.Helper()
		_, err := db.ExecContext(ctx,
			`INSERT INTO legacy_ranks (workspace_id, project_id, ticket_id, "position")
			 SELECT t.workspace_id, t.project_id, t.id, m.position
			 FROM legacy_tickets t
			 JOIN migration_ticket_positions m ON m.ticket_id = t.id
			 WHERE t.archived_at IS NULL AND t.deleted_at IS NULL
			 ON CONFLICT (workspace_id, ticket_id) DO NOTHING`)
		return err
	}

	t.Run("台本どおりに流すと現役の並びがそのまま移る", func(t *testing.T) {
		setup(t)
		live := seed(t)

		require.NoError(t, capture(t, `WHERE archived_at IS NULL AND deleted_at IS NULL`))
		require.NoError(t, backfill(t))

		// 現役 3 件ぶんだけが入る。
		var n int
		require.NoError(t, db.QueryRowContext(ctx, `SELECT count(*) FROM legacy_ranks`).Scan(&n))
		assert.Equal(t, 3, n, "アーカイブ済み・削除済みは移さない")

		// 並びは移行前の順序と一致する（position をそのまま写しているので当然だが、
		// 「写す」以外の操作が紛れ込んでいないことの確認になる）。
		rows, err := db.QueryContext(ctx,
			`SELECT ticket_id FROM legacy_ranks WHERE project_id = $1 ORDER BY "position"`, project)
		require.NoError(t, err)
		defer rows.Close()
		var got []string
		for rows.Next() {
			var id string
			require.NoError(t, rows.Scan(&id))
			got = append(got, id)
		}
		require.NoError(t, rows.Err())
		assert.Equal(t, live, got, "移行前の position 順のまま")

		// 現役で並び順の行が無いチケットは 0 件（02 の検算 1 と同じ問い合わせ）。
		var missing int
		require.NoError(t, db.QueryRowContext(ctx, `
			SELECT count(*) FROM legacy_tickets t
			LEFT JOIN legacy_ranks r ON r.workspace_id = t.workspace_id AND r.ticket_id = t.id
			WHERE t.archived_at IS NULL AND t.deleted_at IS NULL AND r.ticket_id IS NULL`).Scan(&missing))
		assert.Zero(t, missing)
	})

	// 01 の「現役だけ」を外すと何が起きるかを実際に確かめる。ここが通ってしまうなら、
	// 移行先の一意制約が緩んでいる（＝旧 ticket_ranks と同じ壊れ方に戻っている）。
	t.Run("現役の絞り込みを外すと移送先の一意制約が止める", func(t *testing.T) {
		setup(t)
		seed(t)

		require.NoError(t, capture(t, ``)) // 全件を退避してしまった場合

		_, err := db.ExecContext(ctx,
			`INSERT INTO legacy_ranks (workspace_id, project_id, ticket_id, "position")
			 SELECT t.workspace_id, t.project_id, t.id, m.position
			 FROM legacy_tickets t
			 JOIN migration_ticket_positions m ON m.ticket_id = t.id`)
		require.Error(t, err, "アーカイブ済みが現役と同じ鍵を持つので重複する")
		assert.Contains(t, err.Error(), "uq_legacy_ranks_position")
	})

	t.Run("2回流しても増えない", func(t *testing.T) {
		setup(t)
		seed(t)

		require.NoError(t, capture(t, `WHERE archived_at IS NULL AND deleted_at IS NULL`))
		require.NoError(t, backfill(t))
		require.NoError(t, capture(t, `WHERE archived_at IS NULL AND deleted_at IS NULL`))
		require.NoError(t, backfill(t))

		var n int
		require.NoError(t, db.QueryRowContext(ctx, `SELECT count(*) FROM legacy_ranks`).Scan(&n))
		assert.Equal(t, 3, n)
	})
}
