-- name: InsertActiveWorkspaceMember :exec
-- 自分でワークスペースを作った／個人ワークスペースを自動作成した本人を、招待の手順を踏まず
-- 直接 active な所属として記録する。principal の作成（InsertPrincipal）と同じ
-- トランザクションで呼ぶこと（workspace_members のコメントにある procedural invariant）。
INSERT INTO workspace_members (workspace_id, user_id, status, joined_at, created_at, updated_at)
VALUES ($1, $2, 'active', now(), now(), now());

-- name: LeaveWorkspaceMembership :execrows
-- active/invited → left（退出・削除・招待の取り消し）。0 件なら既に left/suspended か、
-- そもそも所属したことが無い。呼び出し側はどちらも「非メンバーになった」として
-- 冪等に成功扱いする（行の有無を見ない）。
UPDATE workspace_members SET status = 'left', left_at = now(), updated_at = now()
WHERE workspace_id = $1 AND user_id = $2 AND status IN ('active', 'invited');

-- name: UpsertActiveWorkspaceMember :exec
-- 招待（invitations）の承諾で所属を active にする。行が無ければ active で新規に作り、
-- invited / left / suspended の行は active へ戻す（admin が改めて招いた以上、以前の状態は
-- 上書きしてよい）。既に active なら何もしない（joined_at を保つ）。
-- principal の作成（ensureUserPrincipalInTx）・付与・invitations.accepted_at と同じ
-- トランザクションで呼ぶ。
INSERT INTO workspace_members (workspace_id, user_id, status, invited_by_user_id, joined_at, created_at, updated_at)
VALUES ($1, $2, 'active', $3, now(), now(), now())
ON CONFLICT (workspace_id, user_id) DO UPDATE SET
  status             = 'active',
  invited_by_user_id = COALESCE(workspace_members.invited_by_user_id, EXCLUDED.invited_by_user_id),
  joined_at          = COALESCE(workspace_members.joined_at, now()),
  left_at            = NULL,
  updated_at         = now()
WHERE workspace_members.status <> 'active';
