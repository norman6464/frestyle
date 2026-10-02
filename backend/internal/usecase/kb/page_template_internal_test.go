package kb

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Test_雛形保存時にpageRefと画像ノードを取り除く は
// stripPageRefAndImageNodesForTemplate の木の走査を table-driven で固定する。
func Test_雛形保存時にpageRefと画像ノードを取り除く(t *testing.T) {
	tests := []struct {
		name        string
		doc         string
		wantAbsent  []string // 出力に含まれてはいけない文字列
		wantPresent []string // 出力に含まれるべき文字列
	}{
		{
			name: "pageRefノードが消える",
			doc: `{"type":"doc","content":[
				{"type":"paragraph","attrs":{"id":"11111111-1111-1111-1111-111111111111"},"content":[
					{"type":"text","text":"参照: "},
					{"type":"pageRef","attrs":{"pageId":"22222222-2222-2222-2222-222222222222","title":"参照先"}}
				]}
			]}`,
			wantAbsent:  []string{"pageRef", "参照先", "22222222-2222-2222-2222-222222222222"},
			wantPresent: []string{"参照: ", "paragraph"},
		},
		{
			name: "画像ノードが消える",
			doc: `{"type":"doc","content":[
				{"type":"paragraph","attrs":{"id":"11111111-1111-1111-1111-111111111111"},"content":[
					{"type":"text","text":"本文"}
				]},
				{"type":"image","attrs":{"id":"33333333-3333-3333-3333-333333333333","src":"kb/ws1/page1/123.bin"}}
			]}`,
			wantAbsent:  []string{`"image"`, "kb/ws1/page1/123.bin"},
			wantPresent: []string{"本文", "paragraph"},
		},
		{
			name: "通常のtextとpageRefが混在するdocはtextだけ残る",
			doc: `{"type":"doc","content":[
				{"type":"paragraph","attrs":{"id":"11111111-1111-1111-1111-111111111111"},"content":[
					{"type":"text","text":"前段"},
					{"type":"pageRef","attrs":{"pageId":"22222222-2222-2222-2222-222222222222","title":"隠す"}},
					{"type":"text","text":"後段"}
				]}
			]}`,
			wantAbsent:  []string{"pageRef", "隠す"},
			wantPresent: []string{"前段", "後段"},
		},
		{
			name: "ネストしたリストの中のpageRefも消える",
			doc: `{"type":"doc","content":[
				{"type":"bulletList","attrs":{"id":"44444444-4444-4444-4444-444444444444"},"content":[
					{"type":"listItem","attrs":{"id":"55555555-5555-5555-5555-555555555555"},"content":[
						{"type":"paragraph","attrs":{"id":"66666666-6666-6666-6666-666666666666"},"content":[
							{"type":"pageRef","attrs":{"pageId":"22222222-2222-2222-2222-222222222222","title":"深い参照"}}
						]}
					]}
				]}
			]}`,
			wantAbsent:  []string{"pageRef", "深い参照"},
			wantPresent: []string{"bulletList", "listItem"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := stripPageRefAndImageNodesForTemplate(tc.doc)
			require.NoError(t, err)
			// 結果が壊れていない JSON であることも確かめる。
			var v any
			require.NoError(t, json.Unmarshal([]byte(got), &v))
			for _, s := range tc.wantAbsent {
				assert.NotContains(t, got, s)
			}
			for _, s := range tc.wantPresent {
				assert.Contains(t, got, s)
			}
		})
	}

	t.Run("不正なJSONはErrPageDocInvalidを返す", func(t *testing.T) {
		_, err := stripPageRefAndImageNodesForTemplate(`{invalid`)
		require.ErrorIs(t, err, ErrPageDocInvalid)
	})
}

// Test_雛形からのブロックID再採番 は regenerateBlockIDs の table-driven の基本ケースと、
// 「同じ雛形から作った2つのページで最終的なブロックIDが衝突しない」ことを固定する。
func Test_雛形からのブロックID再採番(t *testing.T) {
	doc := `{"type":"doc","content":[
		{"type":"paragraph","attrs":{"id":"11111111-1111-1111-1111-111111111111"},"content":[
			{"type":"text","text":"本文"}
		]},
		{"type":"bulletList","attrs":{"id":"44444444-4444-4444-4444-444444444444"},"content":[
			{"type":"listItem","attrs":{"id":"55555555-5555-5555-5555-555555555555"},"content":[
				{"type":"paragraph","attrs":{"id":"66666666-6666-6666-6666-666666666666"}}
			]}
		]}
	]}`

	t.Run("attrs.idがキーごと削除される", func(t *testing.T) {
		got, err := regenerateBlockIDs(doc)
		require.NoError(t, err)
		for _, id := range []string{
			"11111111-1111-1111-1111-111111111111",
			"44444444-4444-4444-4444-444444444444",
			"55555555-5555-5555-5555-555555555555",
			"66666666-6666-6666-6666-666666666666",
		} {
			assert.NotContains(t, got, id)
		}
		// 中身（type や text）はそのまま残る。
		assert.Contains(t, got, "本文")
		assert.Contains(t, got, "bulletList")
	})

	t.Run("不正なJSONはErrPageDocInvalidを返す", func(t *testing.T) {
		_, err := regenerateBlockIDs(`not json`)
		require.ErrorIs(t, err, ErrPageDocInvalid)
	})

	// 変異確認: regenerateBlockIDs が id を削除しなかった場合、この後の parsePageDoc は
	// クライアント由来の attrs.id をそのまま採用してしまい、2 回とも同じ id 集合が
	// 返ってくる。同じ雛形から複数ページを作ると blocks.id（グローバルに一意な PK）が
	// 衝突するのは、まさにこの現象なので、id 集合が呼び出しごとに変わることを固定する。
	t.Run("同じ雛形を2回処理すると毎回別のブロックIDが割り振られる", func(t *testing.T) {
		blockIDsOf := func(input string) map[string]bool {
			regenerated, err := regenerateBlockIDs(input)
			require.NoError(t, err)
			tree, err := parsePageDoc(regenerated)
			require.NoError(t, err)
			rows, err := flattenPageDoc(tree)
			require.NoError(t, err)
			ids := make(map[string]bool, len(rows))
			for _, r := range rows {
				ids[r.ID] = true
			}
			return ids
		}

		first := blockIDsOf(doc)
		second := blockIDsOf(doc)
		require.Len(t, first, 4)
		require.Len(t, second, 4)
		for id := range first {
			assert.False(t, second[id], "1回目に採番されたid %sが2回目にも再利用されている（衝突の原因）", id)
		}
	})
}

// チケット参照も特定の 1 件への固定参照なので、pageRef と同じく雛形には残さない
// （雛形から作った複数のページが同じチケットを指しても意味をなさない）。
func Test_雛形保存時にチケット参照も取り除く(t *testing.T) {
	doc := `{"type":"doc","content":[{"type":"paragraph","content":[` +
		`{"type":"text","text":"前 "},` +
		`{"type":"ticketRef","attrs":{"ticketId":"00000000-0000-7000-8000-0000000000b1","title":"隠す"}},` +
		`{"type":"text","text":" 後"}]}]}`
	got, err := stripPageRefAndImageNodesForTemplate(doc)
	require.NoError(t, err)
	require.NotContains(t, got, "ticketRef")
	require.NotContains(t, got, "隠す")
	require.Contains(t, got, "前 ")
	require.Contains(t, got, " 後")
}
