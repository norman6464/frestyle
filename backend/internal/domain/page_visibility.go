package domain

// PageVisibility はページの公開範囲。バイラインの公開範囲バッジの元になる。
//
// 'public' と 'space' は閲覧可否（grants の解決）を一切変えない — 表示上の区別でしかない。
// **'private' だけが唯一の例外で、作成者以外には既存の付与を問わず一切見せない。**
// 「打ち消す層は持たない」という grants の原則（ResolvePagePermission 参照）の外にある、
// 段 13 で意図して足した唯一の例外。スペース / ワークスペースの管理者を含め、
// 作成者本人でなければ閲覧・編集・コメントのいずれも届かない。
type PageVisibility string

const (
	PageVisibilityPublic  PageVisibility = "public"
	PageVisibilitySpace   PageVisibility = "space"
	PageVisibilityPrivate PageVisibility = "private"
)

// ValidPageVisibility は保存してよい visibility の値かを返す。
func ValidPageVisibility(v PageVisibility) bool {
	return v == PageVisibilityPublic || v == PageVisibilitySpace || v == PageVisibilityPrivate
}
