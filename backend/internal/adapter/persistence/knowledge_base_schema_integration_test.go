//go:build integration

package persistence_test

import (
	"database/sql"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/pkg/fracindex"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/stretchr/testify/require"
)

// PostgreSQL の SQLSTATE（エラーの種別）。どの制約・列型が効いたのかまで固定するために使う。
const (
	sqlStateStringDataRightTruncation = "22001"
	sqlStateForeignKeyViolation       = "23503"
	sqlStateUniqueViolation           = "23505"
	sqlStateCheckViolation            = "23514"
)

// kbTables はナレッジのテーブル（TRUNCATE 対象）。子から先に並べる。
// 権限モデル（principals 以下）も含める。principals は users を親に持つが、
// users はここで消さない（ほかの結合テストと共有するため。principals 側だけ空にすれば足りる）。
var kbTables = []string{
	"share_links", "page_grants", "space_grants", "workspace_grants",
	"principal_members", "principals",
	// page_search / page_links は blocks / pages への CASCADE FK を
	// 持つため、blocks・pages を TRUNCATE ... CASCADE すれば自動的に一緒に空になるが、
	// page_snapshots と同じく明示しておく（この表の作法に揃える）。
	"blocks", "page_paths", "page_snapshots", "page_search", "page_links", "page_ticket_links",
	"page_views", "page_favorites",
	"pages", "spaces", "workspaces",
}

