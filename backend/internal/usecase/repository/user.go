// Package repository は usecase 層が依存する永続化境界（port）を定義する。
// 実装は adapter/persistence 配下で提供される（依存方向: usecase ← persistence、DIP）。
package repository

import (
	"context"
	"errors"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// ErrEmailTaken は作成しようとした email が既に別のアクティブユーザーに使われているときに返す
// （uq_users_email_active）。同時サインアップ・招待の二重受諾で起き得る。
var ErrEmailTaken = errors.New("email is already used by another active user")

// UserRepository は users テーブルへのアクセスを提供する。
type UserRepository interface {
	FindByOidcSubject(ctx context.Context, sub string) (*domain.User, error)
	// OidcSubjectByUserID はユーザーの既定 provider（domain.OidcProviderDefault）の OIDC subject を
	// 返す。無ければ ("", nil)。
	OidcSubjectByUserID(ctx context.Context, userID uint64) (string, error)
	FindByID(ctx context.Context, id uint64) (*domain.User, error)
	// FindDisplayByID は表示に要る最小限（表示名・アイコン・状態メッセージ）を返す。FindByID と違い
	// 退会・停止していても解決する（過去の記録の投稿者表示を壊さないため）。見つからなければ (nil, nil)。
	FindDisplayByID(ctx context.Context, id uint64) (*domain.UserDisplay, error)
	// Create は users 行を 1 件作る。OIDC identity と不可分に作る場合は、呼び出し側が
	// TxManager.DoInTx の中で UserOidcIdentityRepository.EnsureIdentity と併せて呼ぶ。
	Create(ctx context.Context, user *domain.User) error
	// UpdateActive はユーザーアカウントの有効/無効を更新する（false で無効化 → 利用不可）。
	UpdateActive(ctx context.Context, userID uint64, active bool) error
	// SoftDelete はユーザーを退会させる（deactivated にし deleted_at を立てる。認証時にも除外される）。
	SoftDelete(ctx context.Context, userID uint64) error
	// UpdateName は氏名変更、および OIDC ログイン時の name 自動補正で呼ばれる。
	UpdateName(ctx context.Context, userID uint64, name string) error
	// UpdateEmail は email だけを更新する。email_verified を確認できたログインで、それまで
	// email を持たなかったユーザーへ後から付ける場合に呼ぶ。使用済みの値なら ErrEmailTaken。
	UpdateEmail(ctx context.Context, userID uint64, email string) error
	// FindActiveIDByEmail は正規形（domain.NormalizeEmail）の email から、退会していないユーザーの
	// id を引く。無ければ found=false（エラーではない）。招待で「相手に既にアカウントがあるか」を
	// 知るための口で、users の一意索引 uq_users_email_active と同じ式で引く。
	FindActiveIDByEmail(ctx context.Context, email string) (id uint64, found bool, err error)
}
