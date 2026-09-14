-- ローカル開発 DB の初期化。空のデータディレクトリで一度だけ実行される
-- (docker-entrypoint-initdb.d の仕様。既存 volume がある場合は流れない)。
--
-- pg_stat_statements: 実行されたクエリを正規化して累積統計を取る。どのクエリが
-- 遅いかを「体感」ではなく実測で特定するために入れる。compose 側で
-- shared_preload_libraries に指定済みなので、ここでは拡張を作るだけでよい。
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- pg_trgm: チケット題名検索・KB ページ検索（題名・本文）のあいまい検索が使う
-- （要件は速度でなく表記ゆれ／打ち間違いを拾う振れ幅。schema.hcl 冒頭の
-- 「pg_trgm 拡張について」参照）。Atlas の OSS 版 CLI は `extension` ブロックが Pro 限定で
-- schema.hcl 側から宣言できないため、この CREATE EXTENSION がここ・
-- scripts/atlas-dev/Dockerfile（同じ文を COPY で共有）・internal/infra/database/schema.go の
-- ApplySchema・backend/Makefile の schema-ensure-pg-trgm（TARGET の実 DB 向け）の 4 箇所で
-- 独立に行う唯一の場所になる。ズレを防ぐため文言はこの 1 行のまま複製しないこと。
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 統計をリセットして計測し直すときは psql で:
--   SELECT pg_stat_statements_reset();
-- 遅いクエリの確認:
--   SELECT calls, round(mean_exec_time::numeric, 2) AS mean_ms,
--          round(total_exec_time::numeric, 2) AS total_ms, query
--     FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;
