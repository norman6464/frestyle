package domain_test

import (
	"strings"
	"testing"

	"github.com/norman6464/frestyle/backend/internal/domain"
	"github.com/stretchr/testify/assert"
)

func Test_版名の検証(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  bool
	}{
		{"ふつうの版名は通る", "1.2.0", true},
		{"日本語も通る", "第 1 次リリース", true},
		{"空は拒む", "", false},
		{"空白だけは拒む", "   ", false},
		{"前後の空白は数えない", "  1.0  ", true},
		{"上限ちょうどは通る", strings.Repeat("あ", domain.ProjectVersionNameMax), true},
		{"上限を 1 文字超えたら拒む", strings.Repeat("あ", domain.ProjectVersionNameMax+1), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.Equal(t, c.want, domain.ValidProjectVersionName(c.input))
		})
	}
}

func Test_チーム名の検証(t *testing.T) {
	assert.True(t, domain.ValidTeamName("基盤チーム"))
	assert.False(t, domain.ValidTeamName(""))
	assert.False(t, domain.ValidTeamName("\t\n "))
	assert.True(t, domain.ValidTeamName(strings.Repeat("a", domain.TeamNameMax)))
	assert.False(t, domain.ValidTeamName(strings.Repeat("a", domain.TeamNameMax+1)))
}
