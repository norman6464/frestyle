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

// savedFilterFixture は保存した絞り込みの結合テストの下ごしらえ（ワークスペース 1 つ・
// プロジェクト 1 つ・状態と種別・ラベル 1 つ・利用者 2 人とその主体）。
type savedFilterFixture struct {
	ws, project, statusID, typeID, labelID string
	alice, bob                             uint64
	aliceP, bobP                           string
}

func setupSavedFilter(t *testing.T, db *sql.DB, tag string) savedFilterFixture {
	t.Helper()
	testsupport.TruncateAll(t, db, kbTables...)
	ctx := context.Background()
	perm := persistence.NewKnowledgeBasePermissionRepository(db)
	labels := persistence.NewLabelRepository(db)

	f := savedFilterFixture{}
	f.ws = createWorkspace(t, db, "sf-"+tag)
	f.project = createProject(t, db, f.ws, "eng")
	f.statusID, f.typeID = seedTicketMaster(t, db, f.ws, f.project)
	f.alice = createUser(t, db, "sf-alice")
	f.bob = createUser(t, db, "sf-bob")
	aliceP, err := perm.EnsureUserPrincipal(ctx, f.ws, f.alice)
	require.NoError(t, err)
	bobP, err := perm.EnsureUserPrincipal(ctx, f.ws, f.bob)
	require.NoError(t, err)
	f.aliceP, f.bobP = aliceP.ID, bobP.ID
	label := &domain.Label{WorkspaceID: f.ws, Name: "不具合", Color: "#ff0000"}
	require.NoError(t, labels.CreateLabel(ctx, label))
	f.labelID = label.ID
	return f
}

func (f savedFilterFixture) filter(userID uint64, name string) domain.TicketSavedFilter {
	return domain.TicketSavedFilter{WorkspaceID: f.ws, ProjectID: f.project, UserID: userID, Name: name}
}

func countSavedFilterRows(t *testing.T, db *sql.DB, userID uint64) int {
	t.Helper()
	var n int
	require.NoError(t, db.QueryRow(`SELECT count(*) FROM ticket_saved_filters WHERE user_id = $1`, userID).Scan(&n))
	return n
}

