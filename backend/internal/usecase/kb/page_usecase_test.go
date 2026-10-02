package kb

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/require"
)

// writesToDomainBlocks は保存用の行（BlockWrite.ID / ParentID）を、
// DB から読み出した形（domain.Block）へそのまま写す。往復テスト用。
// ID は既に flattenPageDoc が確定させているので、配列添字→文字列 ID のような
// 変換は不要（旧 ParentIndex 時代と違い repository 側の採番を模す必要が無い）。
func writesToDomainBlocks(t *testing.T, rows []repository.BlockWrite) []domain.Block {
	t.Helper()
	blocks := make([]domain.Block, 0, len(rows))
	for _, r := range rows {
		b := domain.Block{
			ID:       r.ID,
			ParentID: r.ParentID,
			PageID:   "page-1",
			Position: r.Position,
			Type:     r.Type,
			Attrs:    r.Attrs,
		}
		if r.Inline != nil {
			s := *r.Inline
			b.Inline = &s
		}
		blocks = append(blocks, b)
	}
	return blocks
}

// stripBlockIDsFromAttrs は JSON 木（json.Unmarshal した any）を再帰的に走査し、
// すべての "attrs" オブジェクトから "id" キーを取り除く（破壊的に変更する）。
// 削除の結果 attrs が空 object になったら、attrs キー自体も取り除く
// （renderBlockNode が付ける前の正規形＝「id を除いた属性が空なら attrs を出さない」に戻す）。
func stripBlockIDsFromAttrs(v any) {
	switch val := v.(type) {
	case map[string]any:
		if attrsRaw, ok := val["attrs"]; ok {
			if attrsMap, ok := attrsRaw.(map[string]any); ok {
				delete(attrsMap, "id")
				if len(attrsMap) == 0 {
					delete(val, "attrs")
				}
			}
		}
		for _, child := range val {
			stripBlockIDsFromAttrs(child)
		}
	case []any:
		for _, child := range val {
			stripBlockIDsFromAttrs(child)
		}
	}
}

// requireJSONEqIgnoringBlockIDs は 2 つの JSON 文字列を意味的に比較する
// （キー順・空白の差、および attrs.id の差を無視する）。
//
// 新規ブロック（attrs.id 無し入力）は保存のたび・呼び出しのたびに新しい UUID が
// 採番されるため、id を無視せず厳密一致で比較すると常に落ちる。
func requireJSONEqIgnoringBlockIDs(t *testing.T, want, got string) {
	t.Helper()
	var w, g any
	require.NoError(t, json.Unmarshal([]byte(want), &w))
	require.NoError(t, json.Unmarshal([]byte(got), &g))
	stripBlockIDsFromAttrs(w)
	stripBlockIDsFromAttrs(g)
	require.Equal(t, w, g)
}

