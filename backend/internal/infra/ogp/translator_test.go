package ogp

import (
	"strings"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

var testLimits = domain.LinkPreviewLimits{TitleBytes: 600, DescriptionBytes: 1500, ImageURLBytes: 2048, SiteNameBytes: 300}

func translate(t *testing.T, requestURL, body string) domain.LinkPreview {
	t.Helper()
	preview, err := NewOpenGraphTranslator(testLimits).ToLinkPreview(requestURL, Page{URL: requestURL, Body: []byte(body)})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	return preview
}

func Test_OGPの変換_OGPの各項目をリンクプレビューの項目にする(t *testing.T) {
	got := translate(t, "https://example.com/post", `<html><head>
		<meta property="og:title" content="Hello Title">
		<meta content='Hello Desc' property="og:description">
		<meta property="og:image" content="https://example.com/a.png">
		<meta property="og:site_name" content="Example &amp; Co">
	</head></html>`)
	want := domain.LinkPreview{URL: "https://example.com/post", Title: "Hello Title", Description: "Hello Desc", ImageURL: "https://example.com/a.png", SiteName: "Example & Co"}
	if got != want {
		t.Fatalf("got  %+v\nwant %+v", got, want)
	}
}

func Test_OGPの変換_ルート相対の画像を取得先のURLで絶対URLに直す(t *testing.T) {
	got := translate(t, "https://example.com/post/1", `<meta property="og:title" content="x"><meta property="og:image" content="/img/a.png">`)
	if got.ImageURL != "https://example.com/img/a.png" {
		t.Fatalf("image = %q", got.ImageURL)
	}
}

func Test_OGPの変換_ディレクトリ相対の画像はRFC3986どおりに解決する(t *testing.T) {
	got := translate(t, "https://example.com/post/1", `<meta property="og:title" content="x"><meta property="og:image" content="img/a.png">`)
	if got.ImageURL != "https://example.com/post/img/a.png" {
		t.Fatalf("image = %q", got.ImageURL)
	}
}

func Test_OGPの変換_空の画像URLは飛ばして次の画像を使う(t *testing.T) {
	got := translate(t, "https://example.com/post/1", `<meta property="og:title" content="x"><meta property="og:image" content=""><meta property="og:image" content="https://example.com/b.png">`)
	if got.ImageURL != "https://example.com/b.png" {
		t.Fatalf("image = %q", got.ImageURL)
	}
}

func Test_OGPの変換_ページが示す正規URLが壊れていてもカードを作る(t *testing.T) {
	got := translate(t, "https://example.com/post", `<meta property="og:title" content="x"><meta property="og:url" content="https://example.com/100%-off"><meta property="og:image" content="/a.png">`)
	if got.Title != "x" || got.ImageURL != "https://example.com/a.png" {
		t.Fatalf("got = %+v", got)
	}
}

func Test_OGPの変換_OGPの題名が無ければtitleタグの題名を使う(t *testing.T) {
	got := translate(t, "https://example.com", `<html><head><title>  Plain Title  </title></head></html>`)
	if got.Title != "Plain Title" {
		t.Fatalf("title = %q", got.Title)
	}
}

func Test_OGPの変換_題名が見つからなければホスト名を使う(t *testing.T) {
	got := translate(t, "https://example.com/post", `<html><body>no title</body></html>`)
	if got.Title != "example.com" {
		t.Fatalf("title = %q", got.Title)
	}
}

func Test_OGPの変換_上限を超えた項目は上限のバイト数まで切り詰める(t *testing.T) {
	huge := strings.Repeat("A", 400*1024)
	got := translate(t, "https://example.com", `<html><head><title>`+huge+`</title>`+
		`<meta property="og:description" content="`+huge[:4000]+`">`+
		`<meta property="og:site_name" content="`+huge[:4000]+`">`+
		`<meta property="og:image" content="https://example.com/`+huge[:4000]+`">`+
		`</head></html>`)
	if len(got.Title) != testLimits.TitleBytes || len(got.Description) != testLimits.DescriptionBytes ||
		len(got.ImageURL) != testLimits.ImageURLBytes || len(got.SiteName) != testLimits.SiteNameBytes {
		t.Fatalf("title=%d desc=%d image=%d site=%d", len(got.Title), len(got.Description), len(got.ImageURL), len(got.SiteName))
	}
}
