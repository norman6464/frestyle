# コントリビューションガイド

FreStyle の開発に参加するための規約をまとめます。
チーム全員が参照できるよう、このファイルはリポジトリにコミットしています。

- バックエンド: Go / Gin / sqlc（`backend/`）
- フロントエンド: React 19 / TypeScript / Vite / Tailwind（`frontend/`）
- インフラ / CI の設計判断: 別リポ（IaC・非公開）の `docs/`

---

## 1. セットアップ

起動手順・ローカルログイン（Dex）・DB のやり直し方は [トップ README](./README.md#セットアップ) にまとめてある。ここでは重複させない（2 箇所に同じ手順を書くと片方だけ更新されてドリフトする）。

DB 接続情報・環境変数は `.env`（gitignore 済）に置き、**絶対にコミットしない**。

---

## 2. ブランチ / コミット / PR

### ブランチ

- `main` への直接コミットは禁止（ブランチ保護済み）。必ず PR 経由。
- ブランチ名は Prefix を付ける: `feat/*` / `fix/*` / `refactor/*` / `docs/*` / `test/*` / `chore/*`
- マージ後はローカルブランチを削除し、新しい作業は `main` から切り直す。

### コミットメッセージ

- 日本語で書く。先頭に Prefix: `feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `perf` / `style`
- 例: `feat: 企業申請フォームを追加`

### 言語

- **日本語**: PR タイトル / 本文 / Issue / コミットメッセージ / コメント
- **英語**: 識別子（型・変数・関数名）
- 他社プロダクト名（Zenn / Qiita / Slack / Notion 等）は PR / Issue / コード / docs に書かない。機能の中身で説明する。

### PR フロー

1. Issue を起票（テンプレートあり）
2. ブランチを切って作業 → コミット
3. PR を作成（テンプレートの「概要 / 変更内容 / テスト / 関連 Issue」を埋める）
4. **CodeRabbit のレビューを待ち**、指摘に対応（対応 or 意図を説明）
5. **Code Owner（`@norman6464`）の承認**後に **squash merge**

---

## 3. アーキテクチャ規約（クリーンアーキテクチャ）

依存方向を厳守する。**矢印の向き以外の依存は禁止**。

```
handler  →  usecase  →  repository(port) / infra  →  domain
(Gin)      (Application)   (Persistence / External)    (Entity)
```

- handler は repository / infra を直接呼ばず、必ず usecase を経由する（wiring の `router.go` / `routes_*.go` は例外）
- usecase は `*gin.Context` / `net/http` を参照しない
- domain は他層に依存しない（標準ライブラリのみ）
- repository は **interface（`usecase/repository/`）** と **実装（`adapter/persistence/`）** を分離
- 1 usecase = 1 ビジネスルール（`struct + New...UseCase + Execute`）。集約系の例外は許容

---

## 4. テスト

新規・変更コードには必ずテストを付ける。

```bash
# バックエンド
cd backend
make fmt             # gofumpt -w でコードを自動整形（commit 前に実行）
make verify          # gofumpt / vet / build / test / sqlc-vet を一括
make test-integration  # docker-compose で本物の PostgreSQL に対する結合テスト

# フロントエンド
cd frontend
pnpm run test:run     # Vitest
pnpm run e2e          # Playwright 本番スモーク
pnpm run e2e:local    # ローカルビルド + API モックの認証導線 E2E（要 build）
```

- **単体**: 依存を interface で差し替え（**手書き fake が基本**・状態 / 戻り値を検証。`testify/mock` は相互作用が仕様のときだけ）
- **結合**: handler（httptest で本物の Gin ルータ）/ repository（`//go:build integration` で本物の Postgres）
- **E2E**: 本番スモーク + ローカルモック（`/auth/me` のレスポンスで認証状態を制御。本番の認証基盤/DB に触れない）
- **カバレッジゲート**: frontend は閾値（lines 85 等）、backend は総計 floor（`COVERAGE_MIN`）を下回ると CI が落ちる。テスト追加に合わせて floor を引き上げる

**テストの哲学は古典学派（Classicist / Detroit）**を採用する。本物を使えるところは本物（実 DB・実ルータ）、扱いにくい依存だけ手書き fake に差し替え、検証は状態 / 出力。`testify/mock`（相互作用検証）は「呼ばれたこと自体が仕様」のときだけ。詳細は [トップ README のテスト節](./README.md) と `IaC リポ/docs/25` / `26`。

---

## 5. CI / 品質ゲート

PR では変更したパスに対応するものだけが走る（一覧と方針は `.github/workflows/README.md`）:

- backend（`backend/**`）: **gofumpt(整形強制)** / go mod tidy / golangci-lint / govulncheck(advisory) / **race + coverage** / schema・sqlc drift / sqlc vet / build / 結合テスト(Postgres) / **合算カバレッジ floor**（`COVERAGE_MIN`）
- frontend（`frontend/**`）: tsc / ESLint(max-warnings=0) / build / **Vitest + coverage 閾値** / Storybook テスト / knip・size-limit(advisory) / ローカルモック E2E（Playwright）
- 依存・Dockerfile 等の変更時: Trivy（修正版のある HIGH/CRITICAL で fail）
- 本番スモーク E2E は PR では走らない（デプロイ後にだけ走る）

本リポジトリに `docs/` フォルダは置かない（README はアプリケーションの説明に限定）。取り組んだ内容・手順は **Jira チケット**に残し、必要なら該当ディレクトリの README を更新する。設計・運用の詳細は private リポ（`frestyle-pdm` / `frestyle-infrastructure`）の `docs/` に置く。

---

## 6. シークレット / セキュリティ

秘密情報（クラウドの API キー / DB パスワード / トークン等）は `.env`（gitignore 済）か Secrets Manager に置き、**コード・docs に直書きしない**。

漏洩対策は多層防御:

| 層 | 仕組み |
|---|---|
| push 時 | **GitHub Push Protection**（既知パターンの秘密を含む push をブロック。有効化済み） |
| PR レビュー | **CodeRabbit**（gitleaks を含む。手動トリガー） |
| コミット前（手元） | **lefthook + gitleaks** の pre-commit フック |

pre-commit フックの有効化（推奨）:

```bash
brew install lefthook gitleaks   # macOS
lefthook install                 # リポジトリごとに 1 回
```

テスト用の固定値など**機密でない**ものが誤検知されたら、`.gitleaks.toml` の `allowlist` に追加する（実機密を広く allowlist しないこと）。

## 7. デプロイ（本番保護）

いずれも**マージ即本番反映ではない**。手動 `workflow_dispatch`（`confirm=deploy`）で起動し、`deploy` job は
`production` Environment（required reviewers = `@norman6464`）の**承認待ちで停止**する。

- **backend**（`cd-backend.yml`）: Artifact Registry へ push → Cloud Run の新リビジョン作成 → `/api/v2/health` で確認
- **frontend**（`cd-frontend.yml`）: Firebase Hosting へデプロイ → 配信された HTML が今回の資産を指すことを確認。`release/v*` タグ push でも起動できる

```bash
gh workflow run cd-backend.yml --ref main -f confirm=deploy
gh workflow run cd-frontend.yml --ref main -f confirm=deploy
```

ロールバック手順は `.github/workflows/README.md` を参照。

## 8. マージ権限

- `main` はブランチ保護下（force-push・削除は禁止）。**PR承認・CI green は GitHub 側の必須設定にはなっていない**（`required_pull_request_reviews.required_approving_review_count` は 0、`required_status_checks` は未設定。`enforce_admins` は on だが、そもそもゲートが無いため意味を持たない）。運用上はレビューを得てからのマージを基本とする。
- リポジトリ管理者（`@norman6464`）は admin 権限で要件をバイパスできる（`gh pr merge --admin`）。緊急時・自分の PR の最終マージ用。
- メンバーを追加するときは **Write / Maintain ロール**で（Admin ロールはバイパスできてしまうため避ける）。
