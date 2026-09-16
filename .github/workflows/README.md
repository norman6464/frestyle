# GitHub Actions ワークフロー構成

CI と CD を **完全に分離** しています。テスト・ビルド検証は自動、デプロイは明示的トリガーのみです。

## ワークフロー一覧

| ファイル | 種別 | トリガー | やること |
|---|---|---|---|
| `ci-backend-go.yml` | CI | PR / push to main（`backend/**` と本ファイルの変更時のみ） | gofumpt / go mod tidy / golangci-lint / govulncheck(advisory) / `go test -race` + coverage / schema・sqlc drift / sqlc vet / `go build` + 結合テスト（実 PostgreSQL）+ 合算カバレッジ floor |
| `ci-frontend.yml` | CI | PR / push to main（`frontend/**`・`.github/scripts/**`・本ファイルの変更時のみ） | tsc / ESLint / build / size-limit(advisory) / knip(advisory) + Vitest unit（カバレッジ閾値）+ Storybook テスト |
| `e2e.yml` | CI | local-mocked: PR / push to main（`frontend/**`）・ smoke: **cd-* の成功後**（`workflow_run`）と手動 | Playwright。smoke は本番 https://frestyle.dev への外形監視、local-mocked は API モックでの導線検証 |
| `security.yml` | CI | PR（依存・Dockerfile・compose 等の変更時のみ）/ 週次 / 手動 | Trivy（依存 CVE・Dockerfile/IaC 誤設定。修正版のある HIGH/CRITICAL で fail） |
| `mutation.yml` | CI（非ブロッキング） | 週次 / 手動 / **`mutation` ラベル付き PR** | gremlins（Go）のミューテーションテスト。Stryker（JS/TS）は CI から外しており手元で `pnpm exec stryker run` |
| `cd-backend.yml` | CD | **workflow_dispatch のみ** | Artifact Registry へ push + Cloud Run の新リビジョン作成（Cloud Run サービス自体は infra リポの Terraform が管理） |
| `cd-frontend.yml` | CD | **workflow_dispatch のみ** + tag `release/v*` | Firebase Hosting へデプロイ |

### 課金分数を増やさないための約束

GitHub-hosted runner の課金は **ジョブごとに 1 分単位で切り上げ** られる（10 秒のジョブも 1 分。private リポの
無料枠は月 2,000 分）。public のあいだは課金されないが、private に戻しても枠内に収まるよう次の方針で運用する。

- CI は変更に関係するパスでだけ発火させる（`paths:`）。branch protection の必須チェックにはしていない
  （paths で発火しなかったワークフローのチェックは pending のまま残り、PR がマージできなくなるため。
  必須にするなら変更検知ジョブ + `if:` 方式へ切り替える）
- 全ワークフローに `concurrency` を付け、PR への連続 push では古い実行をキャンセルする（main push は止めない）
- 数十秒で終わる検査を別ジョブにしない（切り上げで 1 分ずつ増える）。shard は待ち時間が問題になってから
- 本番を叩くスモークはデプロイ後にだけ走らせる。PR の時点では本番は変わっていない
- 新しいジョブや shard を足すときは、1 イベントあたりの課金分数がいくつ増えるかを PR に書く

`cd-backend.yml` が tag push を持たないのは、本番デプロイ用の WIF binding（インフラ側
Terraform）が `refs/heads/main` 上の実行にしか許可されていないため（`release/v*` タグは
含まれない）。タグ経路を持たせるにはインフラ側の対応が先に要る。

## CD が使う設定値（Secrets は不要）

**CD はどちらも GitHub Secrets を持たない。**

`cd-backend.yml` の Artifact Registry のリポジトリ名・Cloud Run サービス名、`cd-frontend.yml` の
API の URL・GCIP（Firebase Authentication）のクライアント設定（`VITE_FIREBASE_API_KEY` /
`VITE_FIREBASE_AUTH_DOMAIN` / `VITE_FIREBASE_PROJECT_ID`）は、いずれも値そのものが秘密ではない
ためワークフロー内に直接書いている（`env:` 参照）。

Firebase のクライアント設定を Secret にしないのは、**隠せる種類の値ではない**ため。
ビルド成果物の JS に焼き込まれ、frestyle.dev を開いた誰もが読める。鍵ではなく
「どのプロジェクトへ話しかけるか」の宛先で、守りは GCIP 側の許可ドメイン
（`authorizedDomains`）と Auth の規則が担う。

