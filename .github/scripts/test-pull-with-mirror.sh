#!/usr/bin/env bash
#
# pull-with-mirror.sh のテスト。docker を偽物に差し替え、取り元ごとの成否を決めて流れを確かめる。
#
# 取り直しは「失敗したときに何をするか」が仕事なので、ECR Public が失敗したときにミラーから取って
# 付け直すこと、両方失敗したら落ちること、ECR Public 以外の取り元にはミラーを当てないことまで見る。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="${HERE}/pull-with-mirror.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

# 偽の docker。呼ばれた引数を 1 行ずつ記録する。pull の成否は FAIL_PULL（空白区切りのイメージ名。
# 名前の後ろに :N を付けると、その取り元は N 回目まで失敗し、その後は成功する）で決める。
mkdir -p "${WORK}/bin"
cat > "${WORK}/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "${DOCKER_LOG}"
if [ "$1" = "pull" ]; then
  target="${!#}"
  count_file="${DOCKER_LOG}.$(echo "${target}" | tr '/:' '__')"
  n=$(( $(cat "${count_file}" 2>/dev/null || echo 0) + 1 ))
  echo "${n}" > "${count_file}"
  for rule in ${FAIL_PULL:-}; do
    name="${rule%%=*}"
    until_n="${rule#*=}"
    [ "${rule}" = "${name}" ] && until_n=999
    if [ "${name}" = "${target}" ] && [ "${n}" -le "${until_n}" ]; then
      exit 1
    fi
  done
fi
exit 0
EOF
chmod +x "${WORK}/bin/docker"

ECR=public.ecr.aws/docker/library/postgres:17.6-alpine
MIRROR=mirror.gcr.io/library/postgres:17.6-alpine
failures=0

# 期待する終了コード / 期待する docker の呼び出し（; 区切り） / 説明 / 取るイメージ / FAIL_PULL
check() {
  local want_code="$1" want_calls="$2" what="$3" image="$4" fail="$5"
  local log="${WORK}/log.$RANDOM"
  : > "${log}"
  env PATH="${WORK}/bin:${PATH}" DOCKER_LOG="${log}" FAIL_PULL="${fail}" PULL_RETRY_SLEEP=0 \
    bash "${SCRIPT}" "${image}" >/dev/null 2>&1
  local got_code=$?
  local got_calls
  got_calls="$(paste -sd ';' "${log}")"
  if [ "${got_code}" != "${want_code}" ] || [ "${got_calls}" != "${want_calls}" ]; then
    echo "::error::${what}: 終了コード ${want_code}・呼び出し [${want_calls}] を期待したが、${got_code}・[${got_calls}] だった"
    failures=$((failures + 1))
  else
    echo "  ok  ${what}"
  fi
}

check 0 "pull --quiet ${ECR}" \
  "ECR Public で取れたら、ミラーは使わない" "${ECR}" ""

check 0 "pull --quiet ${ECR};pull --quiet ${MIRROR};tag ${MIRROR} ${ECR}" \
  "ECR Public で取れなければ、ミラーから取って元の名前に付け直す" "${ECR}" "${ECR}"

check 0 "pull --quiet ${ECR};pull --quiet ${MIRROR};pull --quiet ${ECR}" \
  "両方取れなくても、次の周で取れれば通す" "${ECR}" "${ECR}=1 ${MIRROR}=1"

check 1 "pull --quiet ${ECR};pull --quiet ${MIRROR};pull --quiet ${ECR};pull --quiet ${MIRROR};pull --quiet ${ECR};pull --quiet ${MIRROR}" \
  "3 周とも両方取れなければ落とす" "${ECR}" "${ECR} ${MIRROR}"

check 1 "pull --quiet ghcr.io/example/tool:1;pull --quiet ghcr.io/example/tool:1;pull --quiet ghcr.io/example/tool:1" \
  "ECR Public 以外の取り元にはミラーを当てない" "ghcr.io/example/tool:1" "ghcr.io/example/tool:1"

if [ "${failures}" -gt 0 ]; then
  echo "${failures} 件失敗"
  exit 1
fi
echo "すべて通った"
