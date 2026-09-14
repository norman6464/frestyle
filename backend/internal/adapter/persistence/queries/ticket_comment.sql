-- チケットの状態遷移ログ（段 3・設計 Ⅵ）とチケットへの発言（段 3・設計 Ⅳ 着手時決定）のクエリ。
-- ticket.sql とは別ファイルに分ける（役割が増えてきたので 1 ファイルに詰め込まない）。

-- =============================================================================
-- ticket_status_transitions
-- =============================================================================

-- name: InsertTicketStatusTransition :exec
INSERT INTO ticket_status_transitions
  (id, workspace_id, project_id, ticket_id, from_status_id, to_status_id, changed_by_user_id, changed_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, now());

-- =============================================================================
-- ticket_comments
-- =============================================================================

-- name: CreateTicketComment :one
INSERT INTO ticket_comments (id, workspace_id, ticket_id, parent_comment_id, author_user_id, body)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: GetTicketComment :one
-- 削除済みは「無い」と同じ扱い（他の delete_at 付き表と同じ作法）。
SELECT * FROM ticket_comments
WHERE workspace_id = $1 AND ticket_id = $2 AND id = $3 AND deleted_at IS NULL;

-- name: ListTicketComments :many
SELECT * FROM ticket_comments
WHERE workspace_id = $1 AND ticket_id = $2 AND deleted_at IS NULL
ORDER BY created_at ASC, id ASC;

-- name: UpdateTicketCommentBody :one
-- 編集前の本文を ticket_comment_edits へ退避するのは usecase 側の責務
-- （呼び出し順は InsertTicketCommentEdit → この UPDATE。同一トランザクション）。
UPDATE ticket_comments
SET body = $4, edited_at = now(), updated_at = now()
WHERE workspace_id = $1 AND ticket_id = $2 AND id = $3 AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteTicketComment :execrows
UPDATE ticket_comments
SET deleted_at = now(), updated_at = now()
WHERE workspace_id = $1 AND ticket_id = $2 AND id = $3 AND deleted_at IS NULL;

-- =============================================================================
-- ticket_comment_edits
-- =============================================================================

-- name: InsertTicketCommentEdit :exec
INSERT INTO ticket_comment_edits (id, workspace_id, comment_id, editor_user_id, previous_body)
VALUES ($1, $2, $3, $4, $5);

-- name: ListTicketCommentEdits :many
-- 新しい方が先（直近の編集から遡って見せる想定）。
SELECT * FROM ticket_comment_edits
WHERE workspace_id = $1 AND comment_id = $2
ORDER BY edited_at DESC;

-- =============================================================================
-- ticket_comment_reactions
-- =============================================================================

-- name: InsertTicketCommentReaction :execrows
-- 同じ人が同じ発言へ同じ絵文字で 2 回反応しても複合主キーが吸収する（0 行更新で成功扱い。
-- 呼び出し側は execrows を見ない — 「既に付いている」も「今付けた」も同じ結果を返せばよい）。
INSERT INTO ticket_comment_reactions (workspace_id, comment_id, user_id, emoji)
VALUES ($1, $2, $3, $4)
ON CONFLICT DO NOTHING;

-- name: DeleteTicketCommentReaction :execrows
DELETE FROM ticket_comment_reactions
WHERE workspace_id = $1 AND comment_id = $2 AND user_id = $3 AND emoji = $4;

-- name: ListTicketCommentReactionsByComments :many
-- comment_id 群は json 配列 1 個のパラメータで渡す（comment.sql の
-- ListCommentsByThreadIDs と同じ作法。database/sql モードでは配列パラメータを直接使えない）。
SELECT * FROM ticket_comment_reactions
WHERE workspace_id = sqlc.arg(workspace_id)
  AND comment_id IN (
    SELECT value::uuid FROM json_array_elements_text(sqlc.arg(comment_ids)::json) AS t(value)
  )
ORDER BY comment_id, created_at ASC;
