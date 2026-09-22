# FreStyle backend - 開発 / 検証 用 Makefile
#
# 主要 target:
#   make schema-gen    … schema.hcl（正本）から schema.gen.sql（sqlc 入力・DO NOT EDIT）を再生成
#   make schema-plan    … TARGET=<DSN> の実 DB に schema.hcl を当てたときの差分を表示（dry-run）
#   make schema-apply   … TARGET=<DSN> の実 DB へ schema.hcl を宣言的に適用する（要確認）
#   make sqlc          … queries/*.sql + schema.gen.sql から型安全な Go を再生成
#   make sqlc-vet       … sqlc.yaml の rules を全クエリに当てて危険な SQL を弾く
#   make fmt            … gofumpt -w でコードを自動整形（commit 前に実行）
#   make verify         … gofumpt / vet / build / test / sqlc-vet を 一括 実行
#   make test-integration … docker-compose で PostgreSQL を起動し -tags=integration の結合テストを実行
#   make run            … go run ./cmd/server で ローカル サーバ 起動
#   ローカル環境の起動は make ではなくリポジトリ直下で `docker compose up -d`
#   (DB + メールキャッチャー + バックエンドが起動する。スキーマは db サービスの
#   docker-entrypoint-initdb.d が schema.gen.sql を初回起動時だけ流す。詳細は /docker-compose.yml)
#   make local-seed     … ダミーデータ投入 (SIZE=small|medium|large)
#   make local-psql     … ローカル DB に psql で接続
#   make local-slow     … pg_stat_statements から遅いクエリ上位 20 件を表示
#   make local-reset    … ローカル DB を volume ごと破棄してまっさらにする
#
# go install は GOBIN > GOPATH/bin の 優先 順位 で 配置 する。
# どちら で も 拾える よう に GOBIN が セット されて いれば そちら を 優先 する。
GO_INSTALL_DIR := $(shell go env GOBIN)
ifeq ($(GO_INSTALL_DIR),)
GO_INSTALL_DIR := $(shell go env GOPATH)/bin
endif
SQLC_VERSION := v1.31.1
SQLC := $(GO_INSTALL_DIR)/sqlc

