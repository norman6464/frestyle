#!/usr/bin/env bash
#
# コンテナのイメージを取る。ECR Public（public.ecr.aws/docker/library/…）で取れなければ、同じ
# イメージを Google の Docker Hub のミラー（mirror.gcr.io/library/…）から取り、元の名前に付け直す。
#
# なぜ要るか: ECR Public はログインしない利用者に転送量の上限があり、GitHub の実行機は出口を
# 多くの利用者と共有するので上限に当たることがある（toomanyrequests: Data limit exceeded）。
# 上限の間は同じ取り元を何度叩いても通らないので、取り元を切り替える。
# 2 つの取り元の中身が同じこと（同じ digest）は、postgres:17.6-alpine で確かめてある。
#
# 使い方: pull-with-mirror.sh <image>
#   取り直しの間隔（秒）は PULL_RETRY_SLEEP で変えられる（既定 10。テストでは 0）。
set -uo pipefail

image="${1:?使い方: pull-with-mirror.sh <image>}"
sleep_seconds="${PULL_RETRY_SLEEP:-10}"
attempts=3

ecr_prefix="public.ecr.aws/docker/library/"
mirror=""
if [[ "${image}" == "${ecr_prefix}"* ]]; then
  mirror="mirror.gcr.io/library/${image#"${ecr_prefix}"}"
fi

for i in $(seq 1 "${attempts}"); do
  if docker pull --quiet "${image}"; then
    exit 0
  fi
  echo "${image} を取れなかった（${i}/${attempts} 周目）。"
  if [ -n "${mirror}" ]; then
    if docker pull --quiet "${mirror}" && docker tag "${mirror}" "${image}"; then
      echo "ミラー ${mirror} から取り、${image} に付け直した。"
      exit 0
    fi
    echo "ミラー ${mirror} からも取れなかった。"
  fi
  if [ "${i}" -lt "${attempts}" ]; then
    sleep "${sleep_seconds}"
  fi
done

echo "::error::${image} を取れなかった（${attempts} 周）。"
exit 1
