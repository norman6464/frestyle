-- ナレッジ（workspaces / spaces / pages / blocks / page_paths / page_snapshots）のクエリ。
--
-- 作法（このファイル全体の前提）:
--   - すべての SELECT / UPDATE / DELETE の WHERE に workspace_id を含める。
--     DB の複合 FK が守るのは「親子の整合」までで、テナント越えの読み書きは
--     クエリレベルで塞ぐ（page_snapshots のように workspace_id を持たない表は pages と JOIN する）。
--   - UPDATE 文には必ず updated_at = now() を明示する。GORM を通さないため自動更新が無く、
--     忘れると snapshot の鮮度判定（built_at との比較）が将来壊れる。
--   - 並び順（position）は COLLATE "C" の列なので ORDER BY はバイト順になり、
--     fracindex（Go 側のバイト比較）と一致する。

-- name: GetWorkspaceByID :one
-- ワークスペースの存在確認（テナント検証の入口）。
SELECT * FROM workspaces
WHERE id = $1;

-- name: GetWorkspaceBySlug :one
-- URL に出る slug からワークスペースを引く（HTTP 層のテナント解決の入口）。
-- slug はグローバルに一意（uq_workspaces_slug）なので workspace_id での絞り込みは要らない。
SELECT * FROM workspaces
WHERE slug = $1;

-- name: InsertWorkspace :one
-- ワークスペースの作成。slug はグローバルに一意（uq_workspaces_slug）なので、
-- 重複は一意制約違反として返り、repository が「その slug は使用済み」へ翻訳する。
-- personal_owner_user_id は個人ワークスペースだけ非 NULL（uq_workspaces_personal_owner で
-- 1 人 1 つ）。通常のチームワークスペースは NULL のまま渡す。
INSERT INTO workspaces (id, slug, name, personal_owner_user_id)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListAllWorkspaceIDs :many
-- 全ワークスペースの id（slug 順）。cmd/rebuildsearchindex（一回限りの再構築）が
-- 全ワークスペースを列挙するために使う。テナントを故意に跨ぐ唯一の
-- 用途で、通常の API 経路（handler → usecase）からは呼ばない。
SELECT id FROM workspaces
ORDER BY slug;

-- name: GetPersonalWorkspaceByOwner :one
-- 個人ワークスペースを持ち主から引く。サインアップの「作る前に既に在るか見る」に使う
-- （uq_workspaces_personal_owner が 1 人 1 つを守るので、あれば必ず 1 行）。
SELECT * FROM workspaces
WHERE personal_owner_user_id = $1;

-- name: InsertSpace :one
-- スペースの作成。key はワークスペース内で一意（uq_spaces_workspace_key）。
-- visibility の値は domain.SpaceVisibility が正（'workspace' / 'private'）。
INSERT INTO spaces (id, workspace_id, "key", name, visibility)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: DeleteWorkspace :execrows
-- ワークスペースを消す。**そこに所属している人がいるものは消さない**（WHERE で弾く）。
--
-- 配下（spaces / pages / blocks / page_paths / principals / grants / 共有リンク /
-- workspace_members）はすべて workspaces への FK が ON DELETE CASCADE で連なっているので、
-- この 1 文で消える。
--
-- 人が居るワークスペースを守るのは、そこに全員のナレッジが入るため。1 人の操作でみんなの
-- 資産が消えてよいはずがない。WHERE で明示して 0 行で返し、呼び出し側が「無い」と
-- 「人が居る」を撃ち分けられるようにする。
--
-- 判定は workspace_members の active な行（段 2）。invited（まだ受諾していない）だけの
-- ワークスペースは「人が居る」に数えない — 誰もまだ実際にはアクセスしていないため。
DELETE FROM workspaces w
WHERE w.id = $1
  AND NOT EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = w.id AND wm.status = 'active'
  );

-- name: GetSpace :one
-- スペースの存在確認。workspace_id を含めることで別テナントのスペース ID を弾く。
SELECT * FROM spaces
WHERE workspace_id = $1 AND id = $2;