// Test_doc往復_分解して組み立てると同値 は decompose → assemble の往復同値を固定する。
// 入力は正規形（attrs が空の object を持たない・doc の content は配列）の ProseMirror doc。
func Test_doc往復_分解して組み立てると同値(t *testing.T) {
	cases := []struct {
		name string
		doc  string
	}{
		{
			name: "空のdoc",
			doc:  `{"type":"doc","content":[]}`,
		},
		{
			name: "段落だけ",
			doc: `{"type":"doc","content":[
				{"type":"paragraph","content":[{"type":"text","text":"こんにちは"}]},
				{"type":"paragraph"},
				{"type":"paragraph","content":[{"type":"text","text":"二段落目"},{"type":"hardBreak"},{"type":"text","text":"改行後"}]}
			]}`,
		},
		{
			name: "見出しとマーク",
			doc: `{"type":"doc","content":[
				{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"見出し"}]},
				{"type":"paragraph","content":[
					{"type":"text","marks":[{"type":"bold"},{"type":"italic"}],"text":"強調"},
					{"type":"text","marks":[{"type":"link","attrs":{"href":"https://example.com","target":"_blank"}}],"text":"リンク"}
				]}
			]}`,
		},
		{
			name: "ネストしたリスト",
			doc: `{"type":"doc","content":[
				{"type":"bulletList","content":[
					{"type":"listItem","content":[
						{"type":"paragraph","content":[{"type":"text","text":"親項目"}]},
						{"type":"orderedList","attrs":{"start":3},"content":[
							{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"子項目1"}]}]},
							{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"子項目2"}]}]}
						]}
					]},
					{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"兄弟項目"}]}]}
				]}
			]}`,
		},
		{
			name: "表",
			doc: `{"type":"doc","content":[
				{"type":"table","content":[
					{"type":"tableRow","content":[
						{"type":"tableHeader","attrs":{"colspan":1,"rowspan":1},"content":[{"type":"paragraph","content":[{"type":"text","text":"列A"}]}]},
						{"type":"tableHeader","attrs":{"colspan":1,"rowspan":1},"content":[{"type":"paragraph","content":[{"type":"text","text":"列B"}]}]}
					]},
					{"type":"tableRow","content":[
						{"type":"tableCell","attrs":{"colspan":1,"rowspan":1},"content":[{"type":"paragraph","content":[{"type":"text","text":"a1"}]}]},
						{"type":"tableCell","attrs":{"colspan":2,"rowspan":1},"content":[{"type":"paragraph"}]}
					]}
				]}
			]}`,
		},
		{
			name: "タスクリスト",
			doc: `{"type":"doc","content":[
				{"type":"taskList","content":[
					{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"済み"}]}]},
					{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"未着手"}]}]}
				]}
			]}`,
		},
		{
			name: "コードブロック",
			doc: `{"type":"doc","content":[
				{"type":"codeBlock","attrs":{"language":"go"},"content":[{"type":"text","text":"package main\nfunc main() {}"}]}
			]}`,
		},
		{
			name: "注意書きと折りたたみと段組み",
			doc: `{"type":"doc","content":[
				{"type":"callout","attrs":{"kind":"warning"},"content":[{"type":"paragraph","content":[{"type":"text","text":"注意"}]}]},
				{"type":"details","attrs":{"open":true},"content":[
					{"type":"detailsSummary","content":[{"type":"text","text":"要約"}]},
					{"type":"detailsContent","content":[{"type":"paragraph","content":[{"type":"text","text":"中身"}]}]}
				]},
				{"type":"columns","attrs":{"count":2},"content":[
					{"type":"column","content":[{"type":"paragraph","content":[{"type":"text","text":"左"}]}]},
					{"type":"column","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"右"}]}]}
				]}
			]}`,
		},
		{
			name: "画像と区切り線と引用",
			doc: `{"type":"doc","content":[
				{"type":"image","attrs":{"src":"kb/ws1/page1/1.bin","alt":"代替","title":null}},
				{"type":"horizontalRule"},
				{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"引用文"}]}]}
			]}`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tree, err := parsePageDoc(tc.doc)
			require.NoError(t, err)
			rows, err := flattenPageDoc(tree)
			require.NoError(t, err)

			// 行（DB の形）を経由して組み立て直しても同値であること。
			rebuilt, err := treeFromBlocks(writesToDomainBlocks(t, rows))
			require.NoError(t, err)
			got, err := renderPageDoc(rebuilt)
			require.NoError(t, err)
			requireJSONEqIgnoringBlockIDs(t, tc.doc, got)

			// 行を経由しない直接の組み立てでも同値であること。
			direct, err := renderPageDoc(tree)
			require.NoError(t, err)
			requireJSONEqIgnoringBlockIDs(t, tc.doc, direct)
		})
	}
}

