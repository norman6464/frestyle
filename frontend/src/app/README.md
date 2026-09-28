# app 層

アプリ全体に関わる技術的・ビジネス的事項を置く。**FSD の最上位層**。

## 置くもの

- エントリポイント（`index.tsx`。`index.html` が読む）
- ルーティング定義（`App.tsx`。画面は遅延読み込み）
- Provider 群（store / トースト / エラーバウンダリ / 認証初期化）
- ログイン後の親（`layouts/AuthenticatedLayout`: アプリの枠と、取得した結果のキャッシュを配る。遅延読み込み）
- グローバルスタイル

## 構造

**app は Slice を持たない**（公式仕様）。Layer の直下に Segment が来る。

```
app/
  index.tsx   … エントリ（Router・Redux の Provider）
  App.tsx     … ルーティング
  providers/  … 認証の初期化・トースト・エラーバウンダリ・ログイン必須の門
  layouts/    … ログイン後の親
  store/      … Redux の store の組み立て
  styles/     … 全体のスタイル
```

Segment 名は標準の 5 つ（ui / api / model / lib / config）に縛られない。
アプリ初期化の実態に合わせた名前を使ってよい。

## 依存ルール

- **すべての層を import してよい**（最上位のため）
- **どの層からも import されない**
- `app` と `shared` のあいだは相互 import 可（公式の例外）
