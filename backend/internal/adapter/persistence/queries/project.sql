-- プロジェクト（バックログの入れ物）のクエリ。
--
-- projects はワークスペースだけを参照し、spaces（ナレッジの入れ物）とは関係を持たない
-- （schema.hcl の projects のコメント参照）。作法は knowledge_base.sql と同じで、
-- SELECT / UPDATE の WHERE には必ず workspace_id を含める（テナント越えをクエリで塞ぐ）。

-- name: InsertProject :one
-- プロジェクトの作成。key はワークスペース内で一意（uq_projects_workspace_key）。
-- key は表示キーの接頭辞（FRESTYLE-12 の FRESTYLE）になるので、作成後は変えない
-- （改名は name だけ。UpdateProjectName 参照）。
INSERT INTO projects (id, workspace_id, "key", name)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: ListProjects :many
-- ワークスペース内のプロジェクト一覧。並びは作成順（採番の若い順に安定させる）。
SELECT * FROM projects
WHERE workspace_id = $1
ORDER BY created_at, id;

-- name: GetProject :one
-- プロジェクト 1 件。別ワークスペースの ID はここで 0 行になる。
SELECT * FROM projects
WHERE workspace_id = $1 AND id = $2;

-- name: GetProjectByKey :one
-- 表示キーの接頭辞（小文字）からプロジェクトを引く。チケットのキー解決が使う。
SELECT * FROM projects
WHERE workspace_id = $1 AND lower("key") = $2;

-- name: UpdateProjectName :execrows
-- 表示名だけを変える。key は表示キーの接頭辞なので触らない（変えると既存チケットの
-- キーの見え方が全部変わり、外に貼られたキーが指す先を失う）。
UPDATE projects SET name = $3, updated_at = now()
WHERE workspace_id = $1 AND id = $2;
