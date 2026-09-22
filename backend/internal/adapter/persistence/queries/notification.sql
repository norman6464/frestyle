-- name: ListNotificationsByUserID :many
-- 自分の通知を新しい順で返す。同時刻の順序を安定させるため id DESC をタイブレークに付ける。
SELECT * FROM notifications
WHERE user_id = $1
ORDER BY created_at DESC, id DESC;

-- name: CountUnreadNotifications :one
-- 未読通知数（バッジ表示用）。
SELECT count(*) FROM notifications
WHERE user_id = $1 AND is_read = false;

-- name: InsertNotification :one
-- 通知を 1 件作成する。created_at は呼び出し側が値を渡す（過去日時のテストデータも作れる
-- ように。ゼロなら呼び出し側で now() を入れる。列の既定値も now() なので省略した INSERT も通る）。
-- link_path は飛び先のアプリ内パス。空文字は「飛び先なし」。形は CHECK 制約が守る。
-- RETURNING で id / created_at を書き戻す。
INSERT INTO notifications (user_id, type, title, body, is_read, link_path, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, created_at;

-- name: CreateNotifications :exec
-- 複数の通知を 1 回の INSERT でまとめて作成する（宛先が増えても往復を増やさない）。
-- database/sql モードで配列を渡すと lib/pq 依存が増えるため、items は 1 個の json 配列で
-- 渡し、json_to_recordset で行へ展開する。created_at は列の既定値（now()）に任せる。
INSERT INTO notifications (user_id, type, title, body, is_read, link_path)
SELECT x.user_id, x.type, x.title, x.body, x.is_read, x.link_path
FROM json_to_recordset(sqlc.arg(items)::json)
  AS x(user_id bigint, type text, title text, body text, is_read boolean, link_path text);

-- name: MarkNotificationRead :execrows
-- 単一通知を既読化する。WHERE で user_id を絞り、他人の通知を既読化できないようにする。
--
-- :exec ではなく :execrows にしている理由:
--   :exec は「SQL がエラーなく流れたか」しか返さない。UPDATE は 1 行も一致しなくても
--   成功なので、存在しない id・他人の通知を渡しても呼び出し側には成功として見える。
--   :execrows は実際に書き換わった行数（RowsAffected）を返すので 0 行を not-found にできる。
--
-- 存在オラクルとの関係:
--   WHERE に user_id が入っているので「他人の通知」も「存在しない id」もどちらも 0 行になり、
--   同じ 404 に畳まれる。応答が分かれるのは自分の通知を既読化できたかどうかだけ。
--
-- 既読の通知をもう一度既読化した場合は 1 行に当たる（is_read の条件を WHERE に入れていない）。
-- 二重既読は not-found にならない。
UPDATE notifications SET is_read = true
WHERE id = $1 AND user_id = $2;

-- name: MarkAllNotificationsRead :exec
-- 対象 user の未読通知をすべて既読化する。
--
-- ここは :exec のままで良い（件数を見ない）。単一行を狙う MarkNotificationRead と違い、
-- これは「その user の未読を全部畳む」一括操作で、0 件は「未読が 1 件も無かった」という
-- 正常な結果でしかない。0 件を not-found にすると、未読が無い状態で
-- 「すべて既読にする」を押しただけで 404 が返ることになる。
UPDATE notifications SET is_read = true
WHERE user_id = $1 AND is_read = false;
