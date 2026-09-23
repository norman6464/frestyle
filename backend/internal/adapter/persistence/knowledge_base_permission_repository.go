package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence/sqlcgen"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// knowledgeBasePermissionRepository は [repository.KnowledgeBasePermissionRepository] の実装。
// ナレッジは GORM を通さない方針のため、クエリはすべて sqlc 生成コード + 素の *sql.DB で書く。
//
// ユーザー ID の境界（uint64 → bigint）に注意: domain の uint64 を int64(userID) と素で
// 書くと、math.MaxInt64 を超える値は最上位ビットが符号ビットに化けて負数へ巻き戻り、
// 元の入力とは無関係な行を指してしまう。変換は必ず toInt64ID（ids.go）を通し、範囲外の
// userID（実在しえない）は書き込みならエラー、読み取り（権限判定・一覧）なら
// **必ず拒否側（deny）に倒す**こと — 許可側の値を返すと権限昇格になる。
type knowledgeBasePermissionRepository struct {
	baseRepository
}

// NewKnowledgeBasePermissionRepository はナレッジの権限 repository を組み立てる。
func NewKnowledgeBasePermissionRepository(db *sql.DB) repository.KnowledgeBasePermissionRepository {
	return &knowledgeBasePermissionRepository{baseRepository{db: db}}
}

// queries は ctx に乗っているトランザクション（あれば）に束縛した sqlc の Queries を作る。
func (r *knowledgeBasePermissionRepository) queries(ctx context.Context) *sqlcgen.Queries {
	return sqlcgen.New(r.dbtx(ctx))
}

// runInTx は 1 つのトランザクションを開き、その中でだけ有効な Queries を fn に渡す。
// ctx に既に外側の DoInTx が開いたトランザクションがあれば、新規に開始せずそれへ相乗りする
// （二重に BeginTx するとデッドロックの原因になる。commit/rollback は外側だけが持つ）。
func (r *knowledgeBasePermissionRepository) runInTx(ctx context.Context, fn func(qtx *sqlcgen.Queries) error) error {
	if tx, ok := getTx(ctx); ok {
		return fn(sqlcgen.New(tx))
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }() // Commit 済みなら no-op
	if err := fn(sqlcgen.New(tx)); err != nil {
		return err
	}
	return tx.Commit()
}

