package httpclient

import (
	"context"
	"io"
	"net/http"
)

func (client *Client) SendPostRequest(
	ctx context.Context,
	endpointURL string,
	requestBody io.Reader,
) (*http.Response, error) {
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpointURL,
		requestBody,
	)
	if err != nil {
		return nil, err
	}

	return client.httpClient.Do(request)
}
