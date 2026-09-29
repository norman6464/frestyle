package domain

import "unicode/utf8"

type LinkPreview struct {
	URL         string
	Title       string
	Description string
	ImageURL    string
	SiteName    string
}

type LinkPreviewLimits struct {
	TitleBytes       int
	DescriptionBytes int
	ImageURLBytes    int
	SiteNameBytes    int
}

// URL は取得元の入力から作るので、ここでは切り詰めない
func (p LinkPreview) Truncate(limits LinkPreviewLimits) LinkPreview {
	p.Title = truncateUTF8Bytes(p.Title, limits.TitleBytes)
	p.Description = truncateUTF8Bytes(p.Description, limits.DescriptionBytes)
	p.ImageURL = truncateUTF8Bytes(p.ImageURL, limits.ImageURLBytes)
	p.SiteName = truncateUTF8Bytes(p.SiteName, limits.SiteNameBytes)
	return p
}

func truncateUTF8Bytes(value string, maxBytes int) string {
	if len(value) <= maxBytes {
		return value
	}
	cut := maxBytes
	for cut > 0 && !utf8.RuneStart(value[cut]) {
		cut--
	}
	return value[:cut]
}

type LinkPreviewError string

func (e LinkPreviewError) Error() string {
	return string(e)
}

const (
	ErrLinkPreviewInvalidURL  LinkPreviewError = "link preview: url must be https with a host"
	ErrLinkPreviewUnsafeHost  LinkPreviewError = "link preview: host resolves to a non-public address or a port other than 443"
	ErrLinkPreviewUnreachable LinkPreviewError = "link preview: target could not be fetched"
)
