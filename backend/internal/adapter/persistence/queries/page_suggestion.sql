-- page_suggestions（commenter が保存した提案）のクエリ。

-- name: InsertPageSuggestion :one
-- 提案を 1 件作成する。id は Go 側（kbNewID）が UUIDv7 で採番して渡す
-- （page_templates の InsertPageTemplate と同じ流儀）。base_seq はまだ版が無いページへの
-- 提案なら NULL（sqlc.narg）。
-- base_revision は既存提案など基準revisionが不明な場合は NULL。
INSERT INTO page_suggestions (id, workspace_id, page_id, base_seq, base_revision, doc, author_user_id)
VALUES (
  sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(page_id), sqlc.narg(base_seq), sqlc.narg(base_revision),
  sqlc.arg(doc), sqlc.arg(author_user_id)
)
RETURNING *;

-- name: ListOpenPageSuggestions :many
-- そのページの open な提案一覧を created_at 昇順で最大 limit 件返す（先に出した提案から
-- 見えるように）。limit は呼び出し元（usecase）が上限を挟んだ値を渡す — ここで LIMIT を
-- 掛けること自体が目的で、doc を含む全行を一度に読み出させない。
SELECT * FROM page_suggestions
WHERE workspace_id = sqlc.arg(workspace_id) AND page_id = sqlc.arg(page_id) AND status = 'open'
ORDER BY created_at
LIMIT sqlc.arg(row_limit);

-- name: CountOpenPageSuggestions :one
-- そのページの open な提案の総数（doc 抜きで数えるだけなので軽い）。
SELECT count(*) FROM page_suggestions
WHERE workspace_id = sqlc.arg(workspace_id) AND page_id = sqlc.arg(page_id) AND status = 'open';

-- name: CountOpenPageSuggestionsByAuthor :one
-- そのページ・その投稿者本人の open な提案数。投稿者 1 人があたりの上限を判定するための数。
SELECT count(*) FROM page_suggestions
WHERE workspace_id = sqlc.arg(workspace_id) AND page_id = sqlc.arg(page_id) AND status = 'open'
  AND author_user_id = sqlc.arg(author_user_id);

-- name: GetPageSuggestion :one
-- 提案 1 件の取得。workspace_id まで絞ることで、他ページ・他テナントの id を渡されても
-- 見つからない（＝存在しないのと同じ）ようにする（accept/reject の直前に呼ぶ）。
SELECT * FROM page_suggestions
WHERE workspace_id = sqlc.arg(workspace_id) AND page_id = sqlc.arg(page_id) AND id = sqlc.arg(id);

-- name: ResolvePageSuggestion :one
-- 提案を採用・却下する。WHERE に status = 'open' を含めることで、既に解決済みの提案を
-- 誤って上書きしない（同時に 2 人が採用・却下を叩いても片方しか成功しない）。
-- 影響 0 行（sql.ErrNoRows）は「そもそも無い」と「open ではない（解決済み）」のどちらも
-- あり得るため、区別は呼び出し側（repository.Resolve）が追加の GetPageSuggestion で行う。
--
-- base_seq を NULL にするのはここが唯一の書き込み経路。fk_page_suggestions_base_version が
-- NO_ACTION（かつ非 deferrable）なので、この行が base_seq を持ったままだと、その版が
-- 30 日を超えても DeleteOldPageVersions の DELETE が FK 違反で失敗し続ける。open の間だけ
-- 版を保護すればよく、解決した後は参照を切ってよいので、ここで能動的に外す。
UPDATE page_suggestions
SET status = sqlc.arg(status), resolved_at = sqlc.arg(resolved_at), resolved_by_user_id = sqlc.arg(resolved_by_user_id),
    base_seq = NULL
WHERE workspace_id = sqlc.arg(workspace_id) AND page_id = sqlc.arg(page_id) AND id = sqlc.arg(id) AND status = 'open'
RETURNING *;
