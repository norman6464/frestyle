// Package embed は外部 URL の OGP / oEmbed メタ情報を取得し、Embed カード描画用に返す。
// SSRF 対策で https のみ許可、結果は In-Memory LRU で薄くキャッシュする。
package embed

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	defaultHTTPTimeout = 6 * time.Second
	maxBodyBytes       = 512 * 1024 // OGP 抽出に要るのは <head> の一部のみ
	cacheTTL           = 30 * time.Minute
	cacheMaxEntries    = 256
	cacheMaxBytes      = 2 * 1024 * 1024
	cacheMaxKeyBytes   = 2048
	userAgent          = "FreStyle/1.0 (+https://frestyle.dev)"
)

// Card はフロントエンドに返す統一カード DTO。
// OGP / oEmbed どちらの経路で取得しても同形式で返す。
type Card struct {
	URL         string `json:"url"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	ImageURL    string `json:"imageUrl,omitempty"`
	SiteName    string `json:"siteName,omitempty"`
	// Provider は "ogp" / "youtube" / "github" など、どの戦略で解決したかを示す。
	Provider string `json:"provider,omitempty"`
}

// Fetcher は URL → Card を解決する。
type Fetcher struct {
	client *http.Client
	cache  *cache
}

// maxRedirects は追うリダイレクトの最大ホップ数。CheckRedirect を独自設定すると net/http の
// 既定（10 ホップ）が効かなくなるため、同じ値をここで明示する。
const maxRedirects = 10

// NewFetcher は本番デフォルト設定で Fetcher を返す。Transport.DialContext を safeDialContext
// に差し替えることで、最初の接続だけでなくリダイレクトで新しく張る接続も含め、すべての接続が
// 「解決した IP が外部向けか」の検査を通る（safeDialContext の doc 参照）。CheckRedirect は
// IP の再検査までは担わず、スキーム検査（https のみ）だけをホップごとにやり直す。
func NewFetcher() *Fetcher {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	dialer := &net.Dialer{Timeout: defaultHTTPTimeout}
	transport.DialContext = safeDialContext(defaultResolve, dialer.DialContext)
	f := &Fetcher{cache: newCache(cacheMaxEntries, cacheMaxBytes)}
	f.client = &http.Client{
		Timeout:       defaultHTTPTimeout,
		Transport:     transport,
		CheckRedirect: f.checkRedirect,
	}
	return f
}

// NewFetcherWithClient はテスト用。http.Client を丸ごと差し替える（safeDialContext /
// checkRedirect は適用されない——httptest サーバの Transport を使うため、これらの
// 本番専用の防御には元々乗らない経路）。
func NewFetcherWithClient(c *http.Client) *Fetcher {
	if c == nil {
		c = &http.Client{Timeout: defaultHTTPTimeout}
	}
	return &Fetcher{client: c, cache: newCache(cacheMaxEntries, cacheMaxBytes)}
}

// checkRedirect はリダイレクト追跡のホップごとに呼ばれる。IP の安全性は safeDialContext が
// ホップごとの新規接続で必ず検査するので、ここではスキーム（https のみ）とホップ数だけを見る。
func (f *Fetcher) checkRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= maxRedirects {
		return fmt.Errorf("%w: stopped after %d redirects", ErrUnreachable, maxRedirects)
	}
	return validateScheme(req.URL)
}

var (
	// ErrInvalidURL は URL parse 不能 / scheme が https でない / host が空 等。
	ErrInvalidURL = errors.New("embed: invalid url")
	// ErrUnreachable は HTTP 通信の失敗（DNS / TLS / timeout）。
	ErrUnreachable = errors.New("embed: target unreachable")
	// ErrUnsupportedHost は SSRF 防御で localhost / private IP に向けた要求を弾いたとき。
	ErrUnsupportedHost = errors.New("embed: unsupported host")
)

// Resolve は与えた URL を Card に解決する。キャッシュヒット時は HTTP を踏まない。
func (f *Fetcher) Resolve(ctx context.Context, raw string) (*Card, error) {
	u, err := f.validateURL(raw)
	if err != nil {
		return nil, err
	}
	key := u.String()
	// 鍵は再エスケープで入力の約 3 倍まで伸びるので、入力ではなく鍵の長さで保持を決める
	cacheable := len(key) <= cacheMaxKeyBytes
	if cacheable {
		if c, ok := f.cache.get(key); ok {
			return c, nil
		}
	}
	card, err := f.resolveOGP(ctx, u)
	if err != nil {
		return nil, err
	}
	if cacheable {
		f.cache.set(key, card)
	}
	return card, nil
}

// validateURL は URL をパースし、scheme=https / host 非空を検証する。
//
// 「private / local なホストでないか」はここでは見ない。文字列照合（旧実装）はホスト名にしか
// 効かず、公開ドメインを private / metadata の IP へ向ける変種（DNS リバインディング含む）を
// 素通りさせてしまう。その検査は実際に接続する瞬間の IP に対して行うべきなので、
// safeDialContext（ssrf_guard.go）へ寄せてある。
func (f *Fetcher) validateURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidURL, err)
	}
	if err := validateScheme(u); err != nil {
		return nil, err
	}
	return u, nil
}

// validateScheme は https のみを許可する。初回の URL・リダイレクト先の双方から
// 呼ぶ共通ロジック（f.checkRedirect 参照）。
func validateScheme(u *url.URL) error {
	if u.Scheme != "https" {
		return fmt.Errorf("%w: scheme must be https", ErrInvalidURL)
	}
	if u.Host == "" {
		return fmt.Errorf("%w: empty host", ErrInvalidURL)
	}
	return nil
}

// resolveOGP はシンプルな OGP 抽出。
func (f *Fetcher) resolveOGP(ctx context.Context, u *url.URL) (*Card, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidURL, err)
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")

	resp, err := f.client.Do(req)
	if err != nil {
		// ここでさらに ErrUnreachable として包むが、safeDialContext / checkRedirect が返した
		// ErrUnsupportedHost・ErrInvalidURL は（net/http の *url.Error / *net.OpError 越しでも）
		// err の中に残るため errors.Is で拾える（embed_handler.go の switch はそちらを
		// ErrUnreachable より先に判定するので、より具体的な分岐が優先される）。
		return nil, fmt.Errorf("%w: %w", ErrUnreachable, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("%w: status=%d", ErrUnreachable, resp.StatusCode)
	}

	limited := io.LimitReader(resp.Body, maxBodyBytes)
	body, _ := io.ReadAll(limited)
	html := string(body)

	card := &Card{URL: u.String(), Provider: "ogp"}
	card.Title = firstMeta(html, []string{`property="og:title"`, `name="twitter:title"`})
	card.Description = firstMeta(html, []string{`property="og:description"`, `name="twitter:description"`, `name="description"`})
	card.ImageURL = firstMeta(html, []string{`property="og:image"`, `name="twitter:image"`})
	card.SiteName = firstMeta(html, []string{`property="og:site_name"`})
	if card.Title == "" {
		card.Title = extractTitleTag(html)
	}
	if card.Title == "" {
		card.Title = u.Host
	}
	card.Title = truncateAndClone(card.Title, maxTitleBytes)
	card.Description = truncateAndClone(card.Description, maxDescriptionBytes)
	card.ImageURL = truncateAndClone(card.ImageURL, maxImageURLBytes)
	card.SiteName = truncateAndClone(card.SiteName, maxSiteNameBytes)
	return card, nil
}

// firstMeta は <meta property|name="..." content="..."> を順番に試して最初に見つかった content を返す。
// HTML パーサーは入れず、正規表現で十分（OGP は基本的に <head> 内の単純なメタタグ）。
func firstMeta(html string, selectors []string) string {
	for _, sel := range selectors {
		// <meta {sel} content="..."> または <meta content="..." {sel}>
		patterns := []string{
			fmt.Sprintf(`<meta\s+[^>]*?%s[^>]*?content="([^"]*)"`, regexp.QuoteMeta(sel)),
			fmt.Sprintf(`<meta\s+[^>]*?content="([^"]*)"[^>]*?%s`, regexp.QuoteMeta(sel)),
		}
		for _, p := range patterns {
			re := regexp.MustCompile(p)
			m := re.FindStringSubmatch(html)
			if len(m) > 1 && m[1] != "" {
				return strings.TrimSpace(m[1])
			}
		}
	}
	return ""
}

