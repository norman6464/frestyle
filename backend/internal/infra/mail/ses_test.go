package mail

import (
	"context"
	"errors"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeSES struct {
	in  *sesv2.SendEmailInput
	err error
}

func (f *fakeSES) SendEmail(_ context.Context, in *sesv2.SendEmailInput, _ ...func(*sesv2.Options)) (*sesv2.SendEmailOutput, error) {
	f.in = in
	if f.err != nil {
		return nil, f.err
	}
	return &sesv2.SendEmailOutput{}, nil
}

func TestSESMailer_入力を組み立てる(t *testing.T) {
	f := &fakeSES{}
	m := newSESWithClient(f, "FreStyle <no-reply@frestyle.dev>")

	require.NoError(t, m.SendInvitation(context.Background(), sample()))
	require.NotNil(t, f.in)
	assert.Equal(t, "FreStyle <no-reply@frestyle.dev>", *f.in.FromEmailAddress)
	assert.Equal(t, []string{"taro@example.com"}, f.in.Destination.ToAddresses)
	assert.Equal(t, []string{"hanako@example.com"}, f.in.ReplyToAddresses)
	assert.Equal(t, "【FreStyle】Acme 社 への招待", *f.in.Content.Simple.Subject.Data)
	assert.Equal(t, "UTF-8", *f.in.Content.Simple.Subject.Charset)
	assert.Contains(t, *f.in.Content.Simple.Body.Text.Data, "https://frestyle.dev/invite#t=tok-123")
	assert.Contains(t, *f.in.Content.Simple.Body.Html.Data, "<a href=")
}

func TestSESMailer_返信先が無ければReplyToを付けない(t *testing.T) {
	f := &fakeSES{}
	m := newSESWithClient(f, "no-reply@frestyle.dev")
	in := sample()
	in.ReplyTo = ""
	require.NoError(t, m.SendInvitation(context.Background(), in))
	assert.Nil(t, f.in.ReplyToAddresses)
}

func TestSESMailer_SESの失敗はそのまま伝える(t *testing.T) {
	boom := errors.New("Throttling: Maximum sending rate exceeded")
	f := &fakeSES{err: boom}
	m := newSESWithClient(f, "no-reply@frestyle.dev")
	err := m.SendInvitation(context.Background(), sample())
	require.ErrorIs(t, err, boom)
}

func TestNewSES_入力の検査(t *testing.T) {
	_, err := NewSES(context.Background(), "", "no-reply@frestyle.dev")
	require.Error(t, err)
	_, err = NewSES(context.Background(), "ap-northeast-1", "bad")
	require.Error(t, err)
}
