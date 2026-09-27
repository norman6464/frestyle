package embed

import (
	"strings"
	"unicode/utf8"
)

const (
	maxTitleBytes       = 600
	maxDescriptionBytes = 1500
	maxImageURLBytes    = 2048
	maxSiteNameBytes    = 300
)

// 抽出結果は応答本文の部分文字列なので、複製しないと本文全体がキャッシュに残る
func truncateAndClone(value string, maxBytes int) string {
	if len(value) > maxBytes {
		cut := maxBytes
		for cut > 0 && !utf8.RuneStart(value[cut]) {
			cut--
		}
		value = value[:cut]
	}
	return strings.Clone(value)
}