# Atlas（ariga.io/atlas）。スキーマの正本 schema.hcl を読み書きする唯一のツール。
# go install できない（Go モジュールとして配布されていない）ため release.ariga.io から
# アーキテクチャ別のバイナリを直接取得する。版は固定（-latest は canary で日によって挙動が変わる）。
ATLAS_VERSION := v1.3.0
ATLAS := $(GO_INSTALL_DIR)/atlas
ATLAS_OS := $(shell uname -s | tr '[:upper:]' '[:lower:]')
ATLAS_ARCH := $(shell uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/')
SCHEMA_DIR := internal/infra/database/schema
SCHEMA_HCL := $(SCHEMA_DIR)/schema.hcl
SCHEMA_GEN_SQL := $(SCHEMA_DIR)/schema.gen.sql
# ローカル開発の docker-entrypoint-initdb.d 用コピー。docker-entrypoint-initdb.d は
# ディレクトリ丸ごとのバインドしか受け付けず、schema.gen.sql を単体で追加マウントできない
# （postgres 公式イメージの仕様）ため、同じ内容をこの実ファイルとしても持つ。
# schema-gen が両方を同時に書くので、手で同期を取る必要はない。
LOCAL_DB_INIT_SQL := scripts/local-db-init/02-schema.sql
# Atlas の dev-database。宣言的 apply の差分計算に使う使い捨ての PostgreSQL
# （ローカルの Docker で毎回まっさらに立ち上げ、変更を残さない）。
#
# 素の postgres イメージではなく自前イメージ（frestyle-atlas-pg-trgm-dev）を使う。
# schema.hcl が pg_trgm の GIN 索引（ops = gin_trgm_ops）を宣言しており、拡張が無い
# dev db では「operator class ... does not exist」で落ちるため（scripts/atlas-dev/Dockerfile・
# schema.hcl 冒頭の「pg_trgm 拡張について」参照）。ensure-atlas-dev-image が毎回ビルドする
# （scripts/local-db-init/01-extensions.sql を COPY するだけの軽量イメージなのでキャッシュが効く）。
ATLAS_DEV_IMAGE := frestyle-atlas-pg-trgm-dev:17
ATLAS_DEV_URL := docker+postgres://_/$(ATLAS_DEV_IMAGE)/dev?search_path=public

# atlas の --dev-url 用イメージをビルドする（ローカルのみ・レジストリに push しない）。
# schema-gen / schema-plan / schema-apply はすべてこれに依存する。
.PHONY: ensure-atlas-dev-image
ensure-atlas-dev-image:
	@echo ">>> building $(ATLAS_DEV_IMAGE) (postgres + pg_trgm, atlas --dev-url 専用)"
	@docker build -q -t $(ATLAS_DEV_IMAGE) -f scripts/atlas-dev/Dockerfile scripts >/dev/null

# TARGET は必ず public スキーマだけに絞る。
#
# schema.hcl が宣言しているのは public ただ 1 つ。search_path を付けずに Atlas を回すと
# データベース全体（realm）が対象になり、**宣言に無いスキーマは「消す対象」**と判断される。
# Supabase の DB には auth / storage / realtime / supabase_migrations が同居しているので、
# 絞り忘れると認証もストレージも消す計画が立つ。
#
# 実際に踏んだ（2026-09-13）: 付け忘れて
#   Error: analyzing plan: found 5 schemas when migration plan is scoped to one
# で止まった。Atlas が止めてくれただけで、止まらない道具なら本番が飛んでいた。
# **人間が毎回 DSN に付け足す前提にしない。** ここで必ず付ける。
#
# なお psql（libpq）は search_path を URI パラメータとして受け付けない（Atlas は自前で
# 解釈する）。そちらは下の schema-ensure-pg-trgm が WITH SCHEMA public で明示する。
SCOPE_TARGET = \
  scoped="$(TARGET)"; \
  case "$$scoped" in \
    *search_path=public*) ;; \
    *search_path=*) \
      echo "エラー: TARGET の search_path が public 以外です。schema.hcl は public だけを宣言しています" >&2; \
      exit 1 ;; \
    *\?*) scoped="$$scoped&search_path=public" ;; \
    *) scoped="$$scoped?search_path=public" ;; \
  esac

