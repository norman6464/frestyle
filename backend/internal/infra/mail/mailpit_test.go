//go:build mailpit

package mail

// 本物の Mailpit に対して送る確認（CI では走らせない。手元で:
//   docker run --rm -d -p 1025:1025 -p 8025:8025 axllent/mailpit:v1.28.0
//   go test -tags=mailpit ./internal/infra/mail/ -run Mailpit -v
// ）。MIME の組み立てを Mailpit の parser に通し、件名・宛先・本文が壊れずに届くことを見る。

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMailpit_実際に届く(t *testing.T) {
	m, err := NewSMTP("127.0.0.1:1025", "FreStyle <no-reply@frestyle.local>")
	require.NoError(t, err)
	in := sample()
	in.To = "mailpit-check@example.test"
	require.NoError(t, m.SendInvitation(context.Background(), in))

	time.Sleep(300 * time.Millisecond)
	resp, err := http.Get("http://127.0.0.1:8025/api/v1/search?query=to:mailpit-check@example.test")
	require.NoError(t, err)
	defer resp.Body.Close()
	var body struct {
		Messages []struct {
			Subject string `json:"Subject"`
			To      []struct{ Address string }
			ReplyTo []struct{ Address string }
		} `json:"messages"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
	require.NotEmpty(t, body.Messages)
	got := body.Messages[0]
	assert.Equal(t, "【FreStyle】Acme 社 への招待", got.Subject, "RFC 2047 の件名が復号されて読める")
	assert.Equal(t, "mailpit-check@example.test", got.To[0].Address)
	require.NotEmpty(t, got.ReplyTo)
	assert.Equal(t, "hanako@example.com", got.ReplyTo[0].Address)
}