// TestTicketSavedFilterRepository_Integration は ticket_saved_filters を実 PostgreSQL で固定する:
// 往復・同名の一意・参照先の誤りの翻訳・CHECK・本人以外に効かないこと・参照先の削除での CASCADE。
func TestTicketSavedFilterRepository_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	repo := persistence.NewTicketSavedFilterRepository(sqlDB)
	ctx := context.Background()
	str := func(s string) *string { return &s }

	t.Run("作成_一覧_更新_削除の往復", func(t *testing.T) {
		f := setupSavedFilter(t, sqlDB, "roundtrip")
		sf := f.filter(f.alice, "未完了のログイン")
		sf.StatusID, sf.Q = str(f.statusID), str("ログイン")
		require.NoError(t, repo.InsertTicketSavedFilter(ctx, &sf))
		require.NotEmpty(t, sf.ID, "採番した ID を書き戻す")
		assert.False(t, sf.CreatedAt.IsZero())
		assert.Equal(t, f.alice, sf.UserID)

		list, err := repo.ListTicketSavedFilters(ctx, f.ws, f.project, f.alice)
		require.NoError(t, err)
		require.Len(t, list, 1)
		assert.Equal(t, sf, list[0], "書き戻した値と一覧の値が一致する")

		sf.Name, sf.StatusID, sf.Q, sf.LabelID, sf.Unassigned = "未割り当ての不具合", nil, nil, str(f.labelID), true
		require.NoError(t, repo.UpdateTicketSavedFilter(ctx, &sf))
		list, err = repo.ListTicketSavedFilters(ctx, f.ws, f.project, f.alice)
		require.NoError(t, err)
		require.Len(t, list, 1)
		assert.Equal(t, "未割り当ての不具合", list[0].Name)
		assert.Nil(t, list[0].StatusID, "外した条件は NULL になる")
		assert.Nil(t, list[0].Q)
		require.NotNil(t, list[0].LabelID)
		assert.Equal(t, f.labelID, *list[0].LabelID)
		assert.True(t, list[0].Unassigned)
		assert.False(t, list[0].UpdatedAt.Before(list[0].CreatedAt))

		n, err := repo.CountTicketSavedFilters(ctx, f.ws, f.project, f.alice)
		require.NoError(t, err)
		assert.Equal(t, int64(1), n)

		require.NoError(t, repo.DeleteTicketSavedFilter(ctx, f.ws, f.project, f.alice, sf.ID))
		assert.Equal(t, 0, countSavedFilterRows(t, sqlDB, f.alice))
		assert.ErrorIs(t, repo.DeleteTicketSavedFilter(ctx, f.ws, f.project, f.alice, sf.ID), repository.ErrTicketSavedFilterNotFound)
	})

	t.Run("同名は大文字小文字違いでも同じ本人_同じプロジェクトでは弾く_別人_別プロジェクトなら作れる", func(t *testing.T) {
		f := setupSavedFilter(t, sqlDB, "name")
		first := f.filter(f.alice, "Bugs")
		first.Overdue = true
		require.NoError(t, repo.InsertTicketSavedFilter(ctx, &first))

		dup := f.filter(f.alice, "bugs")
		dup.Unassigned = true
		assert.ErrorIs(t, repo.InsertTicketSavedFilter(ctx, &dup), repository.ErrTicketSavedFilterNameTaken)

		bobs := f.filter(f.bob, "bugs")
		bobs.Overdue = true
		require.NoError(t, repo.InsertTicketSavedFilter(ctx, &bobs), "別人なら同名でよい")

		otherProject := createProject(t, sqlDB, f.ws, "ops")
		elsewhere := domain.TicketSavedFilter{WorkspaceID: f.ws, ProjectID: otherProject, UserID: f.alice, Name: "bugs", Overdue: true}
		require.NoError(t, repo.InsertTicketSavedFilter(ctx, &elsewhere), "別プロジェクトなら同名でよい")

		second := f.filter(f.alice, "Mine")
		second.AssignedToMe = true
		require.NoError(t, repo.InsertTicketSavedFilter(ctx, &second))
		second.Name = "BUGS"
		assert.ErrorIs(t, repo.UpdateTicketSavedFilter(ctx, &second), repository.ErrTicketSavedFilterNameTaken, "改名でも同名は弾く")
	})

	t.Run("参照先の誤りは複合FKの制約名から翻訳する", func(t *testing.T) {
		f := setupSavedFilter(t, sqlDB, "refs")
		otherProject := createProject(t, sqlDB, f.ws, "ops")
		otherStatus, otherType := seedTicketMaster(t, sqlDB, f.ws, otherProject)
		otherWS := createWorkspace(t, sqlDB, "sf-refs-other")
		otherLabel := &domain.Label{WorkspaceID: otherWS, Name: "よそ", Color: "#00ff00"}
		require.NoError(t, persistence.NewLabelRepository(sqlDB).CreateLabel(ctx, otherLabel))
		perm := persistence.NewKnowledgeBasePermissionRepository(sqlDB)
		group, err := perm.CreateGroupPrincipal(ctx, f.ws, "devs")
		require.NoError(t, err)
		outsider := createUser(t, sqlDB, "sf-outsider")
		outsiderP, err := perm.EnsureUserPrincipal(ctx, otherWS, outsider)
		require.NoError(t, err)

		cases := []struct {
			name string
			mut  func(sf *domain.TicketSavedFilter)
			want error
		}{
			{"別プロジェクトの状態", func(sf *domain.TicketSavedFilter) { sf.StatusID = str(otherStatus) }, repository.ErrTicketStatusNotFound},
			{"別プロジェクトの種別", func(sf *domain.TicketSavedFilter) { sf.TypeID = str(otherType) }, repository.ErrTicketTypeNotFound},
			{"別ワークスペースのラベル", func(sf *domain.TicketSavedFilter) { sf.LabelID = str(otherLabel.ID) }, repository.ErrLabelNotFound},
			{"userでない主体（グループ）", func(sf *domain.TicketSavedFilter) { sf.AssigneePrincipalID = str(group.ID) }, repository.ErrTicketAssigneeNotFound},
			{"別ワークスペースの主体", func(sf *domain.TicketSavedFilter) { sf.AssigneePrincipalID = str(outsiderP.ID) }, repository.ErrTicketAssigneeNotFound},
			{"別ワークスペースのプロジェクト", func(sf *domain.TicketSavedFilter) { sf.WorkspaceID = otherWS }, repository.ErrProjectNotFound},
			{"形の壊れた状態ID", func(sf *domain.TicketSavedFilter) { sf.StatusID = str("nope") }, repository.ErrTicketStatusNotFound},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				sf := f.filter(f.alice, tc.name)
				// 条件を 1 つ付けておく。無いと参照先の FK より先に ck_..._has_condition が効き、
				// 翻訳したい FK 違反まで届かない。
				sf.Overdue = true
				tc.mut(&sf)
				assert.ErrorIs(t, repo.InsertTicketSavedFilter(ctx, &sf), tc.want)
			})
		}
		assert.Equal(t, 0, countSavedFilterRows(t, sqlDB, f.alice))

		ok := f.filter(f.alice, "正しい参照")
		ok.StatusID, ok.TypeID, ok.LabelID, ok.AssigneePrincipalID = str(f.statusID), str(f.typeID), str(f.labelID), str(f.bobP)
		require.NoError(t, repo.InsertTicketSavedFilter(ctx, &ok), "同じプロジェクトの状態・種別、同じワークスペースのラベル・user の主体は通る")
	})

	t.Run("DBのCHECKが担当条件の重なり_条件なし_空の名前_空の検索語を弾く", func(t *testing.T) {
		f := setupSavedFilter(t, sqlDB, "check")
		insert := func(name string, columns string, values string) error {
			_, err := sqlDB.Exec(
				`INSERT INTO ticket_saved_filters (id, workspace_id, project_id, user_id, name`+columns+`)
				 VALUES (gen_random_uuid(), $1, $2, $3, $4`+values+`)`,
				f.ws, f.project, f.alice, name,
			)
			return err
		}
		requirePgError(t, insert("担当が2つ", ", unassigned, assigned_to_me", ", true, true"),
			sqlStateCheckViolation, "ck_ticket_saved_filters_assignee_mode")
		requirePgError(t, insert("主体と未割り当て", ", assignee_principal_id, unassigned", ", '"+f.aliceP+"', true"),
			sqlStateCheckViolation, "ck_ticket_saved_filters_assignee_mode")
		requirePgError(t, insert("条件なし", "", ""),
			sqlStateCheckViolation, "ck_ticket_saved_filters_has_condition")
		requirePgError(t, insert("  前後に空白  ", ", overdue", ", true"),
			sqlStateCheckViolation, "ck_ticket_saved_filters_name_trimmed")
		requirePgError(t, insert("空の検索語", ", q", ", '   '"),
			sqlStateCheckViolation, "ck_ticket_saved_filters_q_not_blank")
		require.NoError(t, insert("通る", ", overdue", ", true"))
	})

	t.Run("更新と削除は本人の行にしか効かない", func(t *testing.T) {
		f := setupSavedFilter(t, sqlDB, "owner")
		mine := f.filter(f.alice, "自分の")
		mine.Overdue = true
		require.NoError(t, repo.InsertTicketSavedFilter(ctx, &mine))

		hijack := mine
		hijack.UserID, hijack.Name = f.bob, "乗っ取り"
		assert.ErrorIs(t, repo.UpdateTicketSavedFilter(ctx, &hijack), repository.ErrTicketSavedFilterNotFound)
		assert.ErrorIs(t, repo.DeleteTicketSavedFilter(ctx, f.ws, f.project, f.bob, mine.ID), repository.ErrTicketSavedFilterNotFound)

		otherProject := createProject(t, sqlDB, f.ws, "ops")
		assert.ErrorIs(t, repo.DeleteTicketSavedFilter(ctx, f.ws, otherProject, f.alice, mine.ID), repository.ErrTicketSavedFilterNotFound, "URL のプロジェクトが違えば無い扱い")

		list, err := repo.ListTicketSavedFilters(ctx, f.ws, f.project, f.alice)
		require.NoError(t, err)
		require.Len(t, list, 1)
		assert.Equal(t, "自分の", list[0].Name)
		bobs, err := repo.ListTicketSavedFilters(ctx, f.ws, f.project, f.bob)
		require.NoError(t, err)
		assert.Empty(t, bobs)
	})

	t.Run("一覧は本人_プロジェクト単位で作った順", func(t *testing.T) {
		f := setupSavedFilter(t, sqlDB, "list")
		for _, name := range []string{"い", "ろ", "は"} {
			sf := f.filter(f.alice, name)
			sf.Overdue = true
			require.NoError(t, repo.InsertTicketSavedFilter(ctx, &sf))
		}
		bobs := f.filter(f.bob, "bob の")
		bobs.Overdue = true
		require.NoError(t, repo.InsertTicketSavedFilter(ctx, &bobs))
		otherProject := createProject(t, sqlDB, f.ws, "ops")
		elsewhere := domain.TicketSavedFilter{WorkspaceID: f.ws, ProjectID: otherProject, UserID: f.alice, Name: "よそ", Overdue: true}
		require.NoError(t, repo.InsertTicketSavedFilter(ctx, &elsewhere))

		list, err := repo.ListTicketSavedFilters(ctx, f.ws, f.project, f.alice)
		require.NoError(t, err)
		names := make([]string, 0, len(list))
		for _, sf := range list {
			names = append(names, sf.Name)
		}
		assert.Equal(t, []string{"い", "ろ", "は"}, names)
	})

	t.Run("参照先が消えると絞り込みごと消える", func(t *testing.T) {
		f := setupSavedFilter(t, sqlDB, "cascade")
		byLabel := f.filter(f.alice, "ラベル")
		byLabel.LabelID, byLabel.Overdue = str(f.labelID), true
		require.NoError(t, repo.InsertTicketSavedFilter(ctx, &byLabel))
		byStatus := f.filter(f.alice, "状態")
		byStatus.StatusID = str(f.statusID)
		require.NoError(t, repo.InsertTicketSavedFilter(ctx, &byStatus))
		byAssignee := f.filter(f.alice, "bob の担当")
		byAssignee.AssigneePrincipalID = str(f.bobP)
		require.NoError(t, repo.InsertTicketSavedFilter(ctx, &byAssignee))
		plain := f.filter(f.alice, "期限切れ")
		plain.Overdue = true
		require.NoError(t, repo.InsertTicketSavedFilter(ctx, &plain))
		require.Equal(t, 4, countSavedFilterRows(t, sqlDB, f.alice))

		_, err := sqlDB.Exec(`DELETE FROM labels WHERE id = $1`, f.labelID)
		require.NoError(t, err)
		assert.Equal(t, 3, countSavedFilterRows(t, sqlDB, f.alice), "ラベルが消えると、他の条件があっても絞り込みごと消える")

		_, err = sqlDB.Exec(`DELETE FROM ticket_statuses WHERE id = $1`, f.statusID)
		require.NoError(t, err)
		assert.Equal(t, 2, countSavedFilterRows(t, sqlDB, f.alice))

		_, err = sqlDB.Exec(`DELETE FROM principals WHERE id = $1`, f.bobP)
		require.NoError(t, err)
		assert.Equal(t, 1, countSavedFilterRows(t, sqlDB, f.alice))

		_, err = sqlDB.Exec(`DELETE FROM users WHERE id = $1`, f.alice)
		require.NoError(t, err)
		assert.Equal(t, 0, countSavedFilterRows(t, sqlDB, f.alice), "退会で本人の分が消える")
	})
}

