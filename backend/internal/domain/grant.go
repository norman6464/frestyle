package domain

import "time"

// GrantRole は grant（既定の権限）で与える役割。workspace_grants と space_grants が共有する。
// 「この入れ物で何ができるか」を入れ物ごとに持つ権限モデルで、グローバルなロールとは独立。
// ナレッジの権限は principals / grants だけで閉じており、「特権ロールなら全部見える」という
// 抜け道は解決ロジックに持たせない。
type GrantRole string

const (
	// GrantRoleAdmin は管理者。閲覧・編集に加えて権限そのものを変えられる。
	GrantRoleAdmin GrantRole = "admin"
	// GrantRoleEditor は閲覧と編集ができる。
	GrantRoleEditor GrantRole = "editor"
	// GrantRoleCommenter は閲覧とコメントができる。
	GrantRoleCommenter GrantRole = "commenter"
	// GrantRoleViewer は閲覧だけができる。
	GrantRoleViewer GrantRole = "viewer"
)

// ValidGrantRoles は grant に保存を許す役割の一覧（強い順）。
var ValidGrantRoles = []GrantRole{
	GrantRoleAdmin,
	GrantRoleEditor,
	GrantRoleCommenter,
	GrantRoleViewer,
}

// Valid は既知の役割かを返す（保存前の検証に使う）。
func (r GrantRole) Valid() bool {
	for _, v := range ValidGrantRoles {
		if v == r {
			return true
		}
	}
	return false
}

// Rank は役割の強さ（大きいほど強い）。未知の値は 0。
//
// 1 人は複数の経路（自分 / 所属グループ / スペース全員 / ワークスペースの grant）で役割を
// 得ることがあり、採るのは常に最も強いもの — これが唯一の合成規則。順序に依存させると
// grant を張った順で結果が変わり説明できなくなるし、弱める規則にするとワークスペース管理者を
// スペース単位の grant で降格できてしまい「テナント全体の管理者」が成り立たない。
//
// 弱める手段はどの層にも無い。付与は足し算だけで、下の段が上の段を打ち消すことはない
// （理由は PagePermissionFacts の doc も参照）。
func (r GrantRole) Rank() int {
	switch r {
	case GrantRoleAdmin:
		return 4
	case GrantRoleEditor:
		return 3
	case GrantRoleCommenter:
		return 2
	case GrantRoleViewer:
		return 1
	default:
		return 0
	}
}

// GrantRoleByRank は Rank の逆写像。既知の強さなら対応する役割を、そうでなければ nil を返す。
// DB 側で「最も強い役割」を強さ（整数）として受け取り役割へ戻すのに使う — text で返すと
// 「grant が無い」が NULL になり生成コードの型付けが崩れるため、整数で受けてここで変換する。
func GrantRoleByRank(rank int) *GrantRole {
	for _, r := range ValidGrantRoles {
		if r.Rank() == rank {
			role := r
			return &role
		}
	}
	return nil
}

// StrongestGrantRole は複数の経路で得た役割のうち最も強いものを返す（無ければ nil）。
// 「採るのは最も強いもの」という合成規則を Go 側で適用する唯一の関数 — 事実（どの役割を持つか）
// は SQL が集め、畳み方はここで決める。規則を SQL に写すと片方だけ直したときに経路ごとのずれ
// （1 ページは編集できるのに直下にページを作れない、等）が起きる。
//
// ページ 1 枚 / ページ一覧の経路だけは SQL が役割の集合ではなく強さ（整数）を返す（1 リクエストで
// 多数のページを集約するため）。強さから役割へは GrantRoleByRank で戻し、両経路の答えの一致は
// 結合テストで固定する。
func StrongestGrantRole(roles []GrantRole) *GrantRole {
	var strongest *GrantRole
	for _, r := range roles {
		if r.Rank() == 0 {
			continue
		}
		if strongest == nil || r.Rank() > strongest.Rank() {
			role := r
			strongest = &role
		}
	}
	return strongest
}

// CanView は既定でページを閲覧できる役割かを返す。
func (r GrantRole) CanView() bool { return r.Rank() >= GrantRoleViewer.Rank() }

// CanComment は既定でコメントできる役割かを返す。
func (r GrantRole) CanComment() bool { return r.Rank() >= GrantRoleCommenter.Rank() }

// CanEdit は既定でページを編集できる役割かを返す。
func (r GrantRole) CanEdit() bool { return r.Rank() >= GrantRoleEditor.Rank() }

// CanManage は権限そのもの（grant）を変えられる役割かを返す。
func (r GrantRole) CanManage() bool { return r.Rank() >= GrantRoleAdmin.Rank() }

// WorkspaceGrant はワークスペース全体での既定の権限。配下の全スペースに効く。
// スペース単位の grant だけでは「テナント全体の管理者」を表すのにスペースの数だけ grant を
// 張ることになり漏れるため、入れ物の階層（workspace ⊃ space）に合わせ既定も 2 段で持つ。
type WorkspaceGrant struct {
	WorkspaceID string    `json:"workspaceId"`
	PrincipalID string    `json:"principalId"`
	Role        GrantRole `json:"role"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// SpaceGrant はスペースでの既定の権限。同じ主体がひとつのスペースで持つ役割は 1 つだけ
// （DB の PK が (workspace_id, space_id, principal_id)）。
type SpaceGrant struct {
	// WorkspaceID はテナント境界。principal との複合 FK に使う。
	WorkspaceID string    `json:"workspaceId"`
	SpaceID     string    `json:"spaceId"`
	PrincipalID string    `json:"principalId"`
	Role        GrantRole `json:"role"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