// TestKnowledgeBaseSchema_Integration は明示 DDL（infra/database/schema/knowledge_base.sql）が
// 張る制約を実 Postgres で固定する。
//
// このテーブル群は GORM を通さないため、テストも database/sql の生 SQL で書く
// （repository は段 1-b で追加する）。
func TestKnowledgeBaseSchema_Integration(t *testing.T) {
	db := testsupport.OpenTestDB(t)

	t.Run("別ワークスペースの space にはページを紐づけられない", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		wsA := createWorkspace(t, db, "ws-a")
		wsB := createWorkspace(t, db, "ws-b")
		spaceB := createSpace(t, db, wsB, "eng")

		// workspace は A なのに space は B のもの → 複合 FK が弾く。
		err := insertPage(db, newID(), wsA, spaceB, nil, "V", nil)
		requirePgError(t, err, sqlStateForeignKeyViolation, "fk_pages_space")
	})

	t.Run("別ワークスペースのページは親にできない", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		wsA := createWorkspace(t, db, "ws-a")
		wsB := createWorkspace(t, db, "ws-b")
		spaceA := createSpace(t, db, wsA, "eng")
		spaceB := createSpace(t, db, wsB, "eng") // key はワークスペース内で一意なので同名で良い
		parentB := createPage(t, db, wsB, spaceB, nil, "V")

		err := insertPage(db, newID(), wsA, spaceA, &parentB, "V", nil)
		requirePgError(t, err, sqlStateForeignKeyViolation, "fk_pages_parent")
	})

	// ページの木はスペースの中で閉じる。別スペースのページを親にできると、そのスペースを消したときに
	// fk_pages_space の CASCADE で親が消え、続けて親の CASCADE が別スペースに残るはずの
	// 子ページまで道連れにする。
	t.Run("同じワークスペースでも別スペースのページは親にできない", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-a")
		spaceA := createSpace(t, db, ws, "aaa")
		spaceB := createSpace(t, db, ws, "bbb")
		parentInB := createPage(t, db, ws, spaceB, nil, "V")

		// INSERT では作れない。
		err := insertPage(db, newID(), ws, spaceA, &parentInB, "V", nil)
		requirePgError(t, err, sqlStateForeignKeyViolation, "fk_pages_parent")

		// 後から UPDATE で別スペースの親に付け替えることもできない。
		rootInA := createPage(t, db, ws, spaceA, nil, "a")
		_, err = db.Exec(`UPDATE pages SET parent_id = $1 WHERE id = $2`, parentInB, rootInA)
		requirePgError(t, err, sqlStateForeignKeyViolation, "fk_pages_parent")

		// 同じスペースの中でなら従来どおり親子にできる（塞ぎすぎていないこと）。
		createPage(t, db, ws, spaceA, &rootInA, "V")
	})

	// スペースの削除で消えるのはそのスペースのページだけ。別スペースの木は残る。
	t.Run("スペースの削除は別スペースのページを巻き込まない", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-a")
		spaceA := createSpace(t, db, ws, "aaa")
		spaceB := createSpace(t, db, ws, "bbb")
		rootA := createPage(t, db, ws, spaceA, nil, "V")
		childA := createPage(t, db, ws, spaceA, &rootA, "V")
		createPage(t, db, ws, spaceB, nil, "V")

		_, err := db.Exec(`DELETE FROM spaces WHERE id = $1`, spaceB)
		require.NoError(t, err)

		require.ElementsMatch(t, []string{rootA, childA}, queryStrings(t, db, `SELECT id::text FROM pages`),
			"スペース A の木がそのまま残ること")
	})

	t.Run("別ワークスペースのブロックは親にできない", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		wsA := createWorkspace(t, db, "ws-a")
		wsB := createWorkspace(t, db, "ws-b")
		spaceA := createSpace(t, db, wsA, "eng")
		spaceB := createSpace(t, db, wsB, "eng")
		pageA := createPage(t, db, wsA, spaceA, nil, "V")
		pageB := createPage(t, db, wsB, spaceB, nil, "V")
		parentB := createBlock(t, db, wsB, pageB, nil, "V", domain.BlockTypeBulletList)

		err := insertBlock(db, newID(), wsA, pageA, &parentB, "V", domain.BlockTypeListItem, "{}", nil)
		requirePgError(t, err, sqlStateForeignKeyViolation, "fk_blocks_parent")
	})

	// ブロックの木は 1 ページの中で閉じる。別ページのブロックを親にできると、そのページを消したときに
	// 親の ON DELETE CASCADE が別ページの本文まで道連れにする。
	t.Run("同じワークスペースでも別ページのブロックは親にできない", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-a")
		space := createSpace(t, db, ws, "eng")
		pageA := createPage(t, db, ws, space, nil, "V")
		pageB := createPage(t, db, ws, space, nil, "a")
		parentOnA := createBlock(t, db, ws, pageA, nil, "V", domain.BlockTypeBulletList)

		err := insertBlock(db, newID(), ws, pageB, &parentOnA, "V", domain.BlockTypeListItem, "{}", nil)
		requirePgError(t, err, sqlStateForeignKeyViolation, "fk_blocks_parent")
	})

	// page_paths は 1 行で 2 ページを組にするため、単独 FK 2 本では別ワークスペースの組を防げない。
	t.Run("page_paths は別ワークスペースのページを組にできない", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		wsA := createWorkspace(t, db, "ws-a")
		wsB := createWorkspace(t, db, "ws-b")
		spaceA := createSpace(t, db, wsA, "eng")
		spaceB := createSpace(t, db, wsB, "eng")
		pageA := createPage(t, db, wsA, spaceA, nil, "V")
		pageB := createPage(t, db, wsB, spaceB, nil, "V")

		// 行の workspace は A、祖先は B のページ → 祖先側の複合 FK が弾く。
		err := insertPagePath(db, wsA, pageA, pageB, 1)
		requirePgError(t, err, sqlStateForeignKeyViolation, "fk_page_paths_ancestor")

		// 子孫側も同じく弾かれる。
		err = insertPagePath(db, wsA, pageB, pageA, 1)
		requirePgError(t, err, sqlStateForeignKeyViolation, "fk_page_paths_page")
	})

	// closure table の depth は 1 行だけで判定できる範囲を DB で守る
	// （祖先の連鎖に抜けが無いかといった複数行の整合は行を書く側の責務）。
	t.Run("page_paths の depth は自己行だけが 0 で負にできない", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-a")
		space := createSpace(t, db, ws, "eng")
		parent := createPage(t, db, ws, space, nil, "V")
		child := createPage(t, db, ws, space, &parent, "V")

		// 自分自身を指すのに depth<>0。
		err := insertPagePath(db, ws, child, child, 1)
		requirePgError(t, err, sqlStateCheckViolation, "ck_page_paths_depth")

		// 別のページを指すのに depth=0。
		err = insertPagePath(db, ws, child, parent, 0)
		requirePgError(t, err, sqlStateCheckViolation, "ck_page_paths_depth")

		// 距離が負。
		err = insertPagePath(db, ws, child, parent, -1)
		requirePgError(t, err, sqlStateCheckViolation, "ck_page_paths_depth")

		// 正しい形（自己行が depth=0、親への行が depth=1）は通る。
		createPagePath(t, db, ws, child, child, 0)
		createPagePath(t, db, ws, child, parent, 1)
	})

	// 壊れた snapshot は読み取りキャッシュとしてそのまま返り、エディタがページを開けなくなる。
	t.Run("page_snapshots.doc は ProseMirror の doc に限られる", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-a")
		space := createSpace(t, db, ws, "eng")
		page := createPage(t, db, ws, space, nil, "V")

		for _, doc := range []string{`[]`, `{"type":"paragraph"}`, `"doc"`} {
			err := insertPageSnapshot(db, page, doc)
			requirePgError(t, err, sqlStateCheckViolation, "ck_page_snapshots_doc")
		}
		// 正しい形なら通る。
		createPageSnapshot(t, db, page)
	})

	t.Run("自分自身を親にはできない", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-a")
		space := createSpace(t, db, ws, "eng")
		page := createPage(t, db, ws, space, nil, "V")

		t.Run("pages", func(t *testing.T) {
			id := newID()
			err := insertPage(db, id, ws, space, &id, "a", nil)
			requirePgError(t, err, sqlStateCheckViolation, "ck_pages_parent_not_self")
		})

		t.Run("blocks", func(t *testing.T) {
			id := newID()
			err := insertBlock(db, id, ws, page, &id, "a", domain.BlockTypeParagraph, "{}", nil)
			requirePgError(t, err, sqlStateCheckViolation, "ck_blocks_parent_not_self")
		})
	})

	t.Run("同じ親の中で position が重複すると弾かれる", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-a")
		space := createSpace(t, db, ws, "eng")
		parent := createPage(t, db, ws, space, nil, "V")
		parentBlock := createBlock(t, db, ws, parent, nil, "V", domain.BlockTypeBulletList)

		t.Run("子ページ", func(t *testing.T) {
			createPage(t, db, ws, space, &parent, "a")
			err := insertPage(db, newID(), ws, space, &parent, "a", nil)
			requirePgError(t, err, sqlStateUniqueViolation, "uq_pages_parent_position")
		})

		t.Run("子ブロック", func(t *testing.T) {
			createBlock(t, db, ws, parent, &parentBlock, "a", domain.BlockTypeListItem)
			err := insertBlock(db, newID(), ws, parent, &parentBlock, "a", domain.BlockTypeListItem, "{}", nil)
			requirePgError(t, err, sqlStateUniqueViolation, "uq_blocks_parent_position")
		})
	})

	// parent_id が NULL の行同士は UNIQUE 索引では衝突しない（NULL は互いに別物として扱われる）ため、
	// ルート直下はスペース / ページを軸にした部分 UNIQUE で守っている。その効きを固定する。
	t.Run("ルート直下でも position の重複は弾かれる", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-a")
		space := createSpace(t, db, ws, "eng")

		t.Run("スペース直下のページ", func(t *testing.T) {
			createPage(t, db, ws, space, nil, "V")
			err := insertPage(db, newID(), ws, space, nil, "V", nil)
			requirePgError(t, err, sqlStateUniqueViolation, "uq_pages_space_position")
		})

		t.Run("ページ直下のブロック", func(t *testing.T) {
			page := createPage(t, db, ws, space, nil, "a")
			createBlock(t, db, ws, page, nil, "V", domain.BlockTypeParagraph)
			err := insertBlock(db, newID(), ws, page, nil, "V", domain.BlockTypeParagraph, "{}", nil)
			requirePgError(t, err, sqlStateUniqueViolation, "uq_blocks_page_position")
		})
	})

	// 並びは「同じ親の中」でだけ意味を持つ。uq_blocks_page_position はページ直下（parent_id IS NULL）
	// だけを見る部分索引で、その述語を外すと親の違う子ブロック同士まで position を奪い合う。
	t.Run("同じページでも親が違えば子ブロックは同じ position を取れる", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-a")
		space := createSpace(t, db, ws, "eng")
		page := createPage(t, db, ws, space, nil, "V")
		listA := createBlock(t, db, ws, page, nil, "V", domain.BlockTypeBulletList)
		listB := createBlock(t, db, ws, page, nil, "a", domain.BlockTypeBulletList)

		// 別々の親を持つ子は、同じページの中でも同じ position を取れる。
		createBlock(t, db, ws, page, &listA, "V", domain.BlockTypeListItem)
		createBlock(t, db, ws, page, &listB, "V", domain.BlockTypeListItem)
	})

	t.Run("アーカイブ済みページは position の一意性から外れる", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-a")
		space := createSpace(t, db, ws, "eng")

		archivedAt := time.Now()
		require.NoError(t, insertPage(db, newID(), ws, space, nil, "V", &archivedAt))

		// 現役のページが同じ position を取れる（アーカイブは並びを占有しない）。
		require.NoError(t, insertPage(db, newID(), ws, space, nil, "V", nil))
	})

	// 上はルート直下（uq_pages_space_position）の話。親ページ配下は別の索引
	// uq_pages_parent_position が守っており、その WHERE archived_at IS NULL を外すと
	// アーカイブ済みの子が並びを占有し続けて position を再利用できなくなる。
	t.Run("親ページ配下でもアーカイブ済みは position の一意性から外れる", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-a")
		space := createSpace(t, db, ws, "eng")
		parent := createPage(t, db, ws, space, nil, "V")

		archivedAt := time.Now()
		require.NoError(t, insertPage(db, newID(), ws, space, &parent, "V", &archivedAt))

		// 現役の子ページが同じ position を取れる。
		require.NoError(t, insertPage(db, newID(), ws, space, &parent, "V", nil))
	})

	t.Run("親ページの物理削除で子孫と派生テーブルが CASCADE で消える", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-a")
		space := createSpace(t, db, ws, "eng")
		parent := createPage(t, db, ws, space, nil, "V")
		child := createPage(t, db, ws, space, &parent, "V")
		createBlock(t, db, ws, parent, nil, "V", domain.BlockTypeParagraph)
		createBlock(t, db, ws, child, nil, "V", domain.BlockTypeParagraph)
		createPagePath(t, db, ws, parent, parent, 0)
		createPagePath(t, db, ws, child, child, 0)
		createPagePath(t, db, ws, child, parent, 1)
		createPageSnapshot(t, db, parent)
		createPageSnapshot(t, db, child)

		_, err := db.Exec(`DELETE FROM pages WHERE id = $1`, parent)
		require.NoError(t, err)

		require.Zero(t, countRows(t, db, "pages"), "子ページも消えること")
		require.Zero(t, countRows(t, db, "blocks"), "両ページのブロックが消えること")
		require.Zero(t, countRows(t, db, "page_paths"), "page_paths が消えること（page_id / ancestor_id の両方向）")
		require.Zero(t, countRows(t, db, "page_snapshots"), "page_snapshots が消えること")
	})

	t.Run("識別子の一意性と形式", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-a")
		createSpace(t, db, ws, "eng")

		t.Run("workspaces.slug は重複できない", func(t *testing.T) {
			err := insertWorkspace(db, newID(), "ws-a")
			requirePgError(t, err, sqlStateUniqueViolation, "uq_workspaces_slug")
		})

		t.Run("spaces.key はワークスペース内で重複できない", func(t *testing.T) {
			err := insertSpace(db, newID(), ws, "eng")
			requirePgError(t, err, sqlStateUniqueViolation, "uq_spaces_workspace_key")
		})

		// 長さの契約は 2 枚の壁で守られる: 空文字は CHECK（BETWEEN 1 AND 64 の下限）が弾き、
		// 65 文字以上は CHECK の評価より前に列型 varchar(64) が長さ超過（SQLSTATE 22001）で弾く。
		// 上限ちょうどの 64 文字は列型にも CHECK の上限にも通ることを併せて固定する。
		t.Run("slug / key の長さ境界", func(t *testing.T) {
			for _, tc := range []struct {
				name       string
				insert     func(value string) error
				constraint string
			}{
				{
					name:       "workspaces.slug",
					insert:     func(value string) error { return insertWorkspace(db, newID(), value) },
					constraint: "ck_workspaces_slug_len",
				},
				{
					name:       "spaces.key",
					insert:     func(value string) error { return insertSpace(db, newID(), ws, value) },
					constraint: "ck_spaces_key_len",
				},
			} {
				t.Run(tc.name, func(t *testing.T) {
					requirePgError(t, tc.insert(""), sqlStateCheckViolation, tc.constraint)
					require.NoError(t, tc.insert(strings.Repeat("a", 64)))
					requireSQLState(t, tc.insert(strings.Repeat("a", 65)), sqlStateStringDataRightTruncation)
				})
			}
		})
	})

	// position が空文字だと順序として意味を持たない（fracindex は空文字を返さない）。
	t.Run("position は空文字にできない", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-a")
		space := createSpace(t, db, ws, "eng")
		page := createPage(t, db, ws, space, nil, "V")

		err := insertPage(db, newID(), ws, space, nil, "", nil)
		requirePgError(t, err, sqlStateCheckViolation, "ck_pages_position_not_empty")

		err = insertBlock(db, newID(), ws, page, nil, "", domain.BlockTypeParagraph, "{}", nil)
		requirePgError(t, err, sqlStateCheckViolation, "ck_blocks_position_not_empty")
	})

	// icon / cover は種類ごとの構造を持つオブジェクトに限る（NULL は「付けていない」で許可）。
	// 配列や文字列を許すと、応答の型（kbPageIconResponse 等）が「object のはず」という
	// 前提で読めなくなる。
	t.Run("pages.icon / cover は object に限られる", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-icon")
		space := createSpace(t, db, ws, "eng")
		page := createPage(t, db, ws, space, nil, "a0")

		_, err := db.Exec(`UPDATE pages SET icon = '"📘"'::jsonb WHERE id = $1`, page)
		requirePgError(t, err, sqlStateCheckViolation, "ck_pages_icon_object")

		_, err = db.Exec(`UPDATE pages SET cover = '[]'::jsonb WHERE id = $1`, page)
		requirePgError(t, err, sqlStateCheckViolation, "ck_pages_cover_object")

		// 空 object も弾く。型は object のままなので jsonb_typeof だけでは通ってしまい、
		// toDomainPage が {"type":"","value":""} というゼロ値の非 nil PageIcon を作ってしまう。
		_, err = db.Exec(`UPDATE pages SET icon = '{}'::jsonb WHERE id = $1`, page)
		requirePgError(t, err, sqlStateCheckViolation, "ck_pages_icon_object")

		_, err = db.Exec(`UPDATE pages SET cover = '{}'::jsonb WHERE id = $1`, page)
		requirePgError(t, err, sqlStateCheckViolation, "ck_pages_cover_object")

		// NULL（未設定）と正しい object 形は通ること。
		_, err = db.Exec(`UPDATE pages SET icon = '{"type":"emoji","value":"📘"}'::jsonb WHERE id = $1`, page)
		require.NoError(t, err)
	})

	t.Run("blocks の attrs は既定 {} で object に限られる", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-a")
		space := createSpace(t, db, ws, "eng")
		page := createPage(t, db, ws, space, nil, "V")

		// attrs を指定しなければ DB 既定の {} が入る（NULL と {} の二通りを作らない）。
		id := newID()
		_, err := db.Exec(
			`INSERT INTO blocks (id, workspace_id, page_id, "position", type) VALUES ($1, $2, $3, $4, $5)`,
			id, ws, page, "V", string(domain.BlockTypeParagraph),
		)
		require.NoError(t, err)
		var attrs string
		require.NoError(t, db.QueryRow(`SELECT attrs::text FROM blocks WHERE id = $1`, id).Scan(&attrs))
		require.JSONEq(t, `{}`, attrs)

		// object 以外（配列）は CHECK で弾く。
		err = insertBlock(db, newID(), ws, page, nil, "a", domain.BlockTypeParagraph, `[]`, nil)
		requirePgError(t, err, sqlStateCheckViolation, "ck_blocks_attrs_object")

		// inline は容器ノードでは NULL、葉ノードでは content 配列。object は弾く。
		objectInline := `{"type":"text"}`
		err = insertBlock(db, newID(), ws, page, nil, "b", domain.BlockTypeParagraph, `{}`, &objectInline)
		requirePgError(t, err, sqlStateCheckViolation, "ck_blocks_inline_array")
	})

	// 分数インデックスは「文字列の辞書順 = 並び順」が前提。Go はバイト比較で判断するので、
	// DB の ORDER BY も同じ順序（C コレーション）でなければ並びが食い違う。
	t.Run("position は Go のバイト順と同じ順序で並ぶ", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-a")
		space := createSpace(t, db, ws, "eng")
		parent := createPage(t, db, ws, space, nil, "V")

		// 大文字・小文字・数字が混ざるキー（ロケール依存のコレーションだと 'a' < 'B' で並んでしまう）。
		positions := []string{"z", "A", "a", "V", "1", "Zz", "zA"}
		for _, p := range positions {
			createPage(t, db, ws, space, &parent, p)
		}

		got := queryStrings(t, db,
			`SELECT "position" FROM pages WHERE parent_id = $1 ORDER BY "position"`, parent)

		want := append([]string(nil), positions...)
		sort.Strings(want) // Go のバイト比較
		require.Equal(t, want, got)
	})

	// 実際に fracindex で採番したキーを流し込み、DB の ORDER BY が挿入した論理順と一致することを見る。
	t.Run("fracindex で採番したキーで並び替えが表現できる", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)
		ws := createWorkspace(t, db, "ws-a")
		space := createSpace(t, db, ws, "eng")
		page := createPage(t, db, ws, space, nil, "V")

		// 末尾に 3 件足してから、1 番目と 2 番目の間に 1 件割り込ませる。
		var order []string
		for i := 0; i < 3; i++ {
			prev := ""
			if len(order) > 0 {
				prev = order[len(order)-1]
			}
			key, err := fracindex.Between(prev, "")
			require.NoError(t, err)
			order = append(order, key)
			createBlock(t, db, ws, page, nil, key, domain.BlockTypeParagraph)
		}
		inserted, err := fracindex.Between(order[0], order[1])
		require.NoError(t, err)
		createBlock(t, db, ws, page, nil, inserted, domain.BlockTypeParagraph)
		order = append([]string{order[0], inserted}, order[1:]...)

		got := queryStrings(t, db,
			`SELECT "position" FROM blocks WHERE page_id = $1 AND parent_id IS NULL ORDER BY "position"`, page)
		require.Equal(t, order, got)
	})

	t.Run("制約が 1 本も欠けていない", func(t *testing.T) {
		testsupport.TruncateAll(t, db, kbTables...)

		// position 列のコレーションが C のままであること（剥がれると並びが狂う）。
		for _, table := range []string{"pages", "blocks"} {
			var collation string
			require.NoError(t, db.QueryRow(
				`SELECT collation_name FROM information_schema.columns
				 WHERE table_schema = current_schema() AND table_name = $1 AND column_name = 'position'`, table,
			).Scan(&collation))
			require.Equalf(t, "C", collation, "%s.position のコレーションが C ではありません", table)
		}

		// PK / FK / CHECK / UNIQUE が 1 本も欠けていないこと。
		for table, constraints := range map[string][]string{
			"workspaces":     {"ck_workspaces_slug_len", "uq_workspaces_slug", "workspaces_pkey"},
			"spaces":         {"ck_spaces_key_len", "fk_spaces_workspace", "spaces_pkey", "uq_spaces_workspace_id", "uq_spaces_workspace_key"},
			"pages":          {"ck_pages_parent_not_self", "ck_pages_position_not_empty", "fk_pages_parent", "fk_pages_space", "pages_pkey", "uq_pages_workspace_id", "uq_pages_workspace_space_id"},
			"blocks":         {"blocks_pkey", "ck_blocks_attrs_object", "ck_blocks_inline_array", "ck_blocks_parent_not_self", "ck_blocks_position_not_empty", "fk_blocks_page", "fk_blocks_parent", "uq_blocks_workspace_page_id"},
			"page_paths":     {"ck_page_paths_depth", "fk_page_paths_ancestor", "fk_page_paths_page", "page_paths_pkey"},
			"page_snapshots": {"ck_page_snapshots_doc", "fk_page_snapshots_page", "page_snapshots_pkey"},
			"page_search":    {"fk_page_search_page", "page_search_pkey"},
			"page_links":     {"fk_page_links_source_block", "fk_page_links_target_page", "page_links_pkey"},
		} {
			for _, name := range constraints {
				var n int
				require.NoError(t, db.QueryRow(
					`SELECT count(*) FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass`,
					name, table,
				).Scan(&n))
				require.Equalf(t, 1, n, "%s.%s が見つかりません", table, name)
			}
		}

		// 部分 UNIQUE 索引も述語込みで残っていること。
		for name, predicate := range map[string]string{
			"uq_pages_parent_position":  "WHERE (archived_at IS NULL)",
			"uq_pages_space_position":   "WHERE ((parent_id IS NULL) AND (archived_at IS NULL))",
			"uq_blocks_page_position":   "WHERE (parent_id IS NULL)",
			"uq_blocks_parent_position": "",
		} {
			var def string
			require.NoError(t, db.QueryRow(
				`SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = $1`, name,
			).Scan(&def))
			require.Containsf(t, def, "CREATE UNIQUE INDEX", "%s が UNIQUE 索引ではありません: %s", name, def)
			if predicate != "" {
				require.Containsf(t, def, predicate, "%s の述語が想定と異なります: %s", name, def)
			} else {
				require.NotContainsf(t, def, "WHERE", "%s に想定外の述語が付いています: %s", name, def)
			}
		}
	})
}

