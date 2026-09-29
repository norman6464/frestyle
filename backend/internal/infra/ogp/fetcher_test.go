package ogp

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
	"unsafe"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

type fakeHTMLFetcher struct {
	body  string
	err   error
	calls int
}

func (f *fakeHTMLFetcher) FetchHTML(_ context.Context, rawURL string) (Page, error) {
	f.calls++
	if f.err != nil {
		return Page{}, f.err
	}
	return Page{URL: rawURL, Body: []byte(f.body)}, nil
}

type fakeTranslator struct {
	preview domain.LinkPreview
}

func (f fakeTranslator) ToLinkPreview(requestURL string, _ Page) (domain.LinkPreview, error) {
	preview := f.preview
	preview.URL = requestURL
	return preview, nil
}

var testCacheConfig = CacheConfig{TTL: time.Minute, MaxEntries: 100, MaxBytes: 1 << 20}

func newTestFetcher(html HTMLFetcher, cacheConfig CacheConfig) *Fetcher {
	return NewFetcher(html, NewOpenGraphTranslator(testLimits), cacheConfig)
}

func Test_OGP取得_差し込んだtranslatorの変換結果を返す(t *testing.T) {
	translator := fakeTranslator{preview: domain.LinkPreview{Title: "from translator"}}
	got, err := NewFetcher(&fakeHTMLFetcher{}, translator, testCacheConfig).Fetch(context.Background(), "https://example.com")
	if err != nil || got.Title != "from translator" || got.URL != "https://example.com" {
		t.Fatalf("got=%+v err=%v", got, err)
	}
}

func Test_OGP取得_HTMLを取れなければ取得側のエラーをそのまま返す(t *testing.T) {
	html := &fakeHTMLFetcher{err: fmt.Errorf("wrapped: %w", domain.ErrLinkPreviewUnsafeHost)}
	_, err := newTestFetcher(html, testCacheConfig).Fetch(context.Background(), "https://example.com")
	if !errors.Is(err, domain.ErrLinkPreviewUnsafeHost) {
		t.Fatalf("err = %v", err)
	}
}

func Test_OGP取得_同じURLは2回目から取得しない(t *testing.T) {
	html := &fakeHTMLFetcher{body: `<title>x</title>`}
	fetcher := newTestFetcher(html, testCacheConfig)
	for range 3 {
		if _, err := fetcher.Fetch(context.Background(), "https://example.com"); err != nil {
			t.Fatalf("err: %v", err)
		}
	}
	if html.calls != 1 {
		t.Fatalf("calls = %d", html.calls)
	}
}

func Test_OGP取得_失敗した結果はキャッシュしない(t *testing.T) {
	html := &fakeHTMLFetcher{err: domain.ErrLinkPreviewUnreachable}
	fetcher := newTestFetcher(html, testCacheConfig)
	for range 2 {
		_, _ = fetcher.Fetch(context.Background(), "https://example.com")
	}
	if html.calls != 2 {
		t.Fatalf("calls = %d", html.calls)
	}
}

func Test_OGP取得_キャッシュのキーは要求の文字列を参照し続けない(t *testing.T) {
	requestLine := "https://example.com/x&pad=" + strings.Repeat("p", 512*1024)
	rawURL := requestLine[:len("https://example.com/x")]
	fetcher := newTestFetcher(&fakeHTMLFetcher{body: `<title>x</title>`}, testCacheConfig)
	if _, err := fetcher.Fetch(context.Background(), rawURL); err != nil {
		t.Fatalf("err: %v", err)
	}
	for _, key := range fetcher.cache.Keys() {
		if unsafe.StringData(key) == unsafe.StringData(rawURL) {
			t.Fatal("キーが要求の部分文字列のままだと、要求行全体がキャッシュに残ってしまう")
		}
	}
}

func Test_OGP取得_保持する合計バイト数が上限を超えたら古い順に追い出す(t *testing.T) {
	html := &fakeHTMLFetcher{body: `<title>` + strings.Repeat("t", 400) + `</title>`}
	cacheConfig := testCacheConfig
	cacheConfig.MaxBytes = 1000
	fetcher := newTestFetcher(html, cacheConfig)
	for i := range 3 {
		if _, err := fetcher.Fetch(context.Background(), fmt.Sprintf("https://example.com/%d", i)); err != nil {
			t.Fatalf("err: %v", err)
		}
	}
	if _, err := fetcher.Fetch(context.Background(), "https://example.com/0"); err != nil {
		t.Fatalf("err: %v", err)
	}
	if html.calls != 4 {
		t.Fatalf("最初の 1 件は予算を超えた時点で追い出されるはず: calls=%d", html.calls)
	}
}

func Test_OGP取得_キャッシュの期限は読み出しても延びない(t *testing.T) {
	html := &fakeHTMLFetcher{body: `<title>x</title>`}
	cacheConfig := testCacheConfig
	cacheConfig.TTL = 200 * time.Millisecond
	fetcher := newTestFetcher(html, cacheConfig)
	for range 3 {
		if _, err := fetcher.Fetch(context.Background(), "https://example.com"); err != nil {
			t.Fatalf("err: %v", err)
		}
		time.Sleep(120 * time.Millisecond)
	}
	if html.calls != 2 {
		t.Fatalf("読むたびに期限が延びると、よく読まれる古いカードがいつまでも残る: calls=%d", html.calls)
	}
}

type substringTranslator struct {
	source string
}

func (t substringTranslator) ToLinkPreview(_ string, _ Page) (domain.LinkPreview, error) {
	return domain.LinkPreview{URL: t.source[0:5], Title: t.source[10:15], Description: t.source[20:25], ImageURL: t.source[30:35], SiteName: t.source[40:45]}, nil
}

func Test_OGP取得_複製しないtranslatorを差し込んでも元の大きな文字列を参照し続けない(t *testing.T) {
	source := strings.Repeat("x", 512*1024)
	fetcher := NewFetcher(&fakeHTMLFetcher{}, substringTranslator{source: source}, testCacheConfig)
	if _, err := fetcher.Fetch(context.Background(), "https://example.com"); err != nil {
		t.Fatalf("err: %v", err)
	}
	start := uintptr(unsafe.Pointer(unsafe.StringData(source)))
	end := start + uintptr(len(source))
	for _, cached := range fetcher.cache.Items() {
		preview := cached.Value()
		for name, value := range map[string]string{"URL": preview.URL, "Title": preview.Title, "Description": preview.Description, "ImageURL": preview.ImageURL, "SiteName": preview.SiteName} {
			if data := uintptr(unsafe.Pointer(unsafe.StringData(value))); data >= start && data < end {
				t.Errorf("キャッシュの %s が translator の返した部分文字列のままになっている", name)
			}
		}
	}
}

func Test_OGP取得_保持する値はどの項目も元の文字列から切り離す(t *testing.T) {
	source := strings.Repeat("x", 512*1024)
	var preview domain.LinkPreview
	value := reflect.ValueOf(&preview).Elem()
	for i := range value.NumField() {
		if value.Field(i).Kind() == reflect.String {
			value.Field(i).SetString(source[i*10 : i*10+5])
		}
	}

	cloned := reflect.ValueOf(clonePreview(preview))
	for i := range value.NumField() {
		field := value.Type().Field(i)
		if field.Type.Kind() != reflect.String {
			continue
		}
		if unsafe.StringData(value.Field(i).String()) == unsafe.StringData(cloned.Field(i).String()) {
			t.Errorf("LinkPreview.%s を複製していないので、元の大きな文字列が解放されない", field.Name)
		}
	}
}