func toDomainPrincipal(row sqlcgen.Principal) domain.Principal {
	p := domain.Principal{
		ID:          row.ID.String(),
		WorkspaceID: row.WorkspaceID.String(),
		Kind:        domain.PrincipalKind(row.Kind),
		Name:        row.Name,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
	if row.UserID.Valid {
		id := uint64(row.UserID.Int64)
		p.UserID = &id
	}
	if row.SpaceID.Valid {
		id := row.SpaceID.UUID.String()
		p.SpaceID = &id
	}
	if row.PageID.Valid {
		id := row.PageID.UUID.String()
		p.PageID = &id
	}
	return p
}

func toDomainWorkspaceGrant(row sqlcgen.WorkspaceGrant) domain.WorkspaceGrant {
	return domain.WorkspaceGrant{
		WorkspaceID: row.WorkspaceID.String(),
		PrincipalID: row.PrincipalID.String(),
		Role:        domain.GrantRole(row.Role),
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

func toDomainSpaceGrant(row sqlcgen.SpaceGrant) domain.SpaceGrant {
	return domain.SpaceGrant{
		WorkspaceID: row.WorkspaceID.String(),
		SpaceID:     row.SpaceID.String(),
		PrincipalID: row.PrincipalID.String(),
		Role:        domain.GrantRole(row.Role),
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

func toDomainPageGrant(row sqlcgen.PageGrant) domain.PageGrant {
	return domain.PageGrant{
		WorkspaceID: row.WorkspaceID.String(),
		PageID:      row.PageID.String(),
		PrincipalID: row.PrincipalID.String(),
		Role:        domain.GrantRole(row.Role),
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

func toDomainMembershipEvent(row sqlcgen.MembershipEvent) domain.MembershipEvent {
	e := domain.MembershipEvent{
		ID:           row.ID.String(),
		TargetUserID: uint64(row.TargetUserID),
		ActorUserID:  uint64(row.ActorUserID),
		Action:       domain.MembershipEventAction(row.Action),
		CreatedAt:    row.CreatedAt,
	}
	if row.OldLabel.Valid {
		e.OldLabel = &row.OldLabel.String
	}
	if row.NewLabel.Valid {
		e.NewLabel = &row.NewLabel.String
	}
	return e
}

// recordMembershipEvent は所属・権限の変更 1 件を membership_events へ追記する
// （段 6・監査）。呼び出し側が開いたトランザクションの qtx をそのまま使うこと —
// 対象の書き込み（workspace_members / workspace_grants / principals）と同じ
// トランザクションで呼ばないと、履歴と実際の状態がずれる。
func recordMembershipEvent(
	ctx context.Context, qtx *sqlcgen.Queries,
	workspaceID uuid.UUID, targetUserID, actorUserID int64,
	action domain.MembershipEventAction, oldLabel, newLabel *string,
) error {
	id, err := kbNewID()
	if err != nil {
		return err
	}
	return qtx.InsertMembershipEvent(ctx, sqlcgen.InsertMembershipEventParams{
		ID:           id,
		WorkspaceID:  workspaceID,
		TargetUserID: targetUserID,
		ActorUserID:  actorUserID,
		Action:       string(action),
		OldLabel:     nullString(oldLabel),
		NewLabel:     nullString(newLabel),
	})
}

func (r *knowledgeBasePermissionRepository) EnsureUserPrincipal(ctx context.Context, workspaceID string, userID uint64) (*domain.Principal, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return nil, repository.ErrWorkspaceNotFound
	}
	// bigint に収まらない userID は users のどの行の id にもなり得ない ＝ そんなユーザーは居ない。
	// これは下の FK 違反（実在しないユーザー ID を渡された場合）とまったく同じ状況なので、
	// 同じ ErrUserNotFound を返して呼び出し側の分岐を増やさない。
	// nil を返してはいけない — 主体を 1 行も作れていないのに「作れた」と誤認される。
	uid, uok := toInt64ID(userID)
	if !uok {
		return nil, repository.ErrUserNotFound
	}
	row, err := ensureUserPrincipalInTx(ctx, r.queries(ctx), wsID, uid)
	if err != nil {
		return nil, err
	}
	p := toDomainPrincipal(row)
	return &p, nil
}

// ensureUserPrincipalInTx は EnsureUserPrincipal の本体（qtx を直接受け取る形）。
// AcceptWorkspaceInvitation のように、複数の書き込みを 1 つのトランザクションへ
// まとめたい呼び出し元向け（runInTx の mutate 内では r.queries(ctx) ではなく必ず
// 引数の qtx を使う — ctx には runInTx が開いた tx が乗っていないため、r.queries(ctx) を
// 使うと別の接続・別のトランザクションを掴んでしまう）。
func ensureUserPrincipalInTx(
	ctx context.Context, qtx *sqlcgen.Queries, workspaceID uuid.UUID, userID int64,
) (sqlcgen.Principal, error) {
	// 先に引いてから作る。ユーザーの主体は (workspace_id, user_id) の部分 UNIQUE で 1 つに限られ、
	// 競合したら INSERT が一意制約で落ちるので、その場合はもう一度引き直して既存を返す。
	row, err := qtx.GetUserPrincipal(ctx, sqlcgen.GetUserPrincipalParams{
		WorkspaceID: workspaceID,
		UserID:      sql.NullInt64{Int64: userID, Valid: true},
	})
	if err == nil {
		return row, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return sqlcgen.Principal{}, err
	}
	id, err := kbNewID()
	if err != nil {
		return sqlcgen.Principal{}, err
	}
	created, err := qtx.InsertPrincipal(ctx, sqlcgen.InsertPrincipalParams{
		ID:          id,
		WorkspaceID: workspaceID,
		Kind:        string(domain.PrincipalKindUser),
		UserID:      sql.NullInt64{Int64: userID, Valid: true},
	})
	if err != nil {
		// 実在しないユーザー ID を渡された場合は users への FK で落ちる。入力の誤りなので
		// 制約違反のまま上へ流さず、「そのユーザーは居ない」として返す（500 にしない）。
		if isForeignKeyViolation(err) {
			return sqlcgen.Principal{}, repository.ErrUserNotFound
		}
		// 同時に同じユーザーを追加したときは一意制約で落ちる。既存を返して冪等にする。
		existing, getErr := qtx.GetUserPrincipal(ctx, sqlcgen.GetUserPrincipalParams{
			WorkspaceID: workspaceID,
			UserID:      sql.NullInt64{Int64: userID, Valid: true},
		})
		if getErr != nil {
			return sqlcgen.Principal{}, err
		}
		return existing, nil
	}
	return created, nil
}

func (r *knowledgeBasePermissionRepository) EnsureSpaceEveryonePrincipal(ctx context.Context, workspaceID, spaceID string) (*domain.Principal, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return nil, repository.ErrSpaceNotFound
	}
	row, err := r.queries(ctx).GetSpaceEveryonePrincipal(ctx, sqlcgen.GetSpaceEveryonePrincipalParams{
		WorkspaceID: wsID,
		SpaceID:     uuid.NullUUID{UUID: spID, Valid: true},
	})
	if err == nil {
		p := toDomainPrincipal(row)
		return &p, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	id, err := kbNewID()
	if err != nil {
		return nil, err
	}
	created, err := r.queries(ctx).InsertPrincipal(ctx, sqlcgen.InsertPrincipalParams{
		ID:          id,
		WorkspaceID: wsID,
		Kind:        string(domain.PrincipalKindSpaceAll),
		SpaceID:     uuid.NullUUID{UUID: spID, Valid: true},
	})
	if err != nil {
		existing, getErr := r.queries(ctx).GetSpaceEveryonePrincipal(ctx, sqlcgen.GetSpaceEveryonePrincipalParams{
			WorkspaceID: wsID,
			SpaceID:     uuid.NullUUID{UUID: spID, Valid: true},
		})
		if getErr != nil {
			return nil, err
		}
		p := toDomainPrincipal(existing)
		return &p, nil
	}
	p := toDomainPrincipal(created)
	return &p, nil
}

func (r *knowledgeBasePermissionRepository) CreateGroupPrincipal(ctx context.Context, workspaceID, name string) (*domain.Principal, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return nil, repository.ErrWorkspaceNotFound
	}
	id, err := kbNewID()
	if err != nil {
		return nil, err
	}
	row, err := r.queries(ctx).InsertPrincipal(ctx, sqlcgen.InsertPrincipalParams{
		ID:          id,
		WorkspaceID: wsID,
		Kind:        string(domain.PrincipalKindGroup),
		Name:        name,
	})
	if err != nil {
		// 名前はワークスペース内で一意（uq_principals_group_name）。検査してから INSERT する
		// までの間に別の要求が同じ名前を取り得るので、一意制約を唯一の判定にする
		// （ワークスペース作成の slug と同じ考え方）。
		if isUniqueViolation(err) {
			return nil, repository.ErrPrincipalGroupNameTaken
		}
		return nil, err
	}
	p := toDomainPrincipal(row)
	return &p, nil
}

func (r *knowledgeBasePermissionRepository) FindPrincipal(ctx context.Context, workspaceID, principalID string) (*domain.Principal, error) {
	wsID, ok := kbParseID(workspaceID)
	prID, ok2 := kbParseID(principalID)
	if !ok || !ok2 {
		return nil, repository.ErrPrincipalNotFound
	}
	row, err := r.queries(ctx).GetPrincipal(ctx, sqlcgen.GetPrincipalParams{WorkspaceID: wsID, ID: prID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrPrincipalNotFound
	}
	if err != nil {
		return nil, err
	}
	p := toDomainPrincipal(row)
	return &p, nil
}

func (r *knowledgeBasePermissionRepository) FindUserPrincipal(ctx context.Context, workspaceID string, userID uint64) (*domain.Principal, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return nil, repository.ErrPrincipalNotFound
	}
	// bigint に収まらない userID はどの principals の行にも一致しない。クエリを投げれば
	// 0 行 ＝ sql.ErrNoRows になる入力なので、その分岐（下の ErrPrincipalNotFound）と
	// 同じ値を返す。呼び出し側から見た意味は「非メンバー」で、拒否側に倒れている。
	uid, uok := toInt64ID(userID)
	if !uok {
		return nil, repository.ErrPrincipalNotFound
	}
	row, err := r.queries(ctx).GetUserPrincipal(ctx, sqlcgen.GetUserPrincipalParams{
		WorkspaceID: wsID,
		UserID:      sql.NullInt64{Int64: uid, Valid: true},
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrPrincipalNotFound
	}
	if err != nil {
		return nil, err
	}
	p := toDomainPrincipal(row)
	return &p, nil
}

// DeletePrincipal は主体を 1 件消す。grant も FK の CASCADE で消えるため、admin を
// 減らし得る操作として grant の取り消しと同じ検査を同じトランザクションで通す
// （withLastAdminGuard 参照）。
func (r *knowledgeBasePermissionRepository) DeletePrincipal(ctx context.Context, workspaceID, principalID string) error {
	wsID, ok := kbParseID(workspaceID)
	prID, ok2 := kbParseID(principalID)
	if !ok || !ok2 {
		return repository.ErrPrincipalNotFound
	}
	return r.withLastAdminGuard(ctx, wsID, prID, func(qtx *sqlcgen.Queries) error {
		n, err := qtx.DeletePrincipal(ctx, sqlcgen.DeletePrincipalParams{WorkspaceID: wsID, ID: prID})
		if err != nil {
			return err
		}
		if n == 0 {
			return repository.ErrPrincipalNotFound
		}
		return nil
	})
}

func (r *knowledgeBasePermissionRepository) IsWorkspaceMember(ctx context.Context, workspaceID string, userID uint64) (bool, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return false, nil
	}
	// bigint に収まらない userID は principals のどの行にも一致しない。SQL は EXISTS を
	// 返すので 0 行 ＝ false。同じ false を返す（上の ID 不正の分岐と同じ値）。
	// true 側へ倒すと、存在しないユーザー ID を名乗るだけでワークスペースの中身が
	// 見える口が開く（所属は principals の行が唯一の表現なので、ここが所属判定の本体）。
	uid, uok := toInt64ID(userID)
	if !uok {
		return false, nil
	}
	return r.queries(ctx).IsWorkspaceMember(ctx, sqlcgen.IsWorkspaceMemberParams{
		WorkspaceID: wsID,
		UserID:      sql.NullInt64{Int64: uid, Valid: true},
	})
}

func (r *knowledgeBasePermissionRepository) IsWorkspaceMemberBulk(ctx context.Context, workspaceID string, userIDs []uint64) (map[uint64]bool, error) {
	if len(userIDs) == 0 {
		return map[uint64]bool{}, nil
	}
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return map[uint64]bool{}, nil
	}
	// bigint に収まらない id は他の行とも一致し得ないので、問い合わせに含めず false のまま返す
	// （IsWorkspaceMember の同じ分岐と同じ理由）。
	ids := make([]int64, 0, len(userIDs))
	for _, id := range userIDs {
		if iid, iok := toInt64ID(id); iok {
			ids = append(ids, iid)
		}
	}
	out := make(map[uint64]bool, len(userIDs))
	if len(ids) == 0 {
		return out, nil
	}
	idsJSON, err := json.Marshal(ids)
	if err != nil {
		return nil, err
	}
	rows, err := r.queries(ctx).ListWorkspaceMemberUserIDsAmong(ctx, sqlcgen.ListWorkspaceMemberUserIDsAmongParams{
		WorkspaceID: wsID,
		UserIds:     idsJSON,
	})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		// SQL 側で kind = 'user' に絞っているので、principals.user_id が NULL の行は
		// そもそも返らない（列 CHECK も同じことを強制する）。row.Int64 は非負の
		// bigint（principals.user_id は users.id への FK）なので uint64 への変換は常に安全。
		out[uint64(row.Int64)] = true
	}
	return out, nil
}

func (r *knowledgeBasePermissionRepository) AddGroupMember(ctx context.Context, workspaceID, groupPrincipalID, memberPrincipalID string) error {
	wsID, ok := kbParseID(workspaceID)
	gID, ok2 := kbParseID(groupPrincipalID)
	mID, ok3 := kbParseID(memberPrincipalID)
	if !ok || !ok2 || !ok3 {
		return repository.ErrPrincipalNotFound
	}
	return r.queries(ctx).InsertPrincipalMember(ctx, sqlcgen.InsertPrincipalMemberParams{
		WorkspaceID:       wsID,
		GroupPrincipalID:  gID,
		MemberPrincipalID: mID,
	})
}

// RemoveGroupMember はグループから 1 人外す。0 行削除も成功のままにする（not-found に
// しない）— 求められているのは「載っていない状態」で、元から載っていなければ
// その事後条件を既に満たしているので冪等に成功でよい。
func (r *knowledgeBasePermissionRepository) RemoveGroupMember(ctx context.Context, workspaceID, groupPrincipalID, memberPrincipalID string) error {
	wsID, ok := kbParseID(workspaceID)
	gID, ok2 := kbParseID(groupPrincipalID)
	mID, ok3 := kbParseID(memberPrincipalID)
	if !ok || !ok2 || !ok3 {
		return nil // 存在し得ない ID = 既に外れている
	}
	_, err := r.queries(ctx).DeletePrincipalMember(ctx, sqlcgen.DeletePrincipalMemberParams{
		WorkspaceID:       wsID,
		GroupPrincipalID:  gID,
		MemberPrincipalID: mID,
	})
	return err
}

func (r *knowledgeBasePermissionRepository) GrantWorkspaceRoleIfAbsent(ctx context.Context, workspaceID, principalID string, role domain.GrantRole) error {
	wsID, ok := kbParseID(workspaceID)
	prID, ok2 := kbParseID(principalID)
	if !ok || !ok2 {
		return repository.ErrPrincipalNotFound
	}
	return r.queries(ctx).InsertWorkspaceGrantIfAbsent(ctx, sqlcgen.InsertWorkspaceGrantIfAbsentParams{
		WorkspaceID: wsID,
		PrincipalID: prID,
		Role:        string(role),
	})
}

// recordWorkspaceRoleChange は、qtx の指す時点での役割を old として読んでから mutate を実行し、
// principal が人（kind=user）なら membership_events へ 1 件記録する（group / space_all は
// 特定の 1 人を追う membership_events の対象外）。old と new が同じなら何も記録しない。
func recordWorkspaceRoleChange(
	ctx context.Context, qtx *sqlcgen.Queries, workspaceID, principalID uuid.UUID, actorUserID int64,
	newLabel *string, mutate func(qtx *sqlcgen.Queries) error,
) error {
	// 変更前の役割を先に読む（mutate が上書き・削除する前でないと読めない）。この読み取り自体は
	// 別テナントの principal ID を渡されても 0 行に落ちるだけで、新しい失敗モードを持ち込まない。
	var oldLabel *string
	prevRole, err := qtx.GetWorkspaceGrant(ctx, sqlcgen.GetWorkspaceGrantParams{WorkspaceID: workspaceID, PrincipalID: principalID})
	switch {
	case err == nil:
		l := prevRole
		oldLabel = &l
	case errors.Is(err, sql.ErrNoRows):
		// 元から役割が無い。oldLabel は nil のまま。
	default:
		return err
	}
	// mutate を先に実行し、そのエラー（別テナントの principal への FK 違反等）をそのまま伝える。
	// ここより後ろで principal を読み直すのは、書き込みが実際に成功した後だけにする —
	// 監査の付随処理が本来のエラーの種類（FK 違反 → not found 等）を書き換えてはいけない。
	if err := mutate(qtx); err != nil {
		return err
	}
	principal, err := qtx.GetPrincipal(ctx, sqlcgen.GetPrincipalParams{WorkspaceID: workspaceID, ID: principalID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// mutate 自体は成功している（例: 対象が無い削除は 0 行のまま成功）。
			// 記録すべき対象が無いだけなので、ここは黙って抜ける。
			return nil
		}
		return err
	}
	if principal.Kind != string(domain.PrincipalKindUser) || !principal.UserID.Valid {
		return nil
	}
	if (oldLabel == nil && newLabel == nil) || (oldLabel != nil && newLabel != nil && *oldLabel == *newLabel) {
		return nil
	}
	if err := recordMembershipEvent(
		ctx, qtx, workspaceID, principal.UserID.Int64, actorUserID,
		domain.MembershipEventRoleChanged, oldLabel, newLabel,
	); err != nil {
		return err
	}
	// admin から降格・剥奪されたら、その人が出した未決の招待を同じトランザクションで止める。
	if adminLost(oldLabel, newLabel) {
		return revokeOpenInvitationsByInviter(ctx, qtx, workspaceID, principal.UserID.Int64, actorUserID)
	}
	return nil
}

// adminLost は役割の変更で admin でなくなったかを返す（admin → 他の役割 / 剥奪）。
func adminLost(oldLabel, newLabel *string) bool {
	if oldLabel == nil || *oldLabel != string(domain.GrantRoleAdmin) {
		return false
	}
	return newLabel == nil || *newLabel != string(domain.GrantRoleAdmin)
}

// revokeOpenInvitationsByInviter は、その人が出した未決の招待（invitations）をまとめて取り消す。
//
// 招待は「招いた人が今も admin であること」を承諾時に再判定するので、放置しても承諾はされない。
// それでもここで止めるのは、admin でなくなった人の招待が一覧に「未決」として残り続け、再送も
// できる状態（再送は admin なら誰でもできる）にしないため。除名・降格・剥奪と同じ
// トランザクションで呼ぶ（LeaveWorkspaceMembership / recordWorkspaceRoleChange）。
func revokeOpenInvitationsByInviter(
	ctx context.Context, qtx *sqlcgen.Queries, workspaceID uuid.UUID, inviterUserID, actorUserID int64,
) error {
	_, err := qtx.RevokeOpenInvitationsByInviter(ctx, sqlcgen.RevokeOpenInvitationsByInviterParams{
		ActorUserID:   actorUserID,
		WorkspaceID:   workspaceID,
		InviterUserID: inviterUserID,
	})
	return err
}

// UpsertWorkspaceGrant はワークスペース全体の既定の役割を 1 行に揃える。admin を**与える**
// 向きは検査も行ロックも要らないが、admin から他の役割へ**落とす**向きは「admin を外す」
// 操作そのものなので、取り消し・メンバー削除と同じ検査を同じトランザクションで通す。
func (r *knowledgeBasePermissionRepository) UpsertWorkspaceGrant(
	ctx context.Context, workspaceID, principalID string, role domain.GrantRole, actorUserID uint64,
) (*domain.WorkspaceGrant, error) {
	wsID, ok := kbParseID(workspaceID)
	prID, ok2 := kbParseID(principalID)
	if !ok || !ok2 {
		return nil, repository.ErrPrincipalNotFound
	}
	actorID, aok := toInt64ID(actorUserID)
	if !aok {
		return nil, repository.ErrUserNotFound
	}
	params := sqlcgen.UpsertWorkspaceGrantParams{
		WorkspaceID: wsID,
		PrincipalID: prID,
		Role:        string(role),
	}
	newLabel := string(role)
	var g domain.WorkspaceGrant
	doUpsert := func(qtx *sqlcgen.Queries) error {
		row, err := qtx.UpsertWorkspaceGrant(ctx, params)
		if err != nil {
			return err
		}
		g = toDomainWorkspaceGrant(row)
		return nil
	}
	if role == domain.GrantRoleAdmin {
		if err := r.runInTx(ctx, func(qtx *sqlcgen.Queries) error {
			return recordWorkspaceRoleChange(ctx, qtx, wsID, prID, actorID, &newLabel, doUpsert)
		}); err != nil {
			return nil, err
		}
		return &g, nil
	}
	if err := r.withLastAdminGuard(ctx, wsID, prID, func(qtx *sqlcgen.Queries) error {
		return recordWorkspaceRoleChange(ctx, qtx, wsID, prID, actorID, &newLabel, doUpsert)
	}); err != nil {
		return nil, err
	}
	return &g, nil
}

// DeleteWorkspaceGrant はワークスペース権限を 1 件取り消す。
// RemoveGroupMember と同じ理由で 0 行削除は成功のまま（「権限が無い状態」が事後条件で、
// 元から無ければ既に満たされている）。取り消しの再実行を 404 にしない。
//
// ただし「ユーザーの admin が 0 人になる取り消し」だけは冪等では済まないので、
// withLastAdminGuard を通して同じトランザクションの中で断る。
func (r *knowledgeBasePermissionRepository) DeleteWorkspaceGrant(ctx context.Context, workspaceID, principalID string, actorUserID uint64) error {
	wsID, ok := kbParseID(workspaceID)
	prID, ok2 := kbParseID(principalID)
	if !ok || !ok2 {
		return nil
	}
	actorID, aok := toInt64ID(actorUserID)
	if !aok {
		return repository.ErrUserNotFound
	}
	return r.withLastAdminGuard(ctx, wsID, prID, func(qtx *sqlcgen.Queries) error {
		return recordWorkspaceRoleChange(ctx, qtx, wsID, prID, actorID, nil, func(qtx *sqlcgen.Queries) error {
			_, err := qtx.DeleteWorkspaceGrant(ctx, sqlcgen.DeleteWorkspaceGrantParams{
				WorkspaceID: wsID,
				PrincipalID: prID,
			})
			return err
		})
	})
}

// withLastAdminGuard は「この主体から admin を外す」操作を 1 トランザクションで包み、
// ユーザーの admin が 0 人になる場合は repository.ErrLastWorkspaceAdmin を返して
// mutate を一度も呼ばない（0 人になると誰も復旧できなくなるため）。
//
// 手前の CanRemoveWorkspaceAdminUseCase の読み取り検査だけでは足りない: 書き換えは別
// トランザクションになるため、admin 2 人をほぼ同時に外す要求は両方とも検査を通り抜けて
// 両方成功し得る（実測: 60 回中 59 回 admin が 0 人になった）。検査を DELETE の EXISTS へ
// 畳んで単一文にするだけでも足りない — PostgreSQL の既定 READ COMMITTED では EXISTS の
// 副問い合わせが行をロックしないため。LockWorkspaceAdminGrantsForRemoval が FOR UPDATE で
// admin 行をロックし、そのロックを書き換えと同じトランザクションが握り続けて初めて塞がる。
func (r *knowledgeBasePermissionRepository) withLastAdminGuard(
	ctx context.Context,
	workspaceID, principalID uuid.UUID,
	mutate func(qtx *sqlcgen.Queries) error,
) error {
	return r.runInTx(ctx, func(qtx *sqlcgen.Queries) error {
		return lastAdminGuardedMutate(ctx, qtx, workspaceID, principalID, mutate)
	})
}

// lastAdminGuardedMutate は withLastAdminGuard の検査本体（qtx を直接受け取り、トランザクション
// 境界を持たない）。LeaveWorkspaceMembership のように、この検査を他の書き込みと同じ
// トランザクションへまとめたい呼び出し元は、独自に runInTx を開いてこちらを直接呼ぶ
// （withLastAdminGuard を呼ぶと二重に BeginTx してしまう）。
func lastAdminGuardedMutate(
	ctx context.Context, qtx *sqlcgen.Queries,
	workspaceID, principalID uuid.UUID,
	mutate func(qtx *sqlcgen.Queries) error,
) error {
	guard, err := qtx.LockWorkspaceAdminGrantsForRemoval(ctx, sqlcgen.LockWorkspaceAdminGrantsForRemovalParams{
		WorkspaceID: workspaceID,
		PrincipalID: principalID,
	})
	if err != nil {
		return err
	}
	// 元から admin ではない相手なら、この操作で admin は 1 人も減らない。
	if guard.TargetIsAdmin && !guard.OtherUserAdminRemains {
		return repository.ErrLastWorkspaceAdmin
	}
	return mutate(qtx)
}

func (r *knowledgeBasePermissionRepository) ListWorkspaceGrants(ctx context.Context, workspaceID string) ([]domain.WorkspaceGrant, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return []domain.WorkspaceGrant{}, nil
	}
	rows, err := r.queries(ctx).ListWorkspaceGrants(ctx, wsID)
	if err != nil {
		return nil, err
	}
	grants := make([]domain.WorkspaceGrant, 0, len(rows))
	for _, row := range rows {
		grants = append(grants, toDomainWorkspaceGrant(row))
	}
	return grants, nil
}

func (r *knowledgeBasePermissionRepository) UpsertSpaceGrant(ctx context.Context, workspaceID, spaceID, principalID string, role domain.GrantRole) (*domain.SpaceGrant, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	prID, ok3 := kbParseID(principalID)
	if !ok || !ok2 || !ok3 {
		return nil, repository.ErrPrincipalNotFound
	}
	row, err := r.queries(ctx).UpsertSpaceGrant(ctx, sqlcgen.UpsertSpaceGrantParams{
		WorkspaceID: wsID,
		SpaceID:     spID,
		PrincipalID: prID,
		Role:        string(role),
	})
	if err != nil {
		return nil, err
	}
	g := toDomainSpaceGrant(row)
	return &g, nil
}

// DeleteSpaceGrant はスペース権限を 1 件取り消す。
// DeleteWorkspaceGrant と同じ理由で 0 行削除は成功のまま（取り消しは冪等）。
func (r *knowledgeBasePermissionRepository) DeleteSpaceGrant(ctx context.Context, workspaceID, spaceID, principalID string) error {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	prID, ok3 := kbParseID(principalID)
	if !ok || !ok2 || !ok3 {
		return nil
	}
	_, err := r.queries(ctx).DeleteSpaceGrant(ctx, sqlcgen.DeleteSpaceGrantParams{
		WorkspaceID: wsID,
		SpaceID:     spID,
		PrincipalID: prID,
	})
	return err
}

func (r *knowledgeBasePermissionRepository) ListSpaceGrants(ctx context.Context, workspaceID, spaceID string) ([]domain.SpaceGrant, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return []domain.SpaceGrant{}, nil
	}
	rows, err := r.queries(ctx).ListSpaceGrants(ctx, sqlcgen.ListSpaceGrantsParams{WorkspaceID: wsID, SpaceID: spID})
	if err != nil {
		return nil, err
	}
	grants := make([]domain.SpaceGrant, 0, len(rows))
	for _, row := range rows {
		grants = append(grants, toDomainSpaceGrant(row))
	}
	return grants, nil
}

func (r *knowledgeBasePermissionRepository) ListGrantablePrincipals(ctx context.Context, workspaceID string) ([]domain.GrantablePrincipal, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return []domain.GrantablePrincipal{}, nil
	}
	rows, err := r.queries(ctx).ListGrantablePrincipals(ctx, wsID)
	if err != nil {
		return nil, err
	}
	out := make([]domain.GrantablePrincipal, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.GrantablePrincipal{
			ID:        row.ID.String(),
			Kind:      domain.PrincipalKind(row.Kind),
			Name:      row.Name,
			AvatarURL: row.AvatarUrl,
			StatusMessage: domain.ComposeStatusDisplay(
				row.StatusEmoji, row.StatusText, nullTimePtr(row.StatusExpiresAt), time.Now(),
			),
		})
	}
	return out, nil
}