// TestTicketRepository_CountTickets_Integration は CountTickets が ListTickets と同じ条件で
// 数えることを固定する（2 つのクエリは WHERE を写し合っているので、片方だけ直すとずれる）。
func TestTicketRepository_CountTickets_Integration(t *testing.T) {
	sqlDB := testsupport.OpenTestDB(t)
	testsupport.TruncateAll(t, sqlDB, kbTables...)
	repo := persistence.NewTicketRepository(sqlDB)
	perm := persistence.NewKnowledgeBasePermissionRepository(sqlDB)
	ctx := context.Background()

	ws := createWorkspace(t, sqlDB, "count")
	project := createProject(t, sqlDB, ws, "eng")
	statusTodo, typeID := seedTicketMaster(t, sqlDB, ws, project)
	statusDone := newID()
	require.NoError(t, insertTicketStatus(sqlDB, statusDone, ws, project, "Done", "done", "#5b6b7a", "a1", false))
	alice := createUser(t, sqlDB, "count-alice")
	aliceP, err := perm.EnsureUserPrincipal(ctx, ws, alice)
	require.NoError(t, err)
	label := &domain.Label{WorkspaceID: ws, Name: "不具合", Color: "#ff0000"}
	require.NoError(t, persistence.NewLabelRepository(sqlDB).CreateLabel(ctx, label))

	// CURRENT_DATE（DB のタイムゾーン）と Go の日付が日付境界でずれても結果が変わらないよう 2 日離す。
	past := time.Now().AddDate(0, 0, -2).Format("2006-01-02")
	future := time.Now().AddDate(0, 0, 2).Format("2006-01-02")

	// t1: To Do・alice の担当・期限切れ・ラベル付き・題名「ログイン画面が崩れる」
	// t2: To Do・未割り当て・期限は先・題名「検索が遅い」
	// t3: Done・未割り当て・期限は過去（done なので期限切れではない）
	// t4: To Do・アーカイブ済み
	t1, t2, t3, t4 := newID(), newID(), newID(), newID()
	require.NoError(t, insertTicketRaw(sqlDB, t1, ws, project, 1, typeID, statusTodo, nil, 2, nil, &past))
	require.NoError(t, insertTicketRaw(sqlDB, t2, ws, project, 2, typeID, statusTodo, nil, 2, nil, &future))
	require.NoError(t, insertTicketRaw(sqlDB, t3, ws, project, 3, typeID, statusDone, nil, 2, nil, &past))
	require.NoError(t, insertTicketRaw(sqlDB, t4, ws, project, 4, typeID, statusTodo, nil, 2, nil, nil))
	_, err = sqlDB.Exec(`UPDATE tickets SET title = 'ログイン画面が崩れる', plain_text = 'ログイン画面が崩れる' WHERE id = $1`, t1)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`UPDATE tickets SET title = '検索が遅い', plain_text = '検索が遅い' WHERE id = $1`, t2)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`UPDATE tickets SET archived_at = now() WHERE id = $1`, t4)
	require.NoError(t, err)
	_, err = sqlDB.Exec(
		`INSERT INTO ticket_assignments (workspace_id, ticket_id, assignee_principal_id, assigned_by_user_id) VALUES ($1, $2, $3, $4)`,
		ws, t1, aliceP.ID, alice,
	)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO ticket_labels (workspace_id, ticket_id, label_id) VALUES ($1, $2, $3)`, ws, t1, label.ID)
	require.NoError(t, err)

	str := func(s string) *string { return &s }
	base := repository.ListTicketsInput{WorkspaceID: ws, ProjectID: project}
	with := func(mut func(in *repository.ListTicketsInput)) repository.ListTicketsInput {
		in := base
		mut(&in)
		return in
	}
	cases := []struct {
		name string
		in   repository.ListTicketsInput
		want int64
	}{
		{"条件なし（現役のみ）", base, 3},
		{"アーカイブ済みの表示", with(func(in *repository.ListTicketsInput) { in.IncludeArchived = true }), 1},
		{"状態", with(func(in *repository.ListTicketsInput) { in.StatusID = str(statusTodo) }), 2},
		{"未割り当て", with(func(in *repository.ListTicketsInput) { in.Unassigned = true }), 2},
		{"自分の担当", with(func(in *repository.ListTicketsInput) { in.AssignedToMePrincipalID = str(aliceP.ID) }), 1},
		{"この主体の担当", with(func(in *repository.ListTicketsInput) { in.AssigneePrincipalID = str(aliceP.ID) }), 1},
		{"期限切れ（done は除く）", with(func(in *repository.ListTicketsInput) { in.Overdue = true }), 1},
		{"ラベル", with(func(in *repository.ListTicketsInput) { in.LabelID = str(label.ID) }), 1},
		{"検索語", with(func(in *repository.ListTicketsInput) { in.Q = str("ログイン") }), 1},
		{"状態 かつ 未割り当て", with(func(in *repository.ListTicketsInput) { in.StatusID, in.Unassigned = str(statusTodo), true }), 1},
		{"形の壊れた ID は 0 件", with(func(in *repository.ListTicketsInput) { in.StatusID = str("nope") }), 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			list, err := repo.ListTickets(ctx, tc.in)
			require.NoError(t, err)
			n, err := repo.CountTickets(ctx, tc.in)
			require.NoError(t, err)
			assert.Equal(t, tc.want, n)
			assert.Equal(t, int64(len(list.Items)), n, "CountTickets は ListTickets の件数と一致する")
			assert.Equal(t, int64(list.Total), n, "ListTickets の total も CountTickets と一致する")
		})
	}
}
