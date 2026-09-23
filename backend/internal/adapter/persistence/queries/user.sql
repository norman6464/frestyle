-- name: GetUserByOidcSubject :one
SELECT u.id, u.email, u.name, u.status, u.created_at, u.updated_at, u.deleted_at
FROM users u
WHERE u.status <> 'deactivated'
  AND u.id IN (
    SELECT oi.user_id FROM user_oidc_identities oi
    WHERE oi.provider = 'oidc' AND oi.subject = $1
  );

-- name: GetUserByID :one
-- 内部 ID で 1 ユーザーを引く（退会済みは除外）。
SELECT u.id, u.email, u.name, u.status, u.created_at, u.updated_at, u.deleted_at
FROM users u
WHERE u.id = $1 AND u.status <> 'deactivated';

-- name: GetUserDisplayByID :one
-- 人を表示するのに要る最小限（表示名・アイコン・状態メッセージ）を 1 件返す。
--
-- チケットの作成者・変更履歴の実行者・発言の投稿者・ページの最終編集者、どの画面も
-- この経路で解決する（画面ごとに users / profiles を別々に JOIN すると、一方だけ
-- アイコンが出せない・フィルタ条件がずれるという事故を生む）。
--
-- GetUserByID と違い status を絞らない。コメントや変更履歴は投稿者が退会・停止した
-- 後も表示できる必要があるため（消えたことにして応答ごと空にすると、過去の記録が
-- 誰の発言だったか分からなくなる）。「今選べる相手か」の判定は
-- ListGrantablePrincipals / ListWorkspaceMembers が別に持つ。
SELECT u.id, u.name,
       COALESCE(p.avatar_url, '') AS avatar_url,
       COALESCE(p.status_emoji, '') AS status_emoji,
       COALESCE(p.status_text, '') AS status_text,
       p.status_expires_at AS status_expires_at
FROM users u
LEFT JOIN profiles p ON p.user_id = u.id
WHERE u.id = $1;

-- name: GetOidcSubjectByUserID :one
-- ユーザーの OIDC subject を引く。
-- (user_id, provider) は uq_user_oidc_user_provider で一意（最大 1 行）。
SELECT subject FROM user_oidc_identities
WHERE user_id = $1 AND provider = 'oidc';

-- name: InsertUser :one
-- ユーザーを 1 件作る（id は採番シーケンスに任せる）。created_at / updated_at は DB 既定値が
-- 無いため呼び出し側が値を渡す。status は常に active（作成直後のアカウントは有効。無効化は
-- UpdateUserStatus の仕事）。RETURNING で id / created_at / updated_at を書き戻す。
INSERT INTO users (
  email, name,
  status, created_at, updated_at, deleted_at
)
VALUES (
  $1, $2, 'active', $3, $4, $5
)
RETURNING id, created_at, updated_at;

-- name: InsertUserWithID :one
-- id を呼び出し側が決める場合の InsertUser。列と既定の扱いは InsertUser と同じにすること
-- （片方だけ列を足すと、id を指定する経路だけ値が入らない）。
INSERT INTO users (
  id, email, name,
  status, created_at, updated_at, deleted_at
)
VALUES (
  $1, $2, $3, 'active', $4, $5, $6
)
RETURNING id, created_at, updated_at;

-- name: InsertOidcIdentityIfAbsent :execrows
-- OIDC identity を冪等に挿入する。既に同じ (provider, subject) があれば 0 行で、
-- 呼び出し側が持ち主を確かめる。(user_id, provider) の一意制約違反はそのままエラーになる。
INSERT INTO user_oidc_identities (user_id, provider, subject, created_at, updated_at)
VALUES ($1, $2, $3, now(), now())
ON CONFLICT (provider, subject) DO NOTHING;

-- name: GetOidcIdentityOwner :one
-- (provider, subject) を持っているユーザーの id。挿入されなかったときの持ち主判定に使う。
SELECT user_id FROM user_oidc_identities
WHERE provider = $1 AND subject = $2;

-- name: DeleteOidcIdentitiesByUserID :exec
-- ユーザーの OIDC identity をすべて消し、subject の占有を解く（同じアカウントの再招待を可能にする）。
DELETE FROM user_oidc_identities WHERE user_id = $1;

-- name: UpdateUserStatus :execrows
-- アカウントの状態を更新する（active / suspended への切り替え専用。deactivated への遷移は
-- deleted_at も同時に立てる必要があるため SoftDeleteUser が担う。ck_users_status_deleted_at
-- が deactivated を渡すこと自体を拒む）。0 件なら対象が存在しない（呼び出し側が not-found にする）。
UPDATE users SET status = $2, updated_at = now() WHERE id = $1;

-- name: UpdateUserName :execrows
-- 氏名だけを更新する。0 件なら対象の user が存在しない（呼び出し側が not-found にする）。
UPDATE users SET name = $2, updated_at = now() WHERE id = $1;

-- name: UpdateUserEmail :execrows
-- email だけを更新する。0 件なら対象の user が存在しない（呼び出し側が not-found にする）。
-- uq_users_email_active に既に使われている値を渡すと一意制約違反になる
-- （呼び出し側 repository が isUniqueViolation で ErrEmailTaken に変換する）。
UPDATE users SET email = $2, updated_at = now() WHERE id = $1;

-- name: SoftDeleteUser :execrows
-- ユーザーを退会させる（status を deactivated にし、deleted_at を立てる。両方を同時に
-- 更新するのは ck_users_status_deleted_at が要求する整合のため）。既に退会済み / 存在しない
-- 場合は 0 件（呼び出し側が not-found にする）。
UPDATE users SET status = 'deactivated', deleted_at = now(), updated_at = now()
WHERE id = $1 AND status <> 'deactivated';

-- name: FindActiveUserIDByEmail :one
-- 正規形（domain.NormalizeEmail）の email から、退会していないユーザーの id を引く。
-- 式は uq_users_email_active と同じ（lower + TAB LF VT FF CR SP の 6 文字を btrim）に
-- 揃えてあるので、その索引で引ける。索引は部分索引（deleted_at IS NULL かつ email が空でない）
-- なので、WHERE にも同じ 2 条件を書いて索引の述語を満たしていることを planner に示す。
-- 招待で「相手にアカウントがあるか（あればアプリ内通知も出す）」の判定に使う。無ければ sql.ErrNoRows。
SELECT id FROM users
WHERE lower(btrim(email, E'\t\n\x0B\x0C\r ')) = $1
  AND deleted_at IS NULL
  AND btrim(email, E'\t\n\x0B\x0C\r ') <> '';
