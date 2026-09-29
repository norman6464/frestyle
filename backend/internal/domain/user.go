package domain

import "time"

// UserStatus はユーザーアカウントの状態。
type UserStatus string

const (
	UserStatusActive UserStatus = "active"
	// UserStatusSuspended は運営判断で一時的に止めた状態。本人の操作では戻せない。
	UserStatusSuspended UserStatus = "suspended"
	// UserStatusDeactivated は退会済み。実際の退会は匿名化で扱い、物理削除はしない
	// （users.id を指す記録列の FK が RESTRICT のため、DB 側でも禁じられている）。
	UserStatusDeactivated UserStatus = "deactivated"
)

// User はアプリケーション利用者のドメインモデル。
//
// 所属ワークスペースへの参照はここには無い。1 人が複数のワークスペースに所属できるため、
// 所属は workspace_members が正本で持つ（usecase/kb.ListMemberWorkspacesUseCase 等）。
type User struct {
	ID    uint64 `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
	// Status はアカウントの状態。deactivated のときだけ DeletedAt が非 nil になる
	// （DB の ck_users_status_deleted_at が両者の整合を縛る）。
	Status    UserStatus `json:"status"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
	DeletedAt *time.Time `json:"deletedAt,omitempty"`
}

// IsActive はアカウントが通常どおり利用できる状態かを返す。false ならログイン/利用不可になる
// （middleware で弾く）。
func (u User) IsActive() bool { return u.Status == UserStatusActive }

// UserDisplay は人を表示するのに要る最小限（id・表示名・アイコン・状態メッセージ）。
//
// チケットの作成者・変更履歴の実行者・発言の投稿者・ページの最終編集者・共有候補・メンバー一覧、
// どの読み取り経路もこれへ集約する（画面ごとに users / profiles を別々に JOIN すると、
// 一方だけアイコンが出せない・フィルタ条件がずれるという事故を生む）。
//
// 過去の記録（コメント・変更履歴）は投稿者が退会・停止した後も表示できる必要があるため、
// これ自体は現在のアカウント状態で絞り込まない。「今選べる相手か」の判定は
// ListWorkspaceMembers が別に持つ。
type UserDisplay struct {
	UserID uint64 `json:"userId"`
	Name   string `json:"name"`
	// AvatarURL は profiles.avatar_url。設定していなければ空文字。
	AvatarURL string `json:"avatarUrl"`
	// StatusMessage は profiles.status_emoji + status_text を結合した一言
	// （domain.ComposeStatusDisplay 参照。失効していれば空文字）。
	StatusMessage string `json:"status"`
}

// UserIdentity は本人の認証方法 1 件（段 14。プロフィール画面向け、自分にしか返さない）。
// 現状は OIDC のみだが provider を持つのはログイン経路の追加ではなく表示のため。
type UserIdentity struct {
	Provider  string    `json:"provider"`
	Subject   string    `json:"subject"`
	CreatedAt time.Time `json:"createdAt"`
}
