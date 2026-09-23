package persistence

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/norman6464/frestyle/backend/internal/adapter/persistence/sqlcgen"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// invitationRepository は [repository.InvitationRepository] の実装。
//
// 承諾（Accept）だけは権限モデルの表（workspace_members / principals / workspace_grants /
// membership_events）を同じトランザクションで書く。それらの書き込みは
// knowledge_base_permission_repository.go の関数（ensureUserPrincipalInTx /
// recordMembershipEvent）をそのまま使う — 同じ package に置いてあるのは、この共有のため。
type invitationRepository struct {
	baseRepository
}

// NewInvitationRepository は招待の repository を組み立てる。
func NewInvitationRepository(db *sql.DB) repository.InvitationRepository {
	return &invitationRepository{baseRepository{db: db}}
}

// queries は ctx に乗っているトランザクション（あれば）に束縛した sqlc の Queries を作る。
func (r *invitationRepository) queries(ctx context.Context) *sqlcgen.Queries {
	return sqlcgen.New(r.dbtx(ctx))
}

// runInTx は 1 つのトランザクションを開き、その中でだけ有効な Queries を fn に渡す。
// 外側の DoInTx が開いたトランザクションがあれば相乗りする（shareLinkRepository.runInTx と同じ）。
func (r *invitationRepository) runInTx(ctx context.Context, fn func(qtx *sqlcgen.Queries) error) error {
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

// nullUUIDPtr は uuid.NullUUID を *string へ変換する（NULL は nil）。
func nullUUIDPtr(u uuid.NullUUID) *string {
	if !u.Valid {
		return nil
	}
	s := u.UUID.String()
	return &s
}

// nullUserIDPtr は sql.NullInt64 のユーザー ID を *uint64 へ変換する（NULL は nil）。
func nullUserIDPtr(v sql.NullInt64) *uint64 {
	if !v.Valid {
		return nil
	}
	id := uint64(v.Int64)
	return &id
}

func toDomainInvitation(row sqlcgen.Invitation) domain.Invitation {
	return domain.Invitation{
		ID:               row.ID.String(),
		WorkspaceID:      row.WorkspaceID.String(),
		Scope:            domain.InvitationScope(row.Scope),
		SpaceID:          nullUUIDPtr(row.SpaceID),
		PageID:           nullUUIDPtr(row.PageID),
		Role:             domain.GrantRole(row.Role),
		Email:            row.Email,
		InviteeName:      row.InviteeName,
		TokenHash:        row.TokenHash,
		InvitedByUserID:  uint64(row.InvitedByUserID),
		ExpiresAt:        row.ExpiresAt,
		LastSentAt:       row.LastSentAt,
		LastSentByUserID: uint64(row.LastSentByUserID),
		SendCount:        int(row.SendCount),
		AcceptedAt:       nullTimePtr(row.AcceptedAt),
		AcceptedByUserID: nullUserIDPtr(row.AcceptedByUserID),
		DeclinedAt:       nullTimePtr(row.DeclinedAt),
		DeclinedByUserID: nullUserIDPtr(row.DeclinedByUserID),
		RevokedAt:        nullTimePtr(row.RevokedAt),
		RevokedByUserID:  nullUserIDPtr(row.RevokedByUserID),
		CreatedAt:        row.CreatedAt,
		UpdatedAt:        row.UpdatedAt,
	}
}

func toDomainInvitationDetail(inv sqlcgen.Invitation, slug, name, inviter string) domain.InvitationDetail {
	return domain.InvitationDetail{
		Invitation:    toDomainInvitation(inv),
		WorkspaceSlug: slug,
		WorkspaceName: name,
		InviterName:   inviter,
	}
}

// optionalKbID は *string の ID を uuid.NullUUID へ変換する。nil は NULL。
// 形が UUID でなければ ok=false（存在し得ない ID）。
func optionalKbID(id *string) (uuid.NullUUID, bool) {
	if id == nil {
		return uuid.NullUUID{}, true
	}
	parsed, ok := kbParseID(*id)
	if !ok {
		return uuid.NullUUID{}, false
	}
	return uuid.NullUUID{UUID: parsed, Valid: true}, true
}

// invitationTargetNotFound は scope に応じた「対象が無い」エラーを返す
// （複合 FK 違反や ID の形式不正をここへ畳む）。
func invitationTargetNotFound(scope domain.InvitationScope) error {
	switch scope {
	case domain.InvitationScopeSpace:
		return repository.ErrSpaceNotFound
	case domain.InvitationScopePage:
		return repository.ErrPageNotFound
	default:
		return repository.ErrWorkspaceNotFound
	}
}

func (r *invitationRepository) Upsert(ctx context.Context, in repository.InvitationWrite) (*domain.Invitation, error) {
	wsID, ok := kbParseID(in.WorkspaceID)
	if !ok {
		return nil, repository.ErrWorkspaceNotFound
	}
	spaceID, sok := optionalKbID(in.SpaceID)
	pageID, pok := optionalKbID(in.PageID)
	if !sok || !pok {
		return nil, invitationTargetNotFound(in.Scope)
	}
	// invited_by_user_id / last_sent_by_user_id は bigint。範囲外の実行者では 1 行も書けないので
	// 書き込みに入る前に止める（nil を返すと発行できたと誤認される）。
	actor, aok := toInt64ID(in.ActorUserID)
	if !aok {
		return nil, repository.ErrUserNotFound
	}
	id, err := kbNewID()
	if err != nil {
		return nil, err
	}
	row, err := r.queries(ctx).UpsertOpenInvitation(ctx, sqlcgen.UpsertOpenInvitationParams{
		ID:          id,
		WorkspaceID: wsID,
		Scope:       string(in.Scope),
		SpaceID:     spaceID,
		PageID:      pageID,
		Role:        string(in.Role),
		Email:       in.Email,
		InviteeName: in.InviteeName,
		TokenHash:   in.TokenHash,
		ActorUserID: actor,
		ExpiresAt:   in.ExpiresAt,
		SentBefore:  in.SentBefore,
	})
	if err != nil {
		// 0 行は「同じ宛先 × 場所に未決の行があり、まだ再送の間隔が空いていない」
		// （UpsertOpenInvitation の DO UPDATE ... WHERE が偽）。
		if errors.Is(err, sql.ErrNoRows) {
			return nil, repository.ErrInvitationResendTooSoon
		}
		// 別テナントのスペース / ページ、消えたワークスペースは複合 FK で落ちる。入力の誤りなので
		// 制約違反のまま上へ流さず「対象が無い」にする（500 にしない）。
		if isForeignKeyViolation(err) {
			return nil, invitationTargetNotFound(in.Scope)
		}
		return nil, err
	}
	inv := toDomainInvitation(row)
	return &inv, nil
}

func (r *invitationRepository) Refresh(ctx context.Context, in repository.InvitationRefresh) (*domain.Invitation, error) {
	wsID, ok := kbParseID(in.WorkspaceID)
	invID, ok2 := kbParseID(in.InvitationID)
	if !ok || !ok2 {
		return nil, repository.ErrInvitationNotFound
	}
	actor, aok := toInt64ID(in.ActorUserID)
	if !aok {
		return nil, repository.ErrUserNotFound
	}
	q := r.queries(ctx)
	row, err := q.RefreshInvitationToken(ctx, sqlcgen.RefreshInvitationTokenParams{
		TokenHash:   in.TokenHash,
		ExpiresAt:   in.ExpiresAt,
		ActorUserID: actor,
		WorkspaceID: wsID,
		ID:          invID,
		SentBefore:  in.SentBefore,
	})
	if err == nil {
		inv := toDomainInvitation(row)
		return &inv, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	// 0 行は「無い」「結果が出ている」「間隔が空いていない」の 3 つがあり得る。次に何をすべきか
	// （取り直す・諦める・待つ）が違うので、読み直して切り分ける。
	current, err := q.GetInvitation(ctx, sqlcgen.GetInvitationParams{WorkspaceID: wsID, ID: invID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, repository.ErrInvitationNotFound
		}
		return nil, err
	}
	if !toDomainInvitation(current).Unresolved() {
		return nil, repository.ErrInvitationNotOpen
	}
	return nil, repository.ErrInvitationResendTooSoon
}

func (r *invitationRepository) Find(ctx context.Context, workspaceID, invitationID string) (*domain.Invitation, error) {
	wsID, ok := kbParseID(workspaceID)
	invID, ok2 := kbParseID(invitationID)
	if !ok || !ok2 {
		return nil, repository.ErrInvitationNotFound
	}
	row, err := r.queries(ctx).GetInvitation(ctx, sqlcgen.GetInvitationParams{WorkspaceID: wsID, ID: invID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrInvitationNotFound
	}
	if err != nil {
		return nil, err
	}
	inv := toDomainInvitation(row)
	return &inv, nil
}

func (r *invitationRepository) FindByID(ctx context.Context, invitationID string) (*domain.Invitation, error) {
	invID, ok := kbParseID(invitationID)
	if !ok {
		return nil, repository.ErrInvitationNotFound
	}
	row, err := r.queries(ctx).GetInvitationByID(ctx, invID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrInvitationNotFound
	}
	if err != nil {
		return nil, err
	}
	inv := toDomainInvitation(row)
	return &inv, nil
}

func (r *invitationRepository) FindDetailByTokenHash(ctx context.Context, tokenHash []byte) (*domain.InvitationDetail, error) {
	row, err := r.queries(ctx).GetInvitationDetailByTokenHash(ctx, tokenHash)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, repository.ErrInvitationNotFound
	}
	if err != nil {
		return nil, err
	}
	d := toDomainInvitationDetail(row.Invitation, row.WorkspaceSlug, row.WorkspaceName, row.InviterName)
	return &d, nil
}

// invitationListMaxLimit は一覧の 1 回の上限。ワークスペースの未決の上限（usecase の定数）より
// 十分大きく、履歴（結果が出た行）まで含めて一画面に出す想定の幅。
const invitationListMaxLimit = 1000

func (r *invitationRepository) ListByWorkspace(ctx context.Context, workspaceID string, limit int) ([]domain.InvitationDetail, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return []domain.InvitationDetail{}, nil
	}
	if limit <= 0 || limit > invitationListMaxLimit {
		limit = invitationListMaxLimit
	}
	rows, err := r.queries(ctx).ListWorkspaceInvitations(ctx, sqlcgen.ListWorkspaceInvitationsParams{
		WorkspaceID: wsID,
		RowLimit:    int32(limit), //nolint:gosec // 上で invitationListMaxLimit 以下に丸めている
	})
	if err != nil {
		return nil, err
	}
	out := make([]domain.InvitationDetail, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainInvitationDetail(row.Invitation, row.WorkspaceSlug, row.WorkspaceName, row.InviterName))
	}
	return out, nil
}