# schema-plan / schema-apply の対象 DB（TARGET）に pg_trgm が無いと、GIN 索引の適用が
# 「operator class ... does not exist」で落ちる。dev db 側と同じ拡張を対象 DB にも用意する
# （Atlas は extension を管理しない＝作成も削除もしない。ここで先に作るだけで足りる）。
# ローカルに psql が無い環境でも動くよう、使い捨ての postgres コンテナから叩く。
#
# TARGET は Supabase ダッシュボード → Connect → **Session pooler** に表示される DSN を渡す
# （ホスト名は <something>.pooler.supabase.com、ポート 5432。リージョン等で変わるので表示に従う）。
# 直結ホスト db.<ref>.supabase.co は、IPv4 アドオンを付けていない既定の構成では IPv6 アドレス
# しか持たない。Docker Desktop のコンテナは IPv6 で外へ出られないので、この psql が
# 「Network unreachable」で止まる（2026-09-22 に踏んだ。Mac 自体からは届くので Atlas 本体は
# 通り、ここだけが落ちる）。IPv4 アドオンを付けていれば直結ホストでも届く。
# Transaction pooler（6543）は DDL・トランザクションの都合で使わない。
#
# WITH SCHEMA public と、その直後の確認がどちらも要る。
#   - 置き場所を明示しないと、接続の search_path 次第で public 以外（Supabase なら
#     extensions）に入りうる。Atlas は public だけを見るので、入っていても見えない
#   - IF NOT EXISTS は「既に別のスキーマにある」場合に黙って何もしない。作成が成功した
#     ことと、gin_trgm_ops が public から見えることは別問題なので、後者を必ず確かめる
#     （確かめないと、この段が緑なのに Atlas 側が operator class で落ちる）
.PHONY: schema-ensure-pg-trgm
schema-ensure-pg-trgm:
	@if [ -z "$(TARGET)" ]; then echo "使い方: make schema-ensure-pg-trgm TARGET=postgres://..."; exit 1; fi
	@out="$$(mktemp)"; \
	docker run --rm public.ecr.aws/docker/library/postgres:17.6-alpine \
	  psql "$(TARGET)" -v ON_ERROR_STOP=1 \
	  -c "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;" \
	  -c "DO \$$\$$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_opclass o JOIN pg_namespace n ON n.oid = o.opcnamespace WHERE o.opcname = 'gin_trgm_ops' AND n.nspname = 'public') THEN RAISE EXCEPTION 'gin_trgm_ops が public にありません。pg_trgm が別のスキーマに入っています（ALTER EXTENSION pg_trgm SET SCHEMA public; で移せます）'; END IF; END \$$\$$;" \
	  2>"$$out"; rc=$$?; \
	cat "$$out" >&2; \
	if [ $$rc -ne 0 ]; then \
	  case "$(TARGET)" in \
	    *@db.*.supabase.co*) \
	      if grep -q "Network unreachable\|Network is unreachable" "$$out"; then \
	        echo "" >&2; \
	        echo "ヒント: TARGET が Supabase の直結ホスト（db.<ref>.supabase.co）で、経路が無くて届いていません。" >&2; \
	        echo "        IPv4 アドオンの無い構成では直結ホストは IPv6 のみで、Docker のコンテナからは出られません。" >&2; \
	        echo "        ダッシュボード → Connect → Session pooler（*.pooler.supabase.com:5432）の DSN を使ってください。" >&2; \
	      fi ;; \
	  esac; \
	fi; \
	rm -f "$$out"; exit $$rc

.PHONY: ensure-atlas
ensure-atlas:
	@if [ ! -x "$(ATLAS)" ] || ! "$(ATLAS)" version 2>/dev/null | grep -q '$(ATLAS_VERSION)'; then \
	  echo ">>> installing atlas ($(ATLAS_VERSION)) for $(ATLAS_OS)/$(ATLAS_ARCH)..."; \
	  mkdir -p "$(GO_INSTALL_DIR)"; \
	  curl -fsSL -o "$(ATLAS)" "https://release.ariga.io/atlas/atlas-$(ATLAS_OS)-$(ATLAS_ARCH)-$(ATLAS_VERSION)"; \
	  chmod +x "$(ATLAS)"; \
	fi

# schema.hcl（正本）→ schema.gen.sql（sqlc の入力・結合テストが使う DDL）。
# 同じ内容を scripts/local-db-init/02-schema.sql（ローカル docker compose の初回起動用）へも書く。
# schema.gen.sql は「まだ何も無い空の DB」への適用専用（CREATE 文のみ・DO ブロックも
# IF NOT EXISTS も持たない）。既存 DB への適用は schema-apply（Atlas の宣言的 apply）を使う。
# CI はこの target を実行し直して git diff で drift（手直し・作り忘れ）をチェックする。
.PHONY: schema-gen
schema-gen: ensure-atlas ensure-atlas-dev-image
	@echo ">>> atlas schema inspect ($(SCHEMA_HCL) -> $(SCHEMA_GEN_SQL), $(LOCAL_DB_INIT_SQL))"
	@tmp="$$(mktemp)"; \
	if ! "$(ATLAS)" schema inspect --url "file://$(SCHEMA_HCL)" --dev-url "$(ATLAS_DEV_URL)" --format '{{ sql . }}' > "$$tmp"; then \
	  rm -f "$$tmp"; \
	  exit 1; \
	fi; \
	cp "$$tmp" "$(SCHEMA_GEN_SQL)"; \
	cp "$$tmp" "$(LOCAL_DB_INIT_SQL)"; \
	rm -f "$$tmp"

