// Package persistence は usecase 層が定義した port の永続化実装
// （sqlc 生成コード / DynamoDB / GCS presigner 等）を集約する。wiring は router.go で行う。
package persistence

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence/sqlcgen"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// userRepository は [repository.UserRepository] の実装。
// クエリは sqlc 生成コード（生 SQL）で、接続プール（*sql.DB）をそのまま受け取る。
type userRepository struct {
	baseRepository
}

func NewUserRepository(db *sql.DB) repository.UserRepository {
	return &userRepository{baseRepository{db: db}}
}

func (r *userRepository) queries(ctx context.Context) *sqlcgen.Queries {
	return sqlcgen.New(r.dbtx(ctx))
}

// toDomainUser は sqlc 生成モデル（users 全列）→ domain への詰め替え。GetUserByID /
// GetUserByOidcSubject は列が users 全列と一致するため sqlc がテーブルの生成モデルをそのまま
// 返す。id は DB が bigint(int64) で domain が uint64 だが、採番シーケンス由来で常に非負・
// int64 範囲内のため変換は安全（gosec G115 は persistence の id 境界として除外設定済み）。
func toDomainUser(row sqlcgen.User) *domain.User {
	u := &domain.User{
		ID:        uint64(row.ID),
		Email:     row.Email,
		Name:      row.Name,
		Status:    domain.UserStatus(row.Status),
		CreatedAt: row.CreatedAt,
		UpdatedAt: row.UpdatedAt,
	}
	if row.DeletedAt.Valid {
		t := row.DeletedAt.Time
		u.DeletedAt = &t
	}
	return u
}

func (r *userRepository) FindByOidcSubject(ctx context.Context, sub string) (*domain.User, error) {
	q := r.queries(ctx)
	row, err := q.GetUserByOidcSubject(ctx, sub)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return toDomainUser(row), nil
}

func (r *userRepository) OidcSubjectByUserID(ctx context.Context, userID uint64) (string, error) {
	id64, ok := toInt64ID(userID)
	if !ok {
		return "", nil
	}
	q := r.queries(ctx)
	subject, err := q.GetOidcSubjectByUserID(ctx, id64)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return subject, nil
}

func (r *userRepository) FindByID(ctx context.Context, id uint64) (*domain.User, error) {
	id64, ok := toInt64ID(id)
	if !ok {
		return nil, nil // int64 範囲外 = 存在し得ない id
	}
	q := r.queries(ctx)
	row, err := q.GetUserByID(ctx, id64)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return toDomainUser(row), nil
}

// FindActiveIDByEmail は正規形の email から退会していないユーザーの id を引く。無ければ found=false。
// 呼び出し側が domain.NormalizeEmail を通していない値を渡すと、索引の式（lower + btrim）と
// 一致せず引けないので、正規化はここでも行う（二重でも害は無い）。
func (r *userRepository) FindActiveIDByEmail(ctx context.Context, email string) (uint64, bool, error) {
	normalized := domain.NormalizeEmail(email)
	if normalized == "" {
		return 0, false, nil
	}
	id, err := r.queries(ctx).FindActiveUserIDByEmail(ctx, normalized)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return uint64(id), true, nil
}

// FindDisplayByID は人を表示するのに要る最小限（表示名・アイコン・状態メッセージ）を返す。
// GetUserByID と違い status を絞らないクエリを使う（domain.UserDisplay の doc 参照）。
func (r *userRepository) FindDisplayByID(ctx context.Context, id uint64) (*domain.UserDisplay, error) {
	id64, ok := toInt64ID(id)
	if !ok {
		return nil, nil // int64 範囲外 = 存在し得ない id
	}
	q := r.queries(ctx)
	row, err := q.GetUserDisplayByID(ctx, id64)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &domain.UserDisplay{
		UserID:    uint64(row.ID),
		Name:      row.Name,
		AvatarURL: row.AvatarUrl,
		StatusMessage: domain.ComposeStatusDisplay(
			row.StatusEmoji, row.StatusText, nullTimePtr(row.StatusExpiresAt), time.Now(),
		),
	}, nil
}

// Create は users 行を 1 件作る。OIDC identity と不可分に作りたい場合は、
// 呼び出し側（usecase）が TxManager.DoInTx の中で UserOidcIdentityRepository.EnsureIdentity と
// 併せて呼ぶ（このメソッド自身はトランザクションを開始しない。ctx に乗っていればそれに乗る）。
func (r *userRepository) Create(ctx context.Context, user *domain.User) error {
	return insertUserTx(ctx, r.queries(ctx), user)
}