func (r *knowledgeBasePermissionRepository) ListWorkspaceMembers(ctx context.Context, workspaceID string) ([]domain.WorkspaceMember, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return []domain.WorkspaceMember{}, nil
	}
	rows, err := r.queries(ctx).ListWorkspaceMembers(ctx, wsID)
	if err != nil {
		return nil, err
	}
	out := make([]domain.WorkspaceMember, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.WorkspaceMember{
			PrincipalID: row.PrincipalID.String(),
			UserID:      uint64(row.UserID),
			Name:        row.Name,
			AvatarURL:   row.AvatarUrl,
			StatusMessage: domain.ComposeStatusDisplay(
				row.StatusEmoji, row.StatusText, nullTimePtr(row.StatusExpiresAt), time.Now(),
			),
		})
	}
	return out, nil
}

func (r *knowledgeBasePermissionRepository) ListWorkspaceMembersForAdmin(
	ctx context.Context, workspaceID string,
) ([]domain.AdminWorkspaceMember, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return []domain.AdminWorkspaceMember{}, nil
	}
	rows, err := r.queries(ctx).ListWorkspaceMembersForAdmin(ctx, wsID)
	if err != nil {
		return nil, err
	}
	out := make([]domain.AdminWorkspaceMember, 0, len(rows))
	for _, row := range rows {
		m := domain.AdminWorkspaceMember{
			PrincipalID:   row.PrincipalID.String(),
			UserID:        uint64(row.UserID),
			Name:          row.Name,
			AccountStatus: domain.UserStatus(row.AccountStatus),
			AvatarURL:     row.AvatarUrl,
			StatusMessage: domain.ComposeStatusDisplay(
				row.StatusEmoji, row.StatusText, nullTimePtr(row.StatusExpiresAt), time.Now(),
			),
		}
		if row.Role.Valid {
			role := domain.GrantRole(row.Role.String)
			m.Role = &role
		}
		out = append(out, m)
	}
	return out, nil
}