-- name: InsertPage :one
-- ページの作成。created_at / updated_at / archived_at は DB 既定値に任せ、
-- RETURNING で確定した行を返す（アプリ側の時刻と DB の時刻を二重管理しない）。
INSERT INTO pages (id, workspace_id, space_id, parent_id, "position", title, created_by_user_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: GetPage :one
-- ページを 1 件取得（アーカイブ済みも返す。現役かどうかの判断は usecase 側）。
SELECT * FROM pages
WHERE workspace_id = $1 AND id = $2;

-- name: GetPageAcrossWorkspaces :one
-- ページを **ID だけ** で引く。/p/{pageId} の URL からワークスペースを特定するための、
-- このファイルで唯一 workspace_id を WHERE に持たない読み取り。
-- 引いた直後に必ずその workspace の権限判定を通すこと（判定なしで応答に使わない）。
-- id は uuid の主キーで全テナント一意なので、これ自体が越境にはならない
-- （危ういのは結果の使い方で、それは呼び出し側の usecase が縛る）。
SELECT * FROM pages
WHERE id = $1;

-- name: ListChildPages :many
-- 指定ページ直下の現役の子ページ一覧（position 順 = 表示順）。
SELECT * FROM pages
WHERE workspace_id = $1 AND parent_id = $2 AND archived_at IS NULL
ORDER BY "position";

-- name: UpdateSpaceName :execrows
-- スペースの表示名だけを変える。key は URL・権限の参照に使われるので触らない。
-- 0 件なら対象が存在しない（別ワークスペースの ID もここで 0 件になる —
-- workspace_id を WHERE に含める作法はこのファイルの先頭コメントのとおり）。
UPDATE spaces SET name = $3, updated_at = now()
WHERE workspace_id = $1 AND id = $2;

-- name: ListActivePagesBySpace :many
-- スペース配下の現役ページ全件（ツリー構築用）。position はバイト順なので、
-- 同じ親を持つページ同士はこの並びのまま兄弟順になる（木への組み立ては Go 側）。
SELECT * FROM pages
WHERE workspace_id = $1 AND space_id = $2 AND archived_at IS NULL
ORDER BY "position";

-- name: ListActivePageIDsByWorkspace :many
-- ワークスペース全体（スペースを問わない）の現役ページ id（アーカイブ済みは除く）。
-- cmd/rebuildsearchindex（一回限りの再構築）が、ワークスペース 1 つの
-- 中で再構築すべきページを列挙するために使う。並び順は id（安定した反復順が要るだけで、
-- 表示順の意味は持たない）。
SELECT id FROM pages
WHERE workspace_id = sqlc.arg(workspace_id) AND archived_at IS NULL
ORDER BY id;

-- name: GetLastActiveSiblingPosition :one
-- 兄弟（同じ親、ルートなら同じスペース直下）の末尾 position。末尾追加の採番
-- fracindex.Between(末尾, "") に使う。parent_id は NULL 可のため IS NOT DISTINCT FROM で比較する。
SELECT "position" FROM pages
WHERE workspace_id = sqlc.arg(workspace_id)
  AND space_id = sqlc.arg(space_id)
  AND parent_id IS NOT DISTINCT FROM sqlc.narg(parent_id)
  AND archived_at IS NULL
ORDER BY "position" DESC
LIMIT 1;

-- name: SiblingPositionsAround :one
-- 「ある兄弟のすぐ前／すぐ後ろに入れる」ための、前後の並び順キーを返す。
--
-- ドラッグで落とした位置を表すのに使う。**クライアントは並び順のキーを持たない**
-- （応答に入れていない。整数部が兄弟の通し番号になるので、飛びから伏せた枚数が読めるため）。
-- 代わりに「どの兄弟の隣か」をページの ID で受け取り、キーの計算はここから先で行う。
--
-- 3 つとも NULL なら、anchor_page_id はその親の現役の子ではない（存在しない・別の親・
-- 別スペース・アーカイブ済みのいずれか）。呼び出し側はまとめて「兄弟ではない」に落とす。
--
-- moving_page_id を必ず除くのは、動かす当人がまだその並びに居るため。除かないと
-- 自分自身との中間値を計算することになり、動かないか、隣とキーが衝突する。
--
-- 伏せられている兄弟も隣人として数える。利用者からは見えないが並びには居るので、
-- 除くとキーが既存の行と衝突する。どのキーになったかは応答に出ないので漏れない。
WITH anchor AS (
    SELECT a."position"
    FROM pages a
    WHERE a.workspace_id = sqlc.arg(workspace_id)
      AND a.id = sqlc.arg(anchor_page_id)
      AND a.space_id = sqlc.arg(space_id)
      AND a.parent_id IS NOT DISTINCT FROM sqlc.narg(parent_id)
      AND a.archived_at IS NULL
      AND a.id <> sqlc.arg(moving_page_id)
)
-- 端が無いことは NULL ではなく空文字で表す。fracindex.Between が「空文字＝そちら側に
-- 隣がいない」という約束なので、そのまま渡せる形に揃える。
-- anchor が兄弟だったかは found で別に返す（空文字だけでは「先頭に入れる」と
-- 「兄弟ではない」を区別できない）。
SELECT
    EXISTS (SELECT 1 FROM anchor) AS found,
    COALESCE((SELECT anchor."position" FROM anchor), '')::text AS anchor_position,
    COALESCE((SELECT max(p."position")
       FROM pages p, anchor
      WHERE p.workspace_id = sqlc.arg(workspace_id)
        AND p.space_id = sqlc.arg(space_id)
        AND p.parent_id IS NOT DISTINCT FROM sqlc.narg(parent_id)
        AND p.archived_at IS NULL
        AND p.id <> sqlc.arg(moving_page_id)
        AND p."position" < anchor."position"), '')::text AS prev_position,
    COALESCE((SELECT min(p."position")
       FROM pages p, anchor
      WHERE p.workspace_id = sqlc.arg(workspace_id)
        AND p.space_id = sqlc.arg(space_id)
        AND p.parent_id IS NOT DISTINCT FROM sqlc.narg(parent_id)
        AND p.archived_at IS NULL
        AND p.id <> sqlc.arg(moving_page_id)
        AND p."position" > anchor."position"), '')::text AS next_position;

-- name: HasActiveSiblingPosition :one
-- 指定 position を持つ現役の兄弟が既にいるか（アーカイブ復帰時の衝突検出用）。
-- 部分 UNIQUE（uq_pages_parent_position / uq_pages_space_position）は現役だけを守るため、
-- 復帰する行自身（excluded_page_id）を除いて衝突を先に調べる。
SELECT EXISTS (
    SELECT 1 FROM pages
    WHERE workspace_id = sqlc.arg(workspace_id)
      AND space_id = sqlc.arg(space_id)
      AND parent_id IS NOT DISTINCT FROM sqlc.narg(parent_id)
      AND "position" = sqlc.arg(position)
      AND archived_at IS NULL
      AND id <> sqlc.arg(excluded_page_id)
) AS conflicted;

-- name: UpdatePageTitle :one
-- タイトル変更。RETURNING で更新後の行を返す。
UPDATE pages
SET title = $3, updated_at = now()
WHERE workspace_id = $1 AND id = $2
RETURNING *;

-- name: UpdatePageIcon :one
-- アイコンの設定・解除（icon に NULL を渡せば解除）。RETURNING で更新後の行を返す。
-- 正規形（domain.PageIcon を json.Marshal したもの）だけを書く前提で、入力の妥当性は
-- usecase / domain 側（Valid()）が保証する。ここでは形の検証をしない。
UPDATE pages
SET icon = sqlc.narg(icon), updated_at = now()
WHERE workspace_id = sqlc.arg(workspace_id) AND id = sqlc.arg(id)
RETURNING *;

-- name: UpdatePageCover :one
-- カバー画像の設定・解除（cover に NULL を渡せば解除）。RETURNING で更新後の行を返す。
-- 正規形（domain.PageCover を json.Marshal したもの）だけを書く前提で、入力の妥当性（key の形）は
-- usecase 側が保証する。ここでは形の検証をしない。
--
-- archived_at IS NULL を最初から入れておく（UpdatePageIcon には無い）。段 1a の
-- TouchPageLastEditedBy で見つかった「FindPage でのアーカイブ確認から実際の UPDATE までの間に
-- 別トランザクションがアーカイブを commit する」競合を、この新規メソッドでは最初から塞ぐ。
-- UpdatePageIcon 自体を直すのは本チケットのスコープ外。
UPDATE pages
SET cover = sqlc.narg(cover), updated_at = now()
WHERE workspace_id = sqlc.arg(workspace_id) AND id = sqlc.arg(id) AND archived_at IS NULL
RETURNING *;

-- name: UpdatePageVisibility :one
-- 公開範囲の変更。RETURNING で更新後の行を返す。値の妥当性（domain.ValidPageVisibility）は
-- usecase 側が保証する。archived_at IS NULL は UpdatePageCover と同じ理由で最初から入れる。
UPDATE pages
SET visibility = sqlc.arg(visibility), updated_at = now()
WHERE workspace_id = sqlc.arg(workspace_id) AND id = sqlc.arg(id) AND archived_at IS NULL
RETURNING *;

-- name: TouchPageLastEditedBy :execrows
-- 最終編集者の記録。呼び出し側（ReplacePageBlocksUseCase）は本文の全消し全入れより
-- **先に**これを呼ぶ。UPDATE が pages の対象行を排他ロックするため、同じページへの
-- 同時保存はここで直列化される（先着が blocks を消し終えるまで後着はここで待つ）。
-- 先に呼ばないと、2 つの保存が pages のロックを取らずに blocks へ同時に触り、
-- 「片方の全消しの後にもう片方の全入れ」のような順序で本文が混ざり得る。
-- archived_at IS NULL も見るのは、呼び出し側の FindPage によるアーカイブ確認から
-- ここまでの間に別トランザクションがアーカイブを commit する競合を塞ぐため。
-- 該当 0 行なら既存の ErrPageNotFound 経路で保存トランザクション全体を中止する。
UPDATE pages
SET last_edited_by_user_id = sqlc.arg(user_id)::bigint, updated_at = now()
WHERE workspace_id = sqlc.arg(workspace_id) AND id = sqlc.arg(id) AND archived_at IS NULL;

-- name: SetPagePosition :execrows
-- position の振り直し（アーカイブ復帰で衝突したときの末尾再採番用）。
UPDATE pages
SET "position" = $3, updated_at = now()
WHERE workspace_id = $1 AND id = $2;

-- name: MovePageWithinSpace :execrows
-- 同一スペース内の移動（親と position の付け替え）。space_id が変わらないので
-- 子孫には触らない（子孫の parent_id / space_id はそのままで整合が保たれる）。
UPDATE pages
SET parent_id = sqlc.narg(new_parent_id),
    "position" = sqlc.arg(new_position),
    updated_at = now()
WHERE workspace_id = sqlc.arg(workspace_id) AND id = sqlc.arg(page_id);

-- name: MovePageSubtreeToSpace :execrows
-- スペースをまたぐ移動。移動するページ自身（親・position・space_id）と
-- 子孫全員（space_id のみ）を 1 文で更新する。
--
-- 1 文であることは省略できない: fk_pages_parent は「親は同じスペースのページ」を要求し、
-- FK（NO ACTION）は文の終わりに検査される。ページだけ先に動かすと子の FK が、
-- 子孫だけ先に動かすと子孫自身の FK が、それぞれ文末で違反になる。
-- サブツリーの特定は page_paths（ancestor_id = 移動ページ。depth=0 の自分自身も含む）。
-- アーカイブ済みの子孫も FK の対象なので除外しない。
UPDATE pages
SET space_id = sqlc.arg(new_space_id),
    parent_id = CASE WHEN pages.id = sqlc.arg(page_id) THEN sqlc.narg(new_parent_id) ELSE pages.parent_id END,
    "position" = CASE WHEN pages.id = sqlc.arg(page_id) THEN sqlc.arg(new_position) ELSE pages."position" END,
    updated_at = now()
WHERE pages.workspace_id = sqlc.arg(workspace_id)
  AND pages.id IN (
      SELECT pp.page_id FROM page_paths pp
      WHERE pp.workspace_id = sqlc.arg(workspace_id) AND pp.ancestor_id = sqlc.arg(page_id)
  );

-- name: ArchivePageSubtree :execrows
-- サブツリーごとアーカイブ。now() はトランザクションのタイムスタンプなので、
-- 1 回の実行で archived_at が全行同じ値になる（復帰時に「この一括操作で archive された行」を
-- archived_at >= 根の archived_at で特定できる）。既にアーカイブ済みの行は
-- 元の archived_at を保つため触らない。
UPDATE pages
SET archived_at = now(), updated_at = now()
WHERE pages.workspace_id = $1
  AND pages.archived_at IS NULL
  AND pages.id IN (
      SELECT pp.page_id FROM page_paths pp
      WHERE pp.workspace_id = $1 AND pp.ancestor_id = $2
  );

-- name: UnarchivePageSubtree :execrows
-- アーカイブ解除。根の archived_at（archived_since）以降にアーカイブされた行だけを戻す。
-- サブツリー全行を無条件に戻すと、根より前に個別アーカイブされていた子まで復帰し、
-- そのあいだに同じ position で作られた現役の兄弟と部分 UNIQUE が衝突しうる。
-- 「一緒にアーカイブされた一括分だけを戻す」ことで衝突面を根の 1 行に閉じる
-- （根の衝突は usecase が SetPagePosition で末尾へ再採番してから解除する）。
UPDATE pages
SET archived_at = NULL, updated_at = now()
WHERE pages.workspace_id = sqlc.arg(workspace_id)
  AND pages.archived_at >= sqlc.arg(archived_since)
  AND pages.id IN (
      SELECT pp.page_id FROM page_paths pp
      WHERE pp.workspace_id = sqlc.arg(workspace_id) AND pp.ancestor_id = sqlc.arg(page_id)
  );

-- ページ階層の変更はワークスペース単位で直列化する。検査と保存の間の移動を防ぐ。
-- name: LockPageHierarchy :one
SELECT id FROM workspaces WHERE id = $1 FOR UPDATE;

-- name: GetPageDepthAndHeight :one
-- depth はルート=1の段数、height は自分から最深子孫までの距離。
-- アーカイブ済みも含める（復元による上限回避を防ぐ）。自己行がない場合は返さない。
SELECT
    (SELECT MAX(p.depth) + 1 FROM page_paths p
     WHERE p.workspace_id = pp.workspace_id AND p.page_id = pp.page_id)::integer AS depth,
    (SELECT MAX(p.depth) FROM page_paths p
     WHERE p.workspace_id = pp.workspace_id AND p.ancestor_id = pp.page_id)::integer AS height
FROM page_paths pp
WHERE pp.workspace_id = $1 AND pp.page_id = $2 AND pp.ancestor_id = pp.page_id;

-- name: InsertPagePathSelf :exec
-- closure の自己参照行（depth=0）。ページ作成と同じトランザクションで張る。
INSERT INTO page_paths (workspace_id, page_id, ancestor_id, depth)
VALUES ($1, $2, $2, 0);

-- name: InsertPagePathAncestors :exec
-- ページ作成時に親の祖先集合（親自身 depth=0 を含む）を +1 して引き継ぐ。
INSERT INTO page_paths (workspace_id, page_id, ancestor_id, depth)
SELECT pp.workspace_id, sqlc.arg(page_id)::uuid, pp.ancestor_id, pp.depth + 1
FROM page_paths pp
WHERE pp.workspace_id = sqlc.arg(workspace_id) AND pp.page_id = sqlc.arg(parent_id);

-- name: PageHasDescendant :one
-- descendant_id が page_id の子孫（depth=0 の自分自身を含む）かどうか。移動時の循環検出に使う。
SELECT EXISTS (
    SELECT 1 FROM page_paths
    WHERE workspace_id = $1 AND ancestor_id = $2 AND page_id = $3
) AS found;

-- name: DetachPageSubtreePaths :exec
-- 移動時の closure 付け替え（前半）: サブツリー内の各ページと「サブツリー外の祖先」との組を消す。
-- サブツリー内部同士の組（自己参照 depth=0 を含む）は移動後も変わらないため残す。
DELETE FROM page_paths
WHERE page_paths.workspace_id = sqlc.arg(workspace_id)
  AND page_paths.page_id IN (
      SELECT pp.page_id FROM page_paths pp
      WHERE pp.workspace_id = sqlc.arg(workspace_id) AND pp.ancestor_id = sqlc.arg(page_id)
  )
  AND page_paths.ancestor_id NOT IN (
      SELECT pp.page_id FROM page_paths pp
      WHERE pp.workspace_id = sqlc.arg(workspace_id) AND pp.ancestor_id = sqlc.arg(page_id)
  );

-- name: AttachPageSubtreePaths :exec
-- 移動時の closure 付け替え（後半）: 新しい親の祖先集合（親自身を含む）×サブツリー全員の
-- 直積を張る。深さは「サブツリー内での深さ + 親までの深さ + 1」。
-- ルートへの移動（親なし）ではこのクエリは呼ばない（Detach だけで完結する）。
INSERT INTO page_paths (workspace_id, page_id, ancestor_id, depth)
SELECT sub.workspace_id, sub.page_id, sup.ancestor_id, sub.depth + sup.depth + 1
FROM page_paths sub
JOIN page_paths sup
  ON sup.workspace_id = sub.workspace_id AND sup.page_id = sqlc.arg(new_parent_id)
WHERE sub.workspace_id = sqlc.arg(workspace_id) AND sub.ancestor_id = sqlc.arg(page_id);

-- name: ListBlocksByPage :many
-- ページの全ブロック（doc への組み立て用）。position はバイト順なので同じ親を持つ
-- ブロック同士はこの並びのまま兄弟順になる。id は position が親違いで偶然一致したときの
-- 並びを決定的にするためのタイブレーク。
SELECT * FROM blocks
WHERE workspace_id = $1 AND page_id = $2
ORDER BY "position", id;

-- name: ListPageBlockIDs :many
-- ページの現在のブロック id 一覧（差分 UPSERT で「消えた行」を判定するため）。
SELECT id FROM blocks
WHERE workspace_id = $1 AND page_id = $2;

-- name: ListExistingBlockIDsAmong :many
-- 与えた id 群のうち、blocks に実在するものだけを返す（ページを問わない）。
-- 「そのページに新しく現れた id」がこの表に既にある＝別ページの行を乗っ取ろうとしている
-- （攻撃 or バグ）ので、ReplacePageBlocks はこれを検出して保存ごと拒否する。
--
-- id 群は json 配列 1 個のパラメータで渡し、json_array_elements_text で展開する
-- （= ANY(sqlc.arg(ids)::uuid[]) にすると database/sql モードの sqlc がパラメータを
-- pq.Array() で包む生成になり、このリポジトリが依存していない github.com/lib/pq を
-- import してビルドが壊れる。禁止は sqlc.yaml の no-array-param vet ルール、
-- 同じ理由での実例は comment.sql の ListCommentsByThreadIDs を参照）。
SELECT id FROM blocks
WHERE id IN (
  SELECT value::uuid FROM json_array_elements_text(sqlc.arg(ids)::json) AS t(value)
);

-- name: BlockExistsInPage :one
-- 与えた block_id が、本当にその workspace/page のブロックとして実在するかを 1 件返す。
-- 錨付きコメントが comment_threads.block_id へ書き込む前に呼ぶ。
--
-- block_id は blocks.id への単独 FK で page_id を含まない。そのため、
-- 「id が実在する」だけを確認しても、他ページ・他テナントのブロック id をそのまま
-- 錨として渡されると通ってしまう。ListExistingBlockIDsAmong → ErrBlockIDConflict と
-- 同じ種類の懸念（id 単独では所有者を保証できない）で、ここでは workspace_id / page_id
-- まで一致するかをまとめて確認することでそれを塞ぐ。
SELECT EXISTS (
    SELECT 1 FROM blocks
    WHERE workspace_id = $1 AND page_id = $2 AND id = $3
) AS block_exists;

-- name: DeleteBlocksByIDs :exec
-- 新しい doc から消えた id だけを削除する（生き残る id は UPDATE に回すため触らない）。
-- comment_threads.block_id の ON DELETE SET NULL は将来ここで意図通りに発火する
-- （ブロックが本当に消えたときだけ引用を残して NULL に落ちる）。
--
-- id 群を json 配列で渡す理由は ListExistingBlockIDsAmong のコメントと同じ。
DELETE FROM blocks
WHERE workspace_id = sqlc.arg(workspace_id) AND page_id = sqlc.arg(page_id)
  AND id IN (
    SELECT value::uuid FROM json_array_elements_text(sqlc.arg(ids)::json) AS t(value)
  );

-- name: ParkBlockPositions :exec
-- 生き残る行の position を id 由来の一時値へ退避する。flattenPageDoc は毎回 position を
-- ゼロから振り直すため、そのまま UPDATE すると「まだ古い position を持つ別の生存行」と
-- 衝突しうる（uq_blocks_parent_position / uq_blocks_page_position）。id は一意なので、
-- id 由来の値へ全行いったん退避してから本来値を書けば、退避後は元の position を持つ行が
-- 存在しなくなり衝突しない。先頭に chr(127)（DEL 制御文字）を付けるのは、fracindex が
-- 使う文字集合（英数字中心）にこの文字が絶対に出てこないため、本来の position 値域と
-- 重ならないことを保証するため。
--
-- id 群を json 配列で渡す理由は ListExistingBlockIDsAmong のコメントと同じ。
UPDATE blocks
SET position = chr(127) || id::text
WHERE workspace_id = sqlc.arg(workspace_id) AND page_id = sqlc.arg(page_id)
  AND id IN (
    SELECT value::uuid FROM json_array_elements_text(sqlc.arg(ids)::json) AS t(value)
  );

-- name: UpsertBlock :execrows
-- ブロック 1 行の挿入または更新。id が生き残る限り行そのものは delete/insert されないため、
-- comment_threads.block_id の FK 参照は保存のたびに外れない（差分 UPSERT の要）。
--
-- 衝突キー (id) には所有者列 workspace_id が入っていない（id は PK 単独で一意なので入れられない）。
-- 呼び出し元の ReplacePageBlocks は「新しく現れる id が他ページ/他ワークスペースに実在しないか」を
-- 保存のたびに事前検証してから UpsertBlock を呼ぶ（ListExistingBlockIDsAmong → ErrBlockIDConflict）が、
-- この事前 SELECT は行をロックしない。別ページ/別ワークスペースの保存が同じ id を先に INSERT すると
-- （事前検証をすり抜けたレース）、DO UPDATE の WHERE が偽になり blocks 行は作成も更新もされない。
-- :execrows で影響行数を返し、呼び出し元が 0 行を検出して ErrBlockIDConflict を返せるようにする
-- （:exec のままだと 0 行が握り潰され、snapshot だけ更新されて保存が成功したことになってしまう）。
-- DO UPDATE の WHERE で workspace_id / page_id を絞るのは
-- queries_static_check_test.go の Test_upsertの衝突キーに所有者列が入っていること が求める多層防御
-- （事前検証にバグがあっても、衝突した行が別ワークスペース・別ページのものなら UPDATE 自体が
-- 素通りで失敗する。page_id まで絞るのは、ブロックの所有者が実質「同じワークスペースの同じページ」
-- という単位だから）。
INSERT INTO blocks (id, workspace_id, page_id, parent_id, "position", type, attrs, inline)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (id) DO UPDATE SET
  parent_id = EXCLUDED.parent_id,
  "position" = EXCLUDED."position",
  type = EXCLUDED.type,
  attrs = EXCLUDED.attrs,
  inline = EXCLUDED.inline,
  updated_at = now()
WHERE blocks.workspace_id = EXCLUDED.workspace_id AND blocks.page_id = EXCLUDED.page_id;

-- name: UpsertPageSnapshot :exec
-- snapshot の焼き直し。blocks の全入れ替えと同じトランザクションで呼び、
-- 「snapshot は常に blocks と同期している」を保つ。
--
-- 衝突キー (page_id) に所有者列が入っていないが、この表に限っては安全。page_snapshots は
-- page_id / doc / built_at しか持たない導出キャッシュで、持ち主という概念がそもそも無い
-- （中身はいつでも blocks から焼き直せる）。誰のページなのかを決めるのは pages 側で、
-- 認可もそちらで行う。
--
-- そのため機械向けの免除コメント（-- upsert-owner-scope: …）は付けていない。付けてしまうと、
-- 将来この表に所有者列が入ったときに検査が黙って素通りする。検査は「所有者列を 1 つも
-- 持たない表には何も要求しない」という作りなので、この形のままで通る
-- （検査の実体は internal/adapter/persistence/queries_static_check_test.go）。
INSERT INTO page_snapshots (page_id, doc, built_at)
VALUES ($1, $2, now())
ON CONFLICT (page_id) DO UPDATE SET doc = EXCLUDED.doc, built_at = now();

-- name: GetPageSnapshot :one
-- snapshot の取得。page_snapshots は workspace_id を持たないため、pages と JOIN して
-- テナント検証をクエリレベルで行う（このファイル冒頭の作法）。
SELECT ps.* FROM page_snapshots ps
JOIN pages p ON p.id = ps.page_id
WHERE p.workspace_id = $1 AND ps.page_id = $2;

-- name: UpsertPageSearch :exec
-- page_search（本文検索の派生キャッシュ）の焼き直し。UpsertPageSnapshot の直後に、
-- blocks の全入れ替えと同じトランザクションで呼び、「page_search は常に
-- pages.title / blocks と同期している」を保つ。
--
-- 衝突キー (page_id) に所有者列（workspace_id）が入っていないため、UpsertBlock と同じ
-- 多層防御で DO UPDATE の WHERE に所有者条件を足す（queries_static_check_test.go の
-- Test_upsertの衝突キーに所有者列が入っていること が要求する）。事前に findPageWith で
-- テナントを確認済みとはいえ、衝突キー自体にも条件を持たせておくことで、将来この
-- クエリだけが単独で再利用されても同じ防御が効く。
INSERT INTO page_search (page_id, workspace_id, title, body, updated_at)
VALUES (sqlc.arg(page_id), sqlc.arg(workspace_id), sqlc.arg(title), sqlc.arg(body), now())
ON CONFLICT (page_id) DO UPDATE SET
  title = EXCLUDED.title,
  body = EXCLUDED.body,
  updated_at = now()
WHERE page_search.workspace_id = EXCLUDED.workspace_id;

-- name: DeletePageLinksBySourceBlockIDsInPage :exec
-- ページ内リンクの張り替え（前半）: そのページのブロックが持っていたリンクを一旦すべて消す。
-- 後半は InsertPageLink による再構築（ON CONFLICT DO NOTHING で 1 行に畳む）。
--
-- page_links.source_block_id は blocks への単独 FK（workspace_id / page_id を含まない）
-- なので、ここで blocks 側から workspace_id / page_id を確認してから消す
-- （schema.hcl の page_links コメント参照 — テナント確認は書き込み側の責務）。
DELETE FROM page_links
WHERE source_block_id IN (
  SELECT id FROM blocks
  WHERE workspace_id = sqlc.arg(workspace_id) AND page_id = sqlc.arg(page_id)
);

-- name: InsertPageLink :exec
-- ページ内リンク 1 本を張る。主キー (source_block_id, target_page_id) との衝突は
-- 無視するだけでよい（DO NOTHING）。衝突しうる相手は直前の
-- DeletePageLinksBySourceBlockIDsInPage で自分が消した行と同じキーの再構築だけなので、
-- 他人の行に当たる余地が無く、所有者列での絞り込みは不要
-- （queries_static_check_test.go は DO NOTHING を検査の対象にしない）。
INSERT INTO page_links (source_block_id, target_page_id)
VALUES (sqlc.arg(source_block_id), sqlc.arg(target_page_id))
ON CONFLICT (source_block_id, target_page_id) DO NOTHING;

-- name: ListExistingPageIDsAmong :many
-- 与えた id 群のうち、pages に実在するものだけを返す（ワークスペースを問わない）。
-- ページ内リンクの参照先が実在するかを保存の直前にまとめて確認するために使う —
-- 実在しない ID（リンク切れ）は黙って除外する。1 本のリンク切れのために本文の保存
-- 自体を失敗させてはいけないため（page_links.target_page_id は pages への FK なので、
-- 存在しない ID のまま INSERT すると外部キー違反で保存全体が落ちてしまう）。
--
-- workspace_id で絞らないのは page_links 自体がテナントを跨いだ参照を書き込み時に
-- 禁じない設計のため（schema.hcl の page_links コメント参照。テナント・可視の判定は
-- 読み取り側 = 逆リンク一覧 API の権限解決に委ねる）。
--
-- id 群は json 配列 1 個のパラメータで渡す（ListExistingBlockIDsAmong と同じ理由・
-- 同じパターン。sqlc-vet の no-array-param ルール）。
SELECT id FROM pages
WHERE id IN (
  SELECT value::uuid FROM json_array_elements_text(sqlc.arg(ids)::json) AS t(value)
);

-- =============================================================================
-- page_ticket_links（段 5: ページ本文の ticketRef からの派生索引。
-- page_links と同じ作法 — 対の表として並べて置く）
-- =============================================================================

-- name: DeletePageTicketLinksBySourceBlockIDsInPage :exec
-- ページ内チケット埋め込みの張り替え（前半）: そのページのブロックが持っていた埋め込みを
-- 一旦すべて消す。後半は InsertPageTicketLink による再構築。
-- page_ticket_links.source_block_id は blocks への単独 FK なので、ここで blocks 側から
-- workspace_id / page_id を確認してから消す（DeletePageLinksBySourceBlockIDsInPage と同じ理由）。
DELETE FROM page_ticket_links
WHERE source_block_id IN (
  SELECT id FROM blocks
  WHERE workspace_id = sqlc.arg(workspace_id) AND page_id = sqlc.arg(page_id)
);

-- name: InsertPageTicketLink :exec
-- ページ内チケット埋め込み 1 本を張る。主キー (source_block_id, target_ticket_id) との
-- 衝突は無視するだけでよい（InsertPageLink と同じ理由）。
INSERT INTO page_ticket_links (source_block_id, target_ticket_id)
VALUES (sqlc.arg(source_block_id), sqlc.arg(target_ticket_id))
ON CONFLICT (source_block_id, target_ticket_id) DO NOTHING;

-- name: ListExistingTicketIDsAmong :many
-- 与えた id 群のうち、tickets に実在するものだけを返す（ワークスペースを問わない。
-- ListExistingPageIDsAmong と同じ理由・同じパターン — page_ticket_links もテナントを
-- 跨いだ参照を書き込み時に禁じない設計で、実在しない ID は黙って除外する）。
SELECT id FROM tickets
WHERE id IN (
  SELECT value::uuid FROM json_array_elements_text(sqlc.arg(ids)::json) AS t(value)
);

-- name: ListPageAncestorIDs :many
-- ページの祖先 ID を根から順（depth の大きい順）に返す。自分自身（depth=0）は含まない。
-- パンくず用の骨組みで、**題名や可視性はここでは返さない** — 可視の判定は
-- ListWorkspacePageViewFactsByIDs と domain.ResolvePageView が持つ（判定の写経をしない）。
SELECT pp.ancestor_id
FROM page_paths pp
WHERE pp.workspace_id = $1 AND pp.page_id = $2 AND pp.depth > 0
ORDER BY pp.depth DESC;

-- name: DeletePage :execrows
-- ページを物理削除する。子孫・closure（page_paths）・blocks・snapshot は
-- ON DELETE CASCADE で一緒に消える（fk_pages_parent が CASCADE のため、
-- この 1 文で部分木全体が落ちる）。アーカイブと違い戻せない — 子孫全員の
-- 編集権限の確認（requireSubtreeEditPermission）は呼び出し側の入口が行う。
DELETE FROM pages
WHERE workspace_id = $1 AND id = $2;
