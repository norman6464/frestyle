package httpclient

import (
	"context"
	"net/http"
	"time"
)

type Client struct {
	httpClient *http.Client
}

func New(requestTimeout time.Duration) *Client {
	return &Client{
		httpClient: &http.Client{
			Timeout: requestTimeout,
		},
	}
}

func (client *Client) SendGetRequest(
	ctx context.Context,
	endpointURL string,
) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpointURL, nil)
	if err != nil {
		return nil, err
	}

	return client.httpClient.Do(request)
}
