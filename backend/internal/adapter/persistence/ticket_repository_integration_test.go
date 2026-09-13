//go:build integration

package persistence_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/testsupport"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// insertTicketStatus / insertTicketType は raw SQL でスキーマ検証用の行を直接作る
// （repository を経由しない — CHECK / FK が効くかどうかそのものを見るテストのため）。
func insertTicketStatus(db *sql.DB, id, workspaceID, spaceID, name, category, color, position string, isInitial bool) error {
	_, err := db.Exec(
		`INSERT INTO ticket_statuses (id, workspace_id, space_id, name, category, color, "position", is_initial)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		id, workspaceID, spaceID, name, category, color, position, isInitial,
	)
	return err
}

func insertTicketType(db *sql.DB, id, workspaceID, spaceID, name string, hierarchyLevel int, color, position string, isDefault bool) error {
	_, err := db.Exec(
		`INSERT INTO ticket_types (id, workspace_id, space_id, name, hierarchy_level, color, "position", is_default)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		id, workspaceID, spaceID, name, hierarchyLevel, color, position, isDefault,
	)
	return err
}

// seedTicketMaster はチケット 1 件の FK が要求する状態・種別を最小構成で用意する。
func seedTicketMaster(t *testing.T, db *sql.DB, workspaceID, spaceID string) (statusID, typeID string) {
	t.Helper()
	statusID, typeID = newID(), newID()
	require.NoError(t, insertTicketStatus(db, statusID, workspaceID, spaceID, "To Do", "todo", "#5b6b7a", "a0", true))
	require.NoError(t, insertTicketType(db, typeID, workspaceID, spaceID, "タスク", 0, "#2f6b47", "a0", true))
	return statusID, typeID
}

// insertTicketRaw は 1 件を直接 INSERT する。number / position は呼び出し側が決める
// （同じスペースを共有する複数の subtest から呼んでも uq_tickets_space_number /
// uq_tickets_space_position とぶつからないように、固定値にしない）。
func insertTicketRaw(
	db *sql.DB, id, workspaceID, spaceID string, number int64, position, typeID, statusID string,
	parentID *string, priority int, startDate, dueDate *string,
) error {
	_, err := db.Exec(
		`INSERT INTO tickets (id, workspace_id, space_id, number, type_id, status_id, parent_id,
			title, doc, plain_text, priority, start_date, due_date, "position", created_by_user_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, 'テスト', '{"type":"doc","content":[]}'::jsonb, '', $8, $9, $10, $11, 1)`,
		id, workspaceID, spaceID, number, typeID, statusID, parentID, priority, startDate, dueDate, position,
	)
	return err
}

// TestTicketSchema_Integration は明示 DDL（schema.hcl のチケット表）が張る制約を実 Postgres で
// 固定する。usecase 層の検証（handler に届く前に断る）とは別に、DB そのものが最後の砦として
// 同じ規則を持っていることを確かめる。
func TestTicketSchema_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	testsupport.TruncateAll(t, sqlDB, kbTables...)
	ws := createWorkspace(t, sqlDB, "tk-schema")
	space := createSpace(t, sqlDB, ws, "eng")
	statusID, typeID := seedTicketMaster(t, sqlDB, ws, space)

	t.Run("優先度は1_2_3のみ", func(t *testing.T) {
		err := insertTicketRaw(sqlDB, newID(), ws, space, 101, "a1", typeID, statusID, nil, 9, nil, nil)
		requirePgError(t, err, sqlStateCheckViolation, "ck_tickets_priority")
	})

	t.Run("開始日は期限を超えられない", func(t *testing.T) {
		start, due := "2026-09-10", "2026-09-01"
		err := insertTicketRaw(sqlDB, newID(), ws, space, 102, "a2", typeID, statusID, nil, 2, &start, &due)
		requirePgError(t, err, sqlStateCheckViolation, "ck_tickets_dates_ordered")
	})

	t.Run("closed_atとresolutionは対で持つ", func(t *testing.T) {
		id := newID()
		require.NoError(t, insertTicketRaw(sqlDB, id, ws, space, 1, "a3", typeID, statusID, nil, 2, nil, nil))
		_, err := sqlDB.Exec(`UPDATE tickets SET closed_at = now() WHERE id = $1`, id)
		requirePgError(t, err, sqlStateCheckViolation, "ck_tickets_closed_pair")
	})

	t.Run("状態のcategoryは3枠のみ", func(t *testing.T) {
		err := insertTicketStatus(sqlDB, newID(), ws, space, "変な状態", "unknown", "#5b6b7a", "a5", false)
		requirePgError(t, err, sqlStateCheckViolation, "ck_ticket_statuses_category")
	})

	t.Run("種別の階層レベルは_1_0_1のみ", func(t *testing.T) {
		err := insertTicketType(sqlDB, newID(), ws, space, "変な種別", 5, "#2f6b47", "a5", false)
		requirePgError(t, err, sqlStateCheckViolation, "ck_ticket_types_hierarchy_level")
	})

	t.Run("担当は別ワークスペースのprincipalを指せない", func(t *testing.T) {
		otherWS := createWorkspace(t, sqlDB, "tk-schema-other")
		otherUser := createUser(t, sqlDB, "outsider")
		perm := persistence.NewKnowledgeBasePermissionRepository(sqlDB)
		outsider, err := perm.EnsureUserPrincipal(context.Background(), otherWS, otherUser)
		require.NoError(t, err)

		ticketID := newID()
		require.NoError(t, insertTicketRaw(sqlDB, ticketID, ws, space, 2, "a4", typeID, statusID, nil, 2, nil, nil))
		_, err = sqlDB.Exec(
			`INSERT INTO ticket_assignments (workspace_id, ticket_id, assignee_principal_id, assigned_by_user_id)
			 VALUES ($1, $2, $3, 1)`,
			ws, ticketID, outsider.ID,
		)
		requirePgError(t, err, sqlStateForeignKeyViolation, "fk_ticket_assignments_principal")
	})

	// closure table の depth は 1 行だけで判定できる範囲を DB で守る（page_paths と同じ規則。
	// 祖先の連鎖に抜けが無いかといった複数行の整合は行を書く側の責務）。
	t.Run("ticket_pathsのdepthは自己行だけが0で負にできない", func(t *testing.T) {
		parentID := newID()
		childID := newID()
		require.NoError(t, insertTicketRaw(sqlDB, parentID, ws, space, 201, "b1", typeID, statusID, nil, 2, nil, nil))
		require.NoError(t, insertTicketRaw(sqlDB, childID, ws, space, 202, "b2", typeID, statusID, &parentID, 2, nil, nil))

		insertTicketPath := func(ticketID, ancestorID string, depth int) error {
			_, err := sqlDB.Exec(
				`INSERT INTO ticket_paths (workspace_id, ticket_id, ancestor_id, depth) VALUES ($1, $2, $3, $4)`,
				ws, ticketID, ancestorID, depth,
			)
			return err
		}

		err := insertTicketPath(childID, childID, 1)
		requirePgError(t, err, sqlStateCheckViolation, "ck_ticket_paths_depth")

		err = insertTicketPath(childID, parentID, 0)
		requirePgError(t, err, sqlStateCheckViolation, "ck_ticket_paths_depth")

		err = insertTicketPath(childID, parentID, -1)
		requirePgError(t, err, sqlStateCheckViolation, "ck_ticket_paths_depth")

		require.NoError(t, insertTicketPath(childID, childID, 0))
		require.NoError(t, insertTicketPath(childID, parentID, 1))
	})

	t.Run("ticket_pathsは別ワークスペースのチケットを組にできない", func(t *testing.T) {
		wsB := createWorkspace(t, sqlDB, "tk-schema-other-paths")
		spaceB := createSpace(t, sqlDB, wsB, "eng")
		statusB, typeB := seedTicketMaster(t, sqlDB, wsB, spaceB)
		ticketA := newID()
		ticketB := newID()
		require.NoError(t, insertTicketRaw(sqlDB, ticketA, ws, space, 301, "c1", typeID, statusID, nil, 2, nil, nil))
		require.NoError(t, insertTicketRaw(sqlDB, ticketB, wsB, spaceB, 1, "c1", typeB, statusB, nil, 2, nil, nil))

		_, err := sqlDB.Exec(
			`INSERT INTO ticket_paths (workspace_id, ticket_id, ancestor_id, depth) VALUES ($1, $2, $3, $4)`,
			ws, ticketA, ticketB, 1,
		)
		requirePgError(t, err, sqlStateForeignKeyViolation, "fk_ticket_paths_ancestor")

		_, err = sqlDB.Exec(
			`INSERT INTO ticket_paths (workspace_id, ticket_id, ancestor_id, depth) VALUES ($1, $2, $3, $4)`,
			ws, ticketB, ticketA, 1,
		)
		requirePgError(t, err, sqlStateForeignKeyViolation, "fk_ticket_paths_ticket")
	})
}