`VITE_OIDC_*` は Dex（ローカル開発の発行者）専用で、本番のビルドには渡さない。

GCP 認証はどちらのワークフローも Workload Identity Federation（WIF）で、実行のたびに一時認証情報を
引き受ける（長寿命のサービスアカウントキーは発行しない）。WIF pool/provider・サービスアカウントは
infra リポの Terraform が管理する。

| ワークフロー | 引き受ける先 | 定義 |
|---|---|---|
| `cd-backend.yml` | GCP サービスアカウント `frestyle-prod-github-deploy@frestyle-prod.iam.gserviceaccount.com`（WIF pool `github`） | frestyle-infrastructure の Terraform（Cloud Run 用 WIF pool/provider） |
| `cd-frontend.yml` | GCP サービスアカウント `frestyle-frontend-deploy@frestyle-507912.iam.gserviceaccount.com`（WIF pool `github`） | frestyle-infrastructure の Terraform（Firebase Hosting 用 WIF pool/provider） |

### Secrets 一覧確認

```bash
gh secret list -R norman6464/frestyle
```

## 設計方針

### 1. CI と CD を分離
- CI（テスト・検証）と CD（デプロイ）は別ファイル。**CD は GCP リソースを触る**ため、明示的なトリガーでのみ動かす

### 2. 通常 push では CD は動かない
- main にマージしただけではデプロイされない
- ドキュメント更新やリファクタなど「動作に影響しない変更」で誤って本番デプロイされることがない
- デプロイしたいときは **手動で workflow_dispatch を起動**（frontend は **`release/v*` タグを push** でも可。backend は WIF binding が `refs/heads/main` にしか許可されていないためタグ経路を持たない）

### 3. 手動実行時の二重確認
- `workflow_dispatch` の入力欄に `deploy` と入力しないと先に進まない
- 誤クリックでデプロイされない

## デプロイ手順

### A. 手動デプロイ（普段はこちら）

1. GitHub UI: Actions → 対象ワークフロー（`CD - Backend Deploy to Cloud Run` 等）を開く
2. 「Run workflow」ボタン → ブランチ選択（通常 `main`）
3. `confirm` 欄に **`deploy`** と入力 → Run
4. `deploy` job は production Environment の required reviewers 承認待ちで止まる。GitHub UI で承認する
5. 完了を待つ

### B. リリースタグ付与でのデプロイ（frontend のみ）

```bash
# main を最新に
git checkout main
git pull

# リリースタグ付与
git tag release/v1.2.3
git push origin release/v1.2.3
```

タグ push をフックに `cd-frontend.yml` が自動実行される。backend（`cd-backend.yml`）はこの経路を
持たない（WIF binding の制約。上の「CD が使う設定値」参照）。

### C. CLI でのデプロイ（`gh` 使用）

```bash
# Backend
gh workflow run cd-backend.yml --ref main -f confirm=deploy

# Frontend
gh workflow run cd-frontend.yml --ref main -f confirm=deploy

# 進捗確認
gh run list --workflow=cd-backend.yml --limit 5
```

## CI と CD のスコープまとめ

| ワークフロー | テスト | Docker image push | Cloud Run deploy | Firebase Hosting deploy |
|---|:-:|:-:|:-:|:-:|
| ci-backend-go | ✅ (lint / test / build + 結合テスト) | – | – | – |
| ci-frontend | ✅ | – | – | – |
| e2e / security / mutation | ✅ | – | – | – |
| cd-backend | – | ✅ (Artifact Registry) | ✅ | – |
| cd-frontend | – | – | – | ✅ |

## トラブル: ロールバックしたい

Artifact Registry の cleanup policy は、タグ無しイメージを 7 日、タグ付きイメージを 30 日で削除し
（直近 3 版は残す）、`cd-backend.yml` は毎回 `:latest` と `:<commit sha>` の 2 タグを push している。
3 版以内であれば、対象の SHA タグを指定して手動でロールバックできる。

```bash
gcloud run services update frestyle-prod-backend \
  --project frestyle-prod --region asia-northeast1 \
  --image asia-northeast1-docker.pkg.dev/frestyle-prod/frestyle-prod-backend/fre-style:<過去のcommit sha>
```

Cloud Run は指定した image 参照をそのままデプロイする。
