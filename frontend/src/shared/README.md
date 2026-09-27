# shared 層

ビジネスから切り離した再利用資産を置く。**FSD の最下位層**。

## 置くもの

- 汎用 UI キット（ボタン / モーダル / 入力欄など、**ビジネス用語を含まないもの**）
- HTTP クライアント（axios インスタンス）と API パス定義
- 汎用ユーティリティ
- 環境変数・共通定数

## 置かないもの

**ビジネスを知っているものは置かない。** これが shared を健全に保つ唯一のルール。

| 対象 | 置き場所 |
|---|---|
| `Button` / `Avatar` | **shared/ui** |
| `UserAvatar` / `CourseCard` | **entities/<slice>/ui** |
| 日付フォーマット | **shared/lib** |
| ページ木の祖先 ID 解決 | **entities/kb/lib** |

判断基準は「**別のプロジェクトにコピーして使えるか**」。使えるなら shared、
そのプロジェクト固有の意味を含むなら上の層。

## 構造

**shared は Slice を持たない**（公式仕様）。Layer の直下に Segment が来る。

```
shared/
  ui/
  api/
  lib/
  config/
```

## サーバーの状態（TanStack Query）

サーバーから取った一覧・詳細は、hook ごとに私有せず TanStack Query のキャッシュで画面をまたいで共有する。
同じ鍵を何か所で使っても 1 回だけ取り、書き込んだら関係する鍵を取り直させる。

### 置き場所

| 何を | どこに |
|---|---|
| キャッシュ（`queryClient`・既定の取り直し方） | `shared/api/queryClient.ts` |
| キャッシュを配る Provider | `app/layouts/AuthenticatedLayout.tsx`（ログイン後の親。遅延読み込みで、最初に読む塊に入れない。外れたら `queryClient.clear()`） |
| 鍵と取得の組（`queryOptions`） | 取るものの entity の `api/*Queries.ts`（例: `entities/user/api/profileQueries.ts`） |
| 画面から使う hook | 同じ entity の `model/useXxx.ts`（例: `useMyProfile`・`useUnreadCount`） |

### 鍵の付け方

- 1 つ目は取るものの名前（複数形・英小文字）。以降に絞り込みの値を並べる: `['profile', 'me']`・`['notifications', 'unread-count']`・`['kb', 'workspaces']`
- 鍵は entity の `xxxKeys` にまとめ、文字列を画面に直書きしない（取り直すときに同じ鍵を指せるように）
- 鍵に入る値は必ず `queryFn` で使う値と同じもの（lint の `@tanstack/query/exhaustive-deps` が見る）

### 書き込んだあと

- **応答が新しい値そのもの**（保存したプロフィール・更新した 1 件）→ `setQueryData` でその鍵を差し替える。取り直しを待たずに表示が変わる
- **応答から一覧が決まらない**（既読にした・消した・並べ替えた）→ `invalidateQueries` で関係する鍵を取り直させる。いま画面に出ていない鍵は、次に使うときに取り直す
- 楽観更新（応答を待たずに書き換える）は、失敗したら戻す手順と一緒に書くときだけ使う

### 取り直し方（`createQueryClient` の既定）

- 通信が届かなかったとき・5xx のときだけ 2 回まで取り直す。4xx はすぐ失敗として出す
- 30 秒は新しいものとして扱う（画面を行き来するたびに取り直さない）
- 書き込みは送り直さない（結果が分からない失敗を二重に送らない）

### テストと見本

- 単体: `@/test/queryClient` の `queryWrapper()` を `render` / `renderHook` の wrapper に渡す（テストごとに新しいキャッシュ・取り直し無し）。2 つの部品で同じキャッシュを共有させたいときは `createTestQueryClient()` で作って両方に渡す
- 見本: `.storybook/decorators.tsx` の `withQueryClient` を preview で全見本にかけてある（見本ごとに新しいキャッシュ）

### React Compiler と一緒に使うとき

- `select` に渡す関数は部品の外（モジュールの上）で作る。描くたびに作ると、取った結果の変わらない描き直しでも `select` が動く

## 依存ルール

- **どの層も import してはいけない**（最下位のため）
- すべての層から import される
- `app` と `shared` のあいだは相互 import 可（公式の例外）

## Public API

各 Segment に `index.ts` を置き、**名前付きで re-export** する。
ワイルドカード（`export *`）は公式が禁止しているので使わない。

```ts
export { Button } from './Button';
export { Modal } from './Modal';
```

呼び出し側は `@/shared/ui` を参照し、`@/shared/ui/Button` のような内部直参照はしない。

### 例外: barrel に載せないもの

**重いモジュールを抱えるものは barrel から出さない。** `RichTextEditor` は中身が
tiptap / ProseMirror（数百 KB）で、`index.ts` で re-export すると `@/shared/ui` を
import した全ページがエディタ一式を巻き込み、コード分割が壊れる。
こういうものは深いパス（`@/shared/ui/RichTextEditor`）で直接 import する。

## 移行状況

FSD 移行の Phase 2 で骨格を作り、**Phase 5a で
`components/` 直下の汎用 UI 18 件をここへ移した**。残っているのは entity / feature
固有の部品で、Phase 5b・6 で `entities/` `features/` へ振り分ける。

**新規に追加する汎用資産は、旧ディレクトリ（`src/components` `src/utils`
`src/constants`）に足さずここへ置くこと。**

### 判断に迷った実例

| 対象 | 置き場所 | 理由 |
|---|---|---|
| `LanguageBadge` / `LanguageIcon` | **shared/ui** | ホームの `FeatureCard` が技術ロゴ表示に使う。entity に置くとビジネス層が shared を参照する向きになり FSD 違反。中身も devicon スラッグと Tailwind クラスの対応表で FreStyle 固有ではない |
| `Toast` | **shared/ui** | 見た目だけを持つ。状態を知らない |
| `ToastContainer` | **app/providers** | `useToastList` で一覧を購読する（出す関数の `useToast` とは箱を分けてある。一覧まで読むと、通知が出るたびに showToast しか使わない部品まで描き直されるため）。shared に置くと、hooks が features へ移った時点で「下位層が上位層を import する」違反になる |
| `PrimaryButton` | **削除** | `Button` に `variant="primary" fullWidth` を渡すだけのラッパ。`Button` の既定 variant がすでに primary なので名前が実態とずれており、`size` / `className` / ネイティブ属性も落としていた |