// TestTicketRepository_Integration は persistence.ticketRepository を実 Postgres 相手に検証する。
// usecase 層の業務規則（親子の階層・深さ・周期など）はモックで既に固定済みなので、ここでは
// 「SQL がその規則の材料を正しく読み書きするか」（採番・簡易プロトコルの日付・
// テナント境界の WHERE ガード）に絞る。
func TestTicketRepository_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	repo := persistence.NewTicketRepository(sqlDB)
	ctx := context.Background()

	setup := func(t *testing.T) (ws, space string) {
		t.Helper()
		testsupport.TruncateAll(t, sqlDB, kbTables...)
		ws = createWorkspace(t, sqlDB, "tk-repo")
		space = createSpace(t, sqlDB, ws, "eng")
		return ws, space
	}

	t.Run("状態種別の名前は現役の中で大文字小文字を無視して一意", func(t *testing.T) {
		ws, space := setup(t)
		require.NoError(t, repo.InsertTicketStatus(ctx, &domain.TicketStatus{
			WorkspaceID: ws, SpaceID: space, Name: "To Do", Category: domain.TicketStatusCategoryTodo, Color: "#5b6b7a", Position: "a0",
		}))
		err := repo.InsertTicketStatus(ctx, &domain.TicketStatus{
			WorkspaceID: ws, SpaceID: space, Name: "TO DO", Category: domain.TicketStatusCategoryTodo, Color: "#5b6b7a", Position: "a1",
		})
		require.ErrorIs(t, err, repository.ErrTicketStatusNameTaken)

		require.NoError(t, repo.InsertTicketType(ctx, &domain.TicketType{
			WorkspaceID: ws, SpaceID: space, Name: "タスク", Color: "#2f6b47", Position: "a0",
		}))
		err = repo.InsertTicketType(ctx, &domain.TicketType{
			WorkspaceID: ws, SpaceID: space, Name: "タスク", Color: "#2f6b47", Position: "a1",
		})
		require.ErrorIs(t, err, repository.ErrTicketTypeNameTaken)
	})

	t.Run("採番はスペースごとに1から連番", func(t *testing.T) {
		ws, space := setup(t)
		status := &domain.TicketStatus{WorkspaceID: ws, SpaceID: space, Name: "To Do", Category: domain.TicketStatusCategoryTodo, Color: "#5b6b7a", Position: "a0", IsInitial: true}
		require.NoError(t, repo.InsertTicketStatus(ctx, status))
		typ := &domain.TicketType{WorkspaceID: ws, SpaceID: space, Name: "タスク", Color: "#2f6b47", Position: "a0", IsDefault: true}
		require.NoError(t, repo.InsertTicketType(ctx, typ))

		other := createSpace(t, sqlDB, ws, "other")
		otherStatus := &domain.TicketStatus{WorkspaceID: ws, SpaceID: other, Name: "To Do", Category: domain.TicketStatusCategoryTodo, Color: "#5b6b7a", Position: "a0", IsInitial: true}
		require.NoError(t, repo.InsertTicketStatus(ctx, otherStatus))
		otherType := &domain.TicketType{WorkspaceID: ws, SpaceID: other, Name: "タスク", Color: "#2f6b47", Position: "a0", IsDefault: true}
		require.NoError(t, repo.InsertTicketType(ctx, otherType))

		mk := func(spaceID, statusID, typeID, position string) *domain.Ticket {
			created, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
				WorkspaceID: ws, SpaceID: spaceID, TypeID: typeID, StatusID: statusID,
				Title: "x", Doc: []byte(`{"type":"doc","content":[]}`), Position: position, Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
			})
			require.NoError(t, err)
			return created
		}
		t1 := mk(space, status.ID, typ.ID, "a0")
		t2 := mk(space, status.ID, typ.ID, "a1")
		o1 := mk(other, otherStatus.ID, otherType.ID, "a0")
		assert.EqualValues(t, 1, t1.Number)
		assert.EqualValues(t, 2, t2.Number, "同じスペース内は連番")
		assert.EqualValues(t, 1, o1.Number, "スペースが違えば1から採番し直す")
	})

	t.Run("親チェーンは根に近い順_自分は含まない", func(t *testing.T) {
		ws, space := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)
		mk := func(parentID *string, position string) *domain.Ticket {
			created, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
				WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID, ParentID: parentID,
				Title: "x", Doc: []byte(`{"type":"doc","content":[]}`), Position: position, Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
			})
			require.NoError(t, err)
			return created
		}
		root := mk(nil, "a0")
		child := mk(&root.ID, "a1")
		grand := mk(&child.ID, "a2")

		chain, err := repo.ListTicketParentChain(ctx, ws, grand.ID)
		require.NoError(t, err)
		require.Len(t, chain, 2)
		assert.Equal(t, root.ID, chain[0].ID)
		assert.Equal(t, child.ID, chain[1].ID)

		empty, err := repo.ListTicketParentChain(ctx, ws, root.ID)
		require.NoError(t, err)
		assert.Empty(t, empty)
	})

	t.Run("担当の設定はテナント境界のWHEREガードで守られる", func(t *testing.T) {
		ws, space := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)
		created, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "x", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a0", Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)

		perm := persistence.NewKnowledgeBasePermissionRepository(sqlDB)
		alice := createUser(t, sqlDB, "alice")
		principal, err := perm.EnsureUserPrincipal(ctx, ws, alice)
		require.NoError(t, err)

		require.NoError(t, repo.UpsertTicketAssignment(ctx, &domain.TicketAssignment{
			WorkspaceID: ws, TicketID: created.ID, AssigneePrincipalID: principal.ID, AssignedByUserID: alice,
		}))
		got, err := repo.FindTicketAssignment(ctx, ws, created.ID)
		require.NoError(t, err)
		require.NotNil(t, got)
		assert.Equal(t, principal.ID, got.AssigneePrincipalID)

		// 同じ担当を UpdateTicket 経由の ON CONFLICT で置き換えても、workspace_id は
		// 自分自身のままである（EXCLUDED.workspace_id と一致しているので通常どおり通る）。
		bob := createUser(t, sqlDB, "bob")
		bobPrincipal, err := perm.EnsureUserPrincipal(ctx, ws, bob)
		require.NoError(t, err)
		require.NoError(t, repo.UpsertTicketAssignment(ctx, &domain.TicketAssignment{
			WorkspaceID: ws, TicketID: created.ID, AssigneePrincipalID: bobPrincipal.ID, AssignedByUserID: bob,
		}))
		got, err = repo.FindTicketAssignment(ctx, ws, created.ID)
		require.NoError(t, err)
		assert.Equal(t, bobPrincipal.ID, got.AssigneePrincipalID, "上書きで置き換わる")

		require.NoError(t, repo.DeleteTicketAssignment(ctx, ws, created.ID))
		got, err = repo.FindTicketAssignment(ctx, ws, created.ID)
		require.NoError(t, err)
		assert.Nil(t, got)
	})

	t.Run("状態変更はclosed_atとresolutionをまとめて書き換える", func(t *testing.T) {
		ws, space := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)
		created, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "x", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a0", Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		doneStatus := &domain.TicketStatus{WorkspaceID: ws, SpaceID: space, Name: "完了", Category: domain.TicketStatusCategoryDone, Color: "#2f6b47", Position: "a1"}
		require.NoError(t, repo.InsertTicketStatus(ctx, doneStatus))

		now := time.Now().UTC().Truncate(time.Second)
		resolution := domain.TicketResolutionDone
		updated, err := repo.ChangeTicketStatus(ctx, ws, created.ID, doneStatus.ID, &now, &resolution)
		require.NoError(t, err)
		assert.Equal(t, doneStatus.ID, updated.StatusID)
		require.NotNil(t, updated.ClosedAt)
		require.NotNil(t, updated.Resolution)
		assert.Equal(t, domain.TicketResolutionDone, *updated.Resolution)

		// 未完了へ戻すと usecase 側が (nil, nil) を渡す想定 — repository はそのまま書く。
		todoStatus := &domain.TicketStatus{WorkspaceID: ws, SpaceID: space, Name: "差し戻し", Category: domain.TicketStatusCategoryTodo, Color: "#5b6b7a", Position: "a2"}
		require.NoError(t, repo.InsertTicketStatus(ctx, todoStatus))
		reverted, err := repo.ChangeTicketStatus(ctx, ws, created.ID, todoStatus.ID, nil, nil)
		require.NoError(t, err)
		assert.Nil(t, reverted.ClosedAt)
		assert.Nil(t, reverted.Resolution)
	})

	t.Run("アーカイブと復元", func(t *testing.T) {
		ws, space := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)
		created, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "x", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a0", Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)

		require.NoError(t, repo.ArchiveTicket(ctx, ws, created.ID))
		got, err := repo.FindTicket(ctx, ws, created.ID)
		require.NoError(t, err)
		require.NotNil(t, got.ArchivedAt)

		require.NoError(t, repo.RestoreTicket(ctx, ws, created.ID, "b0"))
		got, err = repo.FindTicket(ctx, ws, created.ID)
		require.NoError(t, err)
		assert.Nil(t, got.ArchivedAt)
		assert.Equal(t, "b0", got.Position)
	})

	t.Run("変更履歴はグループと項目をまとめて書き新しい順で返す", func(t *testing.T) {
		ws, space := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)
		created, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "x", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a0", Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)

		old, new := "旧", "新"
		require.NoError(t, repo.InsertTicketChangeGroup(ctx, &domain.TicketChangeGroup{
			WorkspaceID: ws, TicketID: created.ID, ActorUserID: 1,
			Items: []domain.TicketChangeItem{{Field: domain.TicketChangeFieldTitle, OldValue: &old, NewValue: &new}},
		}))
		old2, new2 := "新", "新2"
		require.NoError(t, repo.InsertTicketChangeGroup(ctx, &domain.TicketChangeGroup{
			WorkspaceID: ws, TicketID: created.ID, ActorUserID: 1,
			Items: []domain.TicketChangeItem{{Field: domain.TicketChangeFieldTitle, OldValue: &old2, NewValue: &new2}},
		}))

		groups, err := repo.ListTicketChangeGroups(ctx, ws, created.ID)
		require.NoError(t, err)
		require.Len(t, groups, 2)
		require.Len(t, groups[0].Items, 1)
		assert.Equal(t, "新2", *groups[0].Items[0].NewValue, "新しい順")
		assert.Equal(t, "新", *groups[1].Items[0].NewValue)
	})

	t.Run("派生表は本文保存のたびに張り替わる", func(t *testing.T) {
		ws, space := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)
		src, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "x", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a0", Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		target, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "参照先", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a1", Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)

		require.NoError(t, repo.ReplaceTicketTicketLinks(ctx, ws, src.ID, []string{target.ID}))
		links, err := repo.ListTicketTicketLinks(ctx, ws, src.ID)
		require.NoError(t, err)
		require.Len(t, links, 1)
		assert.Equal(t, target.ID, links[0].TargetTicketID)

		back, err := repo.ListTicketsReferencingTicket(ctx, ws, target.ID)
		require.NoError(t, err)
		require.Len(t, back, 1)
		assert.Equal(t, src.ID, back[0].SourceTicketID)

		// 張り替え（空へ）で消える。実在しない ID は黙って除外される
		// （リンク切れ 1 本のために保存全体を失敗させない方針。doc.go の doc 参照）。
		require.NoError(t, repo.ReplaceTicketTicketLinks(ctx, ws, src.ID, []string{newID()}))
		links, err = repo.ListTicketTicketLinks(ctx, ws, src.ID)
		require.NoError(t, err)
		assert.Empty(t, links)
	})

	t.Run("ページへの派生リンクも張り替わり実在しないIDは除外される", func(t *testing.T) {
		ws, space := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)
		src, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "x", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a0", Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		pageSpace := createSpace(t, sqlDB, ws, "kb")
		pageID := createPage(t, sqlDB, ws, pageSpace, nil, "a0")

		require.NoError(t, repo.ReplaceTicketPageLinks(ctx, ws, src.ID, []string{pageID, newID()}))
		links, err := repo.ListTicketPageLinks(ctx, ws, src.ID)
		require.NoError(t, err)
		require.Len(t, links, 1, "実在しないページIDは黙って除外される")
		assert.Equal(t, pageID, links[0].TargetPageID)

		// ListTicketsReferencingPage はページ詳細の逆参照一覧が使う（そのページを参照している
		// チケット一覧）。ticket_repository.go の doc 参照。
		referencing, err := repo.ListTicketsReferencingPage(ctx, ws, pageID)
		require.NoError(t, err)
		require.Len(t, referencing, 1)
		assert.Equal(t, src.ID, referencing[0].ID)

		require.NoError(t, repo.ReplaceTicketPageLinks(ctx, ws, src.ID, nil))
		links, err = repo.ListTicketPageLinks(ctx, ws, src.ID)
		require.NoError(t, err)
		assert.Empty(t, links, "空へ張り替えると消える")

		referencing, err = repo.ListTicketsReferencingPage(ctx, ws, pageID)
		require.NoError(t, err)
		assert.Empty(t, referencing, "張り替えで空にすれば逆参照からも消える")
	})

	t.Run("状態マスタのCRUD一式", func(t *testing.T) {
		ws, space := setup(t)
		has, err := repo.HasActiveInitialTicketStatus(ctx, ws, space)
		require.NoError(t, err)
		assert.False(t, has, "有効化前は初期状態が無い")

		s := &domain.TicketStatus{WorkspaceID: ws, SpaceID: space, Name: "To Do", Category: domain.TicketStatusCategoryTodo, Color: "#5b6b7a", Position: "a0", IsInitial: true}
		require.NoError(t, repo.InsertTicketStatus(ctx, s))
		has, err = repo.HasActiveInitialTicketStatus(ctx, ws, space)
		require.NoError(t, err)
		assert.True(t, has, "「有効化済み」の正本はこの事実")

		got, err := repo.FindTicketStatus(ctx, ws, space, s.ID)
		require.NoError(t, err)
		assert.Equal(t, "To Do", got.Name)
		_, err = repo.FindTicketStatus(ctx, ws, space, newID())
		require.ErrorIs(t, err, repository.ErrTicketStatusNotFound)

		list, err := repo.ListTicketStatuses(ctx, ws, space, false)
		require.NoError(t, err)
		require.Len(t, list, 1)

		initial, err := repo.GetInitialTicketStatus(ctx, ws, space)
		require.NoError(t, err)
		assert.Equal(t, s.ID, initial.ID)

		last, err := repo.LastActiveTicketStatusPosition(ctx, ws, space)
		require.NoError(t, err)
		assert.Equal(t, "a0", last)

		updated := &domain.TicketStatus{ID: s.ID, WorkspaceID: ws, SpaceID: space, Name: "改名後", Category: domain.TicketStatusCategoryInProgress, Color: "#a0661a"}
		require.NoError(t, repo.UpdateTicketStatus(ctx, updated))
		assert.Equal(t, "改名後", updated.Name)

		s2 := &domain.TicketStatus{WorkspaceID: ws, SpaceID: space, Name: "完了", Category: domain.TicketStatusCategoryDone, Color: "#2f6b47", Position: "a1"}
		require.NoError(t, repo.InsertTicketStatus(ctx, s2))
		require.NoError(t, repo.SetTicketStatusInitial(ctx, ws, space, s2.ID))
		initial, err = repo.GetInitialTicketStatus(ctx, ws, space)
		require.NoError(t, err)
		assert.Equal(t, s2.ID, initial.ID, "旧初期状態は自動的に降ろされる")

		typ := &domain.TicketType{WorkspaceID: ws, SpaceID: space, Name: "タスク", Color: "#2f6b47", Position: "a0", IsDefault: true}
		require.NoError(t, repo.InsertTicketType(ctx, typ))
		_, err = repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typ.ID, StatusID: updated.ID,
			Title: "x", Doc: []byte(`{"type":"doc","content":[]}`), Position: "b0", Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		n, err := repo.CountActiveTicketsByStatus(ctx, ws, space, updated.ID)
		require.NoError(t, err)
		assert.EqualValues(t, 1, n)

		// 管理画面の「使用中 N 件」はスペース単位の GROUP BY で一括して数える
		// （状態ごとに CountActiveTicketsByStatus を呼ぶ N+1 の代わり）。
		// 使っていない状態（s2）は対応表に現れない — 呼び出し側が 0 とみなす契約。
		grouped, err := repo.CountActiveTicketsByStatusForSpace(ctx, ws, space)
		require.NoError(t, err)
		assert.EqualValues(t, 1, grouped[updated.ID])
		_, hasUnused := grouped[s2.ID]
		assert.False(t, hasUnused, "使っていない状態は対応表に現れない")

		// s2 は今の初期状態なのでアーカイブできない（ck_ticket_statuses_initial_active）。
		// もう初期状態ではない updated（旧 s）をアーカイブする。
		require.NoError(t, repo.ArchiveTicketStatus(ctx, ws, space, updated.ID))
		// includeArchived は「アーカイブ済みだけを絞り込む」フラグであって「両方含める」ではない
		// （ListTicketStatuses の SQL コメント参照。archived=true → archived_at IS NOT NULL だけ）。
		archived, err := repo.ListTicketStatuses(ctx, ws, space, true)
		require.NoError(t, err)
		require.Len(t, archived, 1)
		require.NoError(t, repo.RestoreTicketStatus(ctx, ws, space, updated.ID, "b1"))
		active, err := repo.ListTicketStatuses(ctx, ws, space, false)
		require.NoError(t, err)
		assert.Len(t, active, 2)
	})

	t.Run("種別マスタのCRUD一式", func(t *testing.T) {
		ws, space := setup(t)
		typ := &domain.TicketType{WorkspaceID: ws, SpaceID: space, Name: "タスク", Color: "#2f6b47", Position: "a0", IsDefault: true}
		require.NoError(t, repo.InsertTicketType(ctx, typ))

		got, err := repo.FindTicketType(ctx, ws, space, typ.ID)
		require.NoError(t, err)
		assert.Equal(t, "タスク", got.Name)

		list, err := repo.ListTicketTypes(ctx, ws, space, false)
		require.NoError(t, err)
		require.Len(t, list, 1)

		def, err := repo.GetDefaultTicketType(ctx, ws, space)
		require.NoError(t, err)
		assert.Equal(t, typ.ID, def.ID)

		last, err := repo.LastActiveTicketTypePosition(ctx, ws, space)
		require.NoError(t, err)
		assert.Equal(t, "a0", last)

		updated := &domain.TicketType{ID: typ.ID, WorkspaceID: ws, SpaceID: space, Name: "改名後", Color: "#9a3b2e", HierarchyLevel: 1}
		require.NoError(t, repo.UpdateTicketType(ctx, updated))
		assert.Equal(t, "改名後", updated.Name)

		typ2 := &domain.TicketType{WorkspaceID: ws, SpaceID: space, Name: "バグ", Color: "#2f6b47", Position: "a1"}
		require.NoError(t, repo.InsertTicketType(ctx, typ2))
		require.NoError(t, repo.SetTicketTypeDefault(ctx, ws, space, typ2.ID))
		def, err = repo.GetDefaultTicketType(ctx, ws, space)
		require.NoError(t, err)
		assert.Equal(t, typ2.ID, def.ID, "旧既定は自動的に外れる")

		status := &domain.TicketStatus{WorkspaceID: ws, SpaceID: space, Name: "To Do", Category: domain.TicketStatusCategoryTodo, Color: "#5b6b7a", Position: "a0", IsInitial: true}
		require.NoError(t, repo.InsertTicketStatus(ctx, status))
		_, err = repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typ2.ID, StatusID: status.ID,
			Title: "x", Doc: []byte(`{"type":"doc","content":[]}`), Position: "b0", Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		n, err := repo.CountActiveTicketsByType(ctx, ws, space, typ2.ID)
		require.NoError(t, err)
		assert.EqualValues(t, 1, n)

		groupedTypes, err := repo.CountActiveTicketsByTypeForSpace(ctx, ws, space)
		require.NoError(t, err)
		assert.EqualValues(t, 1, groupedTypes[typ2.ID])
		_, hasUnusedType := groupedTypes[updated.ID]
		assert.False(t, hasUnusedType, "使っていない種別は対応表に現れない")

		require.NoError(t, repo.ArchiveTicketType(ctx, ws, space, updated.ID))
		// includeArchived は「アーカイブ済みだけを絞り込む」フラグ（状態マスタと同じ規則）。
		archived, err := repo.ListTicketTypes(ctx, ws, space, true)
		require.NoError(t, err)
		require.Len(t, archived, 1)
		require.NoError(t, repo.RestoreTicketType(ctx, ws, space, updated.ID, "b1"))
		active, err := repo.ListTicketTypes(ctx, ws, space, false)
		require.NoError(t, err)
		assert.Len(t, active, 2)
	})

	t.Run("一覧_更新_移動_子一覧_表示キー解決", func(t *testing.T) {
		ws, space := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)
		root, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "親", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a0", Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		child, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID, ParentID: &root.ID,
			Title: "子", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a1", Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)

		// 一覧（フィルタ無し）。
		all, err := repo.ListTickets(ctx, repository.ListTicketsInput{WorkspaceID: ws, SpaceID: space})
		require.NoError(t, err)
		require.Len(t, all, 2)

		// status_id で絞り込み。
		filtered, err := repo.ListTickets(ctx, repository.ListTicketsInput{WorkspaceID: ws, SpaceID: space, StatusID: &statusID})
		require.NoError(t, err)
		assert.Len(t, filtered, 2)

		children, err := repo.ListTicketChildren(ctx, ws, space, root.ID)
		require.NoError(t, err)
		require.Len(t, children, 1)
		assert.Equal(t, child.ID, children[0].ID)

		n, err := repo.CountActiveTicketChildren(ctx, ws, root.ID)
		require.NoError(t, err)
		assert.EqualValues(t, 1, n)

		// 表示キー解決。spaceKey は spaces.key の値（setup() が "eng" で作っている。
		// space 変数は spaces.id であって key ではない — 混同しない）。
		resolvedID, err := repo.ResolveTicketIDByKey(ctx, ws, "eng", root.Number)
		require.NoError(t, err)
		assert.Equal(t, root.ID, resolvedID)
		_, err = repo.ResolveTicketIDByKey(ctx, ws, "eng", 9999)
		require.ErrorIs(t, err, repository.ErrTicketNotFound)

		// 更新（PUT 相当）。
		updated, err := repo.UpdateTicket(ctx, ws, root.ID, repository.TicketUpdateFields{
			TypeID: typeID, Title: "更新後", Doc: []byte(`{"type":"doc","content":[]}`),
			Priority: domain.TicketPriorityHigh,
		})
		require.NoError(t, err)
		assert.Equal(t, "更新後", updated.Title)

		// tickets.position を直接読む経路（FindActiveTicketPosition。並び順の正本では
		// なくなったが、列自体はまだ残っているので読み書きの SQL は健在であることを確認する）。
		pos, ok, err := repo.FindActiveTicketPosition(ctx, ws, space, root.ID)
		require.NoError(t, err)
		require.True(t, ok)
		assert.Equal(t, "a0", pos)
		_, ok, err = repo.FindActiveTicketPosition(ctx, ws, space, newID())
		require.NoError(t, err)
		assert.False(t, ok, "非実在は 0 行に畳まれる")

		// 並び替え（ticket_ranks。段 2 以降の並び順の正本。設計 Ⅳ-F）。root/child は
		// repo.CreateTicket を直接呼んでおり InsertTicketRank を伴っていないので、
		// GetTicket の position は COALESCE で tickets.position（"a1"）にフォールバックする。
		got, err := repo.FindTicket(ctx, ws, child.ID)
		require.NoError(t, err)
		assert.Equal(t, "a1", got.Position, "ticket_ranks に行が無ければ tickets.position へ落ちる")

		require.NoError(t, repo.InsertTicketRank(ctx, ws, child.ID, "a1"))
		lastRank, err := repo.LastActiveTicketRankPosition(ctx, ws, space)
		require.NoError(t, err)
		assert.Equal(t, "a1", lastRank)
		require.NoError(t, repo.MoveTicketRank(ctx, ws, child.ID, lastRank+"1"))
		moved, err := repo.FindTicket(ctx, ws, child.ID)
		require.NoError(t, err)
		assert.Equal(t, "a11", moved.Position, "InsertTicketRank 後は ticket_ranks.position を返す")
	})

	// 削除・復元（設計 Ⅳ-J）。deleted_at IS NULL のチケットは FindTicket から見えなくなり、
	// 削除済みは FindDeletedTicket でだけ引ける（Archive/Restore の archived_at と対称）。
	t.Run("削除と復元_本文からの参照の伝播", func(t *testing.T) {
		ws, space := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)
		created, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "x", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a0", Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		target, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "参照先", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a1", Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		pageSpace := createSpace(t, sqlDB, ws, "kb-del")
		pageID := createPage(t, sqlDB, ws, pageSpace, nil, "a0")

		require.NoError(t, repo.ReplaceTicketTicketLinks(ctx, ws, created.ID, []string{target.ID}))
		require.NoError(t, repo.ReplaceTicketPageLinks(ctx, ws, created.ID, []string{pageID}))
		backFromTicket, err := repo.ListTicketsReferencingTicket(ctx, ws, target.ID)
		require.NoError(t, err)
		require.Len(t, backFromTicket, 1, "削除前は逆参照に載る")
		// ListPagesReferencingTicket は既知の実装ミス（ticket_repository.go の doc 参照。
		// 内部で ListTicketPageLinksBySource を呼んでおり target_page_id では絞れない）で
		// 段2の対象外のため、ページ側は ticket_page_links.deleted_at を直接読んで確かめる。
		var pageLinkDeletedBefore sql.NullTime
		require.NoError(t, sqlDB.QueryRow(
			`SELECT deleted_at FROM ticket_page_links WHERE workspace_id = $1 AND source_ticket_id = $2 AND target_page_id = $3`,
			ws, created.ID, pageID,
		).Scan(&pageLinkDeletedBefore))
		assert.False(t, pageLinkDeletedBefore.Valid, "削除前は deleted_at が立っていない")

		// 削除。以後 FindTicket は「無い」と同じ扱いにする。
		require.NoError(t, repo.DeleteTicket(ctx, ws, created.ID))
		_, err = repo.FindTicket(ctx, ws, created.ID)
		require.ErrorIs(t, err, repository.ErrTicketNotFound, "削除済みは現役取得から見えない")
		// 二重削除は 0 行（冪等な失敗）。
		require.ErrorIs(t, repo.DeleteTicket(ctx, ws, created.ID), repository.ErrTicketNotFound)

		// 派生リンクへの伝播（DeleteTicketUseCase が呼ぶのと同じ 2 メソッド）。
		require.NoError(t, repo.DeleteTicketPageLinksBySourceCascade(ctx, ws, created.ID))
		require.NoError(t, repo.DeleteTicketTicketLinksBySourceCascade(ctx, ws, created.ID))
		backFromTicket, err = repo.ListTicketsReferencingTicket(ctx, ws, target.ID)
		require.NoError(t, err)
		assert.Empty(t, backFromTicket, "削除済みチケットからの参照は逆参照一覧に出ない")
		var pageLinkDeletedAfter sql.NullTime
		require.NoError(t, sqlDB.QueryRow(
			`SELECT deleted_at FROM ticket_page_links WHERE workspace_id = $1 AND source_ticket_id = $2 AND target_page_id = $3`,
			ws, created.ID, pageID,
		).Scan(&pageLinkDeletedAfter))
		assert.True(t, pageLinkDeletedAfter.Valid, "伝播後は deleted_at が立つ")

		// FindDeletedTicket は削除済みだけを引く（現役は見えない）。
		deleted, err := repo.FindDeletedTicket(ctx, ws, created.ID)
		require.NoError(t, err)
		require.NotNil(t, deleted.DeletedAt)
		_, err = repo.FindDeletedTicket(ctx, ws, target.ID)
		require.ErrorIs(t, err, repository.ErrTicketNotDeleted, "現役チケットは FindDeletedTicket で引けない")

		// 復元。position は末尾へ付け直す。
		require.NoError(t, repo.RestoreDeletedTicket(ctx, ws, created.ID, "z0"))
		restored, err := repo.FindTicket(ctx, ws, created.ID)
		require.NoError(t, err)
		assert.Nil(t, restored.DeletedAt)
		// 二重復元は 0 行。
		require.ErrorIs(t, repo.RestoreDeletedTicket(ctx, ws, created.ID, "z1"), repository.ErrTicketNotDeleted)
	})

	// 部分一意（uq_tickets_space_position）が deleted_at IS NULL の行だけを見ることを、
	// 実 Postgres で固定する（削除済みと同じ position の現役チケットを作り直せる）。
	t.Run("削除済みは一意制約の対象から外れる", func(t *testing.T) {
		ws, space := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)
		first, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "x", Doc: []byte(`{"type":"doc","content":[]}`), Position: "c0", Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		require.NoError(t, repo.DeleteTicket(ctx, ws, first.ID))

		// 削除済みと同じ position ("c0") で新しいチケットを作れる（部分一意が deleted_at を見ている証拠）。
		require.NoError(t, insertTicketRaw(sqlDB, newID(), ws, space, 999, "c0", typeID, statusID, nil, 2, nil, nil))
	})

	t.Run("担当中のチケット一覧", func(t *testing.T) {
		ws, space := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)
		created, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "x", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a0", Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		perm := persistence.NewKnowledgeBasePermissionRepository(sqlDB)
		alice := createUser(t, sqlDB, "alice-assigned")
		principal, err := perm.EnsureUserPrincipal(ctx, ws, alice)
		require.NoError(t, err)
		require.NoError(t, repo.UpsertTicketAssignment(ctx, &domain.TicketAssignment{
			WorkspaceID: ws, TicketID: created.ID, AssigneePrincipalID: principal.ID, AssignedByUserID: alice,
		}))

		assigned, err := repo.ListTicketsAssignedToPrincipal(ctx, ws, principal.ID)
		require.NoError(t, err)
		require.Len(t, assigned, 1)
		assert.Equal(t, created.ID, assigned[0].ID)
	})

	// 段 4 で ListTickets へ足した label_id / due_before / start_after の絞り込みを、
	// 実 Postgres の EXISTS サブクエリ・date キャストで固定する（fake の同等ロジックは
	// handler 層のテストで別途確かめているが、生 SQL 自体の正しさはここでしか見られない）。
	t.Run("一覧はlabel_id_due_before_start_afterで絞り込める", func(t *testing.T) {
		ws, space := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)
		labels := persistence.NewLabelRepository(sqlDB)
		label := &domain.Label{WorkspaceID: ws, SpaceID: space, Name: "緊急", Color: "#ff0000"}
		require.NoError(t, labels.CreateLabel(ctx, label))

		due1, start1 := "2026-01-10", "2026-01-01"
		tagged, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "対象", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a0",
			Priority: domain.TicketPriorityDefault, StartDate: &start1, DueDate: &due1, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		require.NoError(t, labels.AddTicketLabel(ctx, ws, tagged.ID, label.ID))

		due2, start2 := "2026-03-10", "2026-03-01"
		_, err = repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "対象外", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a1",
			Priority: domain.TicketPriorityDefault, StartDate: &start2, DueDate: &due2, CreatedByUserID: 1,
		})
		require.NoError(t, err)

		byLabel, err := repo.ListTickets(ctx, repository.ListTicketsInput{
			WorkspaceID: ws, SpaceID: space, LabelID: &label.ID,
		})
		require.NoError(t, err)
		require.Len(t, byLabel, 1)
		assert.Equal(t, tagged.ID, byLabel[0].Ticket.ID)

		dueBefore := "2026-02-01"
		byDue, err := repo.ListTickets(ctx, repository.ListTicketsInput{
			WorkspaceID: ws, SpaceID: space, DueBefore: &dueBefore,
		})
		require.NoError(t, err)
		require.Len(t, byDue, 1)
		assert.Equal(t, tagged.ID, byDue[0].Ticket.ID)

		startAfter := "2026-02-01"
		byStart, err := repo.ListTickets(ctx, repository.ListTicketsInput{
			WorkspaceID: ws, SpaceID: space, StartAfter: &startAfter,
		})
		require.NoError(t, err)
		require.Len(t, byStart, 1)
		assert.NotEqual(t, tagged.ID, byStart[0].Ticket.ID, "start_afterは指定日以降のみ")
	})

	// 段 5 で足した unassigned / assigned_to_me_principal_id / overdue / q を、実 Postgres の
	// LEFT JOIN・date比較・ILIKE/word_similarity で固定する。GetTicketCounts も同じ行の集合を
	// FILTER で集計するので、ここで一緒に確かめる。
	t.Run("一覧はunassigned_assignedToMe_overdue_qで絞り込める_件数も一致する", func(t *testing.T) {
		ws, space := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)
		perm := persistence.NewKnowledgeBasePermissionRepository(sqlDB)
		me := createUser(t, sqlDB, "me-assigned")
		meP, err := perm.EnsureUserPrincipal(ctx, ws, me)
		require.NoError(t, err)
		other := createUser(t, sqlDB, "other-assigned")
		otherP, err := perm.EnsureUserPrincipal(ctx, ws, other)
		require.NoError(t, err)

		mine, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "認証コードの発行手順", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a0",
			Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		require.NoError(t, repo.UpsertTicketAssignment(ctx, &domain.TicketAssignment{
			WorkspaceID: ws, TicketID: mine.ID, AssigneePrincipalID: meP.ID, AssignedByUserID: me,
		}))

		othersTicket, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "他人の担当", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a1",
			Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		require.NoError(t, repo.UpsertTicketAssignment(ctx, &domain.TicketAssignment{
			WorkspaceID: ws, TicketID: othersTicket.ID, AssigneePrincipalID: otherP.ID, AssignedByUserID: other,
		}))

		overdueDate := "2020-01-01"
		overdue, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "期限切れ", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a2",
			Priority: domain.TicketPriorityDefault, DueDate: &overdueDate, CreatedByUserID: 1,
		})
		require.NoError(t, err)

		unassignedTicket, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
			Title: "未割り当て", Doc: []byte(`{"type":"doc","content":[]}`), Position: "a3",
			Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)

		byUnassigned, err := repo.ListTickets(ctx, repository.ListTicketsInput{
			WorkspaceID: ws, SpaceID: space, Unassigned: true,
		})
		require.NoError(t, err)
		gotIDs := make([]string, len(byUnassigned))
		for i, r := range byUnassigned {
			gotIDs[i] = r.Ticket.ID
		}
		assert.ElementsMatch(t, []string{overdue.ID, unassignedTicket.ID}, gotIDs, "unassignedは担当の付いていない全件")

		byAssignedToMe, err := repo.ListTickets(ctx, repository.ListTicketsInput{
			WorkspaceID: ws, SpaceID: space, AssignedToMePrincipalID: &meP.ID,
		})
		require.NoError(t, err)
		require.Len(t, byAssignedToMe, 1)
		assert.Equal(t, mine.ID, byAssignedToMe[0].Ticket.ID)

		byOverdue, err := repo.ListTickets(ctx, repository.ListTicketsInput{
			WorkspaceID: ws, SpaceID: space, Overdue: true,
		})
		require.NoError(t, err)
		require.Len(t, byOverdue, 1)
		assert.Equal(t, overdue.ID, byOverdue[0].Ticket.ID)

		// q: ILIKE の中間一致（"担当"は「他人の担当」にだけ入っている）。
		q := "担当"
		byQ, err := repo.ListTickets(ctx, repository.ListTicketsInput{WorkspaceID: ws, SpaceID: space, Q: &q})
		require.NoError(t, err)
		require.Len(t, byQ, 1)
		assert.Equal(t, othersTicket.ID, byQ[0].Ticket.ID)

		// q: word_similarity によるあいまい検索（「コート」は「コード」の打ち間違い。
		// ILIKE の中間一致では拾えない）。
		typo := "認証コート"
		byTypo, err := repo.ListTickets(ctx, repository.ListTicketsInput{WorkspaceID: ws, SpaceID: space, Q: &typo})
		require.NoError(t, err)
		require.Len(t, byTypo, 1, "打ち間違いが word_similarity で拾えていない")
		assert.Equal(t, mine.ID, byTypo[0].Ticket.ID)

		counts, err := repo.GetTicketCounts(ctx, ws, space, &meP.ID)
		require.NoError(t, err)
		assert.Equal(t, repository.TicketCounts{Total: 4, AssignedToMe: 1, Overdue: 1, Unassigned: 2}, counts)
	})
}

