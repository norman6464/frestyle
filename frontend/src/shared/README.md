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
| 鍵の根（ワークスペース・プロジェクトの中） | `shared/api/queryKeys.ts`（`workspacesKey`・`workspaceScope`・`projectScope`） |
| 鍵と取得の組（`queryOptions`） | 取るものの entity の `api/*Queries.ts`（例: `entities/user/api/profileQueries.ts`） |
| 画面から使う hook | 同じ entity の `model/useXxx.ts`（例: `useMyProfile`・`useUnreadCount`） |

### 鍵の付け方

- 1 つ目は取るものの名前（複数形・英小文字）。以降に絞り込みの値を並べる: `['profile', 'me']`・`['notifications', 'unread-count']`・`['workspaces']`
- 鍵は entity の `xxxKeys` にまとめ、文字列を画面に直書きしない（取り直すときに同じ鍵を指せるように）
- 鍵に入る値は必ず `queryFn` で使う値と同じもの（lint の `@tanstack/query/exhaustive-deps` が見る）
- 入れ物の中のものは、どの entity のものでも入れ物の鍵の下に置く。根は `shared/api/queryKeys.ts` の `workspaceScope(slug)`（ワークスペースの中）と `projectScope(slug, projectId)`（プロジェクトの中）: スペースの一覧は `['workspaces', slug, 'spaces']`、ラベルは `['workspaces', slug, 'labels']`、状態は `['workspaces', slug, 'projects', projectId, 'statuses']`。鍵は先頭からの一致で束ねて扱えるので、`['workspaces']` を取り直させればナレッジもチケットも中のものがすべて古くなり、`['workspaces', slug]` を消せば消えたワークスペースの中身が残らない

### 一覧から導けるものは控えない

「この ID はどのワークスペースのものか」「最初に開くスペースはどれか」のように、キャッシュにある一覧から決まるものは、決めた結果を別の鍵で控えず、描くたびに一覧から導く（`entities/kb/model/resolveKbSpace.ts`）。結果を控えると、元の一覧を差し替えても（改名・作成）控えが古いまま残り、取り直させる鍵が増える。

- 導く関数は純粋にして単体で確かめる。一覧がまだ無い・取り直している間は「見つからない」と言わない（作ったばかりのものへ移った直後に、行き止まりを一瞬出さない）
- 持っている一覧は、取り直しの間も・一時的な失敗でも出し続ける（読み込み中や失敗の表示で隠さない）。ただし取り直しが **403・404（見る立場を失った・もう無い）** なら持っている一覧も出さない（管理の画面の一覧などが、立場を失ったあとも画面に残らないように）。判定は `shared/api/queryState.ts` の `queryShownState` にまとめてある（出してよい結果・読み込み中・失敗・見る立場を失ったか）。読み込み中と失敗を出すのは、一覧が 1 度も取れていないときだけ。TanStack Query は画面に戻ったときなどに裏で取り直すので、`isError` や `isFetching` だけで表示を切り替えると、一時的な失敗で出ていた一覧が消える（`data === undefined` と組み合わせて判定する）

### 書き込んだあと

- **応答が新しい値そのもの**（保存したプロフィール・作った 1 件・改名した 1 件）→ `shared/api/queryCache.ts` の `reflectWrite` でその鍵を差し替える。取り直しを待たずに表示が変わる。`setQueryData` を直接呼ばない。`reflectWrite` は、書き込みより前に投げた取得の古い結果があとから届いて上書きしないよう先に止め、まだ一覧を持っていなければ（最初の読み込み中に書いた）「書いた 1 件だけの一覧」を作らずに取り直させる。1 つの書き込みが複数の一覧に効くとき（ワークスペース全体のテンプレートはどのスペースの一覧にも出る）は、鍵の先頭が一致するものすべてに効く `reflectWriteAll`。足すときは id で重複を見る（書いている間に取り直した一覧に既に入っていても二重にしない）
- **応答から一覧が決まらない**（既読にした・消した・並べ替えた）→ `invalidateQueries` で関係する鍵を取り直させる。いま画面に出ていない鍵は、次に使うときに取り直す
- 楽観更新（応答を待たずに書き換える）は、失敗したら戻す手順と一緒に書くときだけ使う（左の列のドラッグの移動）。先に `await cancelQueries` で飛んでいる取得を止めてから書き換える
- 書き込みがほかの一覧にも効くときは、その一覧も古いものにする（提案を採用したら版の一覧、提案を送ったら提案の一覧、テンプレートを保存したらテンプレートの一覧）
- 1 つのものが何か所もの控えに載り、いくつもの画面から書かれるときは、直し方を 1 か所にまとめる。チケットは `features/ticket-cache`（載っている一覧すべて・親の子の一覧・1 件の画面へ映して履歴を古くする `reflectTicket`・件数などの派生を古くする `refreshTicketDerived`・親を変えたら祖先の列と子の一覧を取り直させる `refreshTicketHierarchy`）。バックログ・チケットの画面・ホームの作成の窓のどこで書いてもここを通す。スプリントの一覧もまたぐので entity には置かない
- 絞り込みごとの一覧は鍵が別なので、絞り込みを変えると置き場の「変わらない部分を使い回す」は効かない。行を描き直させたくない一覧は、同じ入れ物の中の一覧を `placeholderData` で出しておき、画面の側で前に出していた値に揃える（`pages/backlog/model/useTicketList.ts`）
- 結果をまだ持っていない最初の読み込みの途中で `refetch` しても、新しくは取らず飛んでいる取得を待つ（結果を持っているときだけ、飛んでいるものを止めて取り直す）