func Test_doc分解_不正な入力を弾く(t *testing.T) {
	cases := []struct {
		name    string
		doc     string
		wantErr error
	}{
		{"JSONでない", `not-json`, ErrPageDocInvalid},
		{"ルートがdocでない", `{"type":"paragraph"}`, ErrPageDocInvalid},
		{"contentが配列でない", `{"type":"doc","content":{"type":"paragraph"}}`, ErrPageDocInvalid},
		{"未知のブロックノード", `{"type":"doc","content":[{"type":"iframe"}]}`, ErrPageDocUnknownNodeType},
		{"容器の中の未知ノード", `{"type":"doc","content":[{"type":"bulletList","content":[{"type":"video"}]}]}`, ErrPageDocUnknownNodeType},
		{"インラインノードがトップレベルに来る", `{"type":"doc","content":[{"type":"text","text":"裸のテキスト"}]}`, ErrPageDocUnknownNodeType},
		{"attrsがobjectでない", `{"type":"doc","content":[{"type":"paragraph","attrs":[1,2]}]}`, ErrPageDocInvalid},
		{
			"インラインの要素がnull",
			`{"type":"doc","content":[{"type":"paragraph","content":[null]}]}`,
			ErrPageDocInvalid,
		},
		{
			"インラインの要素が数値",
			`{"type":"doc","content":[{"type":"paragraph","content":[42]}]}`,
			ErrPageDocInvalid,
		},
		{
			"インラインの要素にtypeが無い",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"text":"x"}]}]}`,
			ErrPageDocInvalid,
		},
		{
			"marksの要素がnull",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[null]}]}]}`,
			ErrPageDocInvalid,
		},
		{
			"marksの要素にtypeが無い",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"attrs":{}}]}]}]}`,
			ErrPageDocInvalid,
		},
		{
			"画像のsrcが外部URL",
			`{"type":"doc","content":[{"type":"image","attrs":{"src":"https://example.com/a.png"}}]}`,
			ErrPageDocInvalid,
		},
		{
			"画像にsrcが無い",
			`{"type":"doc","content":[{"type":"image","attrs":{"alt":"代替"}}]}`,
			ErrPageDocInvalid,
		},
		{
			"画像のsrcが文字列でない",
			`{"type":"doc","content":[{"type":"image","attrs":{"src":123}}]}`,
			ErrPageDocInvalid,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := parsePageDoc(tc.doc)
			require.ErrorIs(t, err, tc.wantErr)
		})
	}
}

// nestedBlockDoc は「中身の入った content 配列」がちょうど levels 段になる doc を返す。
// doc 直下が 1 段目。blockquote を levels-1 段重ねて、最内に content を持たない
// horizontalRule を 1 つ置く（葉が content を持つとインライン側でもう 1 段増えるため）。
func nestedBlockDoc(levels int) string {
	inner := `{"type":"horizontalRule"}`
	for i := 0; i < levels-1; i++ {
		inner = `{"type":"blockquote","content":[` + inner + `]}`
	}
	return `{"type":"doc","content":[` + inner + `]}`
}

// nestedInlineDoc は段落 1 つ（1 段目）の下に、インラインの content を levels-1 段
// 重ねた doc を返す。合計の段数は levels になる。
func nestedInlineDoc(levels int) string {
	inner := `{"type":"text","text":"底"}`
	for i := 0; i < levels-2; i++ {
		inner = `{"type":"text","content":[` + inner + `]}`
	}
	return `{"type":"doc","content":[{"type":"paragraph","content":[` + inner + `]}]}`
}

func Test_doc分解_入れ子の段数に上限がある(t *testing.T) {
	t.Run("上限ちょうどは通る", func(t *testing.T) {
		_, err := parsePageDoc(nestedBlockDoc(kbDocMaxDepth))
		require.NoError(t, err)
	})
	t.Run("上限を1段超えると弾く", func(t *testing.T) {
		_, err := parsePageDoc(nestedBlockDoc(kbDocMaxDepth + 1))
		require.ErrorIs(t, err, ErrPageDocInvalid)
	})
	t.Run("インラインの入れ子も同じ物差しで数える_上限ちょうど", func(t *testing.T) {
		_, err := parsePageDoc(nestedInlineDoc(kbDocMaxDepth))
		require.NoError(t, err)
	})
	t.Run("インラインの入れ子も同じ物差しで数える_上限超過", func(t *testing.T) {
		_, err := parsePageDoc(nestedInlineDoc(kbDocMaxDepth + 1))
		require.ErrorIs(t, err, ErrPageDocInvalid)
	})
}

func Test_doc分解_ノード数に上限がある(t *testing.T) {
	build := func(n int) string {
		nodes := make([]string, 0, n)
		for i := 0; i < n; i++ {
			nodes = append(nodes, `{"type":"horizontalRule"}`)
		}
		return `{"type":"doc","content":[` + strings.Join(nodes, ",") + `]}`
	}
	t.Run("上限ちょうどは通る", func(t *testing.T) {
		_, err := parsePageDoc(build(kbDocMaxNodes))
		require.NoError(t, err)
	})
	t.Run("上限を1つ超えると弾く", func(t *testing.T) {
		_, err := parsePageDoc(build(kbDocMaxNodes + 1))
		require.ErrorIs(t, err, ErrPageDocInvalid)
	})
}

func Test_doc分解_コードブロックの言語は許可済みだけ残す(t *testing.T) {
	cases := []struct {
		name  string
		attrs string
		want  string // 残ってほしい language（空なら属性ごと消える）
	}{
		{"許可済みの言語は残る", `{"language":"go"}`, "go"},
		{"知らない言語は落とす", `{"language":"brainfuck"}`, ""},
		{"class を混ぜた値は落とす", `{"language":"go fixed inset-0 z-50 bg-white"}`, ""},
		{"文字列でない値は落とす", `{"language":123}`, ""},
		{"language が無いときはそのまま", `{}`, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			doc := `{"type":"doc","content":[{"type":"codeBlock","attrs":` + tc.attrs +
				`,"content":[{"type":"text","text":"x"}]}]}`
			tree, err := parsePageDoc(doc)
			require.NoError(t, err)
			require.Len(t, tree, 1)

			var attrs map[string]any
			require.NoError(t, json.Unmarshal([]byte(tree[0].Attrs), &attrs))
			if tc.want == "" {
				require.NotContains(t, attrs, "language")
				return
			}
			require.Equal(t, tc.want, attrs["language"])
		})
	}
}

func Test_doc分解_画像は保管庫のkeyだけ受け付ける(t *testing.T) {
	doc := `{"type":"doc","content":[{"type":"image","attrs":{"src":"kb/ws1/page1/1.bin","alt":"代替"}}]}`
	tree, err := parsePageDoc(doc)
	require.NoError(t, err)
	require.Len(t, tree, 1)
	require.Equal(t, domain.BlockTypeImage, tree[0].Type)
}

func Test_doc分解_行の形が正しい(t *testing.T) {
	doc := `{"type":"doc","content":[
		{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"h"}]},
		{"type":"bulletList","content":[
			{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"item"}]}]}
		]}
	]}`
	tree, err := parsePageDoc(doc)
	require.NoError(t, err)
	rows, err := flattenPageDoc(tree)
	require.NoError(t, err)
	require.Len(t, rows, 4) // heading / bulletList / listItem / paragraph

	// トップレベル: heading と bulletList（文書順・親なし）。
	require.Equal(t, domain.BlockTypeHeading, rows[0].Type)
	require.Nil(t, rows[0].ParentID)
	require.JSONEq(t, `{"level":1}`, rows[0].Attrs)
	require.NotNil(t, rows[0].Inline, "葉ノードは content を inline に持つ")
	require.Equal(t, domain.BlockTypeBulletList, rows[1].Type)
	require.Nil(t, rows[1].ParentID)
	require.Nil(t, rows[1].Inline, "容器ノードの inline は NULL")
	require.Equal(t, "{}", rows[1].Attrs, "属性なしは空 object（NULL と {} の二通りを作らない、id は Attrs ではなく BlockWrite.ID に入る）")

	// 入れ子: listItem の親は bulletList、paragraph の親は listItem。
	require.Equal(t, domain.BlockTypeListItem, rows[2].Type)
	require.NotNil(t, rows[2].ParentID)
	require.Equal(t, rows[1].ID, *rows[2].ParentID, "listItem の親は bulletList")
	require.Equal(t, domain.BlockTypeParagraph, rows[3].Type)
	require.NotNil(t, rows[3].ParentID)
	require.Equal(t, rows[2].ID, *rows[3].ParentID, "paragraph の親は listItem")

	// 兄弟の position は辞書順で増える（トップレベルの 2 行）。
	require.Less(t, rows[0].Position, rows[1].Position)
}

func Test_doc組み立て_兄弟をposition順に並べ直す(t *testing.T) {
	inline := `[{"type":"text","text":"x"}]`
	// わざと position の逆順・親子バラバラの順で渡す（DB の ORDER BY に頼らない検証）。
	blocks := []domain.Block{
		{ID: "b2", Type: domain.BlockTypeParagraph, Position: "a1", Attrs: "{}", Inline: &inline},
		{ID: "b1", Type: domain.BlockTypeParagraph, Position: "a0", Attrs: "{}", Inline: &inline},
	}
	tree, err := treeFromBlocks(blocks)
	require.NoError(t, err)
	rows, err := flattenPageDoc(tree)
	require.NoError(t, err)
	require.Len(t, rows, 2)
	doc, err := renderPageDoc(tree)
	require.NoError(t, err)
	requireJSONEqIgnoringBlockIDs(t, `{"type":"doc","content":[
		{"type":"paragraph","content":[{"type":"text","text":"x"}]},
		{"type":"paragraph","content":[{"type":"text","text":"x"}]}
	]}`, doc)
}

func Test_doc組み立て_親が見つからない行はエラー(t *testing.T) {
	missing := "no-such-parent"
	blocks := []domain.Block{
		{ID: "b1", Type: domain.BlockTypeParagraph, Position: "a0", Attrs: "{}", ParentID: &missing},
	}
	_, err := treeFromBlocks(blocks)
	require.Error(t, err)
}

func Test_doc組み立て_未知のtypeの行はエラー(t *testing.T) {
	blocks := []domain.Block{
		{ID: "b1", Type: domain.BlockType("iframe"), Position: "a0", Attrs: "{}"},
	}
	_, err := treeFromBlocks(blocks)
	require.True(t, errors.Is(err, ErrPageDocUnknownNodeType))
}

// Test_flattenPageDoc_明示的な有効idはそのまま使われる は、クライアントが attrs.id で
// 送った有効な UUID が新規採番されずそのまま BlockWrite.ID になることを固定する
// （差分 UPSERT で行を同一に保つための要）。
func Test_flattenPageDoc_明示的な有効idはそのまま使われる(t *testing.T) {
	fixedID := "11111111-1111-1111-1111-111111111111"
	doc := fmt.Sprintf(`{"type":"doc","content":[
		{"type":"paragraph","attrs":{"id":%q},"content":[{"type":"text","text":"x"}]}
	]}`, fixedID)

	tree, err := parsePageDoc(doc)
	require.NoError(t, err)
	rows, err := flattenPageDoc(tree)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, fixedID, rows[0].ID)
}

// Test_flattenPageDoc_idが無いか不正なら新規採番される は、attrs.id が欠けている・
// UUID として parse できない場合に、有効な UUID が新規採番されることを固定する。
func Test_flattenPageDoc_idが無いか不正なら新規採番される(t *testing.T) {
	cases := []struct {
		name string
		doc  string
	}{
		{"idキー無し", `{"type":"doc","content":[{"type":"paragraph"}]}`},
		{"attrs自体が空", `{"type":"doc","content":[{"type":"paragraph","attrs":{}}]}`},
		{"idが文字列でない", `{"type":"doc","content":[{"type":"paragraph","attrs":{"id":123}}]}`},
		{"idがUUIDとしてparseできない", `{"type":"doc","content":[{"type":"paragraph","attrs":{"id":"not-a-uuid"}}]}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tree, err := parsePageDoc(tc.doc)
			require.NoError(t, err)
			rows, err := flattenPageDoc(tree)
			require.NoError(t, err)
			require.Len(t, rows, 1)
			_, err = uuid.Parse(rows[0].ID)
			require.NoError(t, err, "新規採番された id は有効な UUID であること")
		})
	}
}