// spaceMemberViaPriority は同じ人が同じ強さの役割を複数経路で得ているときに、どちらを
// 「代表の経路」として見せるかの優先度（小さいほど優先）。もっとも具体的な理由を見せる。
func spaceMemberViaPriority(source string) int {
	switch source {
	case "direct":
		return 0
	case "group":
		return 1
	case "workspace":
		return 2
	default:
		return 3
	}
}

func (r *knowledgeBasePermissionRepository) ListSpaceMembers(ctx context.Context, workspaceID, spaceID string) ([]domain.SpaceMember, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return []domain.SpaceMember{}, nil
	}
	rows, err := r.queries(ctx).ListSpaceMemberGrantFacts(ctx, sqlcgen.ListSpaceMemberGrantFactsParams{
		WorkspaceID: wsID,
		ID:          spID,
	})
	if err != nil {
		return nil, err
	}
	// 同じ人（user_id）に複数の経路（行）が付くので、ここで「最も強い役割」に集約する。
	// 同じ強さが複数経路にまたがる場合は spaceMemberViaPriority が最も具体的な経路を選ぶ。
	// SQL 側では集約しない（ResolvePagePermissionFacts と同じく、合成は 1 箇所の Go 関数に
	// 集める方針。domain.GrantRole.Rank の doc 参照）。
	type acc struct {
		name, avatarURL string
		role            domain.GrantRole
		source          string
	}
	byUser := map[int64]*acc{}
	order := make([]int64, 0, len(rows))
	for _, row := range rows {
		role := domain.GrantRole(row.Role)
		cur, ok := byUser[row.UserID]
		if !ok {
			byUser[row.UserID] = &acc{name: row.Name, avatarURL: row.AvatarUrl, role: role, source: row.Source}
			order = append(order, row.UserID)
			continue
		}
		switch {
		case role.Rank() > cur.role.Rank():
			cur.role, cur.source = role, row.Source
		case role.Rank() == cur.role.Rank() && spaceMemberViaPriority(row.Source) < spaceMemberViaPriority(cur.source):
			cur.source = row.Source
		}
	}
	out := make([]domain.SpaceMember, 0, len(order))
	for _, uid := range order {
		a := byUser[uid]
		out = append(out, domain.SpaceMember{
			UserID:    uint64(uid),
			Name:      a.name,
			AvatarURL: a.avatarURL,
			Role:      a.role,
			Via:       a.source,
		})
	}
	return out, nil
}

