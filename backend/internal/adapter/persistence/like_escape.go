package persistence

import "strings"

// 生のまま渡すと % 1 文字で全件一致になり、% を並べた形は照合が指数的に後戻りする
func escapeLike(s string) string {
	// \ を最初に倍にする
	// 後で足す \ まで倍にしないため
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}
