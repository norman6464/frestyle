-- =============================================================================
-- sprints / ticket_sprint_ranks
-- =============================================================================
--
-- 日付は 'YYYY-MM-DD' 文字列で運ぶ（tickets.due_date と同じ作法。本番の simple protocol で
-- time.Time だと 1 日ずれるため。ticket.sql 冒頭の注記参照）。

-- name: InsertSprint :one
INSERT INTO sprints (id, workspace_id, project_id, name, state, start_date, end_date, "position", created_at, updated_at)
VALUES ($1, $2, $3, $4, 'planned', sqlc.narg(start_date)::date, sqlc.narg(end_date)::date, $5, now(), now())
RETURNING *;

-- name: GetSprint :one
SELECT * FROM sprints WHERE workspace_id = $1 AND id = $2;

-- name: ListSprints :many
-- プロジェクトのスプリントを並び順で返す。完了したものも含める（隠すかどうかは画面の判断）。
SELECT * FROM sprints
WHERE workspace_id = $1 AND project_id = $2
ORDER BY "position";

-- name: LastSprintPosition :one
SELECT COALESCE(max("position"), '')::text AS "position"
FROM sprints WHERE workspace_id = $1 AND project_id = $2;

-- name: UpdateSprint :one
-- 名前と期間だけを書き換える。状態は ChangeSprintState が持つ（状態遷移は別の関心事で、
-- 名前の打ち間違いを直すのと同じ口に混ぜると「保存したら勝手に開始した」が起こりうる）。
UPDATE sprints
SET name = $3, start_date = sqlc.narg(start_date)::date, end_date = sqlc.narg(end_date)::date, updated_at = now()
WHERE workspace_id = $1 AND id = $2
RETURNING *;

-- name: ChangeSprintState :one
UPDATE sprints SET state = $3, updated_at = now()
WHERE workspace_id = $1 AND id = $2
RETURNING *;

-- name: DeleteSprint :execrows
-- ticket_sprint_ranks は複合 FK の ON DELETE CASCADE で一緒に消える（＝入っていた
-- チケットはバックログへ戻る。ticket_backlog_ranks 側の行は触っていないため）。
DELETE FROM sprints WHERE workspace_id = $1 AND id = $2;

-- name: CountActiveSprints :one
-- 「進行中は 1 つまで」の判定に使う。DB の制約にはしていない（複数を同時に走らせたい
-- チームが居ても表の形で拒まない）ので、usecase がこの数を見て決める。
SELECT count(*) FROM sprints
WHERE workspace_id = $1 AND project_id = $2 AND state = 'active';

-- name: InsertTicketSprintRank :exec
-- チケットをスプリントへ入れる。PK が (workspace_id, ticket_id) なので、既に別の
-- スプリントへ入っている場合は移動として扱う（ON CONFLICT で入れ替える）。
INSERT INTO ticket_sprint_ranks (workspace_id, sprint_id, ticket_id, "position", created_at, updated_at)
VALUES ($1, $2, $3, $4, now(), now())
ON CONFLICT (workspace_id, ticket_id)
DO UPDATE SET sprint_id = EXCLUDED.sprint_id, "position" = EXCLUDED."position", updated_at = now();

-- name: DeleteTicketSprintRank :execrows
-- スプリントから外す（チケットは消えない。バックログの並びは元のまま残っている）。
DELETE FROM ticket_sprint_ranks WHERE workspace_id = $1 AND ticket_id = $2;

-- name: LastTicketSprintRankPosition :one
SELECT COALESCE(max("position"), '')::text AS "position"
FROM ticket_sprint_ranks WHERE workspace_id = $1 AND sprint_id = $2;

-- name: ListSprintTicketIDs :many
-- スプリントに入っているチケットの ID を並び順で返す。中身（題名・状態）は既存の
-- チケット取得に任せる —— ここで JOIN して返すと、一覧の列が増えるたびにこの問い合わせも
-- 直すことになる。
SELECT ticket_id FROM ticket_sprint_ranks
WHERE workspace_id = $1 AND sprint_id = $2
ORDER BY "position";

-- name: CountSprintTickets :one
SELECT count(*) FROM ticket_sprint_ranks WHERE workspace_id = $1 AND sprint_id = $2;

-- name: ListSprintTicketRanks :many
-- スプリント内の並び（ticket_id と position の組）。並べ替えのときに「隣の前後へ何を挟むか」
-- を決めるために使う。中身（題名等）は要らないのでここでは引かない。
SELECT ticket_id, "position" FROM ticket_sprint_ranks
WHERE workspace_id = $1 AND sprint_id = $2
ORDER BY "position";

-- name: FindTicketSprint :one
-- そのチケットがどのスプリントに入っているか（入っていなければ行が無い）。
SELECT sprint_id, "position" FROM ticket_sprint_ranks
WHERE workspace_id = $1 AND ticket_id = $2;

-- name: MoveTicketSprintRank :execrows
UPDATE ticket_sprint_ranks
SET "position" = $3, updated_at = now()
WHERE workspace_id = $1 AND ticket_id = $2;