// insertUserTx は users 行を 1 件作り、採番結果を user へ書き戻す。
// created_at / updated_at に DB 既定値は無いのでここで値を決める（ゼロのときだけ now）。
func insertUserTx(ctx context.Context, q *sqlcgen.Queries, user *domain.User) error {
	now := time.Now()
	createdAt := user.CreatedAt
	if createdAt.IsZero() {
		createdAt = now
	}
	updatedAt := user.UpdatedAt
	if updatedAt.IsZero() {
		updatedAt = now
	}
	params := sqlcgen.InsertUserParams{
		Email:     user.Email,
		Name:      user.Name,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}
	if user.DeletedAt != nil {
		params.DeletedAt = sql.NullTime{Time: *user.DeletedAt, Valid: true}
	}
	var (
		newID        int64
		newCreatedAt time.Time
		newUpdatedAt time.Time
	)
	if user.ID == 0 {
		row, err := q.InsertUser(ctx, params)
		if err != nil {
			if isUniqueViolation(err) {
				return repository.ErrEmailTaken
			}
			return err
		}
		newID, newCreatedAt, newUpdatedAt = row.ID, row.CreatedAt, row.UpdatedAt
	} else {
		// 呼び出し側が id を決めた場合はそれを使う（採番シーケンスは進めない）。
		fixedID, ok := toInt64ID(user.ID)
		if !ok {
			return fmt.Errorf("user id %d が int64 の範囲外です", user.ID)
		}
		row, err := q.InsertUserWithID(ctx, sqlcgen.InsertUserWithIDParams{
			ID:        fixedID,
			Email:     params.Email,
			Name:      params.Name,
			CreatedAt: params.CreatedAt,
			UpdatedAt: params.UpdatedAt,
			DeletedAt: params.DeletedAt,
		})
		if err != nil {
			if isUniqueViolation(err) {
				return repository.ErrEmailTaken
			}
			return err
		}
		newID, newCreatedAt, newUpdatedAt = row.ID, row.CreatedAt, row.UpdatedAt
	}
	user.ID = uint64(newID)
	user.CreatedAt = newCreatedAt
	user.UpdatedAt = newUpdatedAt
	// status は常に active で作る（作成直後のアカウントは有効。停止は UpdateActive の仕事）。
	user.Status = domain.UserStatusActive
	return nil
}

// UpdateActive はユーザーアカウントの有効/無効を更新する（false で無効化 → ログイン/利用不可）。
// active/suspended だけを切り替える — deactivated への遷移は deleted_at と同時に立てる必要があり
// SoftDelete が担う（ck_users_status_deleted_at がこのメソッド経由の指定を許さない）。
func (r *userRepository) UpdateActive(ctx context.Context, userID uint64, active bool) error {
	id64, ok := toInt64ID(userID)
	if !ok {
		return domain.ErrNotFound // 存在し得ない id = not found
	}
	status := domain.UserStatusSuspended
	if active {
		status = domain.UserStatusActive
	}
	q := r.queries(ctx)
	affected, err := q.UpdateUserStatus(ctx, sqlcgen.UpdateUserStatusParams{ID: id64, Status: string(status)})
	if err != nil {
		return err
	}
	if affected == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// SoftDelete はユーザーを退会させる（status を deactivated、deleted_at = now()）。以後
// FindByOidcSubject 等で除外される。OIDC identity も削除して subject の占有を解き、同じ
// アカウントの再招待を可能にする。2 文を 1 トランザクションにまとめないのは無効化を必ず
// 残すため — identity 削除の失敗で巻き戻すと、消したはずの利用者が有効なまま戻ってしまう
// （掃除漏れは起動時バックフィルが自己修復する）。
func (r *userRepository) SoftDelete(ctx context.Context, userID uint64) error {
	id64, ok := toInt64ID(userID)
	if !ok {
		return domain.ErrNotFound // 存在し得ない id = not found
	}
	q := r.queries(ctx)
	affected, err := q.SoftDeleteUser(ctx, id64)
	if err != nil {
		return err
	}
	if affected == 0 {
		return domain.ErrNotFound
	}
	return q.DeleteOidcIdentitiesByUserID(ctx, id64)
}

// UpdateName は氏名だけを更新する。対象が存在しなければ domain.ErrNotFound を返す。
func (r *userRepository) UpdateName(ctx context.Context, userID uint64, name string) error {
	id64, ok := toInt64ID(userID)
	if !ok {
		return domain.ErrNotFound // 存在し得ない id = not found
	}
	q := r.queries(ctx)
	affected, err := q.UpdateUserName(ctx, sqlcgen.UpdateUserNameParams{ID: id64, Name: name})
	if err != nil {
		return err
	}
	if affected == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// UpdateEmail は email だけを更新する。対象が存在しなければ domain.ErrNotFound、
// 値が既に別のアクティブユーザーに使われていれば repository.ErrEmailTaken を返す。
func (r *userRepository) UpdateEmail(ctx context.Context, userID uint64, email string) error {
	id64, ok := toInt64ID(userID)
	if !ok {
		return domain.ErrNotFound // 存在し得ない id = not found
	}
	q := r.queries(ctx)
	affected, err := q.UpdateUserEmail(ctx, sqlcgen.UpdateUserEmailParams{ID: id64, Email: email})
	if err != nil {
		if isUniqueViolation(err) {
			return repository.ErrEmailTaken
		}
		return err
	}
	if affected == 0 {
		return domain.ErrNotFound
	}
	return nil
}
