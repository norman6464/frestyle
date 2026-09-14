-- チケット（段 1: 骨格）のクエリ。knowledge_base.sql と同じ作法。
--
-- 作法（このファイル全体の前提）:
--   - すべての SELECT / UPDATE / DELETE の WHERE に workspace_id を含める。
--   - UPDATE 文には必ず updated_at = now() を明示する。
--   - position（COLLATE "C"）の ORDER BY はバイト順（fracindex と一致）。
--   - tickets への INSERT は CreateTicket 1 本だけ（採番 CTE を含む文でなければ番号が
--     ticket_counters と無関係に振られてしまう。設計 Ⅳ-B のレビュー項目）。

-- =============================================================================
-- ticket_statuses（管理画面）
-- =============================================================================

-- name: HasActiveInitialTicketStatus :one
-- 「有効化済み」の正本判定: 初期状態を持つ現役の状態が 1 つでもあるか。
SELECT EXISTS (
  SELECT 1 FROM ticket_statuses
  WHERE workspace_id = sqlc.arg(workspace_id) AND project_id = sqlc.arg(project_id)
    AND is_initial AND archived_at IS NULL
) AS exists;

-- name: InsertTicketStatus :one
INSERT INTO ticket_statuses
  (id, workspace_id, project_id, name, category, color, "position", is_initial, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
RETURNING *;

-- name: GetTicketStatus :one
SELECT * FROM ticket_statuses
WHERE workspace_id = $1 AND project_id = $2 AND id = $3;

-- name: ListTicketStatuses :many
-- sqlc.narg(archived) は bool。呼び出し側は「現役だけ」か「アーカイブ済みだけ」かを
-- 明示的に渡す（NULL で「両方」は扱わない — 管理画面のタブ切り替えに 1 対 1 対応させる）。
SELECT * FROM ticket_statuses
WHERE workspace_id = sqlc.arg(workspace_id) AND project_id = sqlc.arg(project_id)
  AND (archived_at IS NOT NULL) = sqlc.arg(archived)::boolean
ORDER BY "position";

-- name: GetInitialTicketStatus :one
SELECT * FROM ticket_statuses
WHERE workspace_id = $1 AND project_id = $2 AND is_initial AND archived_at IS NULL;

-- name: UpdateTicketStatus :one
UPDATE ticket_statuses
SET name = $4, category = $5, color = $6, updated_at = now()
WHERE workspace_id = $1 AND project_id = $2 AND id = $3
RETURNING *;

-- name: ClearTicketStatusInitial :execrows
-- SetInitialTicketStatus は「旧初期状態を先に false へ倒す → 新しい状態を true にする」の
-- 2 文で、usecase が同一トランザクションで呼ぶ（部分 UNIQUE のため同時に 2 つは作れない。
-- 旧初期状態が無いプロジェクトでは 0 行更新で構わない）。
UPDATE ticket_statuses
SET is_initial = false, updated_at = now()
WHERE workspace_id = $1 AND project_id = $2 AND is_initial AND archived_at IS NULL;

-- name: SetTicketStatusInitial :execrows
UPDATE ticket_statuses
SET is_initial = true, updated_at = now()
WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND archived_at IS NULL;

-- name: ArchiveTicketStatus :execrows
UPDATE ticket_statuses
SET archived_at = now(), updated_at = now()
WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND archived_at IS NULL;

-- name: RestoreTicketStatus :execrows
-- position を末尾へ付け直す（呼び出し側が LastActiveTicketStatusPosition から
-- fracindex.Between で採番した値を渡す）。
UPDATE ticket_statuses
SET archived_at = NULL, "position" = $4, updated_at = now()
WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND archived_at IS NOT NULL;

-- name: CountActiveTicketsByStatus :one
SELECT count(*) FROM tickets
WHERE workspace_id = $1 AND project_id = $2 AND status_id = $3 AND archived_at IS NULL;

-- name: LastActiveTicketStatusPosition :one
-- 現役の状態のうち最後（position 最大）のもの。復元・新規作成の末尾採番に使う。
-- 1 件も無ければ空文字（sqlc は :one で 0 行だと sql.ErrNoRows を返すため、
-- COALESCE で空文字に畳んで「0 行エラー」を避ける）。
SELECT COALESCE(max("position"), '')::text AS "position" FROM ticket_statuses
WHERE workspace_id = $1 AND project_id = $2 AND archived_at IS NULL;

-- =============================================================================
-- ticket_types（管理画面）
-- =============================================================================

-- name: InsertTicketType :one
INSERT INTO ticket_types
  (id, workspace_id, project_id, name, color, hierarchy_level, "position", is_default,
   template_title, template_doc, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
RETURNING *;

-- name: GetTicketType :one
SELECT * FROM ticket_types
WHERE workspace_id = $1 AND project_id = $2 AND id = $3;

-- name: ListTicketTypes :many
SELECT * FROM ticket_types
WHERE workspace_id = sqlc.arg(workspace_id) AND project_id = sqlc.arg(project_id)
  AND (archived_at IS NOT NULL) = sqlc.arg(archived)::boolean
ORDER BY "position";

-- name: GetDefaultTicketType :one
SELECT * FROM ticket_types
WHERE workspace_id = $1 AND project_id = $2 AND is_default AND archived_at IS NULL;

-- name: UpdateTicketType :one
UPDATE ticket_types
SET name = $4, color = $5, hierarchy_level = $6,
    template_title = $7, template_doc = $8, updated_at = now()
WHERE workspace_id = $1 AND project_id = $2 AND id = $3
RETURNING *;

-- name: ClearTicketTypeDefault :execrows
UPDATE ticket_types
SET is_default = false, updated_at = now()
WHERE workspace_id = $1 AND project_id = $2 AND is_default AND archived_at IS NULL;

-- name: SetTicketTypeDefault :execrows
UPDATE ticket_types
SET is_default = true, updated_at = now()
WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND archived_at IS NULL;

-- name: ArchiveTicketType :execrows
UPDATE ticket_types
SET archived_at = now(), updated_at = now()
WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND archived_at IS NULL;

-- name: RestoreTicketType :execrows
UPDATE ticket_types
SET archived_at = NULL, "position" = $4, updated_at = now()
WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND archived_at IS NOT NULL;

-- name: CountActiveTicketsByType :one
SELECT count(*) FROM tickets
WHERE workspace_id = $1 AND project_id = $2 AND type_id = $3 AND archived_at IS NULL;

-- name: LastActiveTicketTypePosition :one
SELECT COALESCE(max("position"), '')::text AS "position" FROM ticket_types
WHERE workspace_id = $1 AND project_id = $2 AND archived_at IS NULL;

-- =============================================================================
-- tickets 本体
-- =============================================================================

-- name: CreateTicket :one
-- 採番と INSERT を 1 文の CTE にまとめる（設計 Ⅳ-B）。本番の transaction pooler 越しでも
-- 接続が同じであることが保証され、行ロックで直列化される（20 並行で番号が連続することを
-- 実機で確認済み）。VALUES に 1 を渡すのは初回の初期化（ON CONFLICT で 2 回目以降は +1）。
WITH n AS (
  INSERT INTO ticket_counters (workspace_id, project_id, last_number, updated_at)
  VALUES (sqlc.arg(workspace_id), sqlc.arg(project_id), 1, now())
  ON CONFLICT (workspace_id, project_id)
  DO UPDATE SET last_number = ticket_counters.last_number + 1, updated_at = now()
  RETURNING last_number
)
INSERT INTO tickets
  (id, workspace_id, project_id, number, type_id, status_id, parent_id, title, doc, plain_text,
   priority, start_date, due_date, created_by_user_id, created_at, updated_at)
SELECT
  sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(project_id), n.last_number,
  sqlc.arg(type_id), sqlc.arg(status_id), sqlc.narg(parent_id), sqlc.arg(title),
  sqlc.arg(doc), sqlc.arg(plain_text), sqlc.arg(priority),
  sqlc.narg(start_date)::date, sqlc.narg(due_date)::date,
  sqlc.arg(created_by_user_id), now(), now()
FROM n
RETURNING *;

-- name: GetTicket :one
-- 担当（ticket_assignments）を LEFT JOIN で添える。画面は詳細でも一覧でも担当を出すので、
-- チケット 1 件につき問い合わせを 2 回に分けない（設計 Ⅶ の「詳細（… 担当 …）」）。
-- 担当は 1 人（ticket_id が PK）なので、この JOIN で行が増えることはない。
--
-- ticket_backlog_ranks を LEFT JOIN して並び順を rank_position として添える。並び順の正本は
-- この表だけで、tickets.position 列は撤去済み。
--
-- INNER JOIN にはしない。並び順の行が無いだけでチケットが「無い」と誤認され、画面から
-- 黙って消えるため（旧 ticket_ranks で実際に起きた壊れ方がこれ）。行が無ければ
-- rank_position は空文字になり、一覧では末尾に回る —— 消えるのではなく目に見える形で残す。
--
-- deleted_at IS NOT NULL のチケットは「無い」と同じ扱いにする（設計 Ⅳ-J: 消えたことにする。
-- archived_at と違い戻す口を持たない）。削除済みチケットを個別に引く経路は
-- FindDeletedTicket に分けてある（RestoreDeletedTicketUseCase 専用）。
SELECT t.*, a.assignee_principal_id, COALESCE(r."position", '')::text AS rank_position FROM tickets t
LEFT JOIN ticket_backlog_ranks r ON r.workspace_id = t.workspace_id AND r.ticket_id = t.id
LEFT JOIN ticket_assignments a ON a.workspace_id = t.workspace_id AND a.ticket_id = t.id
WHERE t.workspace_id = $1 AND t.id = $2 AND t.deleted_at IS NULL;

-- name: FindDeletedTicket :one
-- RestoreDeletedTicketUseCase 専用。GetTicket と逆に、削除済み（deleted_at IS NOT NULL）の
-- 行だけを引く（現役の行は見えない — Archive/Restore の archived_at と対称の作法）。
SELECT * FROM tickets
WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NOT NULL;

-- name: GetTicketForUpdate :one
-- 状態変更・親子変更・順位変更の直前にロックする。
SELECT * FROM tickets
WHERE workspace_id = $1 AND id = $2
FOR UPDATE;

-- name: ResolveTicketIDByKey :one
-- spaceKey（小文字。domain.ParseTicketKey が返す）+ number からチケットを引く。
SELECT t.id, t.workspace_id FROM tickets t
JOIN projects p ON p.workspace_id = t.workspace_id AND p.id = t.project_id
WHERE t.workspace_id = sqlc.arg(workspace_id)
  AND lower(p."key") = sqlc.arg(project_key)
  AND t.number = sqlc.arg(number);

-- name: ListTickets :many
-- status_id / type_id / assignee_principal_id / label_id / due_before / start_after / q は
-- いずれも sqlc.narg。NULL なら絞らない（段 4 で label_id / due_before / start_after を追加。
-- 段 5 で unassigned / assigned_to_me / overdue / q を追加）。
-- label_id は ticket_labels への EXISTS で絞る（LEFT JOIN だとラベル数だけ行が重複するため）。
-- due_before / start_after は 'YYYY-MM-DD' 文字列を date として渡す（tickets.due_date /
-- start_date と同じ運び方。冒頭の作法参照）。
-- unassigned / assigned_to_me は担当の絞り込みが「誰でもよい/この ID/未割り当て/自分」の
-- 4 通りあるため、assignee_principal_id とは別の bool narg にする（1 つの引数に "me" 等の
-- 文字列を混ぜると uuid のパースと衝突するため）。呼び出し側（handler）は 3 つが同時に
-- 立たないよう検証する。overdue は「期限が今日より前、かつ状態が完了(done)ではない」
-- （done のチケットは「終わっているので遅延ではない」という扱い。設計 段 5）。
-- q は題名（title）・本文の素テキスト写し（plain_text）の両方を対象にする。ILIKE の
-- 中間一致に加えて word_similarity(q, 対象) > 0.6 を OR し、表記ゆれ・打ち間違いも拾う
-- （KB ページ検索の SearchPages と同じ考え方。schema.hcl 冒頭の「pg_trgm 拡張について」参照）。
-- ticket_backlog_ranks を LEFT JOIN で並び順を rank_position として返す（GetTicket と同じ理由）。
-- deleted_at IS NULL は常に付ける（include_archived の有無に関わらず、削除済みは一覧に出さない）。
SELECT t.*, a.assignee_principal_id, COALESCE(r."position", '')::text AS rank_position FROM tickets t
LEFT JOIN ticket_backlog_ranks r ON r.workspace_id = t.workspace_id AND r.ticket_id = t.id
LEFT JOIN ticket_assignments a ON a.workspace_id = t.workspace_id AND a.ticket_id = t.id
LEFT JOIN ticket_statuses s ON s.workspace_id = t.workspace_id AND s.id = t.status_id
WHERE t.workspace_id = sqlc.arg(workspace_id) AND t.project_id = sqlc.arg(project_id)
  AND t.deleted_at IS NULL
  AND (t.archived_at IS NOT NULL) = sqlc.arg(include_archived)::boolean
  AND (sqlc.narg(status_id)::uuid IS NULL OR t.status_id = sqlc.narg(status_id)::uuid)
  AND (sqlc.narg(type_id)::uuid IS NULL OR t.type_id = sqlc.narg(type_id)::uuid)
  AND (
    sqlc.narg(assignee_principal_id)::uuid IS NULL
    OR a.assignee_principal_id = sqlc.narg(assignee_principal_id)::uuid
  )
  AND (NOT sqlc.arg(unassigned)::boolean OR a.assignee_principal_id IS NULL)
  AND (
    sqlc.narg(assigned_to_me_principal_id)::uuid IS NULL
    OR a.assignee_principal_id = sqlc.narg(assigned_to_me_principal_id)::uuid
  )
  AND (
    sqlc.narg(label_id)::uuid IS NULL
    OR EXISTS (
      SELECT 1 FROM ticket_labels tl
      WHERE tl.workspace_id = t.workspace_id AND tl.ticket_id = t.id AND tl.label_id = sqlc.narg(label_id)::uuid
    )
  )
  AND (sqlc.narg(due_before)::date IS NULL OR t.due_date <= sqlc.narg(due_before)::date)
  AND (sqlc.narg(start_after)::date IS NULL OR t.start_date >= sqlc.narg(start_after)::date)
  AND (NOT sqlc.arg(overdue)::boolean OR (t.due_date < CURRENT_DATE AND s.category <> 'done'))
  AND (
    sqlc.narg(q)::text IS NULL
    OR t.title ILIKE '%' || sqlc.narg(q)::text || '%'
    OR t.plain_text ILIKE '%' || sqlc.narg(q)::text || '%'
    OR word_similarity(sqlc.narg(q)::text, t.title) > 0.6
    OR word_similarity(sqlc.narg(q)::text, t.plain_text) > 0.6
  )
ORDER BY r."position";

-- name: GetTicketCounts :one
-- バックログのサイドバー「保存した絞り込み」が使う件数の集計（段 5）。1 クエリの
-- FILTER で 4 通りをまとめて数える（4 回に分けて問い合わせると往復が増えるだけで
-- 対象行の集合はどれも同じ WHERE の前段を共有するため）。
-- my_principal_id は呼び出し側（handler）が principals から先に引いて渡す
-- （kind='user' の principal が無い＝そのワークスペースに所属していない相手からは
-- そもそもこの経路に来ない。ミドルウェアが弾く）。
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (
    WHERE sqlc.narg(my_principal_id)::uuid IS NOT NULL AND a.assignee_principal_id = sqlc.narg(my_principal_id)::uuid
  ) AS assigned_to_me,
  COUNT(*) FILTER (WHERE t.due_date < CURRENT_DATE AND s.category <> 'done') AS overdue,
  COUNT(*) FILTER (WHERE a.assignee_principal_id IS NULL) AS unassigned
FROM tickets t
LEFT JOIN ticket_assignments a ON a.workspace_id = t.workspace_id AND a.ticket_id = t.id
LEFT JOIN ticket_statuses s ON s.workspace_id = t.workspace_id AND s.id = t.status_id
WHERE t.workspace_id = sqlc.arg(workspace_id) AND t.project_id = sqlc.arg(project_id)
  AND t.archived_at IS NULL AND t.deleted_at IS NULL;

-- name: ListTicketChildren :many
-- ticket_backlog_ranks を LEFT JOIN で並び順を rank_position として返す（同上）。
SELECT t.*, COALESCE(r."position", '')::text AS rank_position FROM tickets t
LEFT JOIN ticket_backlog_ranks r ON r.workspace_id = t.workspace_id AND r.ticket_id = t.id
WHERE t.workspace_id = $1 AND t.project_id = $2 AND t.parent_id = $3
  AND t.archived_at IS NULL AND t.deleted_at IS NULL
ORDER BY r."position";

-- name: UpdateTicket :one
-- 並び順（rank_position）は返さない。RETURNING に JOIN は書けず、CTE で繋ぐ形も
-- RETURNING の中の相関副問い合わせも、sqlc の解析器が RETURNING * の列を追えずに
-- 「workspace_id が曖昧」で落ちる（PostgreSQL 自体は通す文なのに、生成が通らない）。
-- 更新は並び順に触らないので、呼び出し側は position を空のまま受け取り、並びが要る画面は
-- 一覧（ListTickets）を読み直す。詳しくは toDomainTicket の doc を参照。
UPDATE tickets
SET type_id = sqlc.arg(type_id), parent_id = sqlc.narg(parent_id), title = sqlc.arg(title),
    doc = sqlc.arg(doc), plain_text = sqlc.arg(plain_text), priority = sqlc.arg(priority),
    -- ::bigint で受ける（列は integer）。::integer だと sqlc が int32 で生成し、
    -- 範囲外の値が Go 側で黙って負数へ折り返す。bigint で渡せば、範囲外は
    -- PostgreSQL が "integer out of range" で弾く（縮小を DB に判定させる）。
    story_points = sqlc.narg(story_points)::bigint,
    start_date = sqlc.narg(start_date)::date, due_date = sqlc.narg(due_date)::date,
    updated_at = now()
WHERE workspace_id = sqlc.arg(workspace_id) AND id = sqlc.arg(id)
RETURNING *;

-- name: ChangeTicketStatus :one
-- closed_at / resolution は usecase が domain.ResolveTicketClosedFields で導出した値を
-- そのまま渡す（ここでは category との整合を判断しない）。
-- 並び順を返さない理由は UpdateTicket と同じ。
UPDATE tickets
SET status_id = $3, closed_at = $4, resolution = $5, updated_at = now()
WHERE workspace_id = $1 AND id = $2
RETURNING *;

-- name: ArchiveTicket :execrows
UPDATE tickets
SET archived_at = now(), updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL AND deleted_at IS NULL;

-- name: RestoreTicket :execrows
-- 並び順の付け直しはこの文では行わない。呼び出し側（RestoreTicketUseCase）が
-- UpsertTicketBacklogRank で末尾へ置き直す。
UPDATE tickets
SET archived_at = NULL, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND archived_at IS NOT NULL AND deleted_at IS NULL;

-- name: DeleteTicket :execrows
-- 「消えたことにする」（設計 Ⅳ-J）。archived_at と独立の列で、戻す口は
-- RestoreDeletedTicket だけ（一覧・検索・URL 直打ちのどこにも出てこなくなる）。
-- 既に削除済みなら 0 行（呼び出し側は ErrTicketNotFound に畳む。冪等な 404）。
UPDATE tickets
SET deleted_at = now(), updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL;

-- name: RestoreDeletedTicket :execrows
-- 並び順は末尾へ付け直す（削除されていた間に他のチケットの並びが進んでいる可能性が
-- あるため、元の位置は復元しない）。付け直しは呼び出し側の UpsertTicketBacklogRank。
UPDATE tickets
SET deleted_at = NULL, updated_at = now()
WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NOT NULL;

-- name: DeleteTicketPageLinksBySourceCascade :exec
-- チケット削除時、その本文からの参照（派生索引）も一緒に「消えたことにする」。
-- 物理削除しないのは、DeleteTicketPageLinksBySource（本文保存時の張り替え）と役割が違うため
-- — こちらは「参照元が消えたので隠す」、あちらは「本文が変わったので作り直す」。
UPDATE ticket_page_links
SET deleted_at = now()
WHERE workspace_id = $1 AND source_ticket_id = $2 AND deleted_at IS NULL;

-- name: DeleteTicketTicketLinksBySourceCascade :exec
UPDATE ticket_ticket_links
SET deleted_at = now()
WHERE workspace_id = $1 AND source_ticket_id = $2 AND deleted_at IS NULL;

-- name: CountActiveTicketChildren :one
SELECT count(*) FROM tickets
WHERE workspace_id = $1 AND parent_id = $2 AND archived_at IS NULL;

-- name: ListTicketParentChain :many
-- 親を根まで辿る（自分は含まない、根に近い順）。最大 3 段の設計なので再帰は浅く終わるが、
-- 誤ったデータで循環していても RECURSIVE は無限ループしない（訪問済み id を UNION の
-- 重複排除では止められないため、深さで打ち切る）。
WITH RECURSIVE chain AS (
  SELECT t.*, 0 AS depth
  FROM tickets t
  WHERE t.workspace_id = sqlc.arg(workspace_id) AND t.id = sqlc.arg(ticket_id)
  UNION ALL
  SELECT p.*, c.depth + 1
  FROM tickets p
  JOIN chain c ON p.workspace_id = c.workspace_id AND p.id = c.parent_id
  WHERE c.depth < 10
)
SELECT id, workspace_id, project_id, number, type_id, status_id, parent_id, title, doc,
  plain_text, priority, start_date, due_date, closed_at, resolution,
  created_by_user_id, archived_at, deleted_at, created_at, updated_at
FROM chain
WHERE depth > 0
ORDER BY depth DESC;

-- =============================================================================
-- ticket_paths（段 5: parent_id の閉包表。page_paths と同じ設計・同じ作法）
-- =============================================================================

-- name: InsertTicketPathSelf :exec
-- closure の自己参照行（depth=0）。チケット作成と同じタイミングで張る。
INSERT INTO ticket_paths (workspace_id, ticket_id, ancestor_id, depth)
VALUES ($1, $2, $2, 0);

-- name: InsertTicketPathAncestors :exec
-- チケット作成時に親の祖先集合（親自身 depth=0 を含む）を +1 して引き継ぐ。
INSERT INTO ticket_paths (workspace_id, ticket_id, ancestor_id, depth)
SELECT tp.workspace_id, sqlc.arg(ticket_id)::uuid, tp.ancestor_id, tp.depth + 1
FROM ticket_paths tp
WHERE tp.workspace_id = sqlc.arg(workspace_id) AND tp.ticket_id = sqlc.arg(parent_id);

-- name: DetachTicketPathSubtree :exec
-- 親の付け替え（前半）: サブツリー内の各チケットと「サブツリー外の祖先」との組を消す。
-- サブツリー内部同士の組（自己参照 depth=0 を含む）は付け替え後も変わらないため残す。
-- page_paths の DetachPageSubtreePaths と同じ形（doc 参照）。
DELETE FROM ticket_paths
WHERE ticket_paths.workspace_id = sqlc.arg(workspace_id)
  AND ticket_paths.ticket_id IN (
      SELECT tp.ticket_id FROM ticket_paths tp
      WHERE tp.workspace_id = sqlc.arg(workspace_id) AND tp.ancestor_id = sqlc.arg(ticket_id)
  )
  AND ticket_paths.ancestor_id NOT IN (
      SELECT tp.ticket_id FROM ticket_paths tp
      WHERE tp.workspace_id = sqlc.arg(workspace_id) AND tp.ancestor_id = sqlc.arg(ticket_id)
  );

-- name: AttachTicketPathSubtree :exec
-- 親の付け替え（後半）: 新しい親の祖先集合（親自身を含む）×サブツリー全員の直積を張る。
-- 深さは「サブツリー内での深さ + 親までの深さ + 1」。ルートへ戻す付け替え（親なし）では
-- このクエリは呼ばない（Detach だけで完結する）。呼び出し順は Detach → Attach 固定
-- （逆にすると Attach で張った行を Detach が消してしまう。page_paths と同じ注意）。
INSERT INTO ticket_paths (workspace_id, ticket_id, ancestor_id, depth)
SELECT sub.workspace_id, sub.ticket_id, sup.ancestor_id, sub.depth + sup.depth + 1
FROM ticket_paths sub
JOIN ticket_paths sup
  ON sup.workspace_id = sub.workspace_id AND sup.ticket_id = sqlc.arg(new_parent_id)
WHERE sub.workspace_id = sqlc.arg(workspace_id) AND sub.ancestor_id = sqlc.arg(ticket_id);

-- name: ListTicketAncestors :many
-- パンくず用。根から順（depth の大きい方が根に近い）に祖先チケットを返す。自分自身
-- （depth=0）は含まない。チケットの親は常に同一スペース限定（fk_tickets_parent）なので、
-- ページの ListAncestorPageIDsと違い祖先ごとの可視判定は要らない（このチケット自体が
-- 見えるなら、同じスペースの祖先もすべて見える。設計 Ⅳ-H）。
--
-- 論理削除済みの祖先は除く。DeleteTicketUseCase は削除を子へ連鎖させないため、
-- 子が生きたまま親だけ削除された状態があり得る。ここで絞らないと、削除後に
-- スペースへ権限を得た利用者が、削除より前の題名・本文をパンくず経由で読めてしまう
-- （ListTicketsReferencingPage が既にこの形で deleted_at を見ている）。
-- アーカイブ済みの祖先は含める（GetTicket 等の個票取得と同じ扱い。アーカイブは
-- 「隠す」ではなく「畳む」ための状態で、経路から抜くと場所を偽ることになる）。
SELECT t.* FROM ticket_paths tp
JOIN tickets t ON t.workspace_id = tp.workspace_id AND t.id = tp.ancestor_id
WHERE tp.workspace_id = $1 AND tp.ticket_id = $2 AND tp.depth > 0 AND t.deleted_at IS NULL
ORDER BY tp.depth DESC;

-- =============================================================================
-- ticket_backlog_ranks（バックログの並び順。設計 Ⅳ-F）
-- =============================================================================

-- name: InsertTicketBacklogRank :exec
-- CreateTicket 成功直後に usecase が呼ぶ（tickets への INSERT とは別文。設計 Ⅳ-B の
-- 「tickets への INSERT は 1 本だけ」という縛りはこの表には及ばない）。
-- project_id を明示的に受け取る —— 並びの範囲がプロジェクトであることを、表の側にも
-- 書き込むため（旧 ticket_ranks はこれを持たず、一意制約が表全体に効いていた）。
INSERT INTO ticket_backlog_ranks (workspace_id, project_id, ticket_id, "position", created_at, updated_at)
VALUES ($1, $2, $3, $4, now(), now());

-- name: MoveTicketBacklogRank :execrows
UPDATE ticket_backlog_ranks
SET "position" = $3, updated_at = now()
WHERE workspace_id = $1 AND ticket_id = $2;

-- name: LastTicketBacklogRankPosition :one
-- 末尾へ足すときの「いま一番後ろの鍵」。表が project_id を持つので、対象プロジェクトの
-- 絞り込みに tickets への JOIN は要らない。
--
-- **現役の行だけに絞ってはいけない。** 一意制約は表の行すべてに効くので、アーカイブ済み・
-- 削除済みの行を無視して最大値を取ると、その鍵を後から作り直して重複で落ちる
-- （末尾のチケットを 1 件アーカイブしてから新しく作ると必ず踏む）。
-- 見えない行も含めて「一番後ろ」を取ることが、採番が衝突しない条件そのもの。
SELECT COALESCE(max("position"), '')::text AS "position"
FROM ticket_backlog_ranks
WHERE workspace_id = $1 AND project_id = $2;

-- name: UpsertTicketBacklogRank :exec
-- 復元（アーカイブ解除・削除取り消し）で末尾へ置き直すときに使う。
--
-- 素の UPDATE ではなく upsert にしてあるのは、並び順の行が無いチケットが有り得るため
-- —— この表より前に作られたチケットは、移行で現役の分だけに行を入れた（撤去済みだった
-- tickets.position から写した）。当時アーカイブ済み・削除済みだった分には行が無い。
-- UPDATE だけだと、そういうチケットを復元したときに 0 行で失敗する。
INSERT INTO ticket_backlog_ranks (workspace_id, project_id, ticket_id, "position", created_at, updated_at)
VALUES ($1, $2, $3, $4, now(), now())
ON CONFLICT (workspace_id, ticket_id)
DO UPDATE SET "position" = EXCLUDED."position", updated_at = now();

-- =============================================================================
-- ticket_assignments
-- =============================================================================

-- name: UpsertTicketAssignment :one
-- 衝突キー (ticket_id) は PK 単独だが、行の所有者列 workspace_id が EXCLUDED と一致する
-- ときだけ更新する（blocks の upsert と同じ形。呼び出し側が ticket_id と workspace_id を
-- 取り違えても、他テナントの行を上書きしない歯止めになる）。
INSERT INTO ticket_assignments
  (workspace_id, ticket_id, assignee_principal_id, assigned_by_user_id, created_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (ticket_id)
DO UPDATE SET assignee_principal_id = EXCLUDED.assignee_principal_id,
              assigned_by_user_id = EXCLUDED.assigned_by_user_id
WHERE ticket_assignments.workspace_id = EXCLUDED.workspace_id
RETURNING *;

-- name: DeleteTicketAssignment :execrows
DELETE FROM ticket_assignments
WHERE workspace_id = $1 AND ticket_id = $2;

-- name: GetTicketAssignment :one
SELECT * FROM ticket_assignments
WHERE workspace_id = $1 AND ticket_id = $2;

-- name: ListTicketsAssignedToPrincipal :many
SELECT t.* FROM tickets t
JOIN ticket_assignments a ON a.workspace_id = t.workspace_id AND a.ticket_id = t.id
WHERE t.workspace_id = $1 AND a.assignee_principal_id = $2
  AND t.archived_at IS NULL AND t.deleted_at IS NULL;

-- =============================================================================
-- ticket_change_groups / ticket_change_items
-- =============================================================================

-- name: InsertTicketChangeGroup :one
INSERT INTO ticket_change_groups (id, workspace_id, ticket_id, actor_user_id, created_at)
VALUES ($1, $2, $3, $4, now())
RETURNING *;

-- name: InsertTicketChangeItem :exec
INSERT INTO ticket_change_items
  (id, workspace_id, group_id, field, old_value, new_value, old_label, new_label)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: ListTicketChangeGroups :many
SELECT * FROM ticket_change_groups
WHERE workspace_id = $1 AND ticket_id = $2
ORDER BY created_at DESC;

-- name: ListTicketChangeItemsByGroupIDs :many
-- group_id 群は json 配列 1 個のパラメータで渡す（no-array-param。comment.sql と同じ形）。
SELECT i.* FROM ticket_change_items i
WHERE i.workspace_id = sqlc.arg(workspace_id)
  AND i.group_id IN (
    SELECT value::uuid FROM json_array_elements_text(sqlc.arg(group_ids)::json) AS t(value)
  )
ORDER BY i.group_id;

-- =============================================================================
-- ticket_page_links / ticket_ticket_links（派生表）
-- =============================================================================

-- name: DeleteTicketPageLinksBySource :exec
DELETE FROM ticket_page_links
WHERE workspace_id = $1 AND source_ticket_id = $2;

-- name: InsertTicketPageLink :exec
INSERT INTO ticket_page_links (workspace_id, source_ticket_id, target_page_id)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: DeleteTicketTicketLinksBySource :exec
DELETE FROM ticket_ticket_links
WHERE workspace_id = $1 AND source_ticket_id = $2;

-- name: InsertTicketTicketLink :exec
INSERT INTO ticket_ticket_links (workspace_id, source_ticket_id, target_ticket_id)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: ListExistingPageIDsInWorkspace :many
-- 本文に貼られた pageRef 候補のうち、**そのワークスペースに実在するページ** だけを返す
-- （リンク切れ・別ワークスペースの ID は黙って除外する。設計 Ⅳ-I）。
SELECT id FROM pages
WHERE workspace_id = sqlc.arg(workspace_id)
  AND id IN (
    SELECT value::uuid FROM json_array_elements_text(sqlc.arg(page_ids)::json) AS t(value)
  );

-- name: ListExistingTicketIDsInWorkspace :many
SELECT id FROM tickets
WHERE workspace_id = sqlc.arg(workspace_id)
  AND id IN (
    SELECT value::uuid FROM json_array_elements_text(sqlc.arg(ticket_ids)::json) AS t(value)
  );

-- name: ListTicketPageLinksBySource :many
SELECT * FROM ticket_page_links
WHERE workspace_id = $1 AND source_ticket_id = $2;

-- name: ListTicketsReferencingPage :many
-- ページ詳細の逆参照一覧（そのページを参照しているチケット一覧。）。
-- target_page_id を起点に tickets を JOIN し、チケットの行そのものを返す
-- （handler が題名・状態をそのまま出せるように、リンク行だけでなくチケット本体を返す）。
--
-- deleted_at IS NULL（ticket_page_links）: 参照元チケットが削除されていれば、削除時に
-- DeleteTicketPageLinksBySourceCascade がこの行にも deleted_at を立てている。ここで除かないと、
-- 消えたはずのチケットの存在がページ側の逆参照一覧から漏れる（参照元チケットの deleted_at を
-- 都度 JOIN で見る代わりに、削除時に伝播させて 1 列で判定できるようにしてある。設計 Ⅳ-J の
-- 「読み出しの述語を単純に保つ」）。t.deleted_at IS NULL は伝播が万一漏れた場合の二重の安全弁。
SELECT t.* FROM ticket_page_links tpl
JOIN tickets t ON t.workspace_id = tpl.workspace_id AND t.id = tpl.source_ticket_id
WHERE tpl.workspace_id = $1 AND tpl.target_page_id = $2
  AND tpl.deleted_at IS NULL AND t.deleted_at IS NULL;

-- name: ListTicketTicketLinksBySource :many
SELECT * FROM ticket_ticket_links
WHERE workspace_id = $1 AND source_ticket_id = $2;

-- name: ListTicketsReferencingTicket :many
-- deleted_at IS NULL: ListPagesReferencingTicket と同じ理由（参照元チケットの削除を伝播で判定）。
SELECT * FROM ticket_ticket_links
WHERE workspace_id = $1 AND target_ticket_id = $2 AND deleted_at IS NULL;

-- name: GetTicketAcrossWorkspaces :one
-- チケットを **ID だけ** で引く。/kb/tickets/{ticketId} の URL からワークスペースを
-- 特定するための、このファイルで唯一 workspace_id を WHERE に持たない読み取り
-- （knowledge_base.sql の GetPageAcrossWorkspaces と同じ役割・同じ作法）。
-- 引いた直後に必ずその workspace の権限判定を通すこと（判定なしで応答に使わない）。
-- id は uuid の主キーで全テナント一意なので、これ自体が越境にはならない。
SELECT id, workspace_id, project_id FROM tickets
WHERE id = $1;

-- name: CountActiveTicketsGroupedByStatus :many
-- 管理画面の「使用中 N 件」。状態 1 つずつ CountActiveTicketsByStatus を呼ぶと
-- 状態の数だけ問い合わせが増えるので、スペース 1 回の GROUP BY でまとめて数える。
-- 現役（archived_at IS NULL）だけを数えるのは、アーカイブ済みのチケットが
-- 状態のアーカイブを妨げないため（usecase の 409 判定と同じ範囲に揃える）。
SELECT status_id, count(*)::bigint AS count FROM tickets
WHERE workspace_id = $1 AND project_id = $2 AND archived_at IS NULL
GROUP BY status_id;

-- name: CountActiveTicketsGroupedByType :many
SELECT type_id, count(*)::bigint AS count FROM tickets
WHERE workspace_id = $1 AND project_id = $2 AND archived_at IS NULL
GROUP BY type_id;

-- name: ListAssignedTicketsForPrincipal :many
-- 「自分の担当」の画面向け。ワークスペース**全体**（プロジェクトを横断）で、その人に
-- 割り当たっている現役のチケットを返す。
--
-- ListTickets との違いは 2 つ。
-- 1. project_id で絞らない。この画面は「どのプロジェクトの仕事か」も込みで一覧にする。
-- 2. 表示に要る隣の表の値（プロジェクトの key / 名前、状態の名前・枠・色、種別の名前）を
--    同じ行で返す。1 件ずつ引き直すと行数分の往復になるため。
--
-- 並びは「状態の枠 → 状態の並び → 期限の近い順 → 作成の古い順」。枠で束ねて出す画面なので、
-- SQL の時点で束の順に並べておけば、画面側は境目を見て見出しを挟むだけで済む。
-- 期限が無い行は最後（NULLS LAST）。
SELECT
  t.*,
  a.assignee_principal_id,
  p.key AS project_key,
  p.name AS project_name,
  s.name AS status_name,
  s.category AS status_category,
  s.color AS status_color,
  s."position" AS status_position,
  ty.name AS type_name
FROM tickets t
JOIN ticket_assignments a
  ON a.workspace_id = t.workspace_id AND a.ticket_id = t.id
JOIN projects p
  ON p.id = t.project_id
JOIN ticket_statuses s
  ON s.workspace_id = t.workspace_id AND s.id = t.status_id
JOIN ticket_types ty
  ON ty.workspace_id = t.workspace_id AND ty.id = t.type_id
WHERE t.workspace_id = sqlc.arg(workspace_id)
  AND a.assignee_principal_id = sqlc.arg(assignee_principal_id)
  AND t.archived_at IS NULL
  AND t.deleted_at IS NULL
ORDER BY
  CASE s.category WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
  s."position",
  t.due_date ASC NULLS LAST,
  t.created_at ASC;

-- =============================================================================
-- ticket_watchers
-- =============================================================================

-- name: InsertTicketWatcher :exec
-- 二重に押しても落とさない（PK 衝突は「もう監視している」なので、成功と同じ扱いでよい）。
INSERT INTO ticket_watchers (workspace_id, ticket_id, user_id, created_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (workspace_id, ticket_id, user_id) DO NOTHING;

-- name: DeleteTicketWatcher :execrows
DELETE FROM ticket_watchers WHERE workspace_id = $1 AND ticket_id = $2 AND user_id = $3;

-- name: CountTicketWatchers :one
SELECT count(*) FROM ticket_watchers WHERE workspace_id = $1 AND ticket_id = $2;

-- name: IsTicketWatchedBy :one
SELECT EXISTS (
  SELECT 1 FROM ticket_watchers
  WHERE workspace_id = $1 AND ticket_id = $2 AND user_id = $3
) AS watching;
