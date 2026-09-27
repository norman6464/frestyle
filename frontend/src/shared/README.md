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
