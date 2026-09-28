# entities 層

ビジネス上の「もの」（ナレッジのページ・チケット・ワークスペース・ユーザーなど）を表す層。
**その entity のデータ取得（`api`）・型（`model`）・単体表示（`ui`）**をひとまとめにする。

## Slice 一覧

| Slice | 担当 |
|---|---|
| `kb` | ナレッジ: スペース・ページ（木・本文・版・編集の提案・コメント・お気に入り・最近開いたもの）・雛形・ページの権限の付与・ページのラベル。ページの絵（`KbPageGlyph`） |
| `workspace` | ワークスペース（テナント）: 所属の一覧・メンバー・役割（admin / editor / commenter / viewer）・招待。ナレッジとチケットの両方の入れ物 |
| `ticket` | チケット: 状態・種別・担当・添付・コメント・変更の履歴・保存した絞り込み・自分の担当。キーの表示（`TicketKeyBadge`）・状態・種別の印 |
| `project` | プロジェクト（チケットの入れ物） |
| `sprint` | スプリント |
| `project-version` | リリースの版（チケットの修正版） |
| `team` | チーム（チケットの担当チーム） |
| `notification` | 通知・未読数。1 件の表示（`NotificationItem`） |
| `user` | ログイン中のユーザー・プロフィール・認証の状態（Redux の slice はここだけ） |

## セグメント

```
entities/<slice>/
  api/      … 取得の口（<slice>Repository.ts）と、鍵と取得の組（<slice>Queries.ts）
  model/    … 型・その entity を使う hook
  ui/       … その entity 単体の表示コンポーネント
  lib/      … その entity 固有の純粋関数
  config/   … その entity 固有の定数
  @x/       … ほかの entity に見せるもの（下の「@x 記法」）
  index.ts  … 公開口（Public API）
```

取得の組（`queryOptions`）と鍵の付け方は `shared/README.md` の「サーバーの状態」にまとめてある。

## 応答を画面の型へ揃える

backend（Go）は「無い」値をポインタ + `omitempty` で返すので、**無いときはキーごと欠ける**（`null` ではない）。
空の配列は `null` で返ることがある。画面の型（`model/types.ts`）は「無い」を `null`、0 件を `[]` で表すと決め、
**取得の口を出る前に揃える**。画面の側で `?? null`・`?? []`・`=== undefined` を書き散らさない。

- 生の応答の型は `…Wire` と名付け、揃える関数と一緒に置く（`entities/kb/api/kbResponses.ts`・`entities/ticket/model/types.ts` の `TicketWire` と `ticketRepository.ts` の `normalizeTicket`）
- backend が常に返す項目（`omitempty` の無いもの）は、型でも必須にする。「backend より先に出したときの古い応答」への備えは型に残さない（デプロイは backend → frontend の順）
- 一覧の応答が `null` でも配列を返すことは `entities/__tests__/listRepositoriesNullResponse.test.ts` で確かめている（揃える必要の無い一覧は、配列を作り直さず素通しする）

## ルール

**公開口以外から import しない。** 外からは `@/entities/kb` だけを参照し、
`@/entities/kb/api/kbQueries` のような中のパスは使わない（lint の `no-restricted-imports` が止める）。
`index.ts` は名前付きで再公開する（`export *` は公式が禁止）。

**Slice 内は相対パスで参照する。** `entities/kb/api/kbRepository.ts` が同じ Slice の
型を使うときは `'../model/types'`。自分の公開口（`@/entities/kb`）を参照すると
循環し、境界 lint も違反として検出する。

**entity 同士は直接 import できない。** 同じ層だから。どうしても必要なら次の `@x` を使う。

**テストは取得の本体を偽物にする。** テストは層の決まりの対象外で、`vi.mock('@/entities/kb/api/kbRepository')` のように
中のパスを指してよい（公開口だけを替えても、取得の組は本体を直接 import しているので本物を呼ぶ）。
ただし自分の Slice の公開口を読むのはテストでも禁止（Slice の全ファイルが読み込まれ、カバレッジの分母が膨らむ）。

## `@x` 記法（entity 同士のクロス import）

FSD 公式が entities 層に限って認めている例外。**参照される側**が「誰に何を見せるか」を明示する。

実例は `entities/workspace/@x/kb.ts`: ナレッジのスペース・ページの権限は、ワークスペースと同じ役割の言葉
（`GrantRole`）で表し、最初に開くスペースは所属の一覧（`workspacesQuery`）から導く。

```ts
// entities/workspace/@x/kb.ts — kb にだけ見せる
export type { GrantRole, Workspace } from '../model/types';
export { workspacesQuery } from '../api/workspaceQueries';

// entities/kb の中 — @x 経由でだけ参照する
import type { GrantRole } from '@/entities/workspace/@x/kb';
```

**増えたら Slice の切り方を疑う。** `@x` が増えるのは「その 2 つは実は 1 つの entity では」というサイン。

境界 lint（`eslint.config.js`）は `@x` を否定先読みの正規表現で例外にしている。`group` の gitignore 記法では
「親ディレクトリが除外されていると子を再包含できない」ため `!@/entities/*/@x/*` が効かない。

## 置き場所に迷ったときの実例

| 対象 | 置き場所 | 理由 |
|---|---|---|
| ワークスペース・メンバー・招待 | `entities/workspace` | ナレッジとチケットの両方の入れ物。`kb` に置くと、チケットの画面がナレッジを読むことになる |
| ページの絵（`KbPageGlyph`） | `entities/kb/ui` | ページ 1 件の表示。枠（widgets/kb-frame）・ホーム・検索の結果の行が使う |
| 雛形を選ぶ窓・雛形として保存 | `features/kb-page-templates` | 「雛形からページを作る」という操作で、枠とページの画面の 2 か所から使う |
| 全文検索の窓 | `features/kb-search` | 「探す」という操作で、枠とホームの 2 か所から開く |
| チケットの控えの直し方（`reflectTicket` など） | `features/ticket-cache` | チケットとスプリントの一覧をまたぐので、どちらかの entity には置けない |
| 読み込み中・失敗・空の表示（`SkeletonRows`・`ErrorNotice`・`EmptyNotice`） | `shared/ui` | 何のデータかを知らない。どの画面の状態の表示もこれを使う |
