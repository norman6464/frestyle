package mail

import (
	"context"
	"fmt"

	"github.com/norman6464/frestyle/backend/internal/infra/config"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// New は設定（MAIL_PROVIDER）に応じた InvitationMailer を組み立てる。
// 設定の過不足は config.Load が起動時に止めているので、ここは組み立てだけを行う。
func New(ctx context.Context, cfg config.MailConfig) (repository.InvitationMailer, error) {
	switch cfg.Provider {
	case config.MailProviderNone:
		return Disabled{}, nil
	case config.MailProviderSMTP:
		return NewSMTP(cfg.SMTPAddr, cfg.From)
	case config.MailProviderSES:
		return NewSES(ctx, cfg.SESRegion, cfg.From)
	default:
		return nil, fmt.Errorf("mail: 未知の provider %q", cfg.Provider)
	}
}