// extractTitleTag は <title>...</title> を最初の 1 件だけ拾う。
func extractTitleTag(html string) string {
	re := regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	m := re.FindStringSubmatch(html)
	if len(m) > 1 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

type cacheEntry struct {
	card    *Card
	expires time.Time
	size    int
}

type cache struct {
	mu       sync.Mutex
	max      int
	maxBytes int
	bytes    int
	entries  map[string]cacheEntry
}

func newCache(maxEntries, maxBytes int) *cache {
	return &cache{max: maxEntries, maxBytes: maxBytes, entries: make(map[string]cacheEntry)}
}

func entrySize(key string, card *Card) int {
	return len(key) + len(card.URL) + len(card.Title) + len(card.Description) + len(card.ImageURL) + len(card.SiteName) + len(card.Provider)
}

func (c *cache) get(key string) (*Card, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok {
		return nil, false
	}
	if time.Now().After(entry.expires) {
		c.removeLocked(key)
		return nil, false
	}
	return entry.card, true
}

func (c *cache) set(key string, card *Card) {
	size := entrySize(key, card)
	if size > c.maxBytes {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.removeLocked(key)
	for len(c.entries) > 0 && c.overBudgetWith(size) {
		c.evictOneLocked()
	}
	c.entries[key] = cacheEntry{card: card, expires: time.Now().Add(cacheTTL), size: size}
	c.bytes += size
}

func (c *cache) overBudgetWith(size int) bool {
	return len(c.entries) >= c.max || c.bytes+size > c.maxBytes
}

func (c *cache) evictOneLocked() {
	for key := range c.entries {
		c.removeLocked(key)
		return
	}
}

func (c *cache) removeLocked(key string) {
	if entry, ok := c.entries[key]; ok {
		c.bytes -= entry.size
		delete(c.entries, key)
	}
}
