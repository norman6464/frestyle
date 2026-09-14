#!/bin/sh
# 同じ拡張を template1 にも作る。
#
# Atlas の --dev-url（docker+postgres://_/<image>/dev）は、この容器の中に作業用の
# データベースを **その都度 CREATE DATABASE で** 用意する。CREATE DATABASE の雛形は
# template1 なので、initdb の投入先（既定の postgres データベース）にだけ拡張を作っても
# 作業用 DB には入らない —— 実測で postgres:1 / dev:0。
#
# 作業用 DB に pg_trgm が無いと、Atlas が現状のスキーマをそこへ写して計画を検証する段で
#   create index "idx_page_search_title_trgm" to table: "page_search":
#   operator class "gin_trgm_ops" does not exist for access method "gin"
# になり、対象 DB 側には拡張が入っているのに schema-apply が通らない（実際に踏んだ）。
#
# 文言を増やさないため、01-extensions.sql を**同じファイルのまま**流し直す。
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname template1 \
  -f /docker-entrypoint-initdb.d/01-extensions.sql
