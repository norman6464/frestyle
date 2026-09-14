package domain_test

import (
	"strings"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/stretchr/testify/assert"
)

// Test_コメント本文検証 は comments.body に保存してよい形の境界を固定する。
//
// 変異確認: len(items) == 0 のチェックを外すと「空配列は拒否」のケースが緑のまま
// 落ちなくなる（ErrInvalidCommentBody を返さなくなるため）— このテストがそれを捕まえる。
func Test_コメント本文検証(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		wantErr bool
	}{
		{name: "1件の要素を持つ配列はOK", raw: `[{"type":"text","text":"hello"}]`, wantErr: false},
		{name: "複数件の要素を持つ配列もOK", raw: `[{"type":"text","text":"a"},{"type":"text","text":"b"}]`, wantErr: false},
		{name: "textを持たないinlineノード（hardBreak等）はOK", raw: `[{"type":"hardBreak"}]`, wantErr: false},
		{name: "空配列は拒否（本文の無いコメント）", raw: `[]`, wantErr: true},
		{name: "配列でないJSON（object）は拒否", raw: `{"type":"text"}`, wantErr: true},
		{name: "配列でないJSON（string）は拒否", raw: `"hello"`, wantErr: true},
		{name: "不正なJSONは拒否", raw: `not json`, wantErr: true},
		{name: "空文字は拒否", raw: ``, wantErr: true},
		// CodeRabbit 指摘: [null] や [{}] は「非空の配列」チェックだけでは通ってしまい、
		// KbCommentItem が text を持たないノードを無視するため保存後に空コメントとして残る。
		{name: "null要素を含む配列は拒否", raw: `[null]`, wantErr: true},
		{name: "空objectの要素を含む配列は拒否（typeが無い）", raw: `[{}]`, wantErr: true},
		{name: "textノードでtextが空文字は拒否", raw: `[{"type":"text","text":""}]`, wantErr: true},
		{name: "textノードでtextが空白のみは拒否", raw: `[{"type":"text","text":"   "}]`, wantErr: true},
		{name: "配列の要素がobjectでない（数値）は拒否", raw: `[1]`, wantErr: true},
		{name: "有効な要素と無効な要素が混在すれば拒否", raw: `[{"type":"text","text":"ok"},{}]`, wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := domain.ValidateCommentBody(tc.raw)
			if tc.wantErr {
				assert.ErrorIs(t, err, domain.ErrInvalidCommentBody)
				return
			}
			assert.NoError(t, err)
		})
	}
}

func Test_コメントスレッド_Resolved(t *testing.T) {
	unresolved := domain.CommentThread{}
	assert.False(t, unresolved.Resolved())

	resolvedAt := unresolved.CreatedAt
	resolved := domain.CommentThread{ResolvedAt: &resolvedAt}
	assert.True(t, resolved.Resolved())
}