// Test_flattenPageDoc_明示idは呼び出しをまたいで安定するがid無しは変わりうる は、
// 同じ doc を 2 回 parsePageDoc → flattenPageDoc しても、明示的な id を持つノードは
// 両方の呼び出しで同じ id になり、id 無しのノードだけが呼び出しごとに変わることを固定する。
func Test_flattenPageDoc_明示idは呼び出しをまたいで安定するがid無しは変わりうる(t *testing.T) {
	fixedID := "22222222-2222-2222-2222-222222222222"
	doc := fmt.Sprintf(`{"type":"doc","content":[
		{"type":"paragraph","attrs":{"id":%q},"content":[{"type":"text","text":"固定"}]},
		{"type":"paragraph","content":[{"type":"text","text":"未指定"}]}
	]}`, fixedID)

	tree1, err := parsePageDoc(doc)
	require.NoError(t, err)
	rows1, err := flattenPageDoc(tree1)
	require.NoError(t, err)

	tree2, err := parsePageDoc(doc)
	require.NoError(t, err)
	rows2, err := flattenPageDoc(tree2)
	require.NoError(t, err)

	require.Len(t, rows1, 2)
	require.Len(t, rows2, 2)
	require.Equal(t, fixedID, rows1[0].ID)
	require.Equal(t, fixedID, rows2[0].ID, "明示的な id は呼び出しをまたいで安定する")
	require.NotEqual(t, rows1[1].ID, rows2[1].ID, "id 無しは呼び出しごとに新規採番される")
}

