package mail

import (
	"context"

	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// Disabled は送らない実装（MAIL_PROVIDER=none）。呼ばれるたびに ErrMailDisabled を返し、
// usecase はそれを「送らない運用」として画面へ伝える。
type Disabled struct{}

var _ repository.InvitationMailer = Disabled{}

func (Disabled) SendInvitation(context.Context, repository.InvitationMail) error {
	return repository.ErrMailDisabled
}
