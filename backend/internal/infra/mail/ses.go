package mail

import (
	"context"
	"fmt"
	"net/mail"
	"time"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	"github.com/aws/aws-sdk-go-v2/service/sesv2/types"
	"github.com/norman6464/frestyle/backend/internal/usecase/repository"
)

// sesTimeout は SendEmail 1 回の上限。招待の発行の応答時間に直接乗るので短くする
// （SES はふつう 1 秒以内に返る）。
const sesTimeout = 10 * time.Second

// sesSender は sesv2.Client のうち使う 1 メソッド。テストで実 SES に繋がずに入力を固定するため。
type sesSender interface {
	SendEmail(ctx context.Context, in *sesv2.SendEmailInput, optFns ...func(*sesv2.Options)) (*sesv2.SendEmailOutput, error)
}

// SESMailer は Amazon SES（sesv2 の SendEmail）で送る本番用の実装。
//
// 資格情報は AWS SDK の既定の探索（環境変数 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY 等）に
// 任せる。config.Load が起動時に環境変数の有無を確かめているので、ここでは触らない。
// 送信元 identity の検証・DKIM・サンドボックス解除は AWS 側の設定（FRESTYLE-479 の着手条件）。
type SESMailer struct {
	client sesSender
	from   string
}

var _ repository.InvitationMailer = (*SESMailer)(nil)

// NewSES はリージョンと差出人から SESMailer を組み立てる。
func NewSES(ctx context.Context, region, from string) (*SESMailer, error) {
	if region == "" {
		return nil, fmt.Errorf("mail: SES のリージョンが空")
	}
	if _, err := mail.ParseAddress(from); err != nil {
		return nil, fmt.Errorf("mail: 差出人の形式が不正: %w", err)
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("mail: AWS の設定を読めない: %w", err)
	}
	return &SESMailer{client: sesv2.NewFromConfig(cfg), from: from}, nil
}

// newSESWithClient はテスト用（送信クライアントを差し替える）。
func newSESWithClient(client sesSender, from string) *SESMailer {
	return &SESMailer{client: client, from: from}
}

func (s *SESMailer) SendInvitation(ctx context.Context, m repository.InvitationMail) error {
	msg, err := BuildInvitationMessage(s.from, m)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, sesTimeout)
	defer cancel()
	in := &sesv2.SendEmailInput{
		FromEmailAddress: &msg.From,
		Destination:      &types.Destination{ToAddresses: []string{msg.To}},
		Content: &types.EmailContent{
			Simple: &types.Message{
				Subject: &types.Content{Data: &msg.Subject, Charset: strPtr("UTF-8")},
				Body: &types.Body{
					Text: &types.Content{Data: &msg.Text, Charset: strPtr("UTF-8")},
					Html: &types.Content{Data: &msg.HTML, Charset: strPtr("UTF-8")},
				},
			},
		},
	}
	if msg.ReplyTo != "" {
		in.ReplyToAddresses = []string{msg.ReplyTo}
	}
	if _, err := s.client.SendEmail(ctx, in); err != nil {
		return fmt.Errorf("mail: SES の送信に失敗: %w", err)
	}
	return nil
}

func strPtr(s string) *string { return &s }