// --- 以下、テスト用のヘルパ（repository が無いので database/sql の生 SQL を直接叩く）---

// newID はテストデータの ID を採番する。本番の repository（段 1-b で追加）と同じ UUIDv7 に揃える。
func newID() string { return uuid.Must(uuid.NewV7()).String() }

func insertWorkspace(db *sql.DB, id, slug string) error {
	_, err := db.Exec(`INSERT INTO workspaces (id, slug, name) VALUES ($1, $2, $3)`, id, slug, slug)
	return err
}

func createWorkspace(t *testing.T, db *sql.DB, slug string) string {
	t.Helper()
	id := newID()
	require.NoError(t, insertWorkspace(db, id, slug))
	return id
}

func insertSpace(db *sql.DB, id, workspaceID, key string) error {
	_, err := db.Exec(
		`INSERT INTO spaces (id, workspace_id, "key", name) VALUES ($1, $2, $3, $4)`,
		id, workspaceID, key, key,
	)
	return err
}

func createSpace(t *testing.T, db *sql.DB, workspaceID, key string) string {
	t.Helper()
	id := newID()
	require.NoError(t, insertSpace(db, id, workspaceID, key))
	return id
}

func insertProject(db *sql.DB, id, workspaceID, key string) error {
	_, err := db.Exec(
		`INSERT INTO projects (id, workspace_id, "key", name) VALUES ($1, $2, $3, $4)`,
		id, workspaceID, key, key,
	)
	return err
}

