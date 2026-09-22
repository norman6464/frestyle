package httpclient

import (
	"context"
	"net/http"
	"time"
)

const defaultRequestTimeout = 5 * time.Second

type Client struct {
	httpClient *http.Client
}

func New() *Client {
	return &Client{
		httpClient: &http.Client{
			Timeout: defaultRequestTimeout,
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
