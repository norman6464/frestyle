package domain

import (
	"encoding/json"
	"errors"
	"math"
	"strings"
	"time"
)

// ErrInvalidCommentBody は comments.body に保存できない形（JSON 配列でない・空配列）のとき返す。
// handler は 400 invalid_request にマップする。
var ErrInvalidCommentBody = errors.New("invalid comment body")

// ErrInvalidCommentAnchor は錨（block_id / anchor_from / anchor_to / quote）の組み合わせが
// 不正なとき返す（段 3）。handler は 400 invalid_comment_anchor にマップする。
var ErrInvalidCommentAnchor = errors.New("invalid comment anchor")

// CommentAnchorMaxQuoteLen は quote に許す最大バイト数。バブルメニューからの引用は通常短いが、
// 極端に長い選択をそのまま保存させないための上限。
const CommentAnchorMaxQuoteLen = 2000

// CommentThread はページ全体、またはページ内の特定ブロック・特定文字範囲（錨）に
// 付いたコメントのスレッド。
//
// BlockID / AnchorFrom / AnchorTo / Quote は 4 つとも nil（page-level）か、4 つとも
// 非 nil（錨付き）のどちらか — ValidateCommentAnchor がこの不変条件を守る。
type CommentThread struct {
	ID          string  `json:"id"`
	WorkspaceID string  `json:"-"`
	PageID      string  `json:"-"`
	BlockID     *string `json:"blockId,omitempty"`
	AnchorFrom  *int    `json:"anchorFrom,omitempty"`
	AnchorTo    *int    `json:"anchorTo,omitempty"`
	Quote       *string `json:"quote,omitempty"`
	// ResolvedAt / ResolvedByUserID は両方あるか両方無いか（DB の CHECK と同じ不変条件）。
	ResolvedAt       *time.Time `json:"resolvedAt,omitempty"`
	ResolvedByUserID *uint64    `json:"-"`
	CreatedByUserID  uint64     `json:"-"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

func (t CommentThread) Resolved() bool { return t.ResolvedAt != nil }

// Comment はスレッドに付いた 1 件の発言（スレッドを開いた最初の発言も返信も同じ形）。
type Comment struct {
	ID           string `json:"id"`
	ThreadID     string `json:"-"`
	AuthorUserID uint64 `json:"-"`
	// Body は ProseMirror インラインノードの配列（JSON 文字列）。API へは handler の response 型で
	// json.RawMessage に変換して出す。
	Body      string    `json:"-"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// commentBodyNode は comments.body のノード 1 つの最小限の形。type を必ず持ち、text ノードは
// 非空の text を持つ、という 2 点だけを見る（marks の中身までは検証しない）。
//
// Content を持つのは、本文が**塊（段落・箇条書き）を含む形**も受けるため。以前は
// 一列（inline ノードだけ）を前提にしていたが、発言に箇条書きを書けるようにしたので、
// 塊の中の text も同じ規則で見る必要が出た。古い一列の本文はそのまま通る
// （Content が空なら再帰しないだけ）。
type commentBodyNode struct {
	Type    string            `json:"type"`
	Text    string            `json:"text"`
	Content []json.RawMessage `json:"content"`
}

// commentBodyMaxDepth は入れ子を辿る深さの上限。箇条書きの中の段落までで 3 段あれば足り、
// 深い入れ子を投げつけられて無限に辿らされるのを防ぐ。
const commentBodyMaxDepth = 6

// validateCommentNodes は 1 段分のノード列を見て、さらに Content があれば潜る。
func validateCommentNodes(items []json.RawMessage, depth int) error {
	if depth > commentBodyMaxDepth {
		return ErrInvalidCommentBody
	}
	for _, item := range items {
		var node commentBodyNode
		if err := json.Unmarshal(item, &node); err != nil {
			return ErrInvalidCommentBody
		}
		if node.Type == "" {
			return ErrInvalidCommentBody
		}
		if node.Type == "text" && strings.TrimSpace(node.Text) == "" {
			return ErrInvalidCommentBody
		}
		if len(node.Content) > 0 {
			if err := validateCommentNodes(node.Content, depth+1); err != nil {
				return err
			}
		}
	}
	return nil
}

// ValidateCommentBody は comments.body に保存してよい形かを検証する。
//
//   - JSON 配列であること。空配列は「本文の無いコメント」として拒否する
//   - 各要素は object で type を持つこと（null・{} は type=="" として弾く。json.Unmarshal は
//     null を非ポインタ struct に当ててもゼロ値のままなので同じ判定で拾える）
//   - type=="text" の要素は空白のみでない text を持つこと（空だと画面が無視するノードに
//     なり、保存後に見た目だけ空のコメントとして残ってしまう）
//   - 塊（content を持つノード）は中まで同じ規則で見る。段落の中に空白だけの text を
//     入れれば通る、という抜け道を作らないため
//
// marks の中身・type の許可リスト等はここでは見ない。blocks.inline の parseBlockNode も
// 同水準までしか見ておらず、それに揃える。
func ValidateCommentBody(raw string) error {
	var items []json.RawMessage
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return ErrInvalidCommentBody
	}
	if len(items) == 0 {
		return ErrInvalidCommentBody
	}
	return validateCommentNodes(items, 1)
}

// ValidateCommentAnchor は錨（block_id / anchor_from / anchor_to / quote）の組み合わせが
// 保存してよい形かを検証する。
//
//   - 4 つとも nil なら有効（page-level のコメント）
//   - 4 つとも非 nil なら、blockID が空文字でない／anchorFrom が 0 以上／anchorFrom < anchorTo／
//     quote が空白のみでなく CommentAnchorMaxQuoteLen バイト以下、をすべて満たすときだけ有効
//   - それ以外（一部だけ非 nil の中途半端な組み合わせ）は無効
//
// blockID が実際にそのページに属するか（他ページ・他テナントのブロックでないか）は
// ここでは見ない。DB を引く必要があるため repository 層（BlockExistsInPage）の責務。
func ValidateCommentAnchor(blockID *string, anchorFrom, anchorTo *int, quote *string) error {
	present := 0
	for _, v := range []bool{blockID != nil, anchorFrom != nil, anchorTo != nil, quote != nil} {
		if v {
			present++
		}
	}
	if present == 0 {
		return nil
	}
	if present != 4 {
		return ErrInvalidCommentAnchor
	}
	if *blockID == "" {
		return ErrInvalidCommentAnchor
	}
	if *anchorFrom < 0 {
		return ErrInvalidCommentAnchor
	}
	if *anchorFrom >= *anchorTo {
		return ErrInvalidCommentAnchor
	}
	// DB 上 anchor_from/anchor_to は int32。ここで弾かないと persistence 層の int32(v) キャストが
	// 符号ごと丸め込まれた値のまま保存される（ORM 移行で踏んだ「縮小キャストの無言失敗」と同種）。
	if *anchorFrom < math.MinInt32 || *anchorFrom > math.MaxInt32 ||
		*anchorTo < math.MinInt32 || *anchorTo > math.MaxInt32 {
		return ErrInvalidCommentAnchor
	}
	if strings.TrimSpace(*quote) == "" {
		return ErrInvalidCommentAnchor
	}
	if len(*quote) > CommentAnchorMaxQuoteLen {
		return ErrInvalidCommentAnchor
	}
	return nil
}