# schema.hcl を TARGET の実 DB に当てたときの差分を表示するだけ（何も変更しない）。
# 本番へ当てる前に必ずこれで計画を読み、DROP が意図どおりかを確認すること。
.PHONY: schema-plan
schema-plan: ensure-atlas ensure-atlas-dev-image schema-ensure-pg-trgm
	@if [ -z "$(TARGET)" ]; then echo "使い方: make schema-plan TARGET=postgres://..."; exit 1; fi
	@$(SCOPE_TARGET); \
	 "$(ATLAS)" schema apply --url "$$scoped" --to "file://$(SCHEMA_HCL)" --dev-url "$(ATLAS_DEV_URL)" --dry-run

# schema.hcl を TARGET の実 DB へ宣言的に適用する。Atlas が差分を表示したあと
# ターミナルで承認を求める（--auto-approve は使い捨て DB 以外では付けない）。
.PHONY: schema-apply
schema-apply: ensure-atlas ensure-atlas-dev-image schema-ensure-pg-trgm
	@if [ -z "$(TARGET)" ]; then echo "使い方: make schema-apply TARGET=postgres://..."; exit 1; fi
	@$(SCOPE_TARGET); \
	 "$(ATLAS)" schema apply --url "$$scoped" --to "file://$(SCHEMA_HCL)" --dev-url "$(ATLAS_DEV_URL)"

# sqlc 生成: queries/*.sql + schema.gen.sql → 型安全な Go (internal/adapter/persistence/sqlcgen)。
# 生成物はコミット対象。クエリを変更したら必ず `make sqlc` で再生成する
# （schema.hcl を変更したときは先に `make schema-gen` を通すこと）。
.PHONY: sqlc
sqlc:
	@if [ ! -x "$(SQLC)" ]; then \
	  echo ">>> installing sqlc CLI ($(SQLC_VERSION))..."; \
	  go install github.com/sqlc-dev/sqlc/cmd/sqlc@$(SQLC_VERSION); \
	fi
	@echo ">>> sqlc generate"
	@$(SQLC) generate

# sqlc vet: 生成とは別に、クエリ 1 本ずつへ sqlc.yaml 末尾の rules を当てる静的検査。
# `sqlc generate` はスキーマとの型の突き合わせしか見ないので、「SQL としては正しいが
# 実行すると事故る」書き方（WHERE の無い UPDATE / DELETE 等）はここで弾く。
# ORM を廃して生 SQL に統一した以上、ORM が暗黙に持っていた安全弁はこれしかない。CI でも走る。
.PHONY: sqlc-vet
sqlc-vet:
	@if [ ! -x "$(SQLC)" ]; then \
	  echo ">>> installing sqlc CLI ($(SQLC_VERSION))..."; \
	  go install github.com/sqlc-dev/sqlc/cmd/sqlc@$(SQLC_VERSION); \
	fi
	@echo ">>> sqlc vet"
	@$(SQLC) vet

GOFUMPT_VERSION := v0.10.0
GOFUMPT := $(GO_INSTALL_DIR)/gofumpt

# gofumpt を用意する。
#
# 存在チェックだけでは不十分で、バージョンまで確認して違えば入れ直す。別バージョンが既に
# 入っている環境だと整形結果が CI とずれるため（CI は v0.10.0 固定。v0.11.0 は多行呼び出しの
# 閉じ括弧の扱いが変わっており、ローカルで整形済みでも CI の gofumpt check が fail する）。
.PHONY: ensure-gofumpt
ensure-gofumpt:
	@if ! "$(GOFUMPT)" --version 2>/dev/null | grep -q '^$(GOFUMPT_VERSION) '; then \
	  echo ">>> installing gofumpt ($(GOFUMPT_VERSION))..."; \
	  go install mvdan.cc/gofumpt@$(GOFUMPT_VERSION); \
	fi

# gofumpt(gofmt 上位互換)でコードを自動整形する。CI(gofumpt check)が未整形を fail にするので、
# commit 前に `make fmt` で整える運用。生成コードは gofumpt clean のため対象外。
.PHONY: fmt
fmt: ensure-gofumpt
	@echo ">>> gofumpt -w ."
	@$(GOFUMPT) -w .

