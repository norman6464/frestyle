package ogp

import (
	"bytes"
	"fmt"
	"net/url"
	"strings"

	"github.com/otiai10/opengraph/v2"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// 解析のライブラリを替えるときに、実装を差し替えるだけで済むよう interface にしている
type Translator interface {
	ToLinkPreview(requestURL string, page Page) (domain.LinkPreview, error)
}

type OpenGraphTranslator struct {
	limits domain.LinkPreviewLimits
}

func NewOpenGraphTranslator(limits domain.LinkPreviewLimits) *OpenGraphTranslator {
	return &OpenGraphTranslator{limits: limits}
}

func (translator *OpenGraphTranslator) ToLinkPreview(requestURL string, page Page) (domain.LinkPreview, error) {
	graph := opengraph.New(page.URL)
	if err := graph.Parse(bytes.NewReader(page.Body)); err != nil {
		return domain.LinkPreview{}, fmt.Errorf("%w: %w", domain.ErrLinkPreviewUnreachable, err)
	}

	preview := domain.LinkPreview{
		URL:         requestURL,
		Title:       titleOrHost(graph.Title, requestURL),
		Description: strings.TrimSpace(graph.Description),
		ImageURL:    firstImageURL(page.URL, graph.Image),
		SiteName:    strings.TrimSpace(graph.SiteName),
	}
	return preview.Truncate(translator.limits), nil
}

func titleOrHost(title, requestURL string) string {
	if trimmed := strings.TrimSpace(title); trimmed != "" {
		return trimmed
	}
	parsed, err := url.Parse(requestURL)
	if err != nil {
		return ""
	}
	return parsed.Host
}

// opengraph の ToAbs は og:url が壊れていると全体を失敗にし、相対パスも RFC 3986 と違う形で解決するので使わない
func firstImageURL(pageURL string, images []opengraph.Image) string {
	base, err := url.Parse(pageURL)
	if err != nil {
		return ""
	}
	for _, image := range images {
		if image.URL == "" {
			continue
		}
		ref, err := url.Parse(image.URL)
		if err != nil {
			continue
		}
		return base.ResolveReference(ref).String()
	}
	return ""
}
