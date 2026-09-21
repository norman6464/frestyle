package oidc

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const defaultJWKSHTTPTimeout = 5 * time.Second

type jwksFetcher struct {
	client *http.Client
}

func newJWKSFetcher() *jwksFetcher {
	return &jwksFetcher{
		client: &http.Client{
			Timeout: defaultJWKSHTTPTimeout,
		},
	}
}

func newJWKSFetcherWithClient(client *http.Client) *jwksFetcher {
	if client == nil {
		return newJWKSFetcher()
	}

	return &jwksFetcher{
		client: client,
	}
}

func (f *jwksFetcher) fetch(
	ctx context.Context,
	endpointURL string,
	fallbackTTL time.Duration,
) ([]jwk, time.Duration, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpointURL, nil)
	if err != nil {
		return nil, 0, fmt.Errorf("%w: %w", ErrJWKSUnavailable, err)
	}

	resp, err := f.client.Do(req)
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

	cacheTTL := cacheTTLFromHeader(
		resp.Header.Get("Cache-Control"),
		fallbackTTL,
	)

	return doc.Keys, cacheTTL, nil
}
