package domain

import (
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

var testLinkPreviewLimits = LinkPreviewLimits{
	TitleBytes:       600,
	DescriptionBytes: 1500,
	ImageURLBytes:    2048,
	SiteNameBytes:    300,
}

func Test_リンクプレビュー_上限以下の項目はそのまま残す(t *testing.T) {
	preview := LinkPreview{URL: "https://example.com", Title: "Hello", Description: "Desc", ImageURL: "https://example.com/a.png", SiteName: "Example"}
	if got := preview.Truncate(testLinkPreviewLimits); got != preview {
		t.Fatalf("got %+v", got)
	}
}

func Test_リンクプレビュー_上限を超えた項目を上限のバイト数に切り詰める(t *testing.T) {
	long := strings.Repeat("a", 5000)
	got := LinkPreview{Title: long, Description: long, ImageURL: long, SiteName: long}.Truncate(testLinkPreviewLimits)
	if len(got.Title) != 600 || len(got.Description) != 1500 || len(got.ImageURL) != 2048 || len(got.SiteName) != 300 {
		t.Fatalf("title=%d desc=%d image=%d site=%d", len(got.Title), len(got.Description), len(got.ImageURL), len(got.SiteName))
	}
}

func Test_リンクプレビュー_切り詰めても文字の途中では切らない(t *testing.T) {
	// 3 バイト文字を 601 バイトで切ると 201 文字目の途中になるので 200 文字に戻す
	limits := testLinkPreviewLimits
	limits.TitleBytes = 601
	got := LinkPreview{Title: strings.Repeat("あ", 300)}.Truncate(limits)
	if !utf8.ValidString(got.Title) || utf8.RuneCountInString(got.Title) != 200 {
		t.Fatalf("valid=%v runes=%d", utf8.ValidString(got.Title), utf8.RuneCountInString(got.Title))
	}
}

func Test_リンクプレビュー_URL以外の文字列項目にはすべて上限がある(t *testing.T) {
	limitFields := map[string]bool{}
	limitsType := reflect.TypeFor[LinkPreviewLimits]()
	for i := range limitsType.NumField() {
		limitFields[limitsType.Field(i).Name] = true
	}
	previewType := reflect.TypeFor[LinkPreview]()
	for i := range previewType.NumField() {
		field := previewType.Field(i)
		if field.Type.Kind() != reflect.String || field.Name == "URL" {
			continue
		}
		if !limitFields[field.Name+"Bytes"] {
			t.Errorf("LinkPreview.%s の上限が LinkPreviewLimits に無いので、Truncate でも切り詰められない", field.Name)
		}
	}
}

func Test_リンクプレビューのエラー_ほかのエラーで包んでも種類を見分けられる(t *testing.T) {
	wrapped := fmt.Errorf("fetch: %w", ErrLinkPreviewUnsafeHost)
	if !errors.Is(wrapped, ErrLinkPreviewUnsafeHost) || errors.Is(wrapped, ErrLinkPreviewUnreachable) {
		t.Fatalf("errors.Is が区別できていない: %v", wrapped)
	}
}