// ListMySpaces は ListSpaceMembers の向きを逆にしたもの（段 14。GET /me/spaces 用）。
func (r *knowledgeBasePermissionRepository) ListMySpaces(ctx context.Context, workspaceID string, userID uint64) ([]domain.MySpace, error) {
	wsID, ok := kbParseID(workspaceID)
	uid, ok2 := toInt64ID(userID)
	if !ok || !ok2 {
		return []domain.MySpace{}, nil
	}
	rows, err := r.queries(ctx).ListMySpaceGrantFacts(ctx, sqlcgen.ListMySpaceGrantFactsParams{
		WorkspaceID: wsID,
		UserID:      sql.NullInt64{Int64: uid, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	// 同じスペースに複数の経路（行）が付くので、ここで「最も強い役割」に集約する
	// （ListSpaceMembers と同じ方針。domain.GrantRole.Rank の doc 参照）。
	type acc struct {
		name string
		role domain.GrantRole
	}
	bySpace := map[uuid.UUID]*acc{}
	order := make([]uuid.UUID, 0, len(rows))
	for _, row := range rows {
		role := domain.GrantRole(row.Role)
		cur, ok := bySpace[row.SpaceID]
		if !ok {
			bySpace[row.SpaceID] = &acc{name: row.Name, role: role}
			order = append(order, row.SpaceID)
			continue
		}
		if role.Rank() > cur.role.Rank() {
			cur.role = role
		}
	}
	out := make([]domain.MySpace, 0, len(order))
	for _, sid := range order {
		a := bySpace[sid]
		out = append(out, domain.MySpace{ID: sid.String(), Name: a.name, Role: a.role})
	}
	return out, nil
}

func (r *knowledgeBasePermissionRepository) UpsertPageGrant(ctx context.Context, workspaceID, pageID, principalID string, role domain.GrantRole) (*domain.PageGrant, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	prID, ok3 := kbParseID(principalID)
	if !ok || !ok2 || !ok3 {
		return nil, repository.ErrPrincipalNotFound
	}
	row, err := r.queries(ctx).UpsertPageGrant(ctx, sqlcgen.UpsertPageGrantParams{
		WorkspaceID: wsID,
		PageID:      pgID,
		PrincipalID: prID,
		Role:        string(role),
	})
	if err != nil {
		return nil, err
	}
	g := toDomainPageGrant(row)
	return &g, nil
}

// DeletePageGrant はページ権限を 1 件取り消す。
// DeleteSpaceGrant と同じ理由で 0 行削除は成功のまま（取り消しは冪等）。
func (r *knowledgeBasePermissionRepository) DeletePageGrant(ctx context.Context, workspaceID, pageID, principalID string) error {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	prID, ok3 := kbParseID(principalID)
	if !ok || !ok2 || !ok3 {
		return nil
	}
	_, err := r.queries(ctx).DeletePageGrant(ctx, sqlcgen.DeletePageGrantParams{
		WorkspaceID: wsID,
		PageID:      pgID,
		PrincipalID: prID,
	})
	return err
}

func (r *knowledgeBasePermissionRepository) ListPageGrants(ctx context.Context, workspaceID, pageID string) ([]domain.PageGrant, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return []domain.PageGrant{}, nil
	}
	rows, err := r.queries(ctx).ListPageGrants(ctx, sqlcgen.ListPageGrantsParams{WorkspaceID: wsID, PageID: pgID})
	if err != nil {
		return nil, err
	}
	grants := make([]domain.PageGrant, 0, len(rows))
	for _, row := range rows {
		grants = append(grants, toDomainPageGrant(row))
	}
	return grants, nil
}

func (r *knowledgeBasePermissionRepository) PagePermissionFactsForUser(ctx context.Context, workspaceID, pageID string, userID uint64) (*domain.PagePermissionFacts, error) {
	// bigint に収まらない userID は principals のどの行にも一致しない。クエリ側で言えば
	// me / mine の CTE が空になる状態で、そのとき SQL が返す自分についての事実は
	// is_member=false / grant_rank=0 / denied_anywhere=false / allowed_at_nearest=false。
	// つまり Member=false / Role=nil で、非メンバーが得るものと同じ。
	//
	// domain.ResolvePagePermission に通すと、役割が nil である以上どのケイパビリティも
	// 許されない（roleAllows(nil) は常に false）。CanEdit は CanView を含むのでさらに閉じる。
	// 拒否側へ倒れることが確実に決まる。
	//
	// ページの実在は確かめない（確かめる術がクエリしか無く、その入力がここでは作れない）。
	// 存在しないページを名指しされたときの応答が 404 ではなく 403 になるが、
	// どちらも拒否で、ページの実在を漏らす向きでもない。
	uid, uok := toInt64ID(userID)
	if !uok {
		return &domain.PagePermissionFacts{}, nil
	}
	return r.pagePermissionFacts(ctx, workspaceID, pageID,
		sql.NullInt64{Int64: uid, Valid: true}, uuid.NullUUID{})
}

func (r *knowledgeBasePermissionRepository) PagePermissionFactsForPrincipal(ctx context.Context, workspaceID, pageID, principalID string) (*domain.PagePermissionFacts, error) {
	prID, ok := kbParseID(principalID)
	if !ok {
		return nil, repository.ErrPrincipalNotFound
	}
	return r.pagePermissionFacts(ctx, workspaceID, pageID,
		sql.NullInt64{}, uuid.NullUUID{UUID: prID, Valid: true})
}

// pagePermissionFacts はユーザーとしての解決と共有リンクの来訪者としての解決の実体。
// どちらも同じ 1 本のクエリを通す（主体の種類で解決の道筋が分かれないようにするため）。
func (r *knowledgeBasePermissionRepository) pagePermissionFacts(
	ctx context.Context, workspaceID, pageID string,
	userID sql.NullInt64, principalID uuid.NullUUID,
) (*domain.PagePermissionFacts, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return nil, repository.ErrPageNotFound
	}
	row, err := r.queries(ctx).ResolvePagePermissionFacts(ctx, sqlcgen.ResolvePagePermissionFactsParams{
		WorkspaceID: wsID,
		PageID:      pgID,
		UserID:      userID,
		PrincipalID: principalID,
	})
	if err != nil {
		return nil, err
	}
	if !row.PageExists {
		return nil, repository.ErrPageNotFound
	}
	return &domain.PagePermissionFacts{
		Member:     row.IsMember,
		Role:       domain.GrantRoleByRank(int(row.GrantRank)),
		Visibility: domain.PageVisibility(row.PageVisibility),
		IsOwner:    row.IsOwner,
	}, nil
}

func (r *knowledgeBasePermissionRepository) ListSpacePageViewFacts(ctx context.Context, workspaceID, spaceID string, userID uint64, archived bool) ([]repository.PageWithViewFacts, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return []repository.PageWithViewFacts{}, nil
	}
	// bigint に収まらない userID はどの主体にも一致しない。この一覧は「見えるページ」を
	// 組み立てる材料なので、0 件（空スライス）が該当なしの答え。上の ID 不正の分岐と同じ値。
	//
	// ここで「行を返しつつ Role だけ nil」のような中途半端な値を作らないのは、
	// 呼び出し側（ListViewablePagesUseCase）が domain.ResolvePageView でふるいに掛ける前に
	// ページの中身（タイトル等）を受け取ってしまうため。空で返せば 1 枚も漏れない。
	uid, uok := toInt64ID(userID)
	if !uok {
		return []repository.PageWithViewFacts{}, nil
	}
	rows, err := r.queries(ctx).ListSpacePageViewFacts(ctx, sqlcgen.ListSpacePageViewFactsParams{
		WorkspaceID: wsID,
		SpaceID:     spID,
		UserID:      sql.NullInt64{Int64: uid, Valid: true},
		Archived:    archived,
	})
	if err != nil {
		return nil, err
	}
	out := make([]repository.PageWithViewFacts, 0, len(rows))
	for _, row := range rows {
		page := toDomainPage(sqlcgen.Page{
			ID:                 row.ID,
			WorkspaceID:        row.WorkspaceID,
			SpaceID:            row.SpaceID,
			ParentID:           row.ParentID,
			Position:           row.Position,
			Title:              row.Title,
			CreatedByUserID:    row.CreatedByUserID,
			ArchivedAt:         row.ArchivedAt,
			CreatedAt:          row.CreatedAt,
			UpdatedAt:          row.UpdatedAt,
			Icon:               row.Icon,
			Cover:              row.Cover,
			LastEditedByUserID: row.LastEditedByUserID,
			Visibility:         row.Visibility,
		})
		out = append(out, repository.PageWithViewFacts{
			Page:           page,
			Role:           domain.GrantRoleByRank(int(row.GrantRank)),
			ParentArchived: row.ParentArchived,
		})
	}
	return out, nil
}

