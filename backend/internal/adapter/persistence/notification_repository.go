package persistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/norman6464/frestyle/backend/internal/adapter/persistence/sqlcgen"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// notificationRepository は [repository.NotificationRepository] の実装。
// クエリは sqlc 生成コード（生 SQL）で、接続プール（*sql.DB）をそのまま受け取る。
type notificationRepository struct{ baseRepository }

func NewNotificationRepository(db *sql.DB) repository.NotificationRepository {
	return &notificationRepository{baseRepository{db: db}}
}

func (r *notificationRepository) Create(ctx context.Context, n *domain.Notification) error {
	uid, ok := toInt64ID(n.UserID)
	if !ok {
		// 1 行も書けていないので nil を返さない（呼び出し側が作成できたと誤認する）。
		return outOfRangeIDError("user_id", n.UserID)
	}
	createdAt := n.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now()
	}
	row, err := sqlcgen.New(r.dbtx(ctx)).InsertNotification(ctx, sqlcgen.InsertNotificationParams{
		UserID:    uid,
		Type:      n.Type,
		Title:     n.Title,
		Body:      n.Body,
		IsRead:    n.IsRead,
		LinkPath:  n.LinkPath,
		CreatedAt: createdAt,
	})
	if err != nil {
		return err
	}
	n.ID = uint64(row.ID)
	n.CreatedAt = row.CreatedAt
	return nil
}

// createManyItem は json_to_recordset に渡す 1 行分。キー名は SQL 側の列名と一致させる。
type createManyItem struct {
	UserID   uint64 `json:"user_id"`
	Type     string `json:"type"`
	Title    string `json:"title"`
	Body     string `json:"body"`
	IsRead   bool   `json:"is_read"`
	LinkPath string `json:"link_path"`
}

// CreateMany は複数件を 1 回の INSERT でまとめて作成する。
// 宛先が 1 人増えるごとに DB との往復が 1 回増える形だと件数に比例して遅くなるため、
// json 配列 1 個を渡して json_to_recordset で展開し 1 文にまとめる。
func (r *notificationRepository) CreateMany(ctx context.Context, ns []domain.Notification) error {
	if len(ns) == 0 {
		return nil // 宛先 0 件は何もしない（呼び出し側で件数を気にしなくてよいように）
	}
	items := make([]createManyItem, 0, len(ns))
	for _, n := range ns {
		items = append(items, createManyItem{
			UserID:   n.UserID,
			Type:     n.Type,
			Title:    n.Title,
			Body:     n.Body,
			IsRead:   n.IsRead,
			LinkPath: n.LinkPath,
		})
	}
	itemsJSON, err := json.Marshal(items)
	if err != nil {
		return err
	}
	return sqlcgen.New(r.dbtx(ctx)).CreateNotifications(ctx, itemsJSON)
}

func (r *notificationRepository) ListByUserID(ctx context.Context, userID uint64) ([]domain.Notification, error) {
	uid, ok := toInt64ID(userID)
	if !ok {
		return []domain.Notification{}, nil // 存在し得ない user_id = 0 件
	}
	rows, err := sqlcgen.New(r.dbtx(ctx)).ListNotificationsByUserID(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]domain.Notification, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.Notification{
			ID:        uint64(row.ID),
			UserID:    uint64(row.UserID),
			Type:      row.Type,
			Title:     row.Title,
			Body:      row.Body,
			IsRead:    row.IsRead,
			LinkPath:  row.LinkPath,
			CreatedAt: row.CreatedAt,
		})
	}
	return out, nil
}

// MarkRead は id と user_id の両方で絞って 1 件を既読化する。
func (r *notificationRepository) MarkRead(ctx context.Context, userID, id uint64) error {
	uid, ok := toInt64ID(userID)
	if !ok {
		return domain.ErrNotFound // 存在し得ない user_id = 対象なし
	}
	nid, ok := toInt64ID(id)
	if !ok {
		return domain.ErrNotFound // 存在し得ない id = 対象なし
	}
	// :execrows なので実際に書き換わった行数が返る（:exec だと 0 行でも成功と区別が付かない）。
	affected, err := sqlcgen.New(r.dbtx(ctx)).MarkNotificationRead(ctx, sqlcgen.MarkNotificationReadParams{
		ID:     nid,
		UserID: uid,
	})
	if err != nil {
		return err
	}
	if affected == 0 {
		return domain.ErrNotFound // 他人の通知もここに落ちる（存在しない id と同じ結末）
	}
	return nil
}

// MarkAllRead は current user の未読通知をまとめて既読化する。
//
// ここだけは 0 件を not-found にしない。単一行を狙う MarkRead と違い、これは
// 「その user の未読を全部畳む」一括操作で、0 件は「未読が 1 件も無かった」という正常な結果。
// not-found にすると、未読が無い状態で「すべて既読にする」を押しただけで 404 が返る。
func (r *notificationRepository) MarkAllRead(ctx context.Context, userID uint64) error {
	uid, ok := toInt64ID(userID)
	if !ok {
		return nil // 存在し得ない user_id = 未読 0 件と同じ（一括操作なので 0 件で正常）
	}
	return sqlcgen.New(r.dbtx(ctx)).MarkAllNotificationsRead(ctx, uid)
}

func (r *notificationRepository) CountUnread(ctx context.Context, userID uint64) (int64, error) {
	uid, ok := toInt64ID(userID)
	if !ok {
		return 0, nil
	}
	return sqlcgen.New(r.dbtx(ctx)).CountUnreadNotifications(ctx, uid)
}

// stubPushPublisher は [repository.PushPublisher] の no-op 実装（本番実装は別 PR）。
type stubPushPublisher struct{}

func NewStubPushPublisher() repository.PushPublisher { return &stubPushPublisher{} }

func (p *stubPushPublisher) Publish(_ context.Context, _ uint64, _, _ string) error { return nil }
