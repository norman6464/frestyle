//go:build integration

package persistence_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
)

// TestUserDisplayReader_Integration はページ本文の @名指しの名前を解決する読み取り口を
// 実 Postgres で確かめる。実在する人だけが返り、0・無い ID は無視されること。
func TestUserDisplayReader_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	testsupport.TruncateAll(t, sqlDB, "users")
	ctx := context.Background()
	reader := persistence.NewUserDisplayReader(sqlDB)

	a := createUser(t, sqlDB, "mention-a")
	b := createUser(t, sqlDB, "mention-b")

	t.Run("実在する人だけが名前つきで返る（重複・無い ID・0 は無視）", func(t *testing.T) {
		rows, err := reader.ListUserDisplaysByIDs(ctx, []uint64{a, b, a, 999999999, 0})
		require.NoError(t, err)
		require.Len(t, rows, 2)
		names := map[uint64]string{}
		for _, r := range rows {
			names[r.UserID] = r.Name
		}
		assert.Equal(t, map[uint64]string{a: "mention-a", b: "mention-b"}, names)
	})

	t.Run("有効な ID が 1 つも無ければ問い合わせずに空", func(t *testing.T) {
		rows, err := reader.ListUserDisplaysByIDs(ctx, []uint64{0})
		require.NoError(t, err)
		assert.Empty(t, rows)
	})
}