func (r *invitationRepository) ListOpenByEmail(ctx context.Context, email string) ([]domain.InvitationDetail, error) {
	rows, err := r.queries(ctx).ListOpenInvitationsByEmail(ctx, email)
	if err != nil {
		return nil, err
	}
	out := make([]domain.InvitationDetail, 0, len(rows))
	for _, row := range rows {
		out = append(out, toDomainInvitationDetail(row.Invitation, row.WorkspaceSlug, row.WorkspaceName, row.InviterName))
	}
	return out, nil
}

// lockOpenInvitationForUser は承諾・辞退のトランザクションで招待の行を掴み、宛先の照合まで行う。
// 「無い」と「宛先が違う」はどちらも ErrInvitationNotFound（id を知っているだけの相手に
// 宛先の実在を教えない）。
func lockOpenInvitationForUser(
	ctx context.Context, qtx *sqlcgen.Queries, invID uuid.UUID, email string,
) (domain.Invitation, error) {
	row, err := qtx.GetInvitationByIDForUpdate(ctx, invID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Invitation{}, repository.ErrInvitationNotFound
		}
		return domain.Invitation{}, err
	}
	inv := toDomainInvitation(row)
	if inv.Email != email {
		return domain.Invitation{}, repository.ErrInvitationNotFound
	}
	return inv, nil
}

