package domain

import "errors"

// PageMaxDepth はフロントエンドの MAX_TREE_DEPTH（entities/kb/lib/tree.ts）と揃えた上限。
// ルートを1段目とし、301段目の保存を防ぐ。
const PageMaxDepth = 300

// errorはGoの定数にできないためvarを使う。errors.Newで作った同じ値を共有し、
// 呼び出し元がerrors.Isでエラーの種類を判別できるようにする。
var (
	ErrPageDepthExceeded = errors.New("page hierarchy depth exceeded")
	ErrPageCycle         = errors.New("cannot move a page under itself or its descendant")
)

// ValidatePageDepth は作成・移動後の最深ページを検査する。
// parentDepth は親の段数（親なしは0）、subtreeHeight は自分から最深の子孫までの距離。
func ValidatePageDepth(parentDepth, subtreeHeight int32) error {
	if parentDepth < 0 || subtreeHeight < 0 || int64(parentDepth)+1+int64(subtreeHeight) > PageMaxDepth {
		return ErrPageDepthExceeded
	}
	return nil
}
