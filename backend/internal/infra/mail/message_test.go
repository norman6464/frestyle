package mail

import (
	"strings"
	"testing"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func sample() repository.InvitationMail {
	return repository.InvitationMail{
		To:            "taro@example.com",
		ToName:        "山田 太郎",
		WorkspaceName: "Acme 社",
		InviterName:   "鈴木 花子",
		ReplyTo:       "hanako@example.com",
		Role:          domain.GrantRoleEditor,
		InviteURL:     "https://frestyle.dev/invite#t=tok-123",
		ExpiresAt:     time.Date(2026, 9, 30, 14, 59, 59, 0, time.UTC), // JST 23:59
	}
}

func TestBuildInvitationMessage(t *testing.T) {
	msg, err := BuildInvitationMessage("FreStyle <no-reply@frestyle.dev>", sample())
	require.NoError(t, err)

	assert.Equal(t, "【FreStyle】Acme 社 への招待", msg.Subject)
	assert.Equal(t, "taro@example.com", msg.To)
	assert.Equal(t, "hanako@example.com", msg.ReplyTo)
	assert.Contains(t, msg.Text, "鈴木 花子 さんから")
	assert.Contains(t, msg.Text, "editor（ページを作り、編集できる）")
	assert.Contains(t, msg.Text, "https://frestyle.dev/invite#t=tok-123")
	assert.Contains(t, msg.Text, "2026年9月30日 23:59（日本時間）", "期限は JST で出す")
	assert.Contains(t, msg.HTML, `href="https://frestyle.dev/invite#t=tok-123"`)
	// リンクは承諾 URL の 1 本だけ。
	assert.Equal(t, 1, strings.Count(msg.Text, "https://"))
	assert.Equal(t, 3, strings.Count(msg.HTML, `href="https://frestyle.dev/invite#t=tok-123"`)+strings.Count(msg.HTML, ">https://frestyle.dev/invite#t=tok-123<"))
}

func TestBuildInvitationMessage_名前は畳んでエスケープしURLに見えるものは伏せる(t *testing.T) {
	m := sample()
	m.WorkspaceName = "  <b>Acme</b>\n & Co  "
	m.InviterName = "https://evil.example ログインしてください"
	msg, err := BuildInvitationMessage("no-reply@frestyle.dev", m)
	require.NoError(t, err)

	assert.Contains(t, msg.Text, "「<b>Acme</b> & Co」", "テキストは畳むだけ")
	assert.Contains(t, msg.HTML, "&lt;b&gt;Acme&lt;/b&gt; &amp; Co", "HTML はエスケープ")
	assert.NotContains(t, msg.HTML, "<b>Acme</b>")
	assert.Contains(t, msg.Text, "（表示できない名前） さんから")
	assert.NotContains(t, msg.Text, "evil.example")
	assert.NotContains(t, msg.HTML, "evil.example")
}

func TestBuildInvitationMessage_長い名前は切り空なら既定の呼び名(t *testing.T) {
	m := sample()
	m.WorkspaceName = strings.Repeat("あ", 40)
	m.InviterName = ""
	msg, err := BuildInvitationMessage("no-reply@frestyle.dev", m)
	require.NoError(t, err)
	assert.Contains(t, msg.Subject, strings.Repeat("あ", 30)+"…")
	assert.NotContains(t, msg.Subject, strings.Repeat("あ", 31))
	assert.Contains(t, msg.Text, "ワークスペースの管理者 さんから")
}

func TestBuildInvitationMessage_宛先とURLは必須(t *testing.T) {
	m := sample()
	m.To = "not-an-address"
	_, err := BuildInvitationMessage("no-reply@frestyle.dev", m)
	require.Error(t, err)
	m = sample()
	m.InviteURL = ""
	_, err = BuildInvitationMessage("no-reply@frestyle.dev", m)
	require.Error(t, err)
}

func TestMessage_MIME(t *testing.T) {
	msg, err := BuildInvitationMessage("FreStyle <no-reply@frestyle.dev>", sample())
	require.NoError(t, err)
	raw := string(msg.MIME(time.Date(2026, 9, 23, 12, 0, 0, 0, jst)))
	assert.Contains(t, raw, "From: FreStyle <no-reply@frestyle.dev>\r\n")
	assert.Contains(t, raw, "To: taro@example.com\r\n")
	assert.Contains(t, raw, "Reply-To: hanako@example.com\r\n")
	assert.Contains(t, raw, "Subject: =?utf-8?b?", "件名は RFC 2047 で包む")
	assert.Contains(t, raw, "Content-Type: multipart/alternative;")
	assert.Contains(t, raw, "Content-Type: text/plain; charset=utf-8")
	assert.Contains(t, raw, "Content-Type: text/html; charset=utf-8")
	assert.NotContains(t, raw, "tok-123", "本文は base64 なので平文のトークンは現れない")
	assert.True(t, strings.HasSuffix(raw, "--=_frestyle_invite_boundary--\r\n"))
}
