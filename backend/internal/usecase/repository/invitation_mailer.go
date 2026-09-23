package repository

import (
	"context"
	"errors"
	"time"

	"github.com/norman6464/frestyle/backend/internal/domain"
)

// ErrMailDisabled はメール送信が設定で止まっているときに InvitationMailer が返す。
// 呼び出し側は「送れなかった」ではなく「送らない運用」として扱う（招待リンクを手で渡す）。
var ErrMailDisabled = errors.New("mail delivery is disabled")

// InvitationMail は招待メール 1 通の材料。本文の組み立て（件名・文面・HTML）は infra 側の
// テンプレートが行い、usecase は値だけを渡す。自由文は無い。
type InvitationMail struct {
	// To は宛先（正規形の email）。
	To string
	// ToName は招いた人が付けた相手の表示名（無ければ空文字）。
	ToName        string
	WorkspaceName string
	// InviterName は招いた人の表示名（無ければ空文字）。
	InviterName string
	// ReplyTo は招いた人の email。返信が招いた人へ届くように Reply-To に載せる。無ければ空文字。
	ReplyTo string
	Role    domain.GrantRole
	// InviteURL は承諾の案内ページ（/invite#t=<token>）の絶対 URL。メールに載る唯一のリンク。
	InviteURL string
	ExpiresAt time.Time
}

// InvitationMailer は招待メールを届ける口。実装は infra/mail（Amazon SES / SMTP / disabled）。
//
// 送信は DB のトランザクションを閉じたあとに行い、失敗しても招待そのものは残す
// （呼び出し側が mailStatus として画面へ伝え、再送を促す）。
type InvitationMailer interface {
	// SendInvitation は 1 通送る。設定で止まっていれば ErrMailDisabled。
	SendInvitation(ctx context.Context, m InvitationMail) error
}