// Test_flattenPageDoc_同じidが複数ノードにあれば2件目以降を採番し直す は、コピー＆ペースト等で
// attrs.id ごとノードが複製され、doc の中に同じ id を持つノードが複数現れた場合の固定。
// 再採番しないと ReplacePageBlocks の UPSERT が同じ id へ複数回書き込み、最後に処理した
// ノードの内容だけが残って前のノードの内容が無言で消える（CodeRabbit 指摘）。
func Test_flattenPageDoc_同じidが複数ノードにあれば2件目以降を採番し直す(t *testing.T) {
	dupID := "33333333-3333-3333-3333-333333333333"
	doc := fmt.Sprintf(`{"type":"doc","content":[
		{"type":"paragraph","attrs":{"id":%q},"content":[{"type":"text","text":"1つ目"}]},
		{"type":"paragraph","attrs":{"id":%q},"content":[{"type":"text","text":"2つ目"}]}
	]}`, dupID, dupID)

	tree, err := parsePageDoc(doc)
	require.NoError(t, err)
	rows, err := flattenPageDoc(tree)
	require.NoError(t, err)

	require.Len(t, rows, 2)
	require.Equal(t, dupID, rows[0].ID, "1件目は明示的な id をそのまま使う")
	require.NotEqual(t, dupID, rows[1].ID, "2件目は衝突を避けて新規採番される")
	_, err = uuid.Parse(rows[1].ID)
	require.NoError(t, err, "採番し直された id も有効な UUID であること")

	// renderPageDoc（snapshot 用）は flattenPageDoc と同じ木を見るので、採番し直した後の
	// id が snapshot 側にも反映されていること（保存行と snapshot の id が食い違わない）。
	rendered, err := renderPageDoc(tree)
	require.NoError(t, err)
	var parsed struct {
		Content []struct {
			Attrs struct {
				ID string `json:"id"`
			} `json:"attrs"`
		} `json:"content"`
	}
	require.NoError(t, json.Unmarshal([]byte(rendered), &parsed))
	require.Len(t, parsed.Content, 2)
	require.Equal(t, rows[0].ID, parsed.Content[0].Attrs.ID)
	require.Equal(t, rows[1].ID, parsed.Content[1].Attrs.ID)
}

