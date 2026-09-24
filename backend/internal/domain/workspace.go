package domain

import "time"

// Workspace はナレッジのテナント境界。配下の space / page / block はすべて workspace_id を持ち、
// 複合 FK で「別テナントの行を親にできない」ことを DB 側で保証する。
//
// スキーマの正本は infra/database/schema/knowledge_base.sql。ID は推測不能な UUID
// （採番は repository 層で UUIDv7）。
type Workspace struct {
	ID string `json:"id"`
	// Slug は URL に出る短い識別子（テナント内ではなくグローバルに一意）。
	Slug string `json:"slug"`
	Name string `json:"name"`
	// IsActive はテナントが利用可能か。false にすると所属する全員が API を使えなくなる
	// （middleware が入口で弾く）。停止の唯一の表現。
	IsActive  bool      `json:"isActive"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// MemberWorkspace はワークスペースと、そのユーザーから見た実効権限の組。
//
// Permission はワークスペースそのものに対する実効権限（ResolveScopePermission の結果）。
// 削除（CanManage）やチケットの作成（CanEdit）の入口で 1 件ずつ確かめる判定と同じ値で、
// 一覧の段階で操作の出し分けに使う。スペースやページの可否ではない（あちらは入れ物ごとの
// 付与で広がる・狭まる）。
type MemberWorkspace struct {
	Workspace
	Permission ScopePermission
}

// WorkspaceMember はワークスペースに属する人 1 人。
//
// GrantablePrincipal とは用途が別で、こちらは人だけを返す。あちらは権限を張る相手なので
// グループやスペース全員のような人でない主体も含み、閲覧にページの管理権限を要求する。
// 担当の表示名を出すことと発言で人を名指すことは権限を変えられない人にも要るので、
// 所属していれば読める口を別に持つ。
//
// PrincipalID と UserID の両方を持つのは指す先が用途で違うため。担当は principals に割り当てる
// ので PrincipalID、発言中の名指しは users を指すので UserID を使う。
type WorkspaceMember struct {
	PrincipalID string `json:"principalId"`
	UserID      uint64 `json:"userId"`
	// Name は表示名。空文字のことがある（登録時に名前を持たない発行者があるため）。
	Name string `json:"name"`
	// AvatarURL / StatusMessage は profiles 由来（段 5）。設定していなければ空文字。
	AvatarURL     string `json:"avatarUrl"`
	StatusMessage string `json:"status"`
}

// AdminWorkspaceMember はメンバー管理画面（段 7）向けの 1 人。WorkspaceMember と違い、
// 停止中のアカウントも含み（復帰操作の対象になるため）、ワークスペース全体の役割も返す。
type AdminWorkspaceMember struct {
	PrincipalID string `json:"principalId"`
	UserID      uint64 `json:"userId"`
	Name        string `json:"name"`
	// AccountStatus はアカウント全体の状態。ここに deactivated は現れない —
	// 退会は全ワークスペースを退出してから起きるため、この一覧に載る時点で対象外になっている。
	AccountStatus UserStatus `json:"accountStatus"`
	AvatarURL     string     `json:"avatarUrl"`
	StatusMessage string     `json:"statusMessage"`
	// Role はワークスペース全体の既定役割。nil は「スペース/ページ単位の grant だけで
	// 見えている」ことを表す。
	Role *GrantRole `json:"role,omitempty"`
}

// SpaceMember はスペースに届いている権限を人に解決した 1 行（段 9）。同じ人が複数経路
// （本人・所属グループ・スペース全員・ワークスペース全体）から役割を得ることがあり、
// 採用するのは最も強い役割（GrantRole.Rank、ここでも弱める規則は無い）。
type SpaceMember struct {
	UserID    uint64    `json:"userId"`
	Name      string    `json:"name"`
	AvatarURL string    `json:"avatarUrl"`
	Role      GrantRole `json:"role"`
	// Via はその役割が届いた経路（"direct" 本人 / "group" グループ・スペース全員 /
	// "workspace" ワークスペース全体からの継承）。同じ強さの役割が複数経路から届く場合は
	// direct > group > workspace の優先度で選ぶ。
	Via string `json:"via"`
}

// MySpace は自分がこのワークスペース内でアクセスできるスペース 1 件（段 14。GET /me/spaces 用）。
// SpaceMember の向きを逆にしたもの — 1 人が複数スペースから得る役割を、スペースごとに
// 最も強い役割へ集約する（SpaceMember と同じ Rank 規則）。
type MySpace struct {
	ID   string    `json:"id"`
	Name string    `json:"name"`
	Role GrantRole `json:"role"`
}

// WorkspaceSlugMaxLen / WorkspaceNameMaxLen は workspaces の列幅（varchar(64) / varchar(200)）。
// DB の CHECK / 列幅と同じ値を入口でも見て、桁あふれを 500 ではなく 400 で返せるようにする。
const (
	WorkspaceSlugMaxLen = 64
	WorkspaceNameMaxLen = 200
)

// ValidWorkspaceSlug は URL に出せる slug かを返す。小文字英数字とハイフンだけに絞り、先頭と
// 末尾は英数字に限る — 大文字や記号を許すと「同じに見えて別のワークスペース」（Acme と acme）が
// 作れてしまう。長さの上限は DB の CHECK と同じ。
func ValidWorkspaceSlug(slug string) bool {
	return validURLKey(slug, WorkspaceSlugMaxLen)
}

// validURLKey は URL に出る識別子（workspaces.slug / spaces.key）の共通の形。
// 空でなく、[a-z0-9-] だけからなり、先頭・末尾がハイフンでないこと。
func validURLKey(s string, maxLen int) bool {
	if s == "" || len(s) > maxLen {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z', c >= '0' && c <= '9':
		case c == '-':
			if i == 0 || i == len(s)-1 {
				return false
			}
		default:
			return false
		}
	}
	return true
}