// Test_錨検証 は ValidateCommentAnchor の境界を固定する（FRESTYLE-432 段 3）。
//
// 変異確認: 「4つとも非nilのときだけ検証する」分岐 (present != 4 の早期リターン) を
// 外すと、blockIDだけ指定・anchorFromだけ欠落のケースが nil 参照でパニックするか、
// 中途半端な組み合わせを誤って通してしまう — このテストがそれを捕まえる。
func Test_錨検証(t *testing.T) {
	strPtr := func(s string) *string { return &s }
	intPtr := func(i int) *int { return &i }

	// ASCII で作る — len() はバイト数なので、マルチバイト文字で作ると「上限ちょうど」の
	// 境界を正確に踏めない（"あ"は3バイトなので rune数と一致しない）— CodeRabbit 指摘。
	quoteAtLimit := strings.Repeat("a", domain.CommentAnchorMaxQuoteLen)
	longQuote := strings.Repeat("a", domain.CommentAnchorMaxQuoteLen+1)

	cases := []struct {
		name       string
		blockID    *string
		anchorFrom *int
		anchorTo   *int
		quote      *string
		wantErr    bool
	}{
		{
			name: "4つともnilはOK（page-level）",
		},
		{
			name:    "4つとも有効な値はOK",
			blockID: strPtr("block-1"), anchorFrom: intPtr(0), anchorTo: intPtr(5), quote: strPtr("引用文"),
		},
		{
			name:    "blockIDだけ指定はNG",
			blockID: strPtr("block-1"),
			wantErr: true,
		},
		{
			name:    "anchorFromだけ欠落はNG",
			blockID: strPtr("block-1"), anchorTo: intPtr(5), quote: strPtr("引用文"),
			wantErr: true,
		},
		{
			name:    "anchorFromが負はNG",
			blockID: strPtr("block-1"), anchorFrom: intPtr(-1), anchorTo: intPtr(5), quote: strPtr("引用文"),
			wantErr: true,
		},
		{
			name:    "anchorFrom>=anchorToはNG",
			blockID: strPtr("block-1"), anchorFrom: intPtr(5), anchorTo: intPtr(5), quote: strPtr("引用文"),
			wantErr: true,
		},
		{
			name:    "blockIDが空文字はNG",
			blockID: strPtr(""), anchorFrom: intPtr(0), anchorTo: intPtr(5), quote: strPtr("引用文"),
			wantErr: true,
		},
		{
			name:    "quoteが空白のみはNG",
			blockID: strPtr("block-1"), anchorFrom: intPtr(0), anchorTo: intPtr(5), quote: strPtr("   "),
			wantErr: true,
		},
		{
			name:    "quoteがちょうど上限バイト数はOK（境界は上限を含む）",
			blockID: strPtr("block-1"), anchorFrom: intPtr(0), anchorTo: intPtr(5), quote: &quoteAtLimit,
			wantErr: false,
		},
		{
			name:    "quoteが上限を1バイト超えるはNG",
			blockID: strPtr("block-1"), anchorFrom: intPtr(0), anchorTo: intPtr(5), quote: &longQuote,
			wantErr: true,
		},
		{
			// DB上 anchor_from/anchor_to は int32。ここで弾かないと persistence 層の
			// 縮小キャストが符号ごと丸め込んだ値を保存してしまう（500ではなく400で拒否したい）。
			name:    "anchorToがint32の範囲を超えるはNG",
			blockID: strPtr("block-1"), anchorFrom: intPtr(0), anchorTo: intPtr(1 << 32), quote: strPtr("引用文"),
			wantErr: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := domain.ValidateCommentAnchor(tc.blockID, tc.anchorFrom, tc.anchorTo, tc.quote)
			if tc.wantErr {
				assert.ErrorIs(t, err, domain.ErrInvalidCommentAnchor)
				return
			}
			assert.NoError(t, err)
		})
	}
}

// Test_コメント本文検証_塊 は、発言に箇条書きを書けるようにしたことで増えた
// 「塊（content を持つノード）」の境界を固定する。
//
// 変異確認: validateCommentNodes の再帰（len(node.Content) > 0 の分岐）を外すと
// 「段落の中の空白だけの text は拒否」が緑のまま通ってしまう — このテストが捕まえる。
func Test_コメント本文検証_塊(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		wantErr bool
	}{
		{
			name:    "段落の塊はOK",
			raw:     `[{"type":"paragraph","content":[{"type":"text","text":"あ"}]}]`,
			wantErr: false,
		},
		{
			name: "箇条書きの入れ子もOK",
			raw: `[{"type":"bulletList","content":[{"type":"listItem","content":[` +
				`{"type":"paragraph","content":[{"type":"text","text":"あ"}]}]}]}]`,
			wantErr: false,
		},
		{
			name:    "古い一列の本文はそのまま通る",
			raw:     `[{"type":"text","text":"あ"},{"type":"mention","attrs":{"userId":"1"}}]`,
			wantErr: false,
		},
		{
			name:    "段落の中の空白だけのtextは拒否（抜け道を作らない）",
			raw:     `[{"type":"paragraph","content":[{"type":"text","text":"   "}]}]`,
			wantErr: true,
		},
		{
			name:    "段落の中のtypeの無いノードは拒否",
			raw:     `[{"type":"paragraph","content":[{}]}]`,
			wantErr: true,
		},
		{
			name: "深すぎる入れ子は拒否",
			raw: `[{"type":"a","content":[{"type":"b","content":[{"type":"c","content":[` +
				`{"type":"d","content":[{"type":"e","content":[{"type":"f","content":[` +
				`{"type":"g","content":[{"type":"text","text":"深い"}]}]}]}]}]}]}]`,
			wantErr: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := domain.ValidateCommentBody(tc.raw)
			if tc.wantErr {
				assert.ErrorIs(t, err, domain.ErrInvalidCommentBody)
				return
			}
			assert.NoError(t, err)
		})
	}
}