// kbEscapeLike は LIKE / ILIKE の特殊文字（% _ \）をエスケープする。
// LIKE の既定のエスケープ文字はバックスラッシュなので ESCAPE 句は書かない。
// 生のまま渡すと「%」1 文字で全件一致になり、候補の天井まで無関係な行が埋まる。
func kbEscapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

func (r *knowledgeBasePermissionRepository) SearchWorkspacePageViewFacts(ctx context.Context, workspaceID string, userID uint64, query string) ([]repository.PageSearchViewFact, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return []repository.PageSearchViewFact{}, nil
	}
	// bigint に収まらない userID はどの主体にも一致しない（ListSpacePageViewFacts と同じ扱い）。
	uid, uok := toInt64ID(userID)
	if !uok {
		return []repository.PageSearchViewFact{}, nil
	}
	rows, err := r.queries(ctx).SearchWorkspacePageViewFacts(ctx, sqlcgen.SearchWorkspacePageViewFactsParams{
		WorkspaceID: wsID,
		UserID:      sql.NullInt64{Int64: uid, Valid: true},
		Needle:      kbEscapeLike(query),
	})
	if err != nil {
		return nil, err
	}
	out := make([]repository.PageSearchViewFact, 0, len(rows))
	for _, row := range rows {
		page := toDomainPage(sqlcgen.Page{
			ID:                 row.ID,
			WorkspaceID:        row.WorkspaceID,
			SpaceID:            row.SpaceID,
			ParentID:           row.ParentID,
			Position:           row.Position,
			Title:              row.Title,
			CreatedByUserID:    row.CreatedByUserID,
			ArchivedAt:         row.ArchivedAt,
			CreatedAt:          row.CreatedAt,
			UpdatedAt:          row.UpdatedAt,
			Icon:               row.Icon,
			Cover:              row.Cover,
			LastEditedByUserID: row.LastEditedByUserID,
			Visibility:         row.Visibility,
		})
		out = append(out, repository.PageSearchViewFact{
			PageWithViewFacts: repository.PageWithViewFacts{
				Page: page,
				Role: domain.GrantRoleByRank(int(row.GrantRank)),
				// ParentArchived は集めない（検索は現役だけが対象）。既定の false のまま。
			},
			Body: row.Body,
		})
	}
	return out, nil
}

// ListPageLinkSourcePageViewFacts は targetPageID を参照している参照元ページ全件と、
// その閲覧の事実を返す（逆リンク用）。組み立ては
// SearchWorkspacePageViewFacts と同じ形（domain.GrantRoleByRank へ変換するだけ）。
func (r *knowledgeBasePermissionRepository) ListPageLinkSourcePageViewFacts(
	ctx context.Context, workspaceID string, viewerUserID uint64, targetPageID string,
) ([]repository.PageWithViewFacts, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return []repository.PageWithViewFacts{}, nil
	}
	targetID, tok := kbParseID(targetPageID)
	if !tok {
		return []repository.PageWithViewFacts{}, nil
	}
	// bigint に収まらない userID はどの主体にも一致しない（他の口と同じ扱い）。
	uid, uok := toInt64ID(viewerUserID)
	if !uok {
		return []repository.PageWithViewFacts{}, nil
	}
	rows, err := r.queries(ctx).ListPageLinkSourcePageViewFacts(ctx, sqlcgen.ListPageLinkSourcePageViewFactsParams{
		WorkspaceID:  wsID,
		UserID:       sql.NullInt64{Int64: uid, Valid: true},
		TargetPageID: targetID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]repository.PageWithViewFacts, 0, len(rows))
	for _, row := range rows {
		page := toDomainPage(sqlcgen.Page{
			ID:                 row.ID,
			WorkspaceID:        row.WorkspaceID,
			SpaceID:            row.SpaceID,
			ParentID:           row.ParentID,
			Position:           row.Position,
			Title:              row.Title,
			CreatedByUserID:    row.CreatedByUserID,
			ArchivedAt:         row.ArchivedAt,
			CreatedAt:          row.CreatedAt,
			UpdatedAt:          row.UpdatedAt,
			Icon:               row.Icon,
			Cover:              row.Cover,
			LastEditedByUserID: row.LastEditedByUserID,
			Visibility:         row.Visibility,
		})
		out = append(out, repository.PageWithViewFacts{
			Page: page,
			Role: domain.GrantRoleByRank(int(row.GrantRank)),
			// ParentArchived は集めない（検索・パンくず以外の口と同じく既定の false）。
		})
	}
	return out, nil
}

// ListPageTicketLinkSourcePageViewFacts は targetTicketID を埋め込んでいる参照元ページ全件と、
// その閲覧の事実を返す（ListPageLinkSourcePageViewFacts のチケット版。doc 参照）。
func (r *knowledgeBasePermissionRepository) ListPageTicketLinkSourcePageViewFacts(
	ctx context.Context, workspaceID string, viewerUserID uint64, targetTicketID string,
) ([]repository.PageWithViewFacts, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return []repository.PageWithViewFacts{}, nil
	}
	targetID, tok := kbParseID(targetTicketID)
	if !tok {
		return []repository.PageWithViewFacts{}, nil
	}
	uid, uok := toInt64ID(viewerUserID)
	if !uok {
		return []repository.PageWithViewFacts{}, nil
	}
	rows, err := r.queries(ctx).ListPageTicketLinkSourcePageViewFacts(ctx, sqlcgen.ListPageTicketLinkSourcePageViewFactsParams{
		WorkspaceID:    wsID,
		UserID:         sql.NullInt64{Int64: uid, Valid: true},
		TargetTicketID: targetID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]repository.PageWithViewFacts, 0, len(rows))
	for _, row := range rows {
		page := toDomainPage(sqlcgen.Page{
			ID:                 row.ID,
			WorkspaceID:        row.WorkspaceID,
			SpaceID:            row.SpaceID,
			ParentID:           row.ParentID,
			Position:           row.Position,
			Title:              row.Title,
			CreatedByUserID:    row.CreatedByUserID,
			ArchivedAt:         row.ArchivedAt,
			CreatedAt:          row.CreatedAt,
			UpdatedAt:          row.UpdatedAt,
			Icon:               row.Icon,
			Cover:              row.Cover,
			LastEditedByUserID: row.LastEditedByUserID,
			Visibility:         row.Visibility,
		})
		out = append(out, repository.PageWithViewFacts{
			Page: page,
			Role: domain.GrantRoleByRank(int(row.GrantRank)),
		})
	}
	return out, nil
}

