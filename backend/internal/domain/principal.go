package domain

import "time"

// PrincipalKind は principals.kind に入る主体の種類。
//
// ユーザー・グループ・スペース全員は「権限を与える相手」という点で同じなので
// 1 つの表にまとめる。grant 側は主体の種類を知らずに 1 本の FK で参照でき、権限を解く SQL が
// 主体の種類だけ分岐することもない。
type PrincipalKind string

const (
	// PrincipalKindUser は 1 人のユーザー（users.id）。ワークスペース所属はこの行の有無で表す。
	PrincipalKindUser PrincipalKind = "user"
	// PrincipalKindGroup は名前を持つユーザーの束。所属は principal_members が持つ。
	PrincipalKindGroup PrincipalKind = "group"
	// PrincipalKindSpaceAll はそのスペースの全メンバー。「既定でチーム全員が編集できる」を
	// 1 行の grant で表すために使う。
	PrincipalKindSpaceAll PrincipalKind = "space_all"
)

// ValidPrincipalKinds は principals.kind に保存を許す値の一覧。
var ValidPrincipalKinds = []PrincipalKind{
	PrincipalKindUser,
	PrincipalKindGroup,
	PrincipalKindSpaceAll,
}

// Valid は既知の主体種別かを返す（保存前の検証に使う）。
func (k PrincipalKind) Valid() bool {
	for _, v := range ValidPrincipalKinds {
		if v == k {
			return true
		}
	}
	return false
}

// Principal は権限を与える相手（主体）。使うフィールドは Kind で決まり、DB 側も CHECK で
// 「その kind のときだけ非 NULL」を強制する（kind='user' なら UserID だけ、kind='space_all' なら
// SpaceID だけ、kind='group' なら Name だけが埋まる）。任意の key/value に逃がす形（EAV）は取らない。
type Principal struct {
	ID string `json:"id"`
	// WorkspaceID はテナント境界。grant からの複合 FK の参照先にもなり、別ワークスペースの
	// 主体へ権限を張ることを DB が弾く。
	WorkspaceID string        `json:"workspaceId"`
	Kind        PrincipalKind `json:"kind"`
	// UserID は Kind が user のときの users.id。それ以外は nil。
	UserID *uint64 `json:"userId,omitempty"`
	// SpaceID は Kind が space_all のときの対象スペース。それ以外は nil。
	SpaceID *string `json:"spaceId,omitempty"`
	// Name は Kind が group のときの表示名。それ以外は空文字（ユーザー名は users、スペース名は
	// spaces が正本で、ここへは写さない）。
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
