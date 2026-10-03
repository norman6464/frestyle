package dto

import "github.com/norman6464/frestyle/backend/internal/domain"

type LinkPreviewResponse struct {
	URL         string `json:"url"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	ImageURL    string `json:"imageUrl,omitempty"`
	SiteName    string `json:"siteName,omitempty"`
}

func LinkPreviewFromDomain(preview domain.LinkPreview) LinkPreviewResponse {
	return LinkPreviewResponse{
		URL:         preview.URL,
		Title:       preview.Title,
		Description: preview.Description,
		ImageURL:    preview.ImageURL,
		SiteName:    preview.SiteName,
	}
}
