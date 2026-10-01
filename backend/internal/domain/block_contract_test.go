package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// kbBlockTypesContractPath はリポジトリ直下の契約ファイル。frontend の本文エディタのテストも
// 同じファイルを読み、スキーマ（withBlockId を付けたノード）と突き合わせる。
const kbBlockTypesContractPath = "../../../contracts/kb-block-types.json"

type kbBlockTypesContract struct {
	BlockTypes []struct {
		Type      string `json:"type"`
		Container bool   `json:"container"`
	} `json:"blockTypes"`
}

// Test_BlockTypes_契約ファイルと一致 は、保存を許す種類とその容器かどうかが
// contracts/kb-block-types.json と完全に一致することを確かめる。
//
// 種類を足すときに backend の表だけ・契約ファイルだけを直すと、ここで落ちる。
// 容器かどうかが食い違うと、保存は通るのに中の段落が行にならず、検索・コメント・
// 被リンクが黙って壊れるので、名前だけでなく容器かどうかまで比べる。
func Test_BlockTypes_契約ファイルと一致(t *testing.T) {
	raw, err := os.ReadFile(filepath.Clean(kbBlockTypesContractPath))
	if err != nil {
		t.Fatalf("契約ファイルを読めません: %v", err)
	}
	var contract kbBlockTypesContract
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatalf("契約ファイルが JSON として読めません: %v", err)
	}
	if len(contract.BlockTypes) == 0 {
		t.Fatal("契約ファイルに種類が 1 つもありません")
	}

	want := make(map[BlockType]bool, len(contract.BlockTypes))
	for _, e := range contract.BlockTypes {
		if e.Type == "" {
			t.Fatal("契約ファイルに空の種類があります")
		}
		if _, dup := want[BlockType(e.Type)]; dup {
			t.Fatalf("契約ファイルで %q が重複しています", e.Type)
		}
		want[BlockType(e.Type)] = e.Container
	}

	got := make(map[BlockType]bool, len(ValidBlockTypes))
	for _, v := range ValidBlockTypes {
		got[v] = v.IsContainer()
	}

	for typ, container := range want {
		g, ok := got[typ]
		if !ok {
			t.Errorf("契約ファイルにある %q が backend の表にありません", typ)
			continue
		}
		if g != container {
			t.Errorf("%q の容器かどうかが違います: 契約 %v, backend %v", typ, container, g)
		}
	}
	for typ := range got {
		if _, ok := want[typ]; !ok {
			t.Errorf("backend の表にある %q が契約ファイルにありません", typ)
		}
	}
}

func Test_BlockType_IsContainer(t *testing.T) {
	cases := []struct {
		name string
		t    BlockType
		want bool
	}{
		{"引用は中にブロックを持つ", BlockTypeBlockquote, true},
		{"表の行は中にセルを持つ", BlockTypeTableRow, true},
		{"タスクの項目は中に段落を持つ", BlockTypeTaskItem, true},
		{"段落は葉", BlockTypeParagraph, false},
		{"画像は葉（中身を持たない）", BlockTypeImage, false},
		{"区切り線は葉（中身を持たない）", BlockTypeHorizontalRule, false},
		{"未知の種類は容器ではない", BlockType("weird"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.t.IsContainer(); got != tc.want {
				t.Fatalf("IsContainer() = %v, want %v", got, tc.want)
			}
		})
	}
}
