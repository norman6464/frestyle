-- ラベル（labels）とチケットへの付け外し（ticket_labels）のクエリ。
-- ラベルはワークスペース単位の語彙で、ページ（page_labels）とチケット（ticket_labels）の
-- 両方から同じ行を引く（labels テーブルの doc コメント参照）。

-- =============================================================================
-- labels
-- =============================================================================

-- name: CreateLabel :one
INSERT INTO labels (id, workspace_id, name, color, created_at, updated_at)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(name), sqlc.arg(color), now(), now())
RETURNING *;

-- name: FindLabel :one
SELECT * FROM labels WHERE workspace_id = $1 AND id = $2;

-- name: ListLabels :many
SELECT * FROM labels WHERE workspace_id = $1 ORDER BY name_key;

-- name: UpdateLabel :one
UPDATE labels
SET name = sqlc.arg(name), color = sqlc.arg(color), updated_at = now()
WHERE workspace_id = sqlc.arg(workspace_id) AND id = sqlc.arg(id)
RETURNING *;

-- name: DeleteLabel :execrows
-- ticket_labels / page_labels は ON DELETE CASCADE で一緒に消える。
DELETE FROM labels WHERE workspace_id = $1 AND id = $2;

-- =============================================================================
-- ticket_labels
-- =============================================================================

-- name: AddTicketLabel :execrows
-- 付け外しは冪等（ticket_comment_reactions と同じ形 — 複合主キーの重複を無視する）。
INSERT INTO ticket_labels (workspace_id, ticket_id, label_id, created_at)
VALUES ($1, $2, $3, now())
ON CONFLICT DO NOTHING;

-- name: RemoveTicketLabel :execrows
DELETE FROM ticket_labels WHERE workspace_id = $1 AND ticket_id = $2 AND label_id = $3;

-- name: ListLabelsByTicket :many
SELECT l.* FROM labels l
JOIN ticket_labels tl ON tl.workspace_id = l.workspace_id AND tl.label_id = l.id
WHERE tl.workspace_id = $1 AND tl.ticket_id = $2
ORDER BY l.name_key;

-- name: ListLabelsByTicketIDs :many
-- ticket_id ごとのラベル一覧を 1 回でまとめて引く（一覧画面の N+1 を避ける）。
-- ticket_id 群は json 配列 1 個のパラメータで渡す（comment.sql の ListCommentsByThreadIDs と
-- 同じ作法 — `= ANY(...)::uuid[]` は database/sql モードの sqlc で pq.Array() 依存になり
-- ビルドが壊れるため使わない）。
SELECT tl.ticket_id, l.* FROM ticket_labels tl
JOIN labels l ON l.workspace_id = tl.workspace_id AND l.id = tl.label_id
WHERE tl.workspace_id = sqlc.arg(workspace_id)
  AND tl.ticket_id IN (
    SELECT value::uuid FROM json_array_elements_text(sqlc.arg(ticket_ids)::json) AS t(value)
  )
ORDER BY tl.ticket_id, l.name_key;
