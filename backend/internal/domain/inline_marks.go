package domain

// ColoredInlineMarkTypes は attrs.color を持つインラインのマーク（文字色・蛍光ペン）の種類名。
// 値は ProseMirror（tiptap）のマーク名そのもの。保存時に color を許可リストで検査する対象。
var ColoredInlineMarkTypes = []string{"textStyle", "highlight"}

// InlineMarkColorNames は文字色・蛍光ペンに許す色の名前。生の色コード（hex）や CSS の値は
// 受け付けない。書いた人の選んだ値がそのまま全員の画面に流れないよう、名前だけを保存し、
// 実際の色は画面側の決まった色（トークン）に対応づける。
//
// 名前を足すときは contracts/kb-inline-attrs.json も直す（突き合わせのテストが inline_marks_test.go
// にある。frontend も同じファイルを読む）。
var InlineMarkColorNames = []string{"red", "orange", "yellow", "green", "blue", "purple", "pink", "gray"}

var (
	coloredInlineMarkTypeSet = toSet(ColoredInlineMarkTypes)
	inlineMarkColorSet       = toSet(InlineMarkColorNames)
)

func toSet(names []string) map[string]struct{} {
	set := make(map[string]struct{}, len(names))
	for _, name := range names {
		set[name] = struct{}{}
	}
	return set
}

// IsColoredInlineMark は、そのマークが attrs.color を持つ（検査の対象になる）種類かを返す。
func IsColoredInlineMark(markType string) bool {
	_, ok := coloredInlineMarkTypeSet[markType]
	return ok
}

// IsInlineMarkColor は許した色の名前かを返す（大文字・空白の違いは許さない）。
func IsInlineMarkColor(name string) bool {
	_, ok := inlineMarkColorSet[name]
	return ok
}
