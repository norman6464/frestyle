package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func Test_validateMail(t *testing.T) {
	env := func(vals map[string]string) func(string) string {
		return func(k string) string { return vals[k] }
	}
	none := env(nil)
	aws := env(map[string]string{"AWS_ACCESS_KEY_ID": "AKIA", "AWS_SECRET_ACCESS_KEY": "secret"})

	t.Run("none は何も要らない", func(t *testing.T) {
		require.NoError(t, validateMail(MailConfig{Provider: MailProviderNone}, "", none))
	})
	t.Run("未知の provider は止める", func(t *testing.T) {
		assert.ErrorContains(t, validateMail(MailConfig{Provider: "sendgrid"}, "https://x", none), "MAIL_PROVIDER")
	})
	t.Run("smtp は From と APP_BASE_URL と宛先が要る", func(t *testing.T) {
		assert.ErrorContains(t, validateMail(MailConfig{Provider: MailProviderSMTP}, "https://x", none), "MAIL_FROM")
		assert.ErrorContains(t, validateMail(MailConfig{Provider: MailProviderSMTP, From: "a@b"}, "", none), "APP_BASE_URL")
		assert.ErrorContains(t, validateMail(MailConfig{Provider: MailProviderSMTP, From: "a@b"}, "https://x", none), "MAIL_SMTP_ADDR")
		require.NoError(t, validateMail(MailConfig{Provider: MailProviderSMTP, From: "a@b", SMTPAddr: "mail:1025"}, "https://x", none))
	})
	t.Run("ses は AWS の資格情報が無いと起動しない", func(t *testing.T) {
		assert.ErrorContains(t, validateMail(MailConfig{Provider: MailProviderSES, From: "a@b", SESRegion: "ap-northeast-1"}, "https://x", none), "AWS_ACCESS_KEY_ID")
		require.NoError(t, validateMail(MailConfig{Provider: MailProviderSES, From: "a@b", SESRegion: "ap-northeast-1"}, "https://x", aws))
	})
}