func (r *invitationRepository) Accept(ctx context.Context, invitationID string, userID uint64, email string) (*domain.Invitation, error) {
	invID, ok := kbParseID(invitationID)
	if !ok {
		return nil, repository.ErrInvitationNotFound
	}
	uid, uok := toInt64ID(userID)
	if !uok {
		return nil, repository.ErrUserNotFound
	}
	var accepted domain.Invitation
	err := r.runInTx(ctx, func(qtx *sqlcgen.Queries) error {
		inv, err := lockOpenInvitationForUser(ctx, qtx, invID, email)
		if err != nil {
			return err
		}
		if !inv.Open(time.Now()) {
			return repository.ErrInvitationNotOpen
		}
		// ゲスト（スペース宛・ページ宛）の付与はまだ無い。所属だけ作って付与が無い、という
		// 中途半端な状態を作らないよう、書き込みに入る前に断る。
		if inv.Scope != domain.InvitationScopeWorkspace {
			return repository.ErrInvitationScopeUnsupported
		}
		wsID, _ := kbParseID(inv.WorkspaceID)
		n, err := qtx.AcceptInvitation(ctx, sqlcgen.AcceptInvitationParams{UserID: uid, ID: invID})
		if err != nil {
			return err
		}
		if n == 0 {
			// FOR UPDATE で掴んだ後なので通常は起きない（起きるとすれば期限が今まさに切れた）。
			return repository.ErrInvitationNotOpen
		}
		invitedBy, _ := toInt64ID(inv.InvitedByUserID)
		if err := qtx.UpsertActiveWorkspaceMember(ctx, sqlcgen.UpsertActiveWorkspaceMemberParams{
			WorkspaceID:     wsID,
			UserID:          uid,
			InvitedByUserID: sql.NullInt64{Int64: invitedBy, Valid: true},
		}); err != nil {
			// 実在しないユーザー ID は users への FK で落ちる（呼び出し側は必ずログイン中の本人の
			// ID を渡すので、通常は起きない）。
			if isForeignKeyViolation(err) {
				return repository.ErrUserNotFound
			}
			return err
		}
		principal, err := ensureUserPrincipalInTx(ctx, qtx, wsID, uid)
		if err != nil {
			return err
		}
		// 招待の役割を「無いときだけ」与える。既にこの人が持っている役割（既存メンバーを別の
		// 役割で招き直した場合）は上書きしない — 役割の変更は権限画面の操作（監査に残る）で行う。
		if err := qtx.InsertWorkspaceGrantIfAbsent(ctx, sqlcgen.InsertWorkspaceGrantIfAbsentParams{
			WorkspaceID: wsID,
			PrincipalID: principal.ID,
			Role:        string(inv.Role),
		}); err != nil {
			return err
		}
		role := string(inv.Role)
		if err := recordMembershipEvent(ctx, qtx, wsID, uid, uid, domain.MembershipEventInvitationAccepted, nil, &role); err != nil {
			return err
		}
		row, err := qtx.GetInvitationByID(ctx, invID)
		if err != nil {
			return err
		}
		accepted = toDomainInvitation(row)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &accepted, nil
}

func (r *invitationRepository) Decline(ctx context.Context, invitationID string, userID uint64, email string) error {
	invID, ok := kbParseID(invitationID)
	if !ok {
		return repository.ErrInvitationNotFound
	}
	uid, uok := toInt64ID(userID)
	if !uok {
		return repository.ErrUserNotFound
	}
	return r.runInTx(ctx, func(qtx *sqlcgen.Queries) error {
		inv, err := lockOpenInvitationForUser(ctx, qtx, invID, email)
		if err != nil {
			return err
		}
		n, err := qtx.DeclineInvitation(ctx, sqlcgen.DeclineInvitationParams{UserID: uid, ID: invID})
		if err != nil {
			return err
		}
		if n == 0 {
			return repository.ErrInvitationNotOpen
		}
		wsID, _ := kbParseID(inv.WorkspaceID)
		// 辞退した人は users に居る（ログイン中の本人）ので、監査にも残す。
		if err := recordMembershipEvent(ctx, qtx, wsID, uid, uid, domain.MembershipEventInvitationDeclined, nil, nil); err != nil {
			if isForeignKeyViolation(err) {
				return repository.ErrUserNotFound
			}
			return err
		}
		return nil
	})
}

func (r *invitationRepository) Revoke(ctx context.Context, workspaceID, invitationID string, actorUserID uint64) error {
	wsID, ok := kbParseID(workspaceID)
	invID, ok2 := kbParseID(invitationID)
	if !ok || !ok2 {
		return repository.ErrInvitationNotFound
	}
	actor, aok := toInt64ID(actorUserID)
	if !aok {
		return repository.ErrUserNotFound
	}
	q := r.queries(ctx)
	n, err := q.RevokeInvitation(ctx, sqlcgen.RevokeInvitationParams{ActorUserID: actor, WorkspaceID: wsID, ID: invID})
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	// 0 行は「無い」「取消済み（冪等に成功）」「承諾・辞退済み（もう取り消せない）」。
	current, err := q.GetInvitation(ctx, sqlcgen.GetInvitationParams{WorkspaceID: wsID, ID: invID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return repository.ErrInvitationNotFound
		}
		return err
	}
	if current.RevokedAt.Valid {
		return nil
	}
	return repository.ErrInvitationNotOpen
}

func (r *invitationRepository) CountOpenInWorkspace(ctx context.Context, workspaceID string) (int64, error) {
	wsID, ok := kbParseID(workspaceID)
	if !ok {
		return 0, nil
	}
	return r.queries(ctx).CountOpenInvitationsInWorkspace(ctx, wsID)
}

func (r *invitationRepository) CountSentBySince(ctx context.Context, userID uint64, since time.Time) (int64, error) {
	uid, ok := toInt64ID(userID)
	if !ok {
		return 0, nil
	}
	return r.queries(ctx).CountInvitationsSentBySince(ctx, sqlcgen.CountInvitationsSentBySinceParams{UserID: uid, Since: since})
}

func (r *invitationRepository) CountSentToEmailSince(ctx context.Context, email string, since time.Time) (int64, error) {
	return r.queries(ctx).CountInvitationsSentToEmailSince(ctx, sqlcgen.CountInvitationsSentToEmailSinceParams{Email: email, Since: since})
}
