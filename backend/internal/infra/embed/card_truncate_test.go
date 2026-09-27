package embed

import (
	"strings"
	"testing"
	"unicode/utf8"
	"unsafe"
)

func Test_項目の切り詰め_上限以下はそのまま(t *testing.T) {
	if got := truncateAndClone("Hello", 600); got != "Hello" {
		t.Fatalf("got %q", got)
	}
}

func Test_項目の切り詰め_上限で切る(t *testing.T) {
	got := truncateAndClone(strings.Repeat("a", 1000), 600)
	if len(got) != 600 {
		t.Fatalf("len = %d", len(got))
	}
}

func Test_項目の切り詰め_文字の途中で切らない(t *testing.T) {
	// 3 バイト文字を 601 バイトで切ると 201 文字目の途中になるので 200 文字に戻す
	got := truncateAndClone(strings.Repeat("あ", 300), 601)
	if !utf8.ValidString(got) {
		t.Fatalf("invalid utf8: %q", got[len(got)-3:])
	}
	if utf8.RuneCountInString(got) != 200 {
		t.Fatalf("runes = %d", utf8.RuneCountInString(got))
	}
}

func Test_項目の切り詰め_元の本文と記憶領域を共有しない(t *testing.T) {
	body := strings.Repeat("x", 512*1024)
	title := body[100:120]
	got := truncateAndClone(title, 600)
	if unsafe.StringData(got) == unsafe.StringData(title) {
		t.Fatal("部分文字列のまま返すと本文全体が GC されない")
	}
}
