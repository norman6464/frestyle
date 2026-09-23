-- 招待（invitations）。表の意味と状態の導き方は schema.hcl の table "invitations" のコメントを見る。
--
-- この表のクエリは、期限や再送間隔の「間隔そのもの」を SQL に書かない。now() - interval を
-- Go 側で計算した時刻（sent_before / since）で受ける。定数（7 日・10 分・1 日）を
-- usecase の 1 か所に置き、テストで時刻を差し替えられるようにするため。
--
-- 「未決」の条件 accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL は
-- 部分一意索引 uq_invitations_open_target の述語と一字一句同じ形で書く（索引を使うため）。
--
-- *_by_user_id（NULL 可の列）へ書くパラメータは ::bigint を付ける。付けないと sqlc が列の
-- NULL 可を見て sql.NullInt64 で生成し、呼び出し側が毎回 Valid: true で包むことになる
-- （値は常にある。::int にしないのは vet の narrowing-cast-on-param が言うとおり）。

-- name: UpsertOpenInvitation :one
-- 招待の発行（送信履歴 InsertInvitationSend を同じトランザクションで足す）。同じ宛先 × 場所に未決の行（期限切れも含む。結果の 3 列が全部 NULL）があれば、
-- 新しい行を作らず既存行を「再送」として更新する: トークン差し替え・期限延長・役割と表示名は
-- 今回の値で上書き・send_count + 1。invited_by_user_id は最初に招いた人のまま保ち、
-- last_sent_by_user_id だけ今回の実行者にする。
--
-- 衝突判定の式と述語は uq_invitations_open_target と同じ（PostgreSQL は式と述語が一致する
-- 索引を ON CONFLICT の推論に使う。片方でも違うと「一致する制約が無い」で落ちる）。
--
-- 直前の送信からの間が短い（last_sent_at > sent_before）ときは更新せず 0 行になる
-- （:one なので sql.ErrNoRows。repository が ErrInvitationResendTooSoon に変換する）。
INSERT INTO invitations (
    id, workspace_id, scope, space_id, page_id, role, email, invitee_name,
    token_hash, invited_by_user_id, expires_at, last_sent_by_user_id
)
VALUES (
    sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(scope), sqlc.arg(space_id), sqlc.arg(page_id),
    sqlc.arg(role), sqlc.arg(email), sqlc.arg(invitee_name),
    sqlc.arg(token_hash), sqlc.arg(actor_user_id), sqlc.arg(expires_at), sqlc.arg(actor_user_id)
)
ON CONFLICT (
    workspace_id, email, scope,
    COALESCE(space_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(page_id, '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
DO UPDATE SET
    role                 = EXCLUDED.role,
    invitee_name         = EXCLUDED.invitee_name,
    token_hash           = EXCLUDED.token_hash,
    expires_at           = EXCLUDED.expires_at,
    last_sent_at         = now(),
    last_sent_by_user_id = EXCLUDED.last_sent_by_user_id,
    send_count           = invitations.send_count + 1,
    updated_at           = now()
WHERE invitations.last_sent_at <= sqlc.arg(sent_before)
RETURNING *;

-- name: RefreshInvitationToken :one
-- 再送（admin が一覧から「もう一度送る」）。未決の行のトークンを差し替えて期限を延ばす。
-- 未決でない・無い・間が短い、のどれでも 0 行（sql.ErrNoRows）。理由の切り分けは
-- repository が GetInvitation で行う。
UPDATE invitations
SET token_hash           = sqlc.arg(token_hash),
    expires_at           = sqlc.arg(expires_at),
    last_sent_at         = now(),
    last_sent_by_user_id = sqlc.arg(actor_user_id),
    send_count           = send_count + 1,
    updated_at           = now()
WHERE workspace_id = sqlc.arg(workspace_id) AND id = sqlc.arg(id)
  AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
  AND last_sent_at <= sqlc.arg(sent_before)
RETURNING *;

-- name: GetInvitation :one
-- admin 側の操作（再送・取消）の対象確認。ワークスペースで絞るので他テナントの id は見えない。
SELECT * FROM invitations
WHERE workspace_id = $1 AND id = $2;

-- name: GetInvitationByID :one
-- 招かれた側の操作（承諾・辞退）は id だけで指す。宛先 email との一致は呼び出し側が検査する。
SELECT * FROM invitations
WHERE id = $1;

-- name: GetInvitationByIDForUpdate :one
-- 承諾のトランザクションで行を掴む。同じ招待への同時承諾（二重クリック・別タブ）を直列化し、
-- 後続は accepted_at が立った行を見て「もう使えない」へ落ちる。
SELECT * FROM invitations
WHERE id = $1
FOR UPDATE;

-- name: GetInvitationDetailByTokenHash :one
-- 招待 URL のトークン（の SHA-256）から、案内（誰から・どこへ・どの役割か）に要る周辺つきで引く。
-- 期限・結果の判定は呼び出し側（「無い」「期限切れ」「取消済み」を同じ応答にまとめるため）。
-- users は物理削除されうるので LEFT JOIN + COALESCE（消えた人は空文字）。
SELECT sqlc.embed(invitations),
       workspaces.slug AS workspace_slug, workspaces.name AS workspace_name,
       COALESCE(users.name, '') AS inviter_name
FROM invitations
JOIN workspaces ON workspaces.id = invitations.workspace_id
LEFT JOIN users ON users.id = invitations.invited_by_user_id AND users.deleted_at IS NULL
WHERE invitations.token_hash = $1;

-- name: ListWorkspaceInvitations :many
-- admin の招待一覧（結果が出たものも含む・新しい順）。ワークスペースの slug / 名前と招いた人の
-- 名前を一緒に返す（自分宛の一覧と同じ形にして、応答の組み立てを 1 つにする）。
SELECT sqlc.embed(invitations),
       workspaces.slug AS workspace_slug, workspaces.name AS workspace_name,
       COALESCE(users.name, '') AS inviter_name
FROM invitations
JOIN workspaces ON workspaces.id = invitations.workspace_id
LEFT JOIN users ON users.id = invitations.invited_by_user_id AND users.deleted_at IS NULL
WHERE invitations.workspace_id = $1
ORDER BY invitations.created_at DESC
LIMIT sqlc.arg(row_limit);

-- name: ListOpenInvitationsByEmail :many
-- 自分宛の未決（期限内）の招待。email は正規形（domain.NormalizeEmail）で渡す。
-- 「○○さんが △△ に招いています」と出すため、ワークスペースの slug / 名前と招いた人の名前を返す。
SELECT sqlc.embed(invitations),
       workspaces.slug AS workspace_slug, workspaces.name AS workspace_name,
       COALESCE(users.name, '') AS inviter_name
FROM invitations
JOIN workspaces ON workspaces.id = invitations.workspace_id
LEFT JOIN users ON users.id = invitations.invited_by_user_id AND users.deleted_at IS NULL
WHERE invitations.email = $1
  AND invitations.accepted_at IS NULL AND invitations.declined_at IS NULL AND invitations.revoked_at IS NULL
  AND invitations.expires_at > now()
ORDER BY invitations.created_at DESC;

-- name: AcceptInvitation :execrows
-- 承諾。未決かつ期限内の行にだけ立つ（ck_invitations_accepted_in_time と同じ条件）。
-- 0 行なら、その間に結果が出た・期限が切れた（呼び出し側が「もう使えない」にする）。
UPDATE invitations
SET accepted_at = now(), accepted_by_user_id = sqlc.arg(user_id)::bigint, updated_at = now()
WHERE id = sqlc.arg(id)
  AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
  AND expires_at > now();

-- name: DeclineInvitation :execrows
-- 辞退。期限切れの行にも立ててよい（残った行を本人が片付ける操作）。
UPDATE invitations
SET declined_at = now(), declined_by_user_id = sqlc.arg(user_id)::bigint, updated_at = now()
WHERE id = sqlc.arg(id)
  AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;

-- name: RevokeInvitation :execrows
-- 取消（admin）。期限切れの行にも立ててよい。0 行なら既に結果が出ている・無い。
UPDATE invitations
SET revoked_at = now(), revoked_by_user_id = sqlc.arg(actor_user_id)::bigint, updated_at = now()
WHERE workspace_id = sqlc.arg(workspace_id) AND id = sqlc.arg(id)
  AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;

-- name: RevokeOpenInvitationsByInviter :execrows
-- 招いた人が admin でなくなった（除名・降格）とき、その人が出した未決の招待をまとめて止める。
-- 承諾時にも「招いた人が今も admin か」を見るが、一覧に残り続けないようここでも止める。
-- 除名・降格と同じトランザクションで呼ぶ。
UPDATE invitations
SET revoked_at = now(), revoked_by_user_id = sqlc.arg(actor_user_id)::bigint, updated_at = now()
WHERE workspace_id = sqlc.arg(workspace_id) AND invited_by_user_id = sqlc.arg(inviter_user_id)
  AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;

-- name: CountOpenInvitationsInWorkspace :one
-- ワークスペースの未決（期限内）の件数。上限（usecase の定数）の判定用。
SELECT count(*) FROM invitations
WHERE workspace_id = $1
  AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
  AND expires_at > now();

-- name: InsertInvitationSend :exec
-- 送信履歴を 1 行追記する。発行（UpsertOpenInvitation）・再送（RefreshInvitationToken）と同じ
-- トランザクションで呼ぶ。1 日の件数の上限はこの表を数える（invitation_sends のコメント参照）。
INSERT INTO invitation_sends (id, invitation_id, workspace_id, email, sent_by_user_id)
VALUES ($1, $2, $3, $4, $5);

-- name: CountInvitationSendsBySince :one
-- この人が since 以降に届けた回数（発行も再送も 1 回ずつ数える）。1 日の上限判定用。
SELECT count(*) FROM invitation_sends
WHERE sent_by_user_id = sqlc.arg(user_id) AND sent_at >= sqlc.arg(since);

-- name: CountInvitationSendsToEmailSince :one
-- この宛先へ since 以降に届けた回数（全ワークスペース横断）。同じ人へ送りすぎない上限判定用。
SELECT count(*) FROM invitation_sends
WHERE email = sqlc.arg(email) AND sent_at >= sqlc.arg(since);