// Test_renderPageDoc_常にattrs_idを出力する は、元々 attrs が空だったノードでも
// render 後は必ず attrs.id が出ることを固定する（renderBlockNode のコメント参照）。
func Test_renderPageDoc_常にattrs_idを出力する(t *testing.T) {
	doc := `{"type":"doc","content":[{"type":"horizontalRule"}]}`
	tree, err := parsePageDoc(doc)
	require.NoError(t, err)
	got, err := renderPageDoc(tree)
	require.NoError(t, err)

	var parsed struct {
		Content []struct {
			Attrs struct {
				ID string `json:"id"`
			} `json:"attrs"`
		} `json:"content"`
	}
	require.NoError(t, json.Unmarshal([]byte(got), &parsed))
	require.Len(t, parsed.Content, 1)
	_, err = uuid.Parse(parsed.Content[0].Attrs.ID)
	require.NoError(t, err, "attrs が元々空だったノードでも render 後は id を持つ")
}

// 文字色（textStyle.color）と蛍光ペン（highlight.color）は名前だけを受け付ける。
// 通らない値はマークごと剥がし、エラーにはしない（コードブロックの言語と同じ扱い）。
// 文字そのものと、ほかのマーク（太字など）はそのまま残る。
func Test_doc分解_文字色と蛍光ペンは許した名前だけ残す(t *testing.T) {
	cases := []struct {
		name      string
		marks     string // text ノードの marks（JSON 配列）
		wantMarks []string
	}{
		{"許した名前の文字色は残る", `[{"type":"textStyle","attrs":{"color":"red"}}]`, []string{"textStyle"}},
		{"許した名前の蛍光ペンは残る", `[{"type":"highlight","attrs":{"color":"yellow"}}]`, []string{"highlight"}},
		{"生の色コードはマークごと剥がす", `[{"type":"textStyle","attrs":{"color":"#ff0000"}}]`, nil},
		{"文字列でない値はマークごと剥がす", `[{"type":"highlight","attrs":{"color":123}}]`, nil},
		{"色の無い文字色は剥がす", `[{"type":"textStyle","attrs":{}}]`, nil},
		{"attrs の無い蛍光ペンは剥がす", `[{"type":"highlight"}]`, nil},
		{"ほかのマークはそのまま", `[{"type":"bold"},{"type":"textStyle","attrs":{"color":"zzz"}},{"type":"link","attrs":{"href":"https://example.com"}}]`, []string{"bold", "link"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			doc := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"色","marks":` + tc.marks + `}]}]}`
			tree, err := parsePageDoc(doc)
			require.NoError(t, err)
			require.Len(t, tree, 1)
			require.NotNil(t, tree[0].Inline)

			var inline []struct {
				Type  string `json:"type"`
				Text  string `json:"text"`
				Marks []struct {
					Type string `json:"type"`
				} `json:"marks"`
			}
			require.NoError(t, json.Unmarshal([]byte(*tree[0].Inline), &inline))
			require.Len(t, inline, 1)
			require.Equal(t, "色", inline[0].Text)
			var got []string
			for _, m := range inline[0].Marks {
				got = append(got, m.Type)
			}
			require.Equal(t, tc.wantMarks, got)
		})
	}
}

// 剥がすものが無ければ、インラインの JSON は元の形（キーの並びも）のまま保つ。
// 直す必要の無い本文を組み替えて、保存のたびに差分が出ることを避けるため。
func Test_doc分解_剥がすものが無ければインラインは元のまま(t *testing.T) {
	inline := `[{"type":"text","marks":[{"type":"bold"},{"type":"textStyle","attrs":{"color":"blue"}}],"text":"色"}]`
	tree, err := parsePageDoc(`{"type":"doc","content":[{"type":"paragraph","content":` + inline + `}]}`)
	require.NoError(t, err)
	require.Equal(t, inline, *tree[0].Inline)
}

// 入れ子のインライン（content を持つインラインノード）の中のマークも同じように検査する。
func Test_doc分解_入れ子のインラインの中の色も検査する(t *testing.T) {
	doc := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"span","content":[{"type":"text","text":"内側","marks":[{"type":"highlight","attrs":{"color":"nope"}}]}]}]}]}`
	tree, err := parsePageDoc(doc)
	require.NoError(t, err)
	require.NotContains(t, *tree[0].Inline, "highlight")
	require.Contains(t, *tree[0].Inline, "内側")
}