// seedTicketMasterViaRepo は repository 経由で状態・種別を 1 つずつ用意する
// （seedTicketMaster の raw SQL 版と違い、repository の採番・検証を経由する）。
func seedTicketMasterViaRepo(ctx context.Context, t *testing.T, repo repository.TicketRepository, ws, space string) (statusID, typeID string) {
	t.Helper()
	// Position は repository が採番しない（usecase が fracindex で決めて渡す設計 — 段 1 の
	// CreateTicketStatusUseCase / CreateTicketTypeUseCase 参照）。ここでは 1 件ずつしか
	// 作らないので固定値で足りる。
	status := &domain.TicketStatus{WorkspaceID: ws, SpaceID: space, Name: "To Do", Category: domain.TicketStatusCategoryTodo, Color: "#5b6b7a", Position: "a0", IsInitial: true}
	require.NoError(t, repo.InsertTicketStatus(ctx, status))
	typ := &domain.TicketType{WorkspaceID: ws, SpaceID: space, Name: "タスク", Color: "#2f6b47", Position: "a0", IsDefault: true}
	require.NoError(t, repo.InsertTicketType(ctx, typ))
	return status.ID, typ.ID
}

// TestTicketPaths_Integration は ticket_paths（parent_id の閉包表）の SQL そのものを固定する。
// InsertTicketPathSelf/InsertTicketPathAncestors/DetachTicketPathSubtree/AttachTicketPathSubtree
// を usecase を介さず直接呼ぶ（CreateTicketUseCase / ChangeTicketParentUseCase が正しい順で
// 呼ぶことはモックテストが別に固定するので、ここでは SQL の正しさだけを見る）。
func TestTicketPaths_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	repo := persistence.NewTicketRepository(sqlDB)
	ctx := context.Background()

	setup := func(t *testing.T) (ws, space string) {
		t.Helper()
		testsupport.TruncateAll(t, sqlDB, kbTables...)
		ws = createWorkspace(t, sqlDB, "tk-paths")
		space = createSpace(t, sqlDB, ws, "eng")
		return ws, space
	}

	// mkTicket は CreateTicketUseCase.Execute の閉包表まわりと同じ順序（自己参照 →
	// 親があれば祖先集合の継承）を手で並べる。
	mkTicket := func(t *testing.T, ws, space, statusID, typeID string, parentID *string, position string) *domain.Ticket {
		t.Helper()
		created, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
			WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID, ParentID: parentID,
			Title: "x", Doc: []byte(`{"type":"doc","content":[]}`), Position: position, Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		})
		require.NoError(t, err)
		require.NoError(t, repo.InsertTicketPathSelf(ctx, ws, created.ID))
		if parentID != nil {
			require.NoError(t, repo.InsertTicketPathAncestors(ctx, ws, created.ID, *parentID))
		}
		return created
	}

	t.Run("直下作成は自己参照のみ_親付き作成は親の祖先集合を引き継ぐ", func(t *testing.T) {
		ws, space := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)
		root := mkTicket(t, ws, space, statusID, typeID, nil, "a0")
		child := mkTicket(t, ws, space, statusID, typeID, &root.ID, "a1")
		grand := mkTicket(t, ws, space, statusID, typeID, &child.ID, "a2")

		rootAncestors, err := repo.ListTicketAncestors(ctx, ws, root.ID)
		require.NoError(t, err)
		assert.Empty(t, rootAncestors, "ルートに祖先は無い")

		childAncestors, err := repo.ListTicketAncestors(ctx, ws, child.ID)
		require.NoError(t, err)
		require.Len(t, childAncestors, 1)
		assert.Equal(t, root.ID, childAncestors[0].ID)

		grandAncestors, err := repo.ListTicketAncestors(ctx, ws, grand.ID)
		require.NoError(t, err)
		require.Len(t, grandAncestors, 2, "根から順")
		assert.Equal(t, root.ID, grandAncestors[0].ID)
		assert.Equal(t, child.ID, grandAncestors[1].ID)
	})

	// DeleteTicketUseCase は削除を子へ連鎖させないので、子が生きたまま親だけ論理削除された
	// 状態があり得る。パンくず（ListTicketAncestors）が削除済みの祖先まで題名・本文ごと
	// 返すと、削除より後にスペースへ権限を得た利用者が、削除前の内容を読めてしまう。
	t.Run("論理削除済みの祖先はパンくずに含めない", func(t *testing.T) {
		ws, space := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)
		root := mkTicket(t, ws, space, statusID, typeID, nil, "d0")
		child := mkTicket(t, ws, space, statusID, typeID, &root.ID, "d1")
		grand := mkTicket(t, ws, space, statusID, typeID, &child.ID, "d2")

		require.NoError(t, repo.DeleteTicket(ctx, ws, child.ID))

		grandAncestors, err := repo.ListTicketAncestors(ctx, ws, grand.ID)
		require.NoError(t, err)
		require.Len(t, grandAncestors, 1, "削除済みの child を除いた root だけが残る")
		assert.Equal(t, root.ID, grandAncestors[0].ID)
	})

	t.Run("親の付け替えでサブツリー全体の祖先集合が張り替わる", func(t *testing.T) {
		ws, space := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)
		// 旧木: oldRoot - a - b（b は a の子で、付け替え時に a と一緒に動くはず）。
		oldRoot := mkTicket(t, ws, space, statusID, typeID, nil, "a0")
		a := mkTicket(t, ws, space, statusID, typeID, &oldRoot.ID, "a1")
		b := mkTicket(t, ws, space, statusID, typeID, &a.ID, "a2")
		newRoot := mkTicket(t, ws, space, statusID, typeID, nil, "a3")

		// a を newRoot の下へ付け替える。Detach → Attach の順（page_paths の MovePage と同じ）。
		require.NoError(t, repo.DetachTicketPathSubtree(ctx, ws, a.ID))
		require.NoError(t, repo.AttachTicketPathSubtree(ctx, ws, a.ID, newRoot.ID))

		aAncestors, err := repo.ListTicketAncestors(ctx, ws, a.ID)
		require.NoError(t, err)
		require.Len(t, aAncestors, 1)
		assert.Equal(t, newRoot.ID, aAncestors[0].ID, "a の祖先は newRoot だけになる（oldRoot は外れる）")

		bAncestors, err := repo.ListTicketAncestors(ctx, ws, b.ID)
		require.NoError(t, err)
		require.Len(t, bAncestors, 2, "子孫 b も一緒に付け替わる")
		assert.Equal(t, newRoot.ID, bAncestors[0].ID)
		assert.Equal(t, a.ID, bAncestors[1].ID)

		var oldRootDescendantCount int
		require.NoError(t, sqlDB.QueryRow(
			`SELECT count(*) FROM ticket_paths WHERE workspace_id = $1 AND ancestor_id = $2`, ws, oldRoot.ID,
		).Scan(&oldRootDescendantCount))
		assert.Equal(t, 1, oldRootDescendantCount, "oldRoot自身の自己行だけが残る（a・bはもう子孫ではない）")
	})

	t.Run("トップレベルへ戻すとDetachだけで祖先行が全て消える", func(t *testing.T) {
		ws, space := setup(t)
		statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)
		root := mkTicket(t, ws, space, statusID, typeID, nil, "a0")
		child := mkTicket(t, ws, space, statusID, typeID, &root.ID, "a1")

		require.NoError(t, repo.DetachTicketPathSubtree(ctx, ws, child.ID))
		// Attach は呼ばない（トップレベルへ戻すケース。ChangeTicketParentUseCase と同じ分岐）。

		ancestors, err := repo.ListTicketAncestors(ctx, ws, child.ID)
		require.NoError(t, err)
		assert.Empty(t, ancestors, "親を無くしたら祖先行も消える")
	})
}

