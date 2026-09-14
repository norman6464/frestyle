# Atlas の --dev-url 専用の使い捨てイメージ（backend/Makefile の ATLAS_DEV_URL）。
#
# schema.hcl は pg_trgm の GIN トライグラム索引（ops = gin_trgm_ops）を宣言するため、
# 素の postgres イメージを dev-url にすると「operator class ... does not exist」で
# schema-gen / schema-plan / schema-apply が落ちる。かといって schema.hcl 側で
# `extension "pg_trgm" {}` は宣言できない（Atlas OSS 版 CLI は `extension` ブロックが
# ログイン必須の Pro 限定機能。実測済み）。
#
# そこで dev-url にだけ、起動時に pg_trgm を作成済みの自前イメージを使う。
# 01-extensions.sql は backend/scripts/local-db-init/ と全く同じファイル
# （COPY で共有するだけで内容の複製はしない。文言がズレると気づけないため）。
#
# 拡張は template1 にも作る（02-template1.sh 参照）。Atlas は作業用 DB を CREATE DATABASE で
# 作るため、initdb の投入先だけに作っても届かない。
FROM public.ecr.aws/docker/library/postgres:17.6-alpine
COPY local-db-init/01-extensions.sql /docker-entrypoint-initdb.d/01-extensions.sql
COPY atlas-dev/02-template1.sh /docker-entrypoint-initdb.d/02-template1.sh

# 使い捨ての dev-url 専用イメージでも root では動かさない（trivy DS-0002）。
# 公式イメージの entrypoint は非 root でも initdb まで通る（/var/lib/postgresql/data は
# イメージ側で postgres 所有のため、匿名ボリュームもその所有を引き継ぐ）。
USER postgres
