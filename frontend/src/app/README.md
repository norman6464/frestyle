# app 層

アプリ全体に関わる技術的・ビジネス的事項を置く。**FSD の最上位層**。

## 置くもの

- エントリポイント（`main.tsx` / `App.tsx`）
- ルーティング定義
- Provider 群（store / トースト / エラーバウンダリ / 認証初期化）
- ログイン後の親（`layouts/AuthenticatedLayout`: アプリの枠と、取得した結果のキャッシュを配る。遅延読み込み）
- グローバルスタイル

## 構造

**app は Slice を持たない**（公式仕様）。Layer の直下に Segment が来る。

```
app/
  providers/
  layouts/
  routes/
  styles/
  store/
```

Segment 名は標準の 5 つ（ui / api / model / lib / config）に縛られない。
アプリ初期化の実態に合わせた名前を使ってよい。

## 依存ルール

- **すべての層を import してよい**（最上位のため）
- **どの層からも import されない**
- `app` と `shared` のあいだは相互 import 可（公式の例外）

## 移行状況

FSD 移行の Phase 1 でここへ移す。それまでは `src/` 直下と
`src/store/` にある。**新規に追加するアプリ初期化コードは、旧構造に足さずここへ置くこと。**