func (r *knowledgeBasePermissionRepository) ListWorkspacePageViewFactsByIDs(
	ctx context.Context, workspaceID string, userID uint64, pageIDs []string,
) ([]repository.PageWithViewFacts, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return []repository.PageWithViewFacts{}, nil
	}
	uid, uok := toInt64ID(userID)
	if !uok {
		return []repository.PageWithViewFacts{}, nil
	}
	// UUID として読めない ID はここで落とす。SQL 側の ::uuid が失敗すると
	// クエリ全体が落ち、壊れた参照 1 つでページの読み出しが死ぬため。
	valid := make([]string, 0, len(pageIDs))
	for _, id := range pageIDs {
		if pid, pok := kbParseID(id); pok {
			valid = append(valid, pid.String())
		}
	}
	if len(valid) == 0 {
		return []repository.PageWithViewFacts{}, nil
	}
	encoded, err := json.Marshal(valid)
	if err != nil {
		return nil, err
	}
	rows, err := r.queries(ctx).ListWorkspacePageViewFactsByIDs(ctx, sqlcgen.ListWorkspacePageViewFactsByIDsParams{
		WorkspaceID: wsID,
		UserID:      sql.NullInt64{Int64: uid, Valid: true},
		PageIds:     encoded,
	})
	if err != nil {
		return nil, err
	}
	out := make([]repository.PageWithViewFacts, 0, len(rows))
	for _, row := range rows {
		page := toDomainPage(sqlcgen.Page{
			ID:                 row.ID,
			WorkspaceID:        row.WorkspaceID,
			SpaceID:            row.SpaceID,
			ParentID:           row.ParentID,
			Position:           row.Position,
			Title:              row.Title,
			CreatedByUserID:    row.CreatedByUserID,
			ArchivedAt:         row.ArchivedAt,
			CreatedAt:          row.CreatedAt,
			UpdatedAt:          row.UpdatedAt,
			Icon:               row.Icon,
			Cover:              row.Cover,
			LastEditedByUserID: row.LastEditedByUserID,
			Visibility:         row.Visibility,
		})
		out = append(out, repository.PageWithViewFacts{
			Page: page,
			Role: domain.GrantRoleByRank(int(row.GrantRank)),
			// ParentArchived は集めない（検索と同じく現役だけが対象）。既定の false のまま。
		})
	}
	return out, nil
}

func (r *knowledgeBasePermissionRepository) ListMemberWorkspaces(ctx context.Context, userID uint64) ([]domain.MemberWorkspace, error) {
	// ここは唯一テナントを跨いで読むメソッドで、絞り込みは user_id だけが行う。
	// つまり userID の取り違えがそのままテナント境界の越境になるので、
	// 巻き戻った値で問い合わせることは絶対に避ける。
	//
	// bigint に収まらない userID は principals のどの行にも一致しない ＝ 所属ゼロ。
	// クエリが 0 行を返したときと同じ空スライスを返す（下のループが作る値と同じ）。
	uid, uok := toInt64ID(userID)
	if !uok {
		return []domain.MemberWorkspace{}, nil
	}
	rows, err := r.queries(ctx).ListMemberWorkspaces(ctx, sql.NullInt64{Int64: uid, Valid: true})
	if err != nil {
		return nil, err
	}
	out := make([]domain.MemberWorkspace, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.MemberWorkspace{
			Workspace: toDomainWorkspace(sqlcgen.Workspace{
				ID:                  row.ID,
				Slug:                row.Slug,
				Name:                row.Name,
				IsActive:            row.IsActive,
				PersonalOwnerUserID: row.PersonalOwnerUserID,
				CreatedAt:           row.CreatedAt,
				UpdatedAt:           row.UpdatedAt,
			}),
			CanManage: row.IsAdmin,
		})
	}
	return out, nil
}

// ListMembershipEvents は所属・権限の変更履歴を新しい順で返す（段 6・監査）。
func (r *knowledgeBasePermissionRepository) ListMembershipEvents(ctx context.Context, workspaceID string) ([]domain.MembershipEvent, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return []domain.MembershipEvent{}, nil
	}
	rows, err := r.queries(ctx).ListMembershipEvents(ctx, wsID)
	if err != nil {
		return nil, err
	}
	out := make([]domain.MembershipEvent, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainMembershipEvent(row))
	}
	return out, nil
}

// RecordMembershipEvent は KnowledgeBasePermissionRepository の外で起きた変更
// （users.status 等）を監査履歴へ追記する汎用の口。呼び出し側が TxManager.DoInTx で
// 対象の書き込みと同じトランザクションにまとめること。
func (r *knowledgeBasePermissionRepository) RecordMembershipEvent(
	ctx context.Context, workspaceID string, targetUserID, actorUserID uint64,
	action domain.MembershipEventAction, oldLabel, newLabel *string,
) error {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return repository.ErrWorkspaceNotFound
	}
	tid, tok := toInt64ID(targetUserID)
	aid, aok := toInt64ID(actorUserID)
	if !tok || !aok {
		return repository.ErrUserNotFound
	}
	return recordMembershipEvent(ctx, r.queries(ctx), wsID, tid, aid, action, oldLabel, newLabel)
}

// LeaveWorkspaceMembership は所属を終える。principal（実メンバーとしての権限一式）が
// あれば「最後の admin」検査を通したうえで削除し、workspace_members は消さず left にする
// （いつ誰が居たかの記録として残す）。
//
// actorUserID は誰がこの操作をしたか（段 6・監査）。userID と同じなら本人の退会
// （MembershipEventLeft）、違えば admin による除名（MembershipEventMemberRemoved）として
// membership_events へ 1 件記録する。実際には所属が終わっていない（0 行更新 = 既に非メンバー）
// なら何も記録しない。
func (r *knowledgeBasePermissionRepository) LeaveWorkspaceMembership(ctx context.Context, workspaceID string, userID, actorUserID uint64) error {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return nil // 存在し得ないワークスペース = 既に非メンバー
	}
	uid, uok := toInt64ID(userID)
	if !uok {
		return nil // 存在し得ないユーザー = 既に非メンバー
	}
	actorID, aok := toInt64ID(actorUserID)
	if !aok {
		return repository.ErrUserNotFound
	}
	action := domain.MembershipEventMemberRemoved
	if actorID == uid {
		action = domain.MembershipEventLeft
	}
	return r.runInTx(ctx, func(qtx *sqlcgen.Queries) error {
		principal, err := qtx.GetUserPrincipal(ctx, sqlcgen.GetUserPrincipalParams{
			WorkspaceID: wsID,
			UserID:      sql.NullInt64{Int64: uid, Valid: true},
		})
		var oldLabel *string
		switch {
		case err == nil:
			// 消す前に、消える役割を履歴用に読んでおく（無ければ役割 0 個のまま所属していた）。
			if role, rerr := qtx.GetWorkspaceGrant(ctx, sqlcgen.GetWorkspaceGrantParams{
				WorkspaceID: wsID, PrincipalID: principal.ID,
			}); rerr == nil {
				oldLabel = &role
			} else if !errors.Is(rerr, sql.ErrNoRows) {
				return rerr
			}
			if delErr := lastAdminGuardedMutate(ctx, qtx, wsID, principal.ID, func(qtx *sqlcgen.Queries) error {
				n, derr := qtx.DeletePrincipal(ctx, sqlcgen.DeletePrincipalParams{WorkspaceID: wsID, ID: principal.ID})
				if derr != nil {
					return derr
				}
				if n == 0 {
					return repository.ErrPrincipalNotFound
				}
				return nil
			}); delErr != nil {
				return delErr
			}
			// 所属を失った人（admin だったなら特に）が出した未決の招待は、ここで止める。
			if err := revokeOpenInvitationsByInviter(ctx, qtx, wsID, uid, actorID); err != nil {
				return err
			}
		case errors.Is(err, sql.ErrNoRows):
			// principal が無い（既に非メンバー等）。所属の記録だけ更新する。
		default:
			return err
		}
		n, err := qtx.LeaveWorkspaceMembership(ctx, sqlcgen.LeaveWorkspaceMembershipParams{
			WorkspaceID: wsID,
			UserID:      uid,
		})
		if err != nil {
			return err
		}
		if n == 0 {
			return nil // 実際には何も変わっていない（既に left/suspended か、そもそも非メンバー）。
		}
		return recordMembershipEvent(ctx, qtx, wsID, uid, actorID, action, oldLabel, nil)
	})
}

