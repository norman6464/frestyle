-- ナレッジのページ本文に置く添付ファイルのメタデータ。本体は Cloud Storage。

-- name: CreatePageAttachment :one
INSERT INTO page_attachments
  (id, workspace_id, page_id, key, filename, content_type, size_bytes, uploaded_by_user_id, created_at)
VALUES (
  sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(page_id), sqlc.arg(key), sqlc.arg(filename),
  sqlc.arg(content_type), sqlc.arg(size_bytes), sqlc.arg(uploaded_by_user_id), now()
)
RETURNING *;

-- name: FindPageAttachment :one
-- ダウンロード URL の発行で 1 件を引く。ワークスペースとページで絞るので、見つかった時点で
-- 「このページの添付」だと確定する（別ページの ID を URL に入れても 0 行）。
SELECT * FROM page_attachments WHERE workspace_id = $1 AND page_id = $2 AND id = $3;

-- name: ListPageAttachmentsByIDs :many
-- 本文の保存時に、本文の attachment ノードが指す ID 群のうち「このページの添付」を 1 回で返す。
-- 返らなかった ID は別ページ・別ワークスペース・存在しないのどれか（呼び出し側が保存を断る）。
--
-- attachment_ids は json 配列（文字列の UUID）。IN 句のスライス展開を使わない理由と、呼び出し側
-- （Go）が UUID として読めない値を先に落とす理由は ListWorkspacePageViewFactsByIDs と同じ
-- （database/sql モードでは lib/pq 依存が増える・ここで ::uuid が失敗するとクエリ全体が落ちる）。
SELECT * FROM page_attachments
WHERE workspace_id = sqlc.arg(workspace_id)
  AND page_id = sqlc.arg(page_id)
  AND id IN (SELECT value::uuid FROM json_array_elements_text(sqlc.arg(attachment_ids)::json));