// チケット参照の表示の写し（鍵・題名・状態）は読み手ごとに読み出し時へ解決する派生値で、
// ページ参照の題名と同じ理由で保存しない。参照先の id だけを残す。
func Test_StripPageRefTitles_チケット参照の表示の写しも剥がす(t *testing.T) {
	doc := `{"type":"doc","content":[{"type":"paragraph","content":[` +
		`{"type":"ticketRef","attrs":{"ticketId":"00000000-0000-7000-8000-0000000000b1","key":"ENG-1","title":"題名","statusName":"To Do","statusCategory":"todo"}},` +
		`{"type":"text","text":"のあと"}]}]}`
	got := StripPageRefTitles(doc)
	var root map[string]any
	require.NoError(t, json.Unmarshal([]byte(got), &root))
	inline := root["content"].([]any)[0].(map[string]any)["content"].([]any)
	attrs := inline[0].(map[string]any)["attrs"].(map[string]any)
	require.Equal(t, "00000000-0000-7000-8000-0000000000b1", attrs["ticketId"])
	for _, key := range []string{"key", "title", "statusName", "statusCategory"} {
		require.Nil(t, attrs[key], key)
	}
	require.Equal(t, "のあと", inline[1].(map[string]any)["text"])
}

func Test_StripPageRefTitles_写しの無いチケット参照はそのまま(t *testing.T) {
	doc := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"ticketRef","attrs":{"ticketId":"00000000-0000-7000-8000-0000000000b1"}}]}]}`
	require.Equal(t, doc, StripPageRefTitles(doc))
}

func Test_StripPageRefTitles_名指しの名前も剥がす(t *testing.T) {
	doc := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"mention","attrs":{"userId":"5","name":"田中"}}]}]}`
	got := StripPageRefTitles(doc)
	var root map[string]any
	require.NoError(t, json.Unmarshal([]byte(got), &root))
	attrs := root["content"].([]any)[0].(map[string]any)["content"].([]any)[0].(map[string]any)["attrs"].(map[string]any)
	require.Equal(t, "5", attrs["userId"])
	require.Nil(t, attrs["name"])
}