.PHONY: verify
verify:
	@if [ ! -x "$(GOFUMPT)" ]; then go install mvdan.cc/gofumpt@$(GOFUMPT_VERSION); fi
	@GOFMT_TMP=$$(mktemp) && \
	  $(GOFUMPT) -l . | tee "$$GOFMT_TMP" && \
	  if [ -s "$$GOFMT_TMP" ]; then echo "ERROR: gofumpt issues above (run 'make fmt')"; rm -f "$$GOFMT_TMP"; exit 1; fi && \
	  rm -f "$$GOFMT_TMP"
	go vet ./...
	go build ./...
	go test ./...
	$(MAKE) sqlc-vet

# 結合テスト: docker-compose で本物の PostgreSQL を起動し、-tags=integration のテストを回す。
# 終了時は必ずコンテナを破棄する（テスト失敗でも teardown する）。
INTEGRATION_DSN := postgres://frestyle:frestyle@localhost:5433/frestyle_integration?sslmode=disable
.PHONY: test-integration
test-integration:
	docker compose -f docker-compose.integration.yml up -d --wait
	@TEST_DATABASE_URL='$(INTEGRATION_DSN)' go test -tags=integration -run Integration ./... ; \
	  status=$$? ; \
	  docker compose -f docker-compose.integration.yml down -v ; \
	  exit $$status

.PHONY: run
run:
	go run ./cmd/server

# ---------------------------------------------------------------------------
# ローカル開発環境の補助 (compose 本体はリポジトリ直下の /docker-compose.yml)
#
# 起動・停止は make を使わず `docker compose up -d` / `docker compose down`。
# ここに残すのは DB のデータ操作(seed / psql / 計測 / 破棄)の補助だけ。
# 結合テスト用(docker-compose.integration.yml / 5433 / tmpfs)とは別物。
# ---------------------------------------------------------------------------
LOCAL_COMPOSE := ../docker-compose.yml

# 各 target が使う psql の共通オプション。接続先はコンテナ自身の環境変数
# (POSTGRES_USER / POSTGRES_DB)に追随させる。Makefile 側に既定値を持つと、
# root の .env で LOCAL_DB_USER 等を変えたとき compose(補間する)とここ(しない)で
# 接続先がずれるため、コンテナ内で解決して常に実際の DB と一致させる。
LOCAL_PSQL := sh -c 'exec psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" "$$@"' --

SIZE ?= small

# volume ごと破棄してまっさらにする。スキーマは次回起動時（docker-entrypoint-initdb.d）で再構築される。
.PHONY: local-reset
local-reset:
	docker compose -f $(LOCAL_COMPOSE) down -v
	@echo "破棄しました。docker compose up -d(初回起動時にスキーマ適用) → make local-seed で作り直せます。"

# ダミーデータ投入。スキーマ適用済みが前提(docker compose up の初回起動時に適用される)。
# 規模: SIZE=small(既定) | medium | large
.PHONY: local-seed
local-seed:
	@docker compose -f $(LOCAL_COMPOSE) exec -T db \
	  $(LOCAL_PSQL) -v ON_ERROR_STOP=1 -v size=$(SIZE) \
	  < scripts/seed-local.sql

.PHONY: local-psql
local-psql:
	@docker compose -f $(LOCAL_COMPOSE) exec db $(LOCAL_PSQL)

# 実測でボトルネックを特定する。体感ではなくここを根拠にする(SQL は scripts/local-slow.sql)。
.PHONY: local-slow
local-slow:
	@docker compose -f $(LOCAL_COMPOSE) exec -T db $(LOCAL_PSQL) < scripts/local-slow.sql

.PHONY: local-slow-reset
local-slow-reset:
	@docker compose -f $(LOCAL_COMPOSE) exec -T db $(LOCAL_PSQL) \
	  -c "SELECT pg_stat_statements_reset();" >/dev/null && echo "統計をリセットしました。"