### 置き場に入れないもの

- **書いている最中の下書き**（ページの本文・自動保存）は入れない。置き場は画面に戻ったときなどに裏で取り直すので、入れると書きかけの本文が古い内容で上書きされうる。本文は `pages/kb/model/useKbPageDoc.ts` が持ち、題名・アイコン・カバーを変えたら木の控えを直す（`entities/kb` の `reflectKbPageInTrees`）
- ほかの場所の変化を、置き場に入れていない画面へ届ける合図は `entities/kb` の `kbTreeEvents` に残す（左の列での改名・削除・ワークスペースの削除 → 開いているページの題名と行き先）。サーバーの状態の写しを合図で配らない（それは置き場の役目）

### 取り直し方（`createQueryClient` の既定）

- 通信が届かなかったとき・5xx のときだけ 2 回まで取り直す。4xx はすぐ失敗として出す
- 30 秒は新しいものとして扱う（画面を行き来するたびに取り直さない）
- 書き込みは送り直さない（結果が分からない失敗を二重に送らない）

### テストと見本

- 単体: `@/test/queryClient` の `queryWrapper()` を `render` / `renderHook` の wrapper に渡す（テストごとに新しいキャッシュ・取り直し無し）。2 つの部品で同じキャッシュを共有させたいときは `createTestQueryClient()` で作って両方に渡す
- 見本: `.storybook/decorators.tsx` の `withQueryClient` を preview で全見本にかけてある（見本ごとに新しいキャッシュ）
- キャッシュの変化は次の刻みで部品へ届く。書き込み・再試行・`setQueryData` のあとの表示は `waitFor` / `findBy…` で待つ
- 取得を偽物にするときは、公開口（`@/entities/kb` の `KbRepository`）ではなく取得の本体（`@/entities/kb/api/kbRepository`）を `vi.mock` する。`queryOptions` は本体を直接 import しているので、公開口だけ替えても本物を呼ぶ（`vi.spyOn(KbRepository, …)` は同じ入れ物を書き換えるので効く）

### React Compiler と一緒に使うとき

範囲（`vite-plugins/react-compiler-scope.js`）は pages・widgets・features・entities の ui と model のすべて。コンパイラは扱えない書き方に出会うと、壊しはしないがその部品・hook を**黙って**対象から外す（画面もテストも通るので気づけない）。CI の `pnpm run check:compiler` が範囲のファイルを実際にコンパイラへ通し、1 つでも外したら落とす。

- `select` に渡す関数は部品の外（モジュールの上）で作る。描くたびに作ると、取った結果の変わらない描き直しでも `select` が動く
- `try … finally` と、catch の無い `try` を書かない。後始末は Promise の `.finally()`、失敗の扱いは `.then(成功, 失敗)` か `.catch()` で書く（処理を中の async 関数にまとめて `write().finally(() => …)` の形）
- `try` の中に条件式（`?:`・`&&`・`??`・`?.`）を書かない。これは lint（`react-hooks/todo`）では捕まらず、`check:compiler` だけが捕まえる
- `useCallback` の関数を中から自分で呼ばない（「宣言より前に使っている」になる）。続けて呼ぶ処理は中に名前付きの関数を置く
- 描いている途中で state を揃える（`if (前の値 !== 今の値) setX(…)`）hook では、コンパイラが state の書き換え関数も依存に数える。`useCallback` の依存にも書く

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

### 公開口に「読み込むだけの import」を書かない

`package.json` の `sideEffects` で、読み込むだけで効くのは CSS と `shared/ui/inkwell/index.ts` だけと宣言している。
これで本番のビルドは、公開口（index.ts）越しに使っていない部品を最初に読む塊へ入れない（ストアが `entities/user` の
公開口から reducer を読んでも、プロフィールの問い合わせや TanStack Query まではついてこない）。

その代わり、宣言に無いファイルの `import './x'`（読み込むだけの import）や、トップレベルで何かを登録するだけの
ファイルは、本番のビルドで飛ばされることがある（開発サーバーとテストでは飛ばないので気づきにくい）。

- CSS は、それを使う部品のファイルで直接 import する（CSS は宣言済みなので落ちない）
- どうしても JS のファイルが読み込むだけで効く必要があるなら、`package.json` の `sideEffects` に足す

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