// 容器を葉として登録してしまうと、保存は通るのに中の段落が丸ごと 1 行の inline に入り、
// 検索・コメント・被リンクが黙って壊れる。第 4 段の容器が行の形でもそうなっていないことを固定する。
func Test_doc分解_容器の中の段落は行になり容器自身のinlineはNULL(t *testing.T) {
	cases := []struct {
		name string
		doc  string
		// want は 文書順の (種類, 親の種類)。親が無ければ ""。
		want [][2]domain.BlockType
	}{
		{
			"注意書き",
			`{"type":"doc","content":[{"type":"callout","attrs":{"kind":"info"},"content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]}]}]}`,
			[][2]domain.BlockType{{domain.BlockTypeCallout, ""}, {domain.BlockTypeParagraph, domain.BlockTypeCallout}},
		},
		{
			"折りたたみ（要約は葉・中身は容器）",
			`{"type":"doc","content":[{"type":"details","content":[` +
				`{"type":"detailsSummary","content":[{"type":"text","text":"s"}]},` +
				`{"type":"detailsContent","content":[{"type":"paragraph","content":[{"type":"text","text":"b"}]}]}]}]}`,
			[][2]domain.BlockType{
				{domain.BlockTypeDetails, ""},
				{domain.BlockTypeDetailsSummary, domain.BlockTypeDetails},
				{domain.BlockTypeDetailsContent, domain.BlockTypeDetails},
				{domain.BlockTypeParagraph, domain.BlockTypeDetailsContent},
			},
		},
		{
			"段組み",
			`{"type":"doc","content":[{"type":"columns","attrs":{"count":2},"content":[` +
				`{"type":"column","content":[{"type":"paragraph","content":[{"type":"text","text":"l"}]}]},` +
				`{"type":"column","content":[{"type":"paragraph","content":[{"type":"text","text":"r"}]}]}]}]}`,
			[][2]domain.BlockType{
				{domain.BlockTypeColumns, ""},
				{domain.BlockTypeColumn, domain.BlockTypeColumns},
				{domain.BlockTypeParagraph, domain.BlockTypeColumn},
				{domain.BlockTypeColumn, domain.BlockTypeColumns},
				{domain.BlockTypeParagraph, domain.BlockTypeColumn},
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tree, err := parsePageDoc(tc.doc)
			require.NoError(t, err)
			rows, err := flattenPageDoc(tree)
			require.NoError(t, err)
			require.Len(t, rows, len(tc.want))
			byID := map[string]repository.BlockWrite{}
			for _, r := range rows {
				byID[r.ID] = r
			}
			for i, r := range rows {
				require.Equal(t, tc.want[i][0], r.Type, "行 %d の種類", i)
				if tc.want[i][1] == "" {
					require.Nil(t, r.ParentID, "行 %d は最上位", i)
				} else {
					require.NotNil(t, r.ParentID, "行 %d の親", i)
					require.Equal(t, tc.want[i][1], byID[*r.ParentID].Type, "行 %d の親の種類", i)
				}
				if r.Type.IsContainer() {
					require.Nil(t, r.Inline, "容器 %s の inline は NULL", r.Type)
				} else {
					require.NotNil(t, r.Inline, "葉 %s の inline は中身を持つ", r.Type)
				}
			}
		})
	}
}

func Test_doc分解_容器のattrsは許した形だけ残す(t *testing.T) {
	cases := []struct {
		name string
		node string
		want string // 正規化後の attrs（JSON）
	}{
		{"注意書きの kind は許可リストの値を残す", `{"type":"callout","attrs":{"kind":"danger"},"content":[{"type":"paragraph"}]}`, `{"kind":"danger"}`},
		{"知らない kind は info に落とす", `{"type":"callout","attrs":{"kind":"neon"},"content":[{"type":"paragraph"}]}`, `{"kind":"info"}`},
		{"文字列でない kind は info に落とす", `{"type":"callout","attrs":{"kind":3},"content":[{"type":"paragraph"}]}`, `{"kind":"info"}`},
		{"kind が無ければ info を入れる", `{"type":"callout","content":[{"type":"paragraph"}]}`, `{"kind":"info"}`},
		{"折りたたみの open は真偽を残す", `{"type":"details","attrs":{"open":true},"content":[{"type":"detailsSummary"}]}`, `{"open":true}`},
		{"折りたたみの open が真偽でなければ外す", `{"type":"details","attrs":{"open":"yes"},"content":[{"type":"detailsSummary"}]}`, `{}`},
		{"段組みの count は 2〜3 を残す", `{"type":"columns","attrs":{"count":3},"content":[{"type":"column"}]}`, `{"count":3}`},
		{"段組みの count が範囲外なら外す", `{"type":"columns","attrs":{"count":5},"content":[{"type":"column"}]}`, `{}`},
		{"段組みの count が整数でなければ外す", `{"type":"columns","attrs":{"count":"2"},"content":[{"type":"column"}]}`, `{}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tree, err := parsePageDoc(`{"type":"doc","content":[` + tc.node + `]}`)
			require.NoError(t, err)
			require.Len(t, tree, 1)
			require.JSONEq(t, tc.want, tree[0].Attrs)
		})
	}
}
