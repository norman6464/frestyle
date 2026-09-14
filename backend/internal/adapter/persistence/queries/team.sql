-- =============================================================================
-- teams（プロジェクトのチーム）と team_members（所属）
-- =============================================================================
--
-- チケットの担当チームは tickets.team_id が持つ（1 チケットに 1 チーム）。
-- 「同じプロジェクトのチームしか付かない」は fk_tickets_team（複合 FK）が守る。

-- name: CreateTeam :one
INSERT INTO teams (id, workspace_id, project_id, name, created_at, updated_at)
VALUES ($1, $2, $3, $4, now(), now())
RETURNING *;

-- name: ListTeams :many
SELECT * FROM teams WHERE workspace_id = $1 AND project_id = $2 ORDER BY name_lower;

-- name: GetTeam :one
SELECT * FROM teams WHERE workspace_id = $1 AND project_id = $2 AND id = $3;

-- name: UpdateTeam :one
UPDATE teams SET name = $4, updated_at = now()
WHERE workspace_id = $1 AND project_id = $2 AND id = $3
RETURNING *;

-- name: ClearTicketsTeam :exec
-- そのチームが付いているチケットから印を外す。DeleteTeam の前に必ず呼ぶ（同じ取引の中で）。
--
-- **複合 FK に ON DELETE SET NULL は使えない。** PostgreSQL は FK を構成する列を
-- **すべて** NULL にするため、workspace_id / project_id まで NULL になって NOT NULL 違反で
-- 落ちる（実測。列を指定する SET NULL (team_id) は PostgreSQL 15+ にあるが、
-- Atlas の HCL からは書けない）。だから「消す前に外す」をコード側で明示する。
UPDATE tickets SET team_id = NULL, updated_at = now()
WHERE workspace_id = $1 AND team_id = $2;

-- name: DeleteTeam :execrows
-- 付いているチケットは ClearTicketsTeam で先に外してある前提。
DELETE FROM teams WHERE workspace_id = $1 AND project_id = $2 AND id = $3;

-- name: AddTeamMember :exec
INSERT INTO team_members (workspace_id, team_id, user_id, created_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (workspace_id, team_id, user_id) DO NOTHING;

-- name: RemoveTeamMember :exec
DELETE FROM team_members WHERE workspace_id = $1 AND team_id = $2 AND user_id = $3;

-- name: ListTeamMembers :many
-- 所属する人（表示に要る名前まで）。名前は users.name が持つ
-- （profiles は自己紹介や状態を持つ別の表で、表示名は無い）。
SELECT m.user_id, u.name::text AS name
FROM team_members m
JOIN users u ON u.id = m.user_id
WHERE m.workspace_id = $1 AND m.team_id = $2
ORDER BY u.name;

-- name: SetTicketTeam :one
-- チケットの担当チーム。NULL を渡すと外す。
UPDATE tickets SET team_id = sqlc.narg(team_id)::uuid, updated_at = now()
WHERE workspace_id = $1 AND id = $2
RETURNING *;
