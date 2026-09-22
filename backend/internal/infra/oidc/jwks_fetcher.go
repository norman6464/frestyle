package oidc

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/norman6464/frestyle/backend/internal/infra/httpclient"
)

type jwksFetcher struct {
	httpClient *httpclient.Client
}

func newJWKSFetcher() *jwksFetcher {
	return &jwksFetcher{
		httpClient: httpclient.New(),
	}
}

func (f *jwksFetcher) fetch(
	ctx context.Context,
	endpointURL string,
	fallbackTTL time.Duration,
) ([]jwk, time.Duration, error) {
	resp, err := f.httpClient.SendGetRequest(ctx, endpointURL)
	if err != nil {
		return nil, 0, fmt.Errorf("%w: %w", ErrJWKSUnavailable, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("%w: status %d", ErrJWKSUnavailable, resp.StatusCode)
	}

	var doc struct {
		Keys []jwk `json:"keys"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxJWKSBytes)).Decode(&doc); err != nil {
		return nil, 0, fmt.Errorf("%w: %w", ErrJWKSUnavailable, err)
	}

	cacheTTL := cacheTTLFromCacheControl(
		resp.Header.Get("Cache-Control"),
		fallbackTTL,
	)

	return doc.Keys, cacheTTL, nil
}
