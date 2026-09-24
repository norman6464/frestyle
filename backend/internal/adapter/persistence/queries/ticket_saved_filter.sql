-- ticket_saved_filters: 利用者が名前を付けて保存したバックログの絞り込み（本人 × プロジェクト）。
-- どのクエリも workspace_id / project_id / user_id を必ず WHERE に持つ。他人の絞り込みは
-- 「見えない = 存在しない」で、ID を当てられても読めず消せない。
-- 条件の意味と NULL の扱いは ticket.sql の ListTickets と同じ（NULL = 絞らない）。

-- name: InsertTicketSavedFilter :one
-- 同名（大文字小文字を区別しない）は uq_ticket_saved_filters_owner_name が弾き、repository が
-- ErrTicketSavedFilterNameTaken へ翻訳する。参照先の誤りは複合 FK が弾き、制約名で翻訳する。
INSERT INTO ticket_saved_filters (
  id, workspace_id, project_id, user_id, name,
  status_id, type_id, label_id, assignee_principal_id,
  unassigned, assigned_to_me, overdue, q
) VALUES (
  sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(project_id), sqlc.arg(user_id), sqlc.arg(name),
  sqlc.narg(status_id), sqlc.narg(type_id), sqlc.narg(label_id), sqlc.narg(assignee_principal_id),
  sqlc.arg(unassigned), sqlc.arg(assigned_to_me), sqlc.arg(overdue), sqlc.narg(q)
)
RETURNING *;

-- name: UpdateTicketSavedFilter :one
-- 名前と条件をまとめて書き換える（部分更新は持たない — 画面は保存の入力欄から全項目を送る）。
-- 本人の行でなければ 0 行で、呼び出し元が ErrTicketSavedFilterNotFound にする。
UPDATE ticket_saved_filters
SET name = sqlc.arg(name),
    status_id = sqlc.narg(status_id),
    type_id = sqlc.narg(type_id),
    label_id = sqlc.narg(label_id),
    assignee_principal_id = sqlc.narg(assignee_principal_id),
    unassigned = sqlc.arg(unassigned),
    assigned_to_me = sqlc.arg(assigned_to_me),
    overdue = sqlc.arg(overdue),
    q = sqlc.narg(q),
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND project_id = sqlc.arg(project_id)
  AND user_id = sqlc.arg(user_id)
RETURNING *;

-- name: DeleteTicketSavedFilter :execrows
-- :execrows で影響行数を返し、0 行なら呼び出し元が ErrTicketSavedFilterNotFound にする。
DELETE FROM ticket_saved_filters
WHERE id = $1 AND workspace_id = $2 AND project_id = $3 AND user_id = $4;

-- name: ListTicketSavedFilters :many
-- 本人がそのプロジェクトで保存した順（作った順）。同時刻は id（UUIDv7 = 採番順）で安定させる。
SELECT * FROM ticket_saved_filters
WHERE workspace_id = $1 AND project_id = $2 AND user_id = $3
ORDER BY created_at, id;

-- name: CountTicketSavedFilters :one
-- 保存数の上限（usecase が持つ）の判定用。
SELECT count(*) FROM ticket_saved_filters
WHERE workspace_id = $1 AND project_id = $2 AND user_id = $3;
