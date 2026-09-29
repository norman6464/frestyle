package ogp

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"

	"code.dny.dev/ssrf"
	"github.com/go-resty/resty/v2"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

type Page struct {
	URL  string
	Body []byte
}

type HTMLFetcher interface {
	FetchHTML(ctx context.Context, rawURL string) (Page, error)
}

type HTMLClientConfig struct {
	Timeout      time.Duration
	MaxRedirects int
	MaxBodyBytes int64
	UserAgent    string
}

type HTMLClient struct {
	httpClient   *resty.Client
	maxBodyBytes int64
}

func NewHTMLClient(config HTMLClientConfig, roundTripper http.RoundTripper) *HTMLClient {
	// nil のまま resty に渡すと resty の既定の接続設定が使われ、SSRF 対策が効かなくなる
	if roundTripper == nil {
		roundTripper = NewSafeRoundTripper(config.Timeout)
	}
	httpClient := resty.New().
		SetTransport(roundTripper).
		// 取得先ごとに Cookie を上限なく溜めてしまうので保存しない
		SetCookieJar(nil).
		SetTimeout(config.Timeout).
		SetRedirectPolicy(
			// resty は送った要求の数で数えるので、最初の 1 回を足してリダイレクトの回数に揃える
			resty.FlexibleRedirectPolicy(config.MaxRedirects+1),
			resty.RedirectPolicyFunc(redirectOnlyToHTTPS),
			reapplyUserAgent(config.UserAgent),
		).
		SetHeader("User-Agent", config.UserAgent).
		SetHeader("Accept", "text/html,application/xhtml+xml").
		// 上限を超えた本文をエラーにせず、先頭だけを読むため
		SetDoNotParseResponse(true)
	return &HTMLClient{httpClient: httpClient, maxBodyBytes: config.MaxBodyBytes}
}

// NewSafeRoundTripper は接続の直前に宛先の IP とポートを検査するので、リダイレクト先や DNS の差し替えにも効く
func NewSafeRoundTripper(dialTimeout time.Duration) http.RoundTripper {
	// https しか取りに行かないので、既定で許される 80 番も閉じる
	guardian := ssrf.New(ssrf.WithPorts(443))
	dialer := &net.Dialer{Timeout: dialTimeout, Control: guardian.Safe}
	roundTripper := http.DefaultTransport.(*http.Transport).Clone()
	roundTripper.DialContext = dialer.DialContext
	// プロキシを通すと検査の対象がプロキシの IP になってしまう
	roundTripper.Proxy = nil
	return roundTripper
}

func (client *HTMLClient) FetchHTML(ctx context.Context, rawURL string) (Page, error) {
	target, err := url.Parse(rawURL)
	if err != nil {
		return Page{}, fmt.Errorf("%w: %w", domain.ErrLinkPreviewInvalidURL, err)
	}
	if err := requireHTTPSURL(target); err != nil {
		return Page{}, err
	}

	resp, err := client.httpClient.R().SetContext(ctx).Get(target.String())
	if resp != nil && resp.RawBody() != nil {
		defer resp.RawBody().Close()
	}
	if err != nil {
		return Page{}, classifyFetchError(err)
	}
	if resp.StatusCode() >= http.StatusBadRequest {
		return Page{}, fmt.Errorf("%w: status=%d", domain.ErrLinkPreviewUnreachable, resp.StatusCode())
	}

	body, err := io.ReadAll(io.LimitReader(resp.RawBody(), client.maxBodyBytes))
	// OGP は先頭の <head> にあるので、途中で切れても読めた分があれば使う
	if err != nil && len(body) == 0 {
		return Page{}, fmt.Errorf("%w: %w", domain.ErrLinkPreviewUnreachable, err)
	}
	return Page{URL: resp.RawResponse.Request.URL.String(), Body: body}, nil
}

func requireHTTPSURL(target *url.URL) error {
	if target.Scheme != "https" || target.Host == "" {
		return fmt.Errorf("%w: %q", domain.ErrLinkPreviewInvalidURL, target.Redacted())
	}
	return nil
}

func redirectOnlyToHTTPS(req *http.Request, _ []*http.Request) error {
	return requireHTTPSURL(req.URL)
}

// resty は別のホストへ移ると User-Agent を自分の名前に書き換えるので、名乗り直す
func reapplyUserAgent(userAgent string) resty.RedirectPolicyFunc {
	return func(req *http.Request, _ []*http.Request) error {
		req.Header.Set("User-Agent", userAgent)
		return nil
	}
}

func classifyFetchError(err error) error {
	switch {
	case errors.Is(err, domain.ErrLinkPreviewInvalidURL):
		return err
	case errors.Is(err, ssrf.ErrProhibitedIP),
		errors.Is(err, ssrf.ErrProhibitedPort),
		errors.Is(err, ssrf.ErrProhibitedNetwork),
		errors.Is(err, ssrf.ErrInvalidHostPort):
		return fmt.Errorf("%w: %w", domain.ErrLinkPreviewUnsafeHost, err)
	default:
		return fmt.Errorf("%w: %w", domain.ErrLinkPreviewUnreachable, err)
	}
}
