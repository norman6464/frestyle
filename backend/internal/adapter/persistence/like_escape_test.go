package persistence

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// メタ文字を 1 つでも取りこぼすと、% は全件一致、_ は 1 文字ワイルドカード、
// \ はエスケープの打ち消しとしてそのまま効く
// 3 文字それぞれと組み合わせを固定する
func Test_escapeLike_メタ文字をリテラルにする(t *testing.T) {
	assert.Equal(t, `50\%\_off`, escapeLike(`50%_off`))
	assert.Equal(t, `a\\b`, escapeLike(`a\b`))
	assert.Equal(t, `\\\%`, escapeLike(`\%`))
	assert.Equal(t, `認証コード`, escapeLike(`認証コード`), "メタ文字が無ければ変えない")
}