// createProject はバックログの入れ物を 1 つ作る。スペース（ナレッジ）とは無関係な別の表で、
// 参照も workspaces にしか張らない。
func createProject(t *testing.T, db *sql.DB, workspaceID, key string) string {
	t.Helper()
	id := newID()
	require.NoError(t, insertProject(db, id, workspaceID, key))
	return id
}

// insertPage は 1 ページを INSERT する。created_by_user_id は users への FK を張っていないため
// 固定値で良い（ナレッジの骨格に閉じて検証する）。
func insertPage(db *sql.DB, id, workspaceID, spaceID string, parentID *string, position string, archivedAt *time.Time) error {
	_, err := db.Exec(
		`INSERT INTO pages (id, workspace_id, space_id, parent_id, "position", title, created_by_user_id, archived_at)
		 VALUES ($1, $2, $3, $4, $5, 'ページ', 1, $6)`,
		id, workspaceID, spaceID, parentID, position, archivedAt,
	)
	return err
}

func createPage(t *testing.T, db *sql.DB, workspaceID, spaceID string, parentID *string, position string) string {
	t.Helper()
	id := newID()
	require.NoError(t, insertPage(db, id, workspaceID, spaceID, parentID, position, nil))
	return id
}

func insertBlock(db *sql.DB, id, workspaceID, pageID string, parentID *string, position string, blockType domain.BlockType, attrs string, inline *string) error {
	_, err := db.Exec(
		`INSERT INTO blocks (id, workspace_id, page_id, parent_id, "position", type, attrs, inline)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		id, workspaceID, pageID, parentID, position, string(blockType), attrs, inline,
	)
	return err
}

func createBlock(t *testing.T, db *sql.DB, workspaceID, pageID string, parentID *string, position string, blockType domain.BlockType) string {
	t.Helper()
	id := newID()
	require.NoError(t, insertBlock(db, id, workspaceID, pageID, parentID, position, blockType, "{}", nil))
	return id
}

func insertPagePath(db *sql.DB, workspaceID, pageID, ancestorID string, depth int) error {
	_, err := db.Exec(
		`INSERT INTO page_paths (workspace_id, page_id, ancestor_id, depth) VALUES ($1, $2, $3, $4)`,
		workspaceID, pageID, ancestorID, depth,
	)
	return err
}

func createPagePath(t *testing.T, db *sql.DB, workspaceID, pageID, ancestorID string, depth int) {
	t.Helper()
	require.NoError(t, insertPagePath(db, workspaceID, pageID, ancestorID, depth))
}

func insertPageSnapshot(db *sql.DB, pageID, doc string) error {
	_, err := db.Exec(`INSERT INTO page_snapshots (page_id, doc) VALUES ($1, $2)`, pageID, doc)
	return err
}

func createPageSnapshot(t *testing.T, db *sql.DB, pageID string) {
	t.Helper()
	require.NoError(t, insertPageSnapshot(db, pageID, `{"type":"doc","content":[]}`))
}

// insertPageSearch / createPageSearch は page_search へ検証用の行を入れる。
// UpsertPageSearch と同じ形（page_id, workspace_id, title, body）で、TruncateAll の
// 掃除漏れを見つけるためだけに使う（本物の抽出ロジックは usecase/kb 側で検証する）。
func insertPageSearch(db *sql.DB, workspaceID, pageID string) error {
	_, err := db.Exec(
		`INSERT INTO page_search (page_id, workspace_id, title, body) VALUES ($1, $2, $3, $4)`,
		pageID, workspaceID, "検証用ページ", "検証用の本文",
	)
	return err
}

func createPageSearch(t *testing.T, db *sql.DB, workspaceID, pageID string) {
	t.Helper()
	require.NoError(t, insertPageSearch(db, workspaceID, pageID))
}

// insertPageLink / createPageLink は page_links へ検証用の行を入れる。
func insertPageLink(db *sql.DB, sourceBlockID, targetPageID string) error {
	_, err := db.Exec(
		`INSERT INTO page_links (source_block_id, target_page_id) VALUES ($1, $2)`,
		sourceBlockID, targetPageID,
	)
	return err
}

func createPageLink(t *testing.T, db *sql.DB, sourceBlockID, targetPageID string) {
	t.Helper()
	require.NoError(t, insertPageLink(db, sourceBlockID, targetPageID))
}

// insertPageTicketLink / createPageTicketLink は page_ticket_links へ検証用の行を入れる
// （insertPageLink / createPageLink のチケット版。段 5）。
func insertPageTicketLink(db *sql.DB, sourceBlockID, targetTicketID string) error {
	_, err := db.Exec(
		`INSERT INTO page_ticket_links (source_block_id, target_ticket_id) VALUES ($1, $2)`,
		sourceBlockID, targetTicketID,
	)
	return err
}

func createPageTicketLink(t *testing.T, db *sql.DB, sourceBlockID, targetTicketID string) {
	t.Helper()
	require.NoError(t, insertPageTicketLink(db, sourceBlockID, targetTicketID))
}

func countRows(t *testing.T, db *sql.DB, table string) int {
	t.Helper()
	var n int
	require.NoError(t, db.QueryRow(`SELECT count(*) FROM `+table).Scan(&n))
	return n
}

func queryStrings(t *testing.T, db *sql.DB, query string, args ...any) []string {
	t.Helper()
	rows, err := db.Query(query, args...)
	require.NoError(t, err)
	defer func() { _ = rows.Close() }()

	got := []string{}
	for rows.Next() {
		var s string
		require.NoError(t, rows.Scan(&s))
		got = append(got, s)
	}
	require.NoError(t, rows.Err())
	return got
}

// requireSQLState は err が期待した SQLSTATE で落ちたことを確かめる
// （列型の長さ超過のように制約名を持たないエラー向け。制約違反は requirePgError で制約名まで見る）。
func requireSQLState(t *testing.T, err error, sqlState string) {
	t.Helper()
	require.Error(t, err)
	var pgErr *pgconn.PgError
	require.ErrorAs(t, err, &pgErr)
	require.Equalf(t, sqlState, pgErr.Code, "SQLSTATE が想定と異なります: %v", err)
}

// requirePgError は err が期待した SQLSTATE の制約違反で、かつ期待した制約名で落ちたことを確かめる。
// 「何かのエラーになった」ではなく「意図した制約が効いた」ところまで固定する。
func requirePgError(t *testing.T, err error, sqlState, constraint string) {
	t.Helper()
	require.Error(t, err)
	var pgErr *pgconn.PgError
	require.ErrorAs(t, err, &pgErr)
	require.Equalf(t, sqlState, pgErr.Code, "SQLSTATE が想定と異なります: %v", err)
	require.Equalf(t, constraint, pgErr.ConstraintName, "効いた制約が想定と異なります: %v", err)
}

// seedPermissionRows は権限モデルの各テーブルへ検証用の行を 1 つずつ入れる
// （TruncateAll の掃除漏れを見つけるため、全テーブルに行がある状態を作る）。
func seedPermissionRows(t *testing.T, db *sql.DB, workspaceID, spaceID, pageID string) {
	t.Helper()
	var userID uint64
	require.NoError(t, db.QueryRow(
		`INSERT INTO users (email, name, created_at, updated_at)
		 VALUES ($1, 'truncate', now(), now()) RETURNING id`,
		"truncate+"+newID()+"@example.test",
	).Scan(&userID))

	userPrincipal, groupPrincipal := newID(), newID()
	_, err := db.Exec(
		`INSERT INTO principals (id, workspace_id, kind, user_id) VALUES ($1, $2, 'user', $3)`,
		userPrincipal, workspaceID, userID,
	)
	require.NoError(t, err)
	_, err = db.Exec(
		`INSERT INTO principals (id, workspace_id, kind, name) VALUES ($1, $2, 'group', '掃除確認')`,
		groupPrincipal, workspaceID,
	)
	require.NoError(t, err)
	_, err = db.Exec(
		`INSERT INTO principals (id, workspace_id, kind, space_id) VALUES ($1, $2, 'space_all', $3)`,
		newID(), workspaceID, spaceID,
	)
	require.NoError(t, err)

	linkPrincipal := newID()
	_, err = db.Exec(
		`INSERT INTO principals (id, workspace_id, kind, page_id) VALUES ($1, $2, 'share_link', $3)`,
		linkPrincipal, workspaceID, pageID,
	)
	require.NoError(t, err)

	_, err = db.Exec(
		`INSERT INTO principal_members (workspace_id, group_principal_id, member_principal_id)
		 VALUES ($1, $2, $3)`, workspaceID, groupPrincipal, userPrincipal,
	)
	require.NoError(t, err)
	_, err = db.Exec(
		`INSERT INTO workspace_grants (workspace_id, principal_id, "role") VALUES ($1, $2, 'admin')`,
		workspaceID, userPrincipal,
	)
	require.NoError(t, err)
	_, err = db.Exec(
		`INSERT INTO space_grants (workspace_id, space_id, principal_id, "role") VALUES ($1, $2, $3, 'editor')`,
		workspaceID, spaceID, userPrincipal,
	)
	require.NoError(t, err)
	_, err = db.Exec(
		`INSERT INTO page_grants (workspace_id, page_id, principal_id, "role") VALUES ($1, $2, $3, 'viewer')`,
		workspaceID, pageID, userPrincipal,
	)
	require.NoError(t, err)
	_, err = db.Exec(
		`INSERT INTO share_links (id, workspace_id, page_id, principal_id, capability, token_hash, created_by_user_id)
		 VALUES ($1, $2, $3, $4, 'view', sha256($5::bytea), $6)`,
		newID(), workspaceID, pageID, linkPrincipal, []byte(newID()), userID,
	)
	require.NoError(t, err)
}
