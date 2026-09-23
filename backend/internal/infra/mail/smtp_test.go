package mail

import (
	"bufio"
	"context"
	"net"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeSMTP はテスト内の最小 SMTP サーバ。1 接続を受け、DATA の中身を溜めて返す。
// reject が空でなければ RCPT TO をその応答で拒む。
func fakeSMTP(t *testing.T, reject string) (addr string, got func() string) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = ln.Close() })
	var data strings.Builder
	done := make(chan struct{})
	go func() {
		defer close(done)
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		r := bufio.NewReader(conn)
		w := bufio.NewWriter(conn)
		say := func(s string) { _, _ = w.WriteString(s + "\r\n"); _ = w.Flush() }
		say("220 fake ESMTP")
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				return
			}
			cmd := strings.ToUpper(strings.TrimSpace(line))
			switch {
			case strings.HasPrefix(cmd, "EHLO"), strings.HasPrefix(cmd, "HELO"):
				say("250 fake")
			case strings.HasPrefix(cmd, "MAIL FROM"):
				say("250 OK")
			case strings.HasPrefix(cmd, "RCPT TO"):
				if reject != "" {
					say(reject)
				} else {
					say("250 OK")
				}
			case cmd == "DATA":
				say("354 go ahead")
				for {
					l, err := r.ReadString('\n')
					if err != nil {
						return
					}
					if l == ".\r\n" {
						break
					}
					data.WriteString(l)
				}
				say("250 queued")
			case cmd == "QUIT":
				say("221 bye")
				return
			default:
				say("250 OK")
			}
		}
	}()
	return ln.Addr().String(), func() string { <-done; return data.String() }
}

func TestSMTPMailer_送る(t *testing.T) {
	addr, got := fakeSMTP(t, "")
	m, err := NewSMTP(addr, "FreStyle <no-reply@frestyle.local>")
	require.NoError(t, err)

	require.NoError(t, m.SendInvitation(context.Background(), sample()))
	raw := got()
	assert.Contains(t, raw, "To: taro@example.com")
	assert.Contains(t, raw, "Reply-To: hanako@example.com")
	assert.Contains(t, raw, "multipart/alternative")
}

func TestSMTPMailer_宛先が拒まれたら失敗を返す(t *testing.T) {
	addr, _ := fakeSMTP(t, "550 no such user")
	m, err := NewSMTP(addr, "no-reply@frestyle.local")
	require.NoError(t, err)
	err = m.SendInvitation(context.Background(), sample())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "RCPT TO")
}

func TestSMTPMailer_繋がらなければ失敗を返す(t *testing.T) {
	m, err := NewSMTP("127.0.0.1:1", "no-reply@frestyle.local")
	require.NoError(t, err)
	require.Error(t, m.SendInvitation(context.Background(), sample()))
}

func TestNewSMTP_入力の検査(t *testing.T) {
	_, err := NewSMTP("", "no-reply@frestyle.local")
	require.Error(t, err)
	_, err = NewSMTP("mail:1025", "not an address")
	require.Error(t, err)
}
