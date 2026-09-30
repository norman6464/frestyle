package domain

// ScopeFacts は入れ物（ワークスペース / スペース）1 つの実効権限を決めるのに必要な事実。
// ページを介さない判定に使う。「スペース直下にページを作る」「スペースを作る」のように対象が
// まだ存在しない操作は、ページ 1 枚の権限では判断できず、かといって「メンバーなら誰でもできる」
// で埋めるとあとから締められない穴になるため、入れ物そのものに対する既定の役割で決める。
//
// PagePermissionFacts とは別の型にする。あちらは所属（Member）とページの公開範囲も持ち、
// ページ 1 枚に対する答えを出すための事実。こちらは入れ物 1 つに届いている役割の集合だけ。
type ScopeFacts struct {
	// Roles は自分に効く主体（自分 / 所属グループ / スペース全員）が、その入れ物に届く grant
	// から得た役割すべて（重複・順序に意味は無い、1 つも無ければ空）。「最も強いものを採る」
	// という合成規則はここには入れず、ResolveScopePermission（＝ StrongestGrantRole）だけが持つ。
	Roles []GrantRole
}

// ScopePermission は入れ物（ワークスペース / スペース）に対する実効権限。
//
// **ページの公開範囲（visibility='private'）は見ていない。** ページを名指しする操作の可否を
// これで決めてはいけない（作成者以外に見せないページを取りこぼし、広い側へ倒れる）。ページには
// ResolvePagePermission を使い、こちらは対象がまだ無い操作（スペース直下への作成 / スペースの
// 作成）にだけ使う。
type ScopePermission struct {
	CanView bool `json:"canView"`
	// CanComment は入れ物の中身に既定でコメントできるか。閲覧と編集のあいだにある唯一の段
	// （commenter は中身を変えられないが会話には加われる）。Capability には入れない
	// （あちらは閲覧 / 編集だけを表す。コメントは役割の写像で決める）。
	CanComment bool `json:"canComment"`
	// CanEdit は入れ物の中身を既定で編集できるか（＝ 直下にページを作れるか）。
	CanEdit bool `json:"canEdit"`
	// CanManage は入れ物そのものの構成（配下のスペース / 権限）を変えられるか。
	CanManage bool `json:"canManage"`
}

// Allows は実効権限が指定のケイパビリティを満たすかを返す。
func (p ScopePermission) Allows(c Capability) bool {
	if c == CapabilityEdit {
		return p.CanEdit
	}
	return p.CanView
}

// ResolveScopePermission は集めた事実から入れ物 1 つの実効権限を決める。既定の役割から
// ケイパビリティへの写像は roleAllows を通す（ページ 1 枚の解決と同じ実装）。ここに if 文で
// 「admin なら〜」を書き足すと、同じ役割の意味がページと入れ物で食い違う余地ができる。
func ResolveScopePermission(f ScopeFacts) ScopePermission {
	role := StrongestGrantRole(f.Roles)
	return ScopePermission{
		CanView: roleAllows(role, CapabilityView),
		// コメントと構成変更は Capability を経由しない（Capability は閲覧 / 編集だけを表す）。
		// 役割の写像そのもの（GrantRole.CanComment / CanManage）を呼び、ここに判定を書き写さない。
		CanComment: role != nil && role.CanComment(),
		CanEdit:    roleAllows(role, CapabilityEdit),
		CanManage:  role != nil && role.CanManage(),
	}
}
