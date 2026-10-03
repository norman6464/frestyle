// Package ogp は取得と解析に使うライブラリの型とエラーを外に出さないための腐敗防止層
package ogp

import (
	"context"
	"strings"
	"time"

	"github.com/jellydator/ttlcache/v3"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

type CacheConfig struct {
	TTL        time.Duration
	MaxEntries uint64
	MaxBytes   uint64
}

type Fetcher struct {
	html       HTMLFetcher
	translator Translator
	cache      *ttlcache.Cache[string, domain.LinkPreview]
}

func NewFetcher(html HTMLFetcher, translator Translator, cacheConfig CacheConfig) *Fetcher {
	cache := ttlcache.New(
		ttlcache.WithTTL[string, domain.LinkPreview](cacheConfig.TTL),
		ttlcache.WithCapacity[string, domain.LinkPreview](cacheConfig.MaxEntries),
		// 読むたびに期限が延びると、よく読まれるカードが古いまま残り続ける
		ttlcache.WithDisableTouchOnHit[string, domain.LinkPreview](),
		ttlcache.WithMaxCost(cacheConfig.MaxBytes, previewCost),
	)
	return &Fetcher{html: html, translator: translator, cache: cache}
}

func (f *Fetcher) Fetch(ctx context.Context, rawURL string) (domain.LinkPreview, error) {
	key := strings.TrimSpace(rawURL)
	if item := f.cache.Get(key); item != nil {
		return item.Value(), nil
	}

	page, err := f.html.FetchHTML(ctx, key)
	if err != nil {
		return domain.LinkPreview{}, err
	}
	preview, err := f.translator.ToLinkPreview(key, page)
	if err != nil {
		return domain.LinkPreview{}, err
	}

	// translator が返す文字列やキーは、解析途中の大きな文字列や要求の一部を参照していることがある
	// 複製してから保持しないと、切り詰めても元の文字列がキャッシュに残る
	preview = clonePreview(preview)
	f.cache.Set(strings.Clone(key), preview, ttlcache.DefaultTTL)
	return preview, nil
}

func previewCost(item ttlcache.CostItem[string, domain.LinkPreview]) uint64 {
	preview := item.Value
	return uint64(len(item.Key) + len(preview.URL) + len(preview.Title) + len(preview.Description) + len(preview.ImageURL) + len(preview.SiteName))
}

func clonePreview(preview domain.LinkPreview) domain.LinkPreview {
	preview.URL = strings.Clone(preview.URL)
	preview.Title = strings.Clone(preview.Title)
	preview.Description = strings.Clone(preview.Description)
	preview.ImageURL = strings.Clone(preview.ImageURL)
	preview.SiteName = strings.Clone(preview.SiteName)
	return preview
}
