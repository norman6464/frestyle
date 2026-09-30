package persistence

import (
	"database/sql"
	"time"
)

// Go のポインタと database/sql の Null 型の行き来。複数の repository が使う小さな変換なので、
// 特定の repository のファイルには置かない。

// nullString は *string を sql.NullString へ変換する。
func nullString(s *string) sql.NullString {
	if s == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *s, Valid: true}
}

// nullTime は *time.Time を sql.NullTime へ変換する。
func nullTime(t *time.Time) sql.NullTime {
	if t == nil {
		return sql.NullTime{}
	}
	return sql.NullTime{Time: *t, Valid: true}
}

// nullTimePtr は nullTime の逆変換（sql.NullTime → *time.Time）。
func nullTimePtr(t sql.NullTime) *time.Time {
	if !t.Valid {
		return nil
	}
	tt := t.Time
	return &tt
}