// TestTicketSimpleProtocol_Integration は simple query protocol（本番の transaction pooler と
// 同じ経路）でチケットの日付（date → string override）と doc（jsonb）が正しく往復することを
// 固定する。段 0 で sqlc.yaml に date → string の override を足した理由そのものの回帰テスト
// （extended protocol では検出できない — pgx が time.Time を渡すと 1 日ずれる本番限定の不具合
// だったため。設計 Ⅳ-K）。
func TestTicketSimpleProtocol_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDBSimpleProtocol(t)
	repo := persistence.NewTicketRepository(sqlDB)
	ctx := context.Background()

	testsupport.TruncateAll(t, sqlDB, kbTables...)
	ws := createWorkspace(t, sqlDB, "tk-simple")
	space := createSpace(t, sqlDB, ws, "eng")
	statusID, typeID := seedTicketMasterViaRepo(ctx, t, repo, ws, space)

	start, due := "2026-09-01", "2026-09-30"
	doc := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"simple protocol 経由"}]}]}`
	created, err := repo.CreateTicket(ctx, repository.TicketCreateInput{
		WorkspaceID: ws, SpaceID: space, TypeID: typeID, StatusID: statusID,
		Title: "x", Doc: []byte(doc), Position: "a0", Priority: domain.TicketPriorityDefault, CreatedByUserID: 1,
		StartDate: &start, DueDate: &due,
	})
	require.NoError(t, err)
	require.NotNil(t, created.StartDate)
	require.NotNil(t, created.DueDate)
	assert.Equal(t, start, *created.StartDate, "simple protocol でも日付がずれない")
	assert.Equal(t, due, *created.DueDate)

	got, err := repo.FindTicket(ctx, ws, created.ID)
	require.NoError(t, err)
	require.NotNil(t, got.StartDate)
	assert.Equal(t, start, *got.StartDate)
	assert.JSONEq(t, doc, string(got.Doc))
}
