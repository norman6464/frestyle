package database

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
)

// schemaGenSQL は Atlas が schema/schema.hcl から機械生成した DDL（schema/schema.gen.sql）。
// バイナリに埋め込んで結合テスト用 DB へ流すため、テストとスキーマ定義が必ず同じ版になる。
// 正本は schema.hcl。このファイルは DO NOT EDIT（make schema-gen で作り直す）。
//
//go:embed schema/schema.gen.sql
var schemaGenSQL string

// ApplySchema は schema.gen.sql を「まだ何も無い空の DB」へ適用する。
// CREATE 文だけで構成されており DO ブロック・IF NOT EXISTS を持たないため、
// 既存のテーブルがある DB へ素で流すと衝突する。
//
// 結合テストは 1 つの PostgreSQL（docker-compose.integration.yml）を複数のテストバイナリ
// （パッケージごとに 1 本）が順に共有するため、schema.gen.sql を無条件に毎回 Exec すると
// 2 本目以降が「テーブルが既に存在する」で必ず落ちる。そこで users テーブルの有無で
// 「このプロセスで初めて適用するか」を判定し、既に在れば何もしない（呼び出し側は
// 誰が最初に適用したかを気にしなくてよい）。
//
// 本番・書き換え済みの DB へ適用するのはこの関数の役割ではない。そちらは schema.hcl を
// 正本にした `make schema-apply`（Atlas の宣言的 apply）を使う。
func ApplySchema(ctx context.Context, db *sql.DB) error {
	applied, err := hasCoreSchema(ctx, db)
	if err != nil {
		return fmt.Errorf("スキーマの適用状況の確認に失敗: %w", err)
	}
	if applied {
		return nil
	}
	// pg_trgm はスキーマ本体（schema.gen.sql）の一部ではない — schema.hcl 側で
	// `extension` ブロックが宣言できない（Atlas OSS 版 CLI は Pro 限定機能。schema.hcl
	// 冒頭の「pg_trgm 拡張について」参照）ため、schema.gen.sql は GIN トライグラム索引
	// （ops = gin_trgm_ops）だけを持ち、拡張の存在を前提にしている。ここで先に作らないと
	// 直後の索引作成が「operator class ... does not exist」で落ちる。
	// scripts/local-db-init/01-extensions.sql と同じ文（ズレ防止のためこの 1 行のみ複製）。
	if _, err := db.ExecContext(ctx, `CREATE EXTENSION IF NOT EXISTS pg_trgm`); err != nil {
		return fmt.Errorf("pg_trgm 拡張の作成に失敗: %w", err)
	}
	if _, err := db.ExecContext(ctx, schemaGenSQL); err != nil {
		return fmt.Errorf("スキーマの適用に失敗: %w", err)
	}
	return nil
}

// hasCoreSchema は users テーブルの有無でスキーマ適用済みかを判定する。
func hasCoreSchema(ctx context.Context, db *sql.DB) (bool, error) {
	var name sql.NullString
	if err := db.QueryRowContext(ctx, `SELECT to_regclass('public.users')`).Scan(&name); err != nil {
		return false, err
	}
	return name.Valid, nil
}