func (r *knowledgeBasePermissionRepository) SpacePermissionFactsForUser(
	ctx context.Context, workspaceID, spaceID string, userID uint64,
) (*domain.ScopeFacts, error) {
	wsID, ok := kbParseID(workspaceID)
	spID, ok2 := kbParseID(spaceID)
	if !ok || !ok2 {
		return nil, repository.ErrSpaceNotFound
	}
	// 役割を集める前にスペースの実在（と同じワークスペースに属すること）を確かめる。
	// workspace_grants は配下の全スペースに届くので、確かめずに役割だけを集めると
	// 存在しないスペースや他テナントのスペースに対しても「自分のワークスペースでの役割」が
	// そのまま返り、口そのものが緩い側へ倒れる。
	if _, err := r.queries(ctx).GetSpace(ctx, sqlcgen.GetSpaceParams{WorkspaceID: wsID, ID: spID}); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, repository.ErrSpaceNotFound
		}
		return nil, err
	}
	// bigint に収まらない userID はどの主体にも一致しない ＝ 役割を 1 つも持たない。
	// 役割の問い合わせが 0 行を返したときと同じ値（空の Roles）を返す。
	// domain.ResolveScopePermission は StrongestGrantRole([]) = nil → roleAllows(nil) = false
	// なので CanView / CanEdit / CanManage がすべて false になり、拒否側へ倒れる。
	//
	// この検査を「スペースの実在を確かめたあと」に置いているのは、ErrSpaceNotFound を
	// 返す条件がスペース側の事情だけで決まるようにするため。userID が範囲外かどうかで
	// 存在しないスペースへの応答が変わると、同じ URL の答えが呼び出し方で揺れる。
	uid, uok := toInt64ID(userID)
	if !uok {
		return &domain.ScopeFacts{Roles: toGrantRoles(nil)}, nil
	}
	roles, err := r.queries(ctx).ListSpaceScopeGrantRoles(ctx, sqlcgen.ListSpaceScopeGrantRolesParams{
		WorkspaceID: wsID,
		UserID:      sql.NullInt64{Int64: uid, Valid: true},
		SpaceID:     uuid.NullUUID{UUID: spID, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	return &domain.ScopeFacts{Roles: toGrantRoles(roles)}, nil
}

func (r *knowledgeBasePermissionRepository) WorkspacePermissionFactsForUser(
	ctx context.Context, workspaceID string, userID uint64,
) (*domain.ScopeFacts, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return nil, repository.ErrWorkspaceNotFound
	}
	// bigint に収まらない userID はどの主体にも一致しない ＝ 役割を 1 つも持たない。
	// SpacePermissionFactsForUser と同じく、0 行のときと同じ空の Roles を返す。
	// これが admin を含む役割へ倒れると、ワークスペースの権限設定そのものを
	// 書き換えられる（CanManage が true になる）ので、必ず空側に倒す。
	uid, uok := toInt64ID(userID)
	if !uok {
		return &domain.ScopeFacts{Roles: toGrantRoles(nil)}, nil
	}
	roles, err := r.queries(ctx).ListWorkspaceScopeGrantRoles(ctx, sqlcgen.ListWorkspaceScopeGrantRolesParams{
		WorkspaceID: wsID,
		UserID:      sql.NullInt64{Int64: uid, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	return &domain.ScopeFacts{Roles: toGrantRoles(roles)}, nil
}

func (r *knowledgeBasePermissionRepository) ListWorkspaceSpaceScopeFacts(
	ctx context.Context, workspaceID string, userID uint64,
) ([]repository.SpaceWithScopeFacts, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		// 解釈できないワークスペース ID は 1 行にも一致しない。0 件と同じ空スライスを返す
		// （nil を返さないのは JSON で null にしないため）。
		return []repository.SpaceWithScopeFacts{}, nil
	}
	// bigint に収まらない userID はどの主体にも一致しない ＝ 役割を 1 つも持たない。
	// ここは一覧の材料なので、空スライス（＝ 1 件も見えない）が拒否側の答えになる。
	//
	// 「全スペースを Roles 空で返す」ではなく空にするのは、見えないスペースの key / name を
	// 呼び出し側へ渡さないため（ListSubtreePagePermissionFacts と同じ判断）。
	uid, uok := toInt64ID(userID)
	if !uok {
		return []repository.SpaceWithScopeFacts{}, nil
	}
	rows, err := r.queries(ctx).ListWorkspaceSpaceScopeFacts(ctx, sqlcgen.ListWorkspaceSpaceScopeFactsParams{
		WorkspaceID: wsID,
		UserID:      sql.NullInt64{Int64: uid, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	// クエリは (スペース × 届いている役割) の直積を返すので、スペース単位に畳み直す。
	// 役割が 1 つも無いスペースは LEFT JOIN の右が NULL の 1 行として来る（＝ Roles は空のまま）。
	//
	// どれを採るかの規則はここでは決めない（domain.StrongestGrantRole の仕事）。
	// ここでやるのは行を集めることだけ。
	out := make([]repository.SpaceWithScopeFacts, 0, len(rows))
	indexBySpace := make(map[uuid.UUID]int, len(rows))
	for _, row := range rows {
		i, seen := indexBySpace[row.ID]
		if !seen {
			i = len(out)
			indexBySpace[row.ID] = i
			out = append(out, repository.SpaceWithScopeFacts{
				Space: toDomainSpace(sqlcgen.Space{
					ID:          row.ID,
					WorkspaceID: row.WorkspaceID,
					Key:         row.Key,
					Name:        row.Name,
					Visibility:  row.Visibility,
					CreatedAt:   row.CreatedAt,
					UpdatedAt:   row.UpdatedAt,
				}),
				Facts: domain.ScopeFacts{Roles: []domain.GrantRole{}},
			})
		}
		if row.Role.Valid {
			out[i].Facts.Roles = append(out[i].Facts.Roles, domain.GrantRole(row.Role.String))
		}
	}
	return out, nil
}

// toGrantRoles は SQL が返した役割の文字列を domain の型へ移すだけの変換。
// どれを採るかの規則（最も強いものを採る）はここでは決めず、domain.StrongestGrantRole に任せる。
func toGrantRoles(rows []string) []domain.GrantRole {
	roles := make([]domain.GrantRole, 0, len(rows))
	for _, row := range rows {
		roles = append(roles, domain.GrantRole(row))
	}
	return roles
}

func (r *knowledgeBasePermissionRepository) ListSubtreePagePermissionFacts(ctx context.Context, workspaceID, pageID string, userID uint64) ([]repository.PageWithPermissionFacts, error) {
	wsID, ok := kbParseID(workspaceID)
	pgID, ok2 := kbParseID(pageID)
	if !ok || !ok2 {
		return []repository.PageWithPermissionFacts{}, nil
	}
	// bigint に収まらない userID はどの主体にも一致しない。上の ID 不正の分岐と同じ
	// 空スライスを返す。呼び出し側（CanEditPageSubtreeUseCase）は 0 行を
	// 「許可には倒さない」と決めて false を返すので、ここも拒否側で一致する。
	//
	// 空ではなく「全ページを Role=nil で返す」ようにしてはいけない。そちらでも判定自体は
	// false になるが、見えないページの ID を呼び出し側へ渡すことになる。
	uid, uok := toInt64ID(userID)
	if !uok {
		return []repository.PageWithPermissionFacts{}, nil
	}
	rows, err := r.queries(ctx).ListSubtreePagePermissionFacts(ctx, sqlcgen.ListSubtreePagePermissionFactsParams{
		WorkspaceID: wsID,
		PageID:      pgID,
		UserID:      uid,
	})
	if err != nil {
		return nil, err
	}
	out := make([]repository.PageWithPermissionFacts, 0, len(rows))
	for _, row := range rows {
		out = append(out, repository.PageWithPermissionFacts{
			PageID: row.PageID.String(),
			Facts: domain.PagePermissionFacts{
				Member:     row.IsMember,
				Role:       domain.GrantRoleByRank(int(row.GrantRank)),
				Visibility: domain.PageVisibility(row.PageVisibility),
				IsOwner:    row.IsOwner,
			},
		})
	}
	return out, nil
}
