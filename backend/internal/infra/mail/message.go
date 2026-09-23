// Package mail は招待メールの組み立てと送信（Amazon SES / SMTP / disabled）を担う infra 層。
//
// 文面はここで固定する。usecase から受け取るのは宛先・名前・役割・URL・期限だけで、
// 自由文は受けない（招待メールを他人宛の文面を運ぶ道具にさせない）。
package mail

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"html"
	"mime"
	"net/mail"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// Message は送信の実装（SES / SMTP）に渡す 1 通。From / To は "名前 <addr>" またはアドレスだけ。
type Message struct {
	From    string
	To      string
	ReplyTo string
	Subject string
	Text    string
	HTML    string
}

const (
	// 名前の長さの上限。件名と本文に載る値で、長すぎると迷惑メール判定や折り返しの原因になる。
	maxWorkspaceNameRunes = 30
	maxPersonNameRunes    = 60
	// hiddenName は URL のように見える名前の代わりに出す。招待メールの中で「クリックしたくなる
	// 文字列」を名乗る値を、招いた人やワークスペース名の欄から締め出す。
	hiddenName = "（表示できない名前）"
)

// looksLikeURL は名前が URL に見えるか（フィッシングの文言に使われる形）。
var looksLikeURL = regexp.MustCompile(`(?i)https?://|www\.|://`)

// safeName は名前を 1 行に畳み、長さを切り、URL に見えるものは伏せる。
func safeName(raw string, max int) string {
	name := strings.Join(strings.Fields(raw), " ")
	if name == "" {
		return ""
	}
	if looksLikeURL.MatchString(name) {
		return hiddenName
	}
	if utf8.RuneCountInString(name) > max {
		runes := []rune(name)
		name = string(runes[:max]) + "…"
	}
	return name
}

// roleLabel は役割の説明。画面（frontend）の文言と揃える。
func roleLabel(role string) string {
	switch role {
	case "admin":
		return "admin（メンバーと権限の管理もできる）"
	case "editor":
		return "editor（ページを作り、編集できる）"
	case "commenter":
		return "commenter（閲覧とコメントができる）"
	case "viewer":
		return "viewer（閲覧だけ）"
	default:
		return role
	}
}

// jst は期限の表示に使う。招待を受け取る人は日本の利用者なので、サーバーの時刻帯（UTC）で
// 出すと日付が 1 日ずれて見える。
var jst = time.FixedZone("Asia/Tokyo", 9*60*60)

// BuildInvitationMessage は招待メールの件名・本文（テキストと HTML）を組み立てる。
// from は設定の差出人。宛先の形式は net/mail で確かめる（usecase 側の検査の二重化）。
func BuildInvitationMessage(from string, m repository.InvitationMail) (Message, error) {
	if _, err := mail.ParseAddress(m.To); err != nil {
		return Message{}, fmt.Errorf("mail: 宛先の形式が不正: %w", err)
	}
	if m.InviteURL == "" {
		return Message{}, fmt.Errorf("mail: 承諾 URL が空")
	}
	workspace := safeName(m.WorkspaceName, maxWorkspaceNameRunes)
	if workspace == "" {
		workspace = "ワークスペース"
	}
	inviter := safeName(m.InviterName, maxPersonNameRunes)
	if inviter == "" {
		inviter = "ワークスペースの管理者"
	}
	expires := m.ExpiresAt.In(jst).Format("2006年1月2日 15:04")
	role := roleLabel(string(m.Role))

	subject := fmt.Sprintf("【FreStyle】%s への招待", workspace)

	text := fmt.Sprintf(`%s さんから、FreStyle のワークスペース「%s」への招待が届いています。

役割: %s

下のリンクを開いて内容を確かめ、%s のアカウントでログインすると参加できます。
%s

このリンクの期限は %s（日本時間）までです。
心当たりがない場合は、このメールを無視してください。

FreStyle
`, inviter, workspace, role, m.To, m.InviteURL, expires)

	e := html.EscapeString
	htmlBody := fmt.Sprintf(`<!doctype html>
<html lang="ja"><body style="margin:0;padding:24px;font-family:'Noto Sans JP','Hiragino Sans',sans-serif;color:#191919;background:#ffffff;">
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;"><strong>%s</strong> さんから、FreStyle のワークスペース「<strong>%s</strong>」への招待が届いています。</p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">役割: %s</p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">下のボタンを開いて内容を確かめ、<strong>%s</strong> のアカウントでログインすると参加できます。</p>
<p style="margin:0 0 24px;"><a href="%s" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;">招待の内容を見る</a></p>
<p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#66655f;">ボタンが開けないときは、このリンクを開いてください:<br><a href="%s" style="color:#2563eb;">%s</a></p>
<p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#66655f;">このリンクの期限は %s（日本時間）までです。心当たりがない場合は、このメールを無視してください。</p>
<p style="margin:16px 0 0;font-size:12px;color:#66655f;">FreStyle</p>
</body></html>
`, e(inviter), e(workspace), e(role), e(m.To), e(m.InviteURL), e(m.InviteURL), e(m.InviteURL), e(expires))

	return Message{
		From:    from,
		To:      m.To,
		ReplyTo: m.ReplyTo,
		Subject: subject,
		Text:    text,
		HTML:    htmlBody,
	}, nil
}

// MIME は SMTP に流すための生のメッセージ（multipart/alternative、本文は base64）を作る。
// 件名は RFC 2047（UTF-8 の B エンコード）で包む。
func (m Message) MIME(now time.Time) []byte {
	const boundary = "=_frestyle_invite_boundary"
	var b bytes.Buffer
	fmt.Fprintf(&b, "From: %s\r\n", m.From)
	fmt.Fprintf(&b, "To: %s\r\n", m.To)
	if m.ReplyTo != "" {
		fmt.Fprintf(&b, "Reply-To: %s\r\n", m.ReplyTo)
	}
	fmt.Fprintf(&b, "Subject: %s\r\n", mime.BEncoding.Encode("utf-8", m.Subject))
	fmt.Fprintf(&b, "Date: %s\r\n", now.Format(time.RFC1123Z))
	b.WriteString("MIME-Version: 1.0\r\n")
	fmt.Fprintf(&b, "Content-Type: multipart/alternative; boundary=\"%s\"\r\n\r\n", boundary)
	writePart := func(contentType, body string) {
		fmt.Fprintf(&b, "--%s\r\n", boundary)
		fmt.Fprintf(&b, "Content-Type: %s; charset=utf-8\r\n", contentType)
		b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
		enc := base64.StdEncoding.EncodeToString([]byte(body))
		for len(enc) > 76 {
			b.WriteString(enc[:76] + "\r\n")
			enc = enc[76:]
		}
		b.WriteString(enc + "\r\n")
	}
	writePart("text/plain", m.Text)
	writePart("text/html", m.HTML)
	fmt.Fprintf(&b, "--%s--\r\n", boundary)
	return b.Bytes()
}
