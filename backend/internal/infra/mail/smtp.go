package mail

import (
	"context"
	"fmt"
	"net"
	"net/mail"
	"net/smtp"
	"time"

	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// smtpTimeout は接続から送信完了までの上限。ローカルの Mailpit 相手なので短くてよい。
const smtpTimeout = 10 * time.Second

// SMTPMailer は認証も TLS も無い SMTP へ流す実装。**ローカルの Mailpit 専用**で、本番の
// 送信基盤に向けてはいけない（平文で流れる・送信元の評判が無い）。本番は SES を使う。
type SMTPMailer struct {
	addr string
	from string
	now  func() time.Time
}

var _ repository.InvitationMailer = (*SMTPMailer)(nil)

// NewSMTP は addr（host:port）へ送る SMTPMailer を組み立てる。
func NewSMTP(addr, from string) (*SMTPMailer, error) {
	if addr == "" {
		return nil, fmt.Errorf("mail: SMTP の宛先が空")
	}
	if _, err := mail.ParseAddress(from); err != nil {
		return nil, fmt.Errorf("mail: 差出人の形式が不正: %w", err)
	}
	return &SMTPMailer{addr: addr, from: from, now: time.Now}, nil
}

func (s *SMTPMailer) SendInvitation(ctx context.Context, m repository.InvitationMail) error {
	msg, err := BuildInvitationMessage(s.from, m)
	if err != nil {
		return err
	}
	return s.deliver(ctx, msg)
}

// deliver は net/smtp の手順（MAIL FROM → RCPT TO → DATA）を 1 接続で行う。
func (s *SMTPMailer) deliver(ctx context.Context, msg Message) error {
	ctx, cancel := context.WithTimeout(ctx, smtpTimeout)
	defer cancel()
	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", s.addr)
	if err != nil {
		return fmt.Errorf("mail: smtp 接続に失敗: %w", err)
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	host, _, _ := net.SplitHostPort(s.addr)
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("mail: smtp の応答が不正: %w", err)
	}
	defer func() { _ = c.Close() }()

	fromAddr, _ := mail.ParseAddress(msg.From) // NewSMTP で検査済み
	if err := c.Mail(fromAddr.Address); err != nil {
		return fmt.Errorf("mail: MAIL FROM が拒まれた: %w", err)
	}
	if err := c.Rcpt(msg.To); err != nil {
		return fmt.Errorf("mail: RCPT TO が拒まれた: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("mail: DATA が拒まれた: %w", err)
	}
	if _, err := w.Write(msg.MIME(s.now())); err != nil {
		_ = w.Close()
		return fmt.Errorf("mail: 本文の送信に失敗: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("mail: 送信が受け付けられなかった: %w", err)
	}
	return c.Quit()
}
