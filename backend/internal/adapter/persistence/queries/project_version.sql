-- =============================================================================
-- project_versions（リリース版）と ticket_fix_versions（チケットの修正バージョン）
-- =============================================================================
--
-- 読み手への注意（生 SQL の作法。CLAUDE.md §3.3）:
--   - 版はプロジェクト単位。ticket_statuses / ticket_types と同じ足場を持つ。
--   - チケットとの組は多対多（1 チケットに複数の版）。組の表は project_id を持ち、
--     両側の FK にそれを含めることで「別プロジェクトの版が付く」を DB が拒む。
--     アプリ側の検査だけに頼らない（旧 ticket_ranks が範囲を鍵に書かず壊れた教訓）。

-- name: CreateProjectVersion :one
INSERT INTO project_versions (id, workspace_id, project_id, name, "position", created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, now(), now())
RETURNING *;

-- name: ListProjectVersions :many
-- 版の一覧（アーカイブ済みを含めるかは呼び出し側が選ぶ）。並びは position。
SELECT * FROM project_versions
WHERE workspace_id = $1 AND project_id = $2
  AND (archived_at IS NOT NULL) = sqlc.arg(include_archived)::boolean
ORDER BY "position";

-- name: GetProjectVersion :one
SELECT * FROM project_versions WHERE workspace_id = $1 AND project_id = $2 AND id = $3;

-- name: UpdateProjectVersion :one
UPDATE project_versions
SET name = $4, released_at = sqlc.narg(released_at)::timestamptz, updated_at = now()
WHERE workspace_id = $1 AND project_id = $2 AND id = $3
RETURNING *;

-- name: ArchiveProjectVersion :execrows
UPDATE project_versions
SET archived_at = now(), updated_at = now()
WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND archived_at IS NULL;

-- name: RestoreProjectVersion :execrows
-- position は末尾へ付け直す（アーカイブ中に他の版の並びが進んでいるため）。
UPDATE project_versions
SET archived_at = NULL, "position" = $4, updated_at = now()
WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND archived_at IS NOT NULL;

-- name: LastProjectVersionPosition :one
-- 末尾へ足すときの「いま一番後ろの鍵」。アーカイブ済みも含めた最大値を返す
-- （一意制約は表の行すべてに効くわけではないが、鍵の重複そのものを避けるため。
--  ticket_backlog_ranks で踏んだのと同じ考え方）。
SELECT COALESCE(max("position"), '')::text AS "position"
FROM project_versions WHERE workspace_id = $1 AND project_id = $2;

-- name: AddTicketFixVersion :exec
-- 同じ組を二度押しても増えない（冪等）。project_id は tickets 側から引いて、
-- 呼び出し側に渡させない —— 渡させると食い違いを持ち込める。
INSERT INTO ticket_fix_versions (workspace_id, project_id, ticket_id, version_id, created_at)
SELECT t.workspace_id, t.project_id, t.id, sqlc.arg(version_id)::uuid, now()
FROM tickets t
WHERE t.workspace_id = sqlc.arg(workspace_id) AND t.id = sqlc.arg(ticket_id)
ON CONFLICT (workspace_id, ticket_id, version_id) DO NOTHING;

-- name: RemoveTicketFixVersion :exec
DELETE FROM ticket_fix_versions
WHERE workspace_id = $1 AND ticket_id = $2 AND version_id = $3;

-- name: ListTicketFixVersions :many
-- 1 チケットに付いた版（表示用に版そのものを返す）。
SELECT v.* FROM ticket_fix_versions f
JOIN project_versions v ON v.workspace_id = f.workspace_id AND v.id = f.version_id
WHERE f.workspace_id = $1 AND f.ticket_id = $2
ORDER BY v."position";
