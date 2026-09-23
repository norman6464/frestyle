package repository

import (
	"context"
	"errors"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// ErrInvitationNotFound は対象の招待が無い・別ワークスペースのもの・宛先が違う、のどれかで返す
// （どれなのかは伝えない。招待の id や宛先の実在を探れる口にしないため）。
var ErrInvitationNotFound = errors.New("invitation not found")

// ErrInvitationNotOpen は結果（承諾・辞退・取消）が出ている、または期限切れで、
// その操作ができないときに返す。
var ErrInvitationNotOpen = errors.New("invitation is no longer open")

// ErrInvitationResendTooSoon は前回の送信から再送の間隔（usecase の定数）が空いていないときに返す。
var ErrInvitationResendTooSoon = errors.New("invitation was sent too recently")

// ErrInvitationScopeUnsupported はスペース宛・ページ宛の承諾を求められたときに返す
// （ゲストの付与はまだ実装していない。承諾を途中まで進めて所属だけ作るような事故を避けるため、
// 承諾の入口で断る）。
var ErrInvitationScopeUnsupported = errors.New("invitation scope is not supported yet")

// InvitationWrite は招待の発行（または同じ宛先 × 場所への再送）に渡す値。
type InvitationWrite struct {
	WorkspaceID string
	Scope       domain.InvitationScope
	// SpaceID / PageID は Scope に応じてどちらか一方だけ入る（workspace 宛はどちらも nil）。
	SpaceID *string
	PageID  *string
	Role    domain.GrantRole
	// Email は正規形（domain.ParseInvitationEmail の戻り）。
	Email       string
	InviteeName string
	// TokenHash は招待 URL のトークンの SHA-256（32 バイト）。平文は渡さない。
	TokenHash []byte
	// ActorUserID は実行者。新規なら invited_by_user_id と last_sent_by_user_id の両方、
	// 再送なら last_sent_by_user_id だけになる。
	ActorUserID uint64
	ExpiresAt   time.Time
	// SentBefore は「これより後に送っていたら再送しない」境界（now - 再送間隔）。
	// 間隔の定数を usecase の 1 か所に置くため、時刻で受ける。
	SentBefore time.Time
}

// InvitationRefresh は再送（トークン差し替え・期限延長）に渡す値。
type InvitationRefresh struct {
	WorkspaceID  string
	InvitationID string
	TokenHash    []byte
	ExpiresAt    time.Time
	SentBefore   time.Time
	ActorUserID  uint64
}

// InvitationRepository は招待（invitations）へのアクセスを提供する。
//
// KnowledgeBasePermissionRepository から分けているのは、招待が権限モデルの表を承諾の瞬間にしか
// 触らないため。その承諾（Accept）だけは所属・主体・付与・監査を 1 トランザクションで書く。
type InvitationRepository interface {
	// Upsert は招待を発行する。同じ宛先 × 場所に未決の行があれば、その行を再送として更新する
	// （呼び出し側は新規か再送かを区別しなくてよい）。再送の間隔が空いていなければ
	// ErrInvitationResendTooSoon。
	Upsert(ctx context.Context, in InvitationWrite) (*domain.Invitation, error)
	// Refresh は未決の招待のトークンを差し替えて期限を延ばす（再送）。
	// 無い・別ワークスペースなら ErrInvitationNotFound、結果が出ていれば ErrInvitationNotOpen、
	// 間隔が空いていなければ ErrInvitationResendTooSoon。
	Refresh(ctx context.Context, in InvitationRefresh) (*domain.Invitation, error)
	// Find はワークスペースで絞って 1 件引く（admin 側の操作の対象確認）。無ければ ErrInvitationNotFound。
	Find(ctx context.Context, workspaceID, invitationID string) (*domain.Invitation, error)
	// FindByID は id だけで 1 件引く（招かれた側の操作。宛先の照合は呼び出し側）。無ければ ErrInvitationNotFound。
	FindByID(ctx context.Context, invitationID string) (*domain.Invitation, error)
	// FindDetailByTokenHash はトークンの SHA-256 から、案内に要る周辺情報つきで引く。
	// 期限・結果の判定は呼び出し側。無ければ ErrInvitationNotFound。
	FindDetailByTokenHash(ctx context.Context, tokenHash []byte) (*domain.InvitationDetail, error)
	// ListByWorkspace はワークスペースの招待を新しい順で返す（結果が出たものも含む）。
	ListByWorkspace(ctx context.Context, workspaceID string, limit int) ([]domain.InvitationDetail, error)
	// ListOpenByEmail はその宛先（正規形）の未決かつ期限内の招待を、全ワークスペース横断で新しい順に返す。
	ListOpenByEmail(ctx context.Context, email string) ([]domain.InvitationDetail, error)
	// Accept は承諾する。招待の宛先と email（正規形）が一致しなければ ErrInvitationNotFound、
	// 未決かつ期限内でなければ ErrInvitationNotOpen。ワークスペース宛なら所属（active）・主体・
	// 役割の付与・監査の記録を同じトランザクションで作る。スペース宛 / ページ宛は
	// ErrInvitationScopeUnsupported。
	Accept(ctx context.Context, invitationID string, userID uint64, email string) (*domain.Invitation, error)
	// Decline は辞退する。宛先が違えば ErrInvitationNotFound、結果が出ていれば ErrInvitationNotOpen
	// （期限切れは辞退できる）。
	Decline(ctx context.Context, invitationID string, userID uint64, email string) error
	// Revoke は admin が取り消す。取消済みなら何もしない（冪等）。承諾・辞退済みなら
	// ErrInvitationNotOpen、無い・別ワークスペースなら ErrInvitationNotFound。
	Revoke(ctx context.Context, workspaceID, invitationID string, actorUserID uint64) error
	// CountOpenInWorkspace はワークスペースの未決かつ期限内の件数。
	CountOpenInWorkspace(ctx context.Context, workspaceID string) (int64, error)
	// CountSentBySince はその人が since 以降に届けた件数（発行も再送も）。
	CountSentBySince(ctx context.Context, userID uint64, since time.Time) (int64, error)
	// CountSentToEmailSince はその宛先へ since 以降に届けた件数（全ワークスペース横断）。
	CountSentToEmailSince(ctx context.Context, email string, since time.Time) (int64, error)
}
