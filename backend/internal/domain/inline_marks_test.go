package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

const kbInlineAttrsContractPath = "../../../contracts/kb-inline-attrs.json"

type kbInlineAttrsContract struct {
	Marks map[string]struct {
		Color []string `json:"color"`
	} `json:"marks"`
}

// Test_InlineMarkColors_契約ファイルと一致 は、文字色・蛍光ペンに許す色の名前が
// contracts/kb-inline-attrs.json と完全に一致することを確かめる（マークの種類も、名前の集合も）。
func Test_InlineMarkColors_契約ファイルと一致(t *testing.T) {
	raw, err := os.ReadFile(filepath.Clean(kbInlineAttrsContractPath))
	if err != nil {
		t.Fatalf("契約ファイルを読めません: %v", err)
	}
	var contract kbInlineAttrsContract
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatalf("契約ファイルが JSON として読めません: %v", err)
	}

	// マークの種類: 契約にある種類と backend が色を検査する種類が一致する。
	for markType := range contract.Marks {
		if !IsColoredInlineMark(markType) {
			t.Errorf("契約ファイルにあるマーク %q を backend は色付きのマークとして扱っていません", markType)
		}
	}
	for _, markType := range ColoredInlineMarkTypes {
		if _, ok := contract.Marks[markType]; !ok {
			t.Errorf("backend が色付きとして扱うマーク %q が契約ファイルにありません", markType)
		}
	}

	// 色の名前: どのマークも同じ集合（InlineMarkColorNames）を使う。
	for markType, spec := range contract.Marks {
		if len(spec.Color) == 0 {
			t.Fatalf("契約ファイルの %q に色が 1 つもありません", markType)
		}
		want := map[string]bool{}
		for _, name := range spec.Color {
			if want[name] {
				t.Fatalf("契約ファイルの %q で色 %q が重複しています", markType, name)
			}
			want[name] = true
			if !IsInlineMarkColor(name) {
				t.Errorf("契約ファイルの %q にある色 %q を backend は許していません", markType, name)
			}
		}
		for _, name := range InlineMarkColorNames {
			if !want[name] {
				t.Errorf("backend が許す色 %q が契約ファイルの %q にありません", name, markType)
			}
		}
	}
}

func Test_IsInlineMarkColor(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want bool
	}{
		{"許した名前", "red", true},
		{"許した名前（gray）", "gray", true},
		{"生の色コードは許さない", "#ff0000", false},
		{"CSS の関数は許さない", "rgb(255,0,0)", false},
		{"大文字違いは許さない", "Red", false},
		{"空文字", "", false},
		{"前後の空白", " red", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsInlineMarkColor(tc.in); got != tc.want {
				t.Fatalf("IsInlineMarkColor(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}
