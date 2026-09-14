# FreStyle のスキーマ正本（Atlas 宣言的スキーマ）。
#
# このファイルが唯一の正本。schema.gen.sql はこのファイルから
# `make schema-gen`（backend/Makefile）が機械生成する、DO NOT EDIT な副産物で、
# CI が drift（手で直したまま make し忘れ）を検査する。
#
# schema.gen.sql の使いどころ:
#   - sqlc の型付け入力（backend/sqlc.yaml）
#   - go:embed して結合テスト用 DB / ローカルの docker-entrypoint-initdb.d へ適用
#     （どちらも「まだ何も無い空の DB」に対してだけ使う。CREATE 文のみで DO ブロックも
#     IF NOT EXISTS も持たないので、既存 DB へ直接流すと衝突する）
#
# 既存 DB（本番・書き換え済みのローカル DB）への適用は必ずこの schema.hcl を正本にした
# `make schema-apply TARGET=<DSN>` を使う。Atlas が実 DB の現在の姿を見て差分だけを計算するため、
# 何度実行しても収束する（宣言のみ・履歴ファイルは持たない）。
#
# コメントの置き場所: DB のメタデータとして残したい説明は `comment = "…"`（COMMENT ON になり、
# 差分の対象にもなる）。ファイルの都合・設計の背景など DB に残す必要のないものは、
# この `#` 行コメントのように書く。
schema "public" {
  comment = "standard public schema"
}

# =====================================================================
# pg_trgm 拡張について（あいまい検索の前提条件）
# =====================================================================
#
# チケット題名検索・KB ページ検索（題名・本文）は pg_trgm を使う。採用理由は速度ではなく
# 「あいまい検索の振れ幅を最低限持ちたい」（表記ゆれ・打ち間違いを拾う）こと。
#
# Atlas v1.3.0（ログイン無しの OSS 版 CLI）は `extension` ブロックも `docker` env の
# `baseline` もいずれも Atlas Pro 限定機能で、`atlas schema inspect` が
# "extensions are available to logged-in users only. Use `atlas login` to access this
# feature" で弾く（実測）。そのため schema.hcl は pg_trgm という拡張そのものは宣言できない
# ——以下の索引で使う `ops = gin_trgm_ops` は、拡張が対象 DB に既に存在する前提で書く
# （Atlas は宣言に無い拡張を DROP しには来ないため、外で作っておけば索引の宣言だけで足りる）。
#
# 拡張の作成（`CREATE EXTENSION IF NOT EXISTS pg_trgm;`）は schema.hcl の外、次の 4 箇所で
# 独立に行う。同じ 1 行の文を複製しているだけで、schema.hcl と実 DB が食い違わないよう
# 4 箇所とも「対象 DB へ入る前に必ず素通しする」構成にしてある:
#   1. backend/scripts/local-db-init/01-extensions.sql
#      （ローカル docker compose の初回起動。02-schema.sql より前に走る）
#   2. backend/scripts/atlas-dev/Dockerfile
#      （make schema-gen/schema-plan/schema-apply の --dev-url 専用イメージ。1 と同じ
#      ファイルを COPY するだけで内容は複製しない）
#   3. internal/infra/database/schema.go の ApplySchema
#      （結合テスト用の空 DB。schema.gen.sql の実行直前に exec）
#   4. backend/Makefile の schema-ensure-pg-trgm
#      （schema-plan/schema-apply の対象 TARGET。atlas 実行前に exec）
#
# 索引（gin_trgm_ops）はあくまで ILIKE '%needle%' の高速化用（pg_trgm の GIN 索引は
# LIKE/ILIKE のパターン一致にそのまま使える）。あいまい検索そのもの（表記ゆれ・打ち間違い）は
# 索引と独立に、クエリ側で word_similarity() を OR 条件として使う
# （knowledge_base_permission.sql の SearchPages・ticket.sql の ListTickets 参照）。
# しきい値はまず word_similarity の既定値である 0.6 を固定値で使う（session 単位の GUC
# `pg_trgm.word_similarity_threshold` は Supabase の transaction pooler 越しだと次の
# 文で保持される保証が無いため使わない）。実運用のフィードバックで調整する前提。

# =====================================================================
# 中核（users / workspaces / notifications …）
# =====================================================================

# 利用者。deleted_at は実際に NULL になり得る。
#
# アプリ全体のロール（かつての users.role）は撤去済み。権限は per-workspace の
# grant（workspace_grants / space_grants / page_grants / course_grants / chapter_grants、
# domain.GrantRole）だけで表現する。
#
# 段 2: 所属の正本だった workspace_id は撤去した（1 人 1 ワークスペースの単一列で、
# 実運用では一度も書かれず常に NULL だった）。所属は workspace_members が表す
# （1 人が複数のワークスペースに所属できる。table "workspace_members" のコメント参照）。
table "users" {
  schema = schema.public
  column "id" {
    null = false
    type = bigserial
  }
  column "email" {
    null    = false
    type    = text
    default = ""
  }
  column "name" {
    null    = false
    type    = text
    default = ""
  }
  # 段 3: is_active（有効/無効の 2 値）と deleted_at（退会日時の有無）を別々の列で
  # 持っていた。組み合わせは 4 通りできるが、意味があるのは 3 つ（有効 / 停止 / 退会）で、
  # 「退会済みだが有効」という 4 つ目は誰も定義していなかった。状態の判定は status
  # 1 列に一本化し、deleted_at は退会日時の記録としてだけ残す
  # （ck_users_status_deleted_at が両者の整合を DB 側で縛る）。
  column "status" {
    null    = false
    type    = text
    default = "active"
  }
  column "created_at" {
    null = false
    type = timestamptz
  }
  column "updated_at" {
    null = false
    type = timestamptz
  }
  column "deleted_at" {
    null = true
    type = timestamptz
  }
  primary_key {
    columns = [column.id]
  }
  check "ck_users_status" {
    expr = "status = ANY (ARRAY['active'::text, 'suspended'::text, 'deactivated'::text])"
  }
  # deleted_at は「退会した日時」の記録。status = 'deactivated' とは常に対で成り立つ
  # （どちらかだけを更新して不整合にするコードを DB 側で弾く）。
  check "ck_users_status_deleted_at" {
    expr = "(status = 'deactivated'::text) = (deleted_at IS NOT NULL)"
  }
  # アクティブ行（未論理削除）かつ正規形が非空に限った部分 UNIQUE。論理削除→同メール再招待と
  # 両立し、email claim の無い OIDC ユーザー（空文字）は対象外にする。
  #
  # 述語は引き続き deleted_at IS NULL（ck_users_status_deleted_at により status <> 'deactivated'
  # と同値）。status 側の式に変えると索引の作り直し（DROP + CREATE、CONCURRENTLY 無し）が
  # 要るため、意味が変わらない以上ここは触らない。
  #
  # 重複データが既にある DB へこの索引を宣言的に適用すると、Atlas は作成に失敗する
  # （かつては DO ブロックで重複を検知し、警告に留めて起動は落とさない実行時分岐を持っていた。
  # 宣言的スキーマでは「重複があれば黙って作らない」という分岐そのものを表現できないため、
  # 適用前に重複を解消しておくことが前提になる。本番の重複は解消済みで、
  # ローカル / CI は毎回まっさらな DB から始まるため、以後どの環境でも重複には当たらない）。
  index "uq_users_email_active" {
    unique  = true
    on {
      expr = "lower(btrim(email, '\t\n\u000b\u000c\r '::text))"
    }
    where = "((deleted_at IS NULL) AND (btrim(email, '\t\n\u000b\u000c\r '::text) <> ''::text))"
  }
}

# users.id を指す列の外部キー方針（段 1）。FK を張らないと任意の users.id を受け付けて
# しまい、存在しないユーザーを指す行が実際に作れてしまう（メンバー追加が任意の users.id
# を受け付ける穴と同根）。全列に FK を張る前提とし、削除時の挙動を 2 通りに分ける:
#   - 持ち物（CASCADE）: ユーザー本人の所有物で、他の誰の記録にもならない列
#     （profiles.user_id / notifications.user_id / ticket_comment_reactions.user_id）。
#     本人の行が消えれば一緒に消えてよい。
#   - 記録（RESTRICT）: 「誰が作った/変更した/担当した」という記録を持つ列。
#     本人の物理削除でページやチケット側が道連れになってはいけないので、
#     記録が 1 件でも残っている users 行の物理削除は DB が拒む
#     （実際の退会は物理削除ではなく匿名化で扱う）。

# OIDC プロバイダ由来のユーザー識別子（発行者の sub を users から分離）。
table "user_oidc_identities" {
  schema = schema.public
  column "id" {
    null = false
    type = bigserial
  }
  column "user_id" {
    null = false
    type = bigint
  }
  column "provider" {
    null    = false
    type    = text
    default = "oidc"
  }
  column "subject" {
    null = false
    type = text
  }
  column "created_at" {
    null = false
    type = timestamptz
  }
  column "updated_at" {
    null = false
    type = timestamptz
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_user_oidc_identities_user" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "uq_user_oidc_user_provider" {
    unique  = true
    columns = [column.user_id, column.provider]
  }
  index "uq_user_oidc_provider_subject" {
    unique  = true
    columns = [column.provider, column.subject]
  }
  check "ck_user_oidc_identities_not_empty" {
    expr = "(provider <> ''::text) AND (subject <> ''::text)"
  }
}

# ワークスペース: テナント境界。ナレッジ（spaces 以下）と、業務データ
# （courses / course_chapters）がどちらもこの表を指す。
table "workspaces" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  # slug は URL に出る短い識別子。テナント内ではなくグローバルに一意。
  column "slug" {
    null = false
    type = character_varying(64)
  }
  column "name" {
    null = false
    type = character_varying(200)
  }
  column "is_active" {
    null    = false
    type    = boolean
    default = true
  }
  # 個人サインアップで自動作成した、その人専用のワークスペース。1 人 1 つ
  # （uq_workspaces_personal_owner）。作った人を物理削除しても中身は消さない
  # （持ち主のいない箱として残り、招かれた他のメンバーはそのまま使い続けられる）。
  column "personal_owner_user_id" {
    null = true
    type = bigint
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_workspaces_personal_owner" {
    columns     = [column.personal_owner_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  # 1 人につき個人ワークスペースは 1 つ。サインアップの再送・並行実行でも 2 つ目が作れない
  # （check-then-act をアプリに書かずに済む。ON CONFLICT の推論先にもなる）。
  index "uq_workspaces_personal_owner" {
    unique = true
    columns = [column.personal_owner_user_id]
    where   = "(personal_owner_user_id IS NOT NULL)"
  }
  unique "uq_workspaces_slug" {
    columns = [column.slug]
  }
  # URL に出る識別子は空文字禁止・長さ上限（アプリ側検証と二重の壁）。
  check "ck_workspaces_slug_len" {
    expr = "(char_length((slug)::text) >= 1) AND (char_length((slug)::text) <= 64)"
  }
}

# workspace_members: ユーザーとワークスペースの所属そのもの（段 2）。1 人が複数の
# ワークスペースに所属できる（個人ワークスペースと会社のワークスペースを両方持つ
# 実態に合わせる）。
#
# status は招待から離脱までのライフサイクルを表す:
#   invited   … 管理者が招いたが、本人はまだ受諾していない（権限はまだ何も届かない）。
#   active    … 実際のメンバー。principals(kind='user') の対応する行がある状態と対で成り立つ
#               （下の対応関係を参照）。
#   suspended … 運営判断で一時的に外した状態（今の usecase はまだ書き込まない。将来の
#               管理操作のための予約）。
#   left      … 離脱・招待の辞退・削除。行は消さずここに残す（いつ誰が居たかの記録）。
#
# # principals との対応関係（procedural invariant。DB の制約では表現しない）
#
# 「status = 'active' の行がある」⟺「principals(kind='user') の対応する行がある」。
# 主体（principals）は**権限を張る宛先**に意味を絞り、作成・削除は必ず workspace_members の
# 状態遷移と同じトランザクションで行う:
#   - 自分でワークスペースを作る／個人ワークスペースの自動作成 → 作成者を active で直接作り、
#     同じトランザクションで principal も作る（招待の手順を踏む理由が無いため）。
#   - 管理者が他人を招く → まず invited の行だけを作る（principal は作らない＝権限はまだ無い）。
#   - 招待された本人が受諾する → invited → active に進め、そこで初めて principal を作る。
#   - 外す／辞退する → active/invited → left に進め、principal があれば削除する
#     （grant も FK の CASCADE でついて消える）。
#
# 招待を「同意なく他人を追加できる穴」にしないための設計（メンバー追加が任意の users.id を
# 受け付ける問題の根本対応）。invited の間は principal が無いので、相手のワークスペースへの
# アクセス権は本人が受諾するまで一切発生しない。
table "workspace_members" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "user_id" {
    null = false
    type = bigint
  }
  column "status" {
    null = false
    type = text
  }
  # invited_by_user_id は招待した人の記録。自分でワークスペースを作った／個人ワークスペースを
  # 自動作成した場合は誰にも招かれていないので NULL。
  column "invited_by_user_id" {
    null = true
    type = bigint
  }
  # joined_at は active になった日時（invited のままなら NULL）。
  column "joined_at" {
    null = true
    type = timestamptz
  }
  # left_at は left になった日時（active/invited のままなら NULL）。
  column "left_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.workspace_id, column.user_id]
  }
  # ワークスペースが消えれば所属の記録も一緒に消えてよい（持ち物。workspaces の削除は
  # DeleteWorkspaceUseCase が配下ごと消す操作で、その一部として扱う）。
  foreign_key "fk_workspace_members_workspace" {
    columns     = [column.workspace_id]
    ref_columns = [table.workspaces.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # 本人自身の所属の記録なので持ち物（CASCADE）。段 1 の方針参照（users テーブル直後のコメント）。
  foreign_key "fk_workspace_members_user" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # invited_by_user_id は「誰が招いたか」という記録なので RESTRICT（段 1 の方針）。
  foreign_key "fk_workspace_members_invited_by" {
    columns     = [column.invited_by_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  check "ck_workspace_members_status" {
    expr = "status = ANY (ARRAY['invited'::text, 'active'::text, 'suspended'::text, 'left'::text])"
  }
}

# 所属・権限の変更履歴（段 6・監査）。「なぜこの人が admin なのか」を後から説明できるように、
# workspace_members / workspace_grants への書き込みと同じトランザクションで 1 行ずつ足す
# （追記のみ、UPDATE / DELETE はしない）。
#
# old_label / new_label は ticket_change_items と同じ設計 — 当時の表示名（役割名・状態名）の
# 写しを持つ。値そのもの（役割・所属状態）を指す別列は持たない。役割名は viewer/editor/admin
# の固定 3 値、所属状態も固定の小さな enum で、後から改名・アーカイブされて意味が変わる
# 「ID が指す先」が無いため、ticket_change_items のように old_value/new_value を separate に
# 持つ必要が無い（ラベルそのものが既に安定した値）。
table "membership_events" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  # target_user_id は「誰の所属・権限が変わったか」。
  column "target_user_id" {
    null = false
    type = bigint
  }
  # actor_user_id は「誰が変えたか」。本人による操作（受諾・辞退・退会）は target と同じ id。
  column "actor_user_id" {
    null = false
    type = bigint
  }
  # action は起きた事実の種類。suspended は段 7 で実装する停止 API 用に先に列挙しておく
  # （ticket_change_items.field と同じ判断 — 値を後から足すたびに CHECK を DROP + ADD
  # し直さない）。
  column "action" {
    null = false
    type = character_varying(32)
  }
  column "old_label" {
    null = true
    type = text
  }
  column "new_label" {
    null = true
    type = text
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  # ワークスペースが消えれば履歴も一緒に消えてよい（DeleteWorkspace は所属者が居ないときだけ
  # 通るので、この時点で意味のある履歴を残す理由が無い）。
  foreign_key "fk_membership_events_workspace" {
    columns     = [column.workspace_id]
    ref_columns = [table.workspaces.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # target / actor はどちらも記録列なので RESTRICT（段 1 の方針。users は退会しても行ごと
  # 消えない＝物理削除されないため、この RESTRICT が実際に書き込みを止める場面は無い）。
  foreign_key "fk_membership_events_target" {
    columns     = [column.target_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  foreign_key "fk_membership_events_actor" {
    columns     = [column.actor_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  index "idx_membership_events_workspace_created" {
    columns = [column.workspace_id, column.created_at]
  }
  check "ck_membership_events_action" {
    expr = "(action)::text = ANY (ARRAY[('member_added'::character varying)::text, ('invited'::character varying)::text, ('invitation_accepted'::character varying)::text, ('invitation_declined'::character varying)::text, ('role_changed'::character varying)::text, ('member_removed'::character varying)::text, ('left'::character varying)::text, ('suspended'::character varying)::text])"
  }
}

# users とは別管理のプロフィール拡張（user_id が PK）。
table "profiles" {
  schema = schema.public
  # 独自の連番は不要（PK は users.id の写し）。bigserial のままだと使われない専用の
  # シーケンスを持ち続けるので、素の bigint に直す（段 1）。
  column "user_id" {
    null = false
    type = bigint
  }
  column "bio" {
    null    = false
    type    = text
    default = ""
  }
  column "avatar_url" {
    null    = false
    type    = text
    default = ""
  }
  # 「一言ステータス」。もとは status_message という単一の自由文だったが、段 14 で
  # 絵文字と失効時刻を持てるよう status_text に改名し、2 列を足した（本人以外への見え方は
  # 「絵文字＋テキストを結合し、失効していれば空にする」— repository 層で解決する。
  # 空文字はどちらも「未設定」を表す。null にしないのは既存の bio / avatar_url と同じ理由）。
  column "status_text" {
    null    = false
    type    = text
    default = ""
  }
  column "status_emoji" {
    null    = false
    type    = text
    default = ""
  }
  column "status_expires_at" {
    null = true
    type = timestamptz
  }
  column "updated_at" {
    null = false
    type = timestamptz
  }
  primary_key {
    columns = [column.user_id]
  }
  # 持ち物: 本人の行が消えれば一緒に消える。
  foreign_key "fk_profiles_user" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
}

# アプリ内通知。
table "notifications" {
  schema = schema.public
  column "id" {
    null = false
    type = bigserial
  }
  column "user_id" {
    null = false
    type = bigint
  }
  column "type" {
    null    = false
    type    = text
    default = ""
  }
  column "title" {
    null    = false
    type    = text
    default = ""
  }
  column "body" {
    null    = false
    type    = text
    default = ""
  }
  column "is_read" {
    null    = false
    type    = boolean
    default = false
  }
  column "created_at" {
    null = false
    type = timestamptz
  }
  primary_key {
    columns = [column.id]
  }
  # 持ち物: 本人の行が消えれば一緒に消える。
  foreign_key "fk_notifications_user" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_notifications_user_id" {
    columns = [column.user_id]
  }
}

# =====================================================================
# ナレッジの骨格（spaces / pages / blocks / page_paths / page_snapshots）
# =====================================================================
#
# 設計の柱は 2 つ:
#
#   (1) 境界越えを DB で塞ぐ。親子の FK は必ず「入れ物」の列を含む複合 FK にし、
#       別のテナント / スペース / ページの行を親にできないようにする。
#       木はそれぞれの入れ物の中で閉じる: ページの木はスペースの中、ブロックの木はページの中。
#       入れ物をまたぐ親子を許すと、入れ物を消したときに ON DELETE CASCADE が
#       別の入れ物に残るはずの行まで道連れにする。
#       そのために参照先へ (workspace_id, …, id) の複合 UNIQUE を張る。id 単独の PK では
#       FK の参照列に複数列を指定できないため、実データ上は冗長でも足場として要る。
#
#   (2) 並び順は分数インデックス（internal/pkg/fracindex）が採番する文字列キー。
#       同じ親の中で position が重複しないことを部分 UNIQUE で守り、既定値は置かない（採番はアプリ側）。

# スペース: ワークスペース内のページの束（部門・プロジェクト単位の入れ物）。
table "spaces" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  # key はワークスペース内で一意な短い識別子（例: "eng"）。
  column "key" {
    null = false
    type = character_varying(64)
  }
  column "name" {
    null = false
    type = character_varying(200)
  }
  # visibility はワークスペース既定の grant が届くか（'workspace'）・届かないか（'private'）。
  # 'private' のスペースにはスペース単位の付与（space_grants）だけが届く。
  # 「プライベートかどうか」を grant の構成から導出しないための明示の印（値の正本は
  # domain.SpaceVisibility）。実効権限の畳み方は変えず、事実の集め方がこの列でふるう。
  column "visibility" {
    null    = false
    type    = character_varying(16)
    default = "workspace"
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  # ワークスペースの物理削除で配下も消える（運用ではアーカイブを使う想定で、物理削除は例外的な操作）。
  foreign_key "fk_spaces_workspace" {
    columns     = [column.workspace_id]
    ref_columns = [table.workspaces.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_spaces_workspace_id" {
    columns = [column.workspace_id]
  }
  unique "uq_spaces_workspace_key" {
    columns = [column.workspace_id, column.key]
  }
  # pages からの複合 FK の参照先。id の PK があるので実データ上は冗長だが、
  # 「テナント越えを FK で塞ぐ」ための足場として要る。
  unique "uq_spaces_workspace_id" {
    columns = [column.workspace_id, column.id]
  }
  check "ck_spaces_key_len" {
    expr = "(char_length((key)::text) >= 1) AND (char_length((key)::text) <= 64)"
  }
  check "ck_spaces_visibility" {
    expr = "(visibility)::text = ANY (ARRAY[('workspace'::character varying)::text, ('private'::character varying)::text])"
  }
}

# ページ: ナレッジの 1 ページ。parent_id の自己参照で木をなす（無限入れ子）。
table "pages" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "space_id" {
    null = false
    type = uuid
  }
  # parent_id が NULL ならスペース直下（ルート）。
  column "parent_id" {
    null = true
    type = uuid
  }
  # position のコレーションは "C"（バイト順）に固定する。
  # 分数インデックスは「文字列の辞書順 = 並び順」が前提で、Go 側はバイト比較で判断する。
  # DB の既定がロケール依存のコレーション（例: en_US.utf8）だと 'a' < 'B' のように並び、
  # ORDER BY position がアプリの認識とずれる。列の定義で最初から揃えておく。
  column "position" {
    null      = false
    type      = text
    collate = "C"
  }
  column "title" {
    null    = false
    type    = character_varying(200)
    default = ""
  }
  # 作成者（users.id）。記録: FK は RESTRICT（下の fk_pages_created_by。段 1）。
  column "created_by_user_id" {
    null = false
    type = bigint
  }
  # archived_at が NULL の行が現役。物理削除ではなくアーカイブで隠す運用のため、
  # position の一意性はアーカイブ済みを除外した部分 UNIQUE で守る（下の index）。
  column "archived_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  # アイコンとカバーは種類が複数ある（絵文字 / アップロードした画像 / 外部 URL）ので構造で持つ。
  # 例: {"type":"emoji","value":"📘"} / {"type":"file","key":"notes/…/cover.png"}
  # NULL は「付けていない」。空オブジェクトは入れない（NULL と {} の二通りを作らない）。
  column "icon" {
    null = true
    type = jsonb
  }
  column "cover" {
    null = true
    type = jsonb
  }
  # 最終編集者。created_by_user_id と同じく記録（下の fk_pages_last_edited_by）。
  # NULL は「作成後まだ誰も本文を保存していない」。本文の保存経路が書く。
  column "last_edited_by_user_id" {
    null = true
    type = bigint
  }
  # visibility はバイラインの公開範囲バッジの元。'public' と 'space' はいまの閲覧可否
  # （grants の解決）を一切変えない — 表示だけが違う。'private' だけが唯一の例外で、
  # 作成者以外は既存の付与（grants・共有リンク含む）を問わず一切見せない
  # （domain.PagePermissionFacts.IsOwner・domain.ResolvePageView 参照。この列が
  # 「打ち消す層を持たない」という grants の原則の外にある、意図した唯一の例外）。
  column "visibility" {
    null    = false
    type    = character_varying(16)
    default = "space"
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_pages_created_by" {
    columns     = [column.created_by_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  foreign_key "fk_pages_last_edited_by" {
    columns     = [column.last_edited_by_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  # ページは「同じワークスペースの space」にしか属せない。
  foreign_key "fk_pages_space" {
    columns     = [column.workspace_id, column.space_id]
    ref_columns = [table.spaces.column.workspace_id, table.spaces.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # 親は「同じワークスペースの、同じスペースの」ページだけ。親の物理削除で子孫も消える。
  # ページの木はスペースの中で閉じる。スペースはページの入れ物であり、木がスペースをまたぐと
  # パンくず（祖先をたどると別スペースに出る）・サブツリー一括取得・スペース単位の権限が
  # すべて破綻するため、space_id まで一致を要求する。workspace だけの一致だと、スペース A の
  # ページがスペース B のページを親に持ててしまい、スペース B を消したときに fk_pages_space の
  # CASCADE で B のページが消え、続けてこちらの CASCADE がスペース A に残るはずの子ページまで
  # 道連れにする。
  #
  # parent_id は NULL 可（ルート）。複合 FK は既定の MATCH SIMPLE なので、参照列に 1 つでも
  # NULL があれば検査自体が行われない ＝ ルートページは素通りする。これは意図どおり:
  # ルートの workspace_id / space_id は fk_pages_space 側で必ず検査されるため、テナント越え・
  # スペース越えの抜け道にはならない。
  #
  # 副作用（意図した挙動）: ページを別スペースへ移すときは、子孫の space_id も同じ文で
  # 更新しないと FK 違反になる。木の一部だけがスペースをまたぐ「中途半端な移動」を DB が防ぐ。
  foreign_key "fk_pages_parent" {
    columns     = [column.workspace_id, column.space_id, column.parent_id]
    ref_columns = [table.pages.column.workspace_id, table.pages.column.space_id, table.pages.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_pages_workspace_id" {
    columns = [column.workspace_id]
  }
  index "idx_pages_space_id" {
    columns = [column.space_id]
  }
  index "idx_pages_parent_id" {
    columns = [column.parent_id]
  }
  # アーカイブ済みの除外・アーカイブ一覧の取得に使う。
  index "idx_pages_archived_at" {
    columns = [column.archived_at]
  }
  # 同じ親の中で position が重複しないこと。アーカイブ済みを除外する
  # （アーカイブは「一覧から隠す」だけで行は残るため、現役の並びだけを守る）。
  index "uq_pages_parent_position" {
    unique  = true
    columns = [column.parent_id, column.position]
    where   = "(archived_at IS NULL)"
  }
  # ルート直下（parent_id IS NULL）は上の索引では守れない。UNIQUE 索引は NULL 同士を
  # 別物として扱うため、parent_id が NULL の行同士は何度でも同じ position を持ててしまう。
  # ルートの並びはスペース単位なので、スペースを軸にした部分 UNIQUE を別に張る。
  index "uq_pages_space_position" {
    unique  = true
    columns = [column.space_id, column.position]
    where   = "((parent_id IS NULL) AND (archived_at IS NULL))"
  }
  # blocks / page_paths からの複合 FK の参照先。space_id を持たないテーブルからページを
  # 参照するには (workspace_id, id) の形が要る（fk_blocks_page / fk_page_paths_page /
  # fk_page_paths_ancestor が使う）。
  unique "uq_pages_workspace_id" {
    columns = [column.workspace_id, column.id]
  }
  # 親ページの FK を「同じスペース」まで絞るための足場。
  unique "uq_pages_workspace_space_id" {
    columns = [column.workspace_id, column.space_id, column.id]
  }
  # 自分自身を親にできない（1 行で閉じた循環を作らせない。多段の循環はアプリ側で検出する）。
  check "ck_pages_parent_not_self" {
    expr = "(parent_id IS NULL) OR (parent_id <> id)"
  }
  # position は空文字だと順序として意味を持たない（fracindex は空文字を返さない）。
  check "ck_pages_position_not_empty" {
    expr = "position <> ''::text"
  }
  # icon / cover は種類ごとの構造を持つオブジェクトに限る。配列や文字列を許すと
  # 応答の型（kbPageIconResponse 等）が「object のはず」という前提で読めなくなる。
  check "ck_pages_icon_object" {
    expr = "(icon IS NULL) OR (jsonb_typeof(icon) = 'object'::text AND icon <> '{}'::jsonb)"
  }
  check "ck_pages_cover_object" {
    expr = "(cover IS NULL) OR (jsonb_typeof(cover) = 'object'::text AND cover <> '{}'::jsonb)"
  }
  check "ck_pages_visibility" {
    expr = "(visibility)::text = ANY (ARRAY[('public'::character varying)::text, ('space'::character varying)::text, ('private'::character varying)::text])"
  }
}

# ブロック: ページ本文を構成する 1 行（段落・見出し・リスト項目・表のセル …）。
# 入れ子（リストや表）は parent_id の自己参照で表す。
table "blocks" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "page_id" {
    null = false
    type = uuid
  }
  # parent_id が NULL ならページ直下（トップレベル）。
  column "parent_id" {
    null = true
    type = uuid
  }
  # pages.position と同じ理由でバイト順に固定する。
  column "position" {
    null      = false
    type      = text
    collate = "C"
  }
  # ProseMirror（tiptap）のノード名。値は domain.BlockType が正。
  column "type" {
    null = false
    type = character_varying(32)
  }
  # ProseMirror の attrs（見出しの level、コードブロックの language など）。
  # 属性が無いノードでも空オブジェクト {} を入れる（NULL と {} の二通りを作らない）。
  column "attrs" {
    null    = false
    type    = jsonb
    default = sql("'{}'::jsonb")
  }
  # 葉ノードのインライン内容（text ノードとマークの配列）。
  # リストや表のような容器ノードは子をブロック行として持つため NULL にする。
  column "inline" {
    null = true
    type = jsonb
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  # ブロックは「同じワークスペースの page」にしか属せない。
  foreign_key "fk_blocks_page" {
    columns     = [column.workspace_id, column.page_id]
    ref_columns = [table.pages.column.workspace_id, table.pages.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # 親は「同じワークスペースの、同じページの」ブロックだけ。ブロックの木は 1 ページの中で
  # 閉じるものなので、page_id まで一致を要求する。workspace だけを一致させると、ページ A の
  # ブロックをページ B のブロックの親にでき、ページ A を消したときに ON DELETE CASCADE が
  # ページ B の本文まで消してしまう。MATCH SIMPLE の扱いは pages と同じで、parent_id が NULL
  # （トップレベル）なら検査されない。その場合の workspace_id / page_id の正しさは
  # fk_blocks_page 側で担保される。
  foreign_key "fk_blocks_parent" {
    columns     = [column.workspace_id, column.page_id, column.parent_id]
    ref_columns = [table.blocks.column.workspace_id, table.blocks.column.page_id, table.blocks.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_blocks_workspace_id" {
    columns = [column.workspace_id]
  }
  index "idx_blocks_page_id" {
    columns = [column.page_id]
  }
  index "idx_blocks_parent_id" {
    columns = [column.parent_id]
  }
  index "uq_blocks_parent_position" {
    unique  = true
    columns = [column.parent_id, column.position]
  }
  # ブロックも同じ理由で、ページ直下（parent_id IS NULL）はページを軸に守る。
  index "uq_blocks_page_position" {
    unique  = true
    columns = [column.page_id, column.position]
    where   = "(parent_id IS NULL)"
  }
  # 親ブロックの FK を「同じページ」まで絞るための足場。
  unique "uq_blocks_workspace_page_id" {
    columns = [column.workspace_id, column.page_id, column.id]
  }
  check "ck_blocks_parent_not_self" {
    expr = "(parent_id IS NULL) OR (parent_id <> id)"
  }
  check "ck_blocks_position_not_empty" {
    expr = "position <> ''::text"
  }
  # attrs は ProseMirror の attrs なので必ず object（属性が無いノードでも {}）。
  check "ck_blocks_attrs_object" {
    expr = "jsonb_typeof(attrs) = 'object'::text"
  }
  # inline は葉ノードの content 配列。容器ノードでは NULL にする。
  check "ck_blocks_inline_array" {
    expr = "(inline IS NULL) OR (jsonb_typeof(inline) = 'array'::text)"
  }
}

# page_paths: ページの祖先関係を平らに持つ派生テーブル（closure table）。
# 自分自身も depth=0 の行として持つ。pages.parent_id の連鎖だけでも木は表せるが、
# パンくず・サブツリー一括取得・移動時の循環検出を再帰クエリなしの 1 回の JOIN で済ませる
# ためにこの索引を別に持つ。正本は pages.parent_id 側。
table "page_paths" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "page_id" {
    null = false
    type = uuid
  }
  column "ancestor_id" {
    null = false
    type = uuid
  }
  # 祖先までの距離。自分自身が 0、親が 1。
  column "depth" {
    null = false
    type = integer
  }
  primary_key {
    columns = [column.page_id, column.ancestor_id]
  }
  # 1 行で「子孫」と「祖先」の 2 ページを組にするため、単独 FK を 2 本張るだけでは
  # 別ワークスペースの 2 ページを組にした行が作れてしまう（両方の FK を通ってしまう）。
  # 行自身の workspace_id を軸にした複合 FK にして、組になる 2 ページが同じワークスペースに
  # 属することを DB 側で保証する。ページが消えたら派生であるこの行も一緒に消す。
  #
  # FK で守るのは「組になる 2 ページが実在し、同じワークスペースに属すること」まで。
  # 「depth が実際の親子の距離と一致するか、祖先の連鎖に抜けや余りが無いか」は複数行にまたがる
  # 不変条件で、宣言的な制約（行ごとの CHECK / FK）では表せない。この表は pages.parent_id から
  # 導ける派生データなので、正本である pages 側の制約で木の形を守り、closure 全体の整合は
  # 行を書く側の責務とする。なお page_paths は常に FK の子側で、この表の行が壊れても他の行を
  # CASCADE で消すことはない（壊れ方が表示の乱れに閉じ、他のデータを失わない）。
  foreign_key "fk_page_paths_page" {
    columns     = [column.workspace_id, column.page_id]
    ref_columns = [table.pages.column.workspace_id, table.pages.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_page_paths_ancestor" {
    columns     = [column.workspace_id, column.ancestor_id]
    ref_columns = [table.pages.column.workspace_id, table.pages.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_page_paths_workspace_id" {
    columns = [column.workspace_id]
  }
  # 祖先からサブツリーを引く経路（PK は (page_id, ancestor_id) なので ancestor_id 単独では効かない）。
  index "idx_page_paths_ancestor_id" {
    columns = [column.ancestor_id]
  }
  # 1 行だけで判定できる不変条件: depth は祖先までの距離なので負にならず、
  # depth=0 の行は自分自身を指す行「だけ」（逆に自己参照の行は必ず depth=0）。
  # パンくずは ORDER BY depth で組み立てるため、ここが崩れると pages.parent_id（正本）は
  # 正しいのに表示だけが壊れ、原因を追いにくい形で顕在化する。
  check "ck_page_paths_depth" {
    expr = "(depth >= 0) AND ((depth = 0) = (page_id = ancestor_id))"
  }
}

# page_views: 人 × ページの「最後に見た日時」を 1 行だけ持つ（開くたびに upsert）。
# 来訪のたびに行を積む・古い行を掃除する、という形は採らない — 行数が「人 × ページ」で
# 頭打ちになり、掃除ジョブそのものが要らなくなる。閲覧数はこの表の行数（= 見たことのある
# 人数。延べ回数ではない）、「最近見たページ」は viewed_at の新しい順で引く。
table "page_views" {
  schema = schema.public
  column "user_id" {
    null = false
    type = bigint
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "page_id" {
    null = false
    type = uuid
  }
  column "viewed_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.user_id, column.page_id]
  }
  # 本人自身の閲覧記録なので持ち物（CASCADE。workspace_members と同じ方針 — 段 1 の
  # 「持ち物は CASCADE・記録は RESTRICT」参照）。
  foreign_key "fk_page_views_user" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # ページが消えれば閲覧記録も一緒に消えてよい（pages から見た派生データ）。
  foreign_key "fk_page_views_page" {
    columns     = [column.workspace_id, column.page_id]
    ref_columns = [table.pages.column.workspace_id, table.pages.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # 閲覧数（= このページを見た人数）を数える経路。
  index "idx_page_views_page_id" {
    columns = [column.page_id]
  }
  # 「自分の最近見たページ」を viewed_at の新しい順に引く経路。
  index "idx_page_views_user_viewed_at" {
    columns = [column.user_id, column.viewed_at]
  }
}

# page_favorites: 人がページに付ける「お気に入り」。付けた・外したは本人の明示操作なので、
# page_views と違い upsert ではなく素直な行の追加・削除で表す。
table "page_favorites" {
  schema = schema.public
  column "user_id" {
    null = false
    type = bigint
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "page_id" {
    null = false
    type = uuid
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.user_id, column.page_id]
  }
  # 本人自身のお気に入りなので持ち物（CASCADE。page_views と同じ方針）。
  foreign_key "fk_page_favorites_user" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # ページが消えればお気に入りも一緒に消えてよい（テナント越えの page_id 指定も防ぐ）。
  foreign_key "fk_page_favorites_page" {
    columns     = [column.workspace_id, column.page_id]
    ref_columns = [table.pages.column.workspace_id, table.pages.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # 「自分のお気に入り一覧」を付けた順の新しい順に引く経路。
  index "idx_page_favorites_user_created_at" {
    columns = [column.user_id, column.created_at]
  }
}

# page_snapshots: ページのブロック行を組み直した ProseMirror ドキュメント（読み取り用のキャッシュ）。
# 表示のたびにブロック行を木に組み直すと 1 ページで数百行の取得と再帰的な組み立てが要るため、
# 編集のたびに 1 つの jsonb へ焼き直して読み出しを 1 行の取得に落とす。
# 正本はあくまで blocks 側で、この行は失っても blocks から再生成できる派生データ。
table "page_snapshots" {
  schema = schema.public
  column "page_id" {
    null = false
    type = uuid
  }
  # tiptap の getJSON() 相当（type='doc' の ProseMirror ドキュメント）。
  column "doc" {
    null = false
    type = jsonb
  }
  # 焼き直した時刻。ブロックの更新時刻より古ければ作り直す判断に使う。
  column "built_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.page_id]
  }
  foreign_key "fk_page_snapshots_page" {
    columns     = [column.page_id]
    ref_columns = [table.pages.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # 壊れた snapshot は読み取りキャッシュとしてそのまま返り、エディタがページを開けなくなるため、
  # tiptap の doc 形式（{"type":"doc",...} の jsonb オブジェクト）であることを入口で保証する。
  check "ck_page_snapshots_doc" {
    expr = "(jsonb_typeof(doc) = 'object'::text) AND ((doc ->> 'type'::text) = 'doc'::text)"
  }
}

# comment_threads: ページ（または特定のブロック）に付いたコメントのスレッド。
# block_id / anchor_from / anchor_to / quote は錨付きコメント（特定のブロックへのコメント）
# のときだけ値を持ち、ページ全体へのコメントでは常に NULL のまま作られる。
table "comment_threads" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "page_id" {
    null = false
    type = uuid
  }
  # 単独 FK（block_id だけを参照列にする）。もし workspace_id/page_id も含めた複合 FK に
  # すると、ON DELETE SET NULL が発火したとき workspace_id/page_id まで NULL になってしまう
  # （このスレッドがどのページのものか分からなくなる）。block_id が「本当に同じページの
  # ブロックか」はこの FK だけでは保証されない（アプリ側で検証する）。ページ全体への
  # コメントでは block_id は常に NULL。
  column "block_id" {
    null = true
    type = uuid
  }
  # 文字範囲での錨付け。両方あるか両方無いかを CHECK で縛る。
  column "anchor_from" {
    null = true
    type = int
  }
  column "anchor_to" {
    null = true
    type = int
  }
  # 錨付けした時点の引用文。ブロックが消えて block_id が NULL に落ちても quote だけは残す。
  column "quote" {
    null = true
    type = text
  }
  # 解決済みなら resolved_at/resolved_by_user_id の両方が入る（両方あるか両方無いかを CHECK）。
  column "resolved_at" {
    null = true
    type = timestamptz
  }
  column "resolved_by_user_id" {
    null = true
    type = bigint
  }
  # pages.created_by_user_id と同じく記録。
  column "created_by_user_id" {
    null = false
    type = bigint
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_comment_threads_page" {
    columns     = [column.workspace_id, column.page_id]
    ref_columns = [table.pages.column.workspace_id, table.pages.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_comment_threads_block" {
    columns     = [column.block_id]
    ref_columns = [table.blocks.column.id]
    on_update   = NO_ACTION
    on_delete   = SET_NULL
  }
  foreign_key "fk_comment_threads_created_by" {
    columns     = [column.created_by_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  foreign_key "fk_comment_threads_resolved_by" {
    columns     = [column.resolved_by_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  index "idx_comment_threads_page" {
    columns = [column.workspace_id, column.page_id]
  }
  index "idx_comment_threads_block" {
    columns = [column.block_id]
  }
  check "ck_comment_threads_anchor_pair" {
    expr = "(anchor_from IS NULL) = (anchor_to IS NULL)"
  }
  check "ck_comment_threads_resolved_pair" {
    expr = "(resolved_at IS NULL) = (resolved_by_user_id IS NULL)"
  }
}

# page_versions: ページ本文（doc）の明示的なスナップショット履歴。
# page_snapshots が「1 ページ 1 行の読み取りキャッシュ（正本は blocks）」なのに対し、
# こちらは「複数行が積み上がる履歴」。本文保存のたびに毎回 1 行増やすのではなく、直近の版から
# 10 分以上経っている場合だけ新しい版を切る（間引き。usecase/repository/page_version.go の
# CreateVersionIfDue のコメント参照）。「版を残す」操作と復元は間引きを無視して必ず 1 行増やす。
# 30 日より古い版は新しい版を作るのと同じトランザクションで掃除する（同ファイル参照）。
#
# PK をあえて id ではなく複合 (page_id, seq) にする。一覧は「そのページの seq 降順」しか
# 引かないため、PK のインデックス（(page_id, seq) の btree）だけで素引きできる
# （id 単独の PK だと (page_id, seq) 用の別インデックスをもう 1 本持つ必要がある）。
table "page_versions" {
  schema = schema.public
  # テナント境界の複合 FK（fk_page_versions_page）用。単体の WHERE には使わない
  # （版の検索は常に page_id とセットで行い、workspace_id だけで絞る使い方が無いため）。
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "page_id" {
    null = false
    type = uuid
  }
  # そのページの中での通し番号（1 始まり）。採番は Go 側（CreateVersionIfDue）が
  # 直近の最大値 + 1 で行う。同時書き込みは pages 行の SELECT ... FOR UPDATE で直列化するため、
  # ここに単独の UNIQUE 制約が無くても PK の複合キーで衝突は原理的に起きない
  # （usecase/repository/page_version.go のコメント参照）。
  column "seq" {
    null = false
    type = bigint
  }
  # tiptap の getJSON() そのまま。page_snapshots.doc と同じ形・同じ CHECK（下の
  # ck_page_versions_doc）。
  column "doc" {
    null = false
    type = jsonb
  }
  # 記録: FK は RESTRICT（下の fk_page_versions_author。段 1）。
  column "author_user_id" {
    null = false
    type = bigint
  }
  # 版に添える任意のメモ。空文字・空白のみは保存しない（domain.ValidateVersionNote が
  # nil へ正規化してから渡す）。
  column "note" {
    null = true
    type = text
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.page_id, column.seq]
  }
  # comment_threads.fk_comment_threads_page と全く同じ書き方（複合 FK でテナント越えを塞ぐ。
  # pages.uq_pages_workspace_id が参照先として要る）。
  foreign_key "fk_page_versions_page" {
    columns     = [column.workspace_id, column.page_id]
    ref_columns = [table.pages.column.workspace_id, table.pages.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_page_versions_author" {
    columns     = [column.author_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  # page_snapshots.ck_page_snapshots_doc と同じ式（tiptap の doc 形式であることを入口で保証する）。
  check "ck_page_versions_doc" {
    expr = "(jsonb_typeof(doc) = 'object'::text) AND ((doc ->> 'type'::text) = 'doc'::text)"
  }
}

# page_search: ページ本文検索のための派生キャッシュ（本文検索と逆リンク）。
# 1 ページ 1 行で、保存のたびに ReplacePageBlocks の最終ステップとして張り替える
# （page_snapshots と同じ立て付け。UpsertPageSnapshot の直後に続けて UPSERT する）。
# 正本はあくまで pages.title / blocks の本文で、この行は失っても
# knowledgeBaseRepository.RebuildPageSearchAndLinks で blocks から作り直せる。
#
# title は pages.title の写し（保存のたびに同期する）。body は全ブロックの素テキストを
# 連結したもの（pageRef ノードは寄与しない — text 型インラインノードの .text だけを
# 繋げる。抽出は usecase/kb/page_usecase.go の extractPageSearchAndLinks を参照）。
#
# pg_trgm の GIN トライグラム索引を title / body に張る（ファイル冒頭の
# 「pg_trgm 拡張について」参照）。ILIKE '%needle%' の高速化用の索引で、あいまい検索
# （word_similarity）はクエリ側で別途行う。
table "page_search" {
  schema = schema.public
  column "page_id" {
    null = false
    type = uuid
  }
  # テナント境界の複合 FK（fk_page_search_page）用。
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "title" {
    null = false
    type = text
  }
  column "body" {
    null = false
    type = text
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.page_id]
  }
  # comment_threads.fk_comment_threads_page と全く同じ書き方（複合 FK でテナント越えを塞ぐ。
  # pages.uq_pages_workspace_id が参照先として要る）。
  foreign_key "fk_page_search_page" {
    columns     = [column.workspace_id, column.page_id]
    ref_columns = [table.pages.column.workspace_id, table.pages.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_page_search_title_trgm" {
    type = GIN
    on {
      column = column.title
      ops    = gin_trgm_ops
    }
  }
  index "idx_page_search_body_trgm" {
    type = GIN
    on {
      column = column.body
      ops    = gin_trgm_ops
    }
  }
}

# page_links: 本文中の pageRef（ページ内リンク）ノードの抽出結果。
# 「このページを参照しているページ」（逆リンク）を求めるための派生データ。正本は blocks の
# 本文（pageRef ノード）で、この表も失えば RebuildPageSearchAndLinks で作り直せる。
#
# 主キーを (source_block_id, target_page_id) にするのは、同じブロックが同じページを
# 複数回参照しても 1 行に畳むため（本文中に同じ pageRef を 2 回貼っても逆リンクの一覧では
# 1 件として数えたい）。
#
# **workspace_id 列は持たない。** 逆リンクのテナント・可視判定は source_block_id → blocks →
# pages の JOIN で行う（persistence の ListPageLinkSourcePageViewFacts 参照）。このテーブル
# 単独の FK では、テナントを跨いだ target_page_id の参照そのものは防がない —
# これは意図した設計判断: pageRef 自体が本文の保存時にテナントを跨いだ参照を禁じていない
# （StripPageRefTitles / pageRefCollector の doc 参照。参照先の実在確認はするが、
# ワークスペースの一致までは見ない）ため、それに揃えている。書き込み時にテナントを
# 確認しない代わり、読み取り時（逆リンク一覧 API）に既存の権限解決を必ず通すことで
# 「見えないページの存在を漏らさない」を担保する。
table "page_links" {
  schema = schema.public
  column "source_block_id" {
    null = false
    type = uuid
  }
  column "target_page_id" {
    null = false
    type = uuid
  }
  primary_key {
    columns = [column.source_block_id, column.target_page_id]
  }
  # 単独 FK（comment_threads.block_id と同じ理由）。ブロックが消えたら、そのブロックが
  # 持っていたページ内リンクも消えてよい。
  foreign_key "fk_page_links_source_block" {
    columns     = [column.source_block_id]
    ref_columns = [table.blocks.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # 参照先ページが消えたらリンクも消える。
  foreign_key "fk_page_links_target_page" {
    columns     = [column.target_page_id]
    ref_columns = [table.pages.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # 逆リンク一覧（target_page_id からの検索）用の索引。主キーは (source_block_id,
  # target_page_id) なので target_page_id 単独では効かない。
  index "idx_page_links_target_page_id" {
    columns = [column.target_page_id]
  }
}

# page_templates: ページの雛形（「雛形として保存」「雛形から作る」の元になる本文）。
# workspace 全体、または特定の space に限定して置ける。page_snapshots / page_search /
# page_links と違い、blocks から再構築できる派生データではない — この表自身が正本。
#
# space_id が NULL ならワークスペース全体で見える雛形、値があればそのスペース限定。
# 複合 FK (workspace_id, space_id) は space_id が NULL の行には効かない
# （PostgreSQL の MATCH SIMPLE の既定動作 — 複合 FK の列のどれか 1 つでも NULL なら
# 制約そのものが素通りする）。これは意図した挙動で、スペース側の存在確認は
# space_id が非 NULL のときだけ効けばよいというこの表の要件とちょうど一致する。
table "page_templates" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "space_id" {
    null = true
    type = uuid
  }
  column "name" {
    null = false
    type = text
  }
  # domain.PageIcon と同じ形（例: {"type":"emoji","value":"📘"}）。未設定は NULL。
  column "icon" {
    null = true
    type = jsonb
  }
  # tiptap の getJSON() 相当。page_snapshots.doc と同じ形・同じ CHECK 式
  # （ck_page_snapshots_doc）を流用する（下の ck_page_templates_doc）。
  column "doc" {
    null = false
    type = jsonb
  }
  # 記録: FK は RESTRICT（下の fk_page_templates_created_by。段 1）。
  column "created_by_user_id" {
    null = false
    type = bigint
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_page_templates_workspace" {
    columns     = [column.workspace_id]
    ref_columns = [table.workspaces.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # spaces.uq_spaces_workspace_id が参照先として要る（テナント越えの space_id 指定を防ぐ）。
  # space_id が NULL の行はこの複合 FK の対象にならない（このテーブルの doc コメント参照）。
  foreign_key "fk_page_templates_space" {
    columns     = [column.workspace_id, column.space_id]
    ref_columns = [table.spaces.column.workspace_id, table.spaces.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_page_templates_created_by" {
    columns     = [column.created_by_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  index "idx_page_templates_workspace_id" {
    columns = [column.workspace_id]
  }
  # 名前はスペースの有無に関わらずワークスペース内で一意（space_id はこの制約に含めない —
  # チームスペース向けとワークスペース全体向けで同じ名前を許すと、一覧でどちらか
  # 区別が付かなくなるため）。
  unique "uq_page_templates_workspace_name" {
    columns = [column.workspace_id, column.name]
  }
  check "ck_page_templates_icon" {
    expr = "(icon IS NULL) OR (jsonb_typeof(icon) = 'object'::text)"
  }
  # page_snapshots.ck_page_snapshots_doc と同じ式（tiptap の doc 形式であることを入口で保証する）。
  check "ck_page_templates_doc" {
    expr = "(jsonb_typeof(doc) = 'object'::text) AND ((doc ->> 'type'::text) = 'doc'::text)"
  }
}

# page_suggestions: commenter（閲覧+コメントはできるが編集はできない役割）が本文を書き換えると、
# blocks を直接更新する代わりにここへ 1 行積む。editor 以上が採用すれば通常の保存経路
# （ReplacePageBlocksUseCase）を通って本文へ反映され、却下すれば何も変えずにこの行だけ閉じる。
#
# 差分は表示のときに base_seq が指す page_versions.doc と比べて出す（差分形式そのものは
# ここに持ち込まない — doc は「提案後の本文全体」を丸ごと持つ）。
#
# base_seq は提案した時点のそのページの最新版（無ければ NULL — まだ 1 度も版が無いページへの
# 提案）。FK を NO_ACTION にしてあるのは、30 日掃除（DeleteOldPageVersions）がこの版を
# 消せてしまうと提案の差分が表示できなくなるため。掃除側はこの表の open な行が参照している
# 版を対象から外す（queries/page_version.sql の DeleteOldPageVersions 参照）。
table "page_suggestions" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  # テナント境界の複合 FK（fk_page_suggestions_page）用。page_versions と同じ役割分担。
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "page_id" {
    null = false
    type = uuid
  }
  # 提案した時点のそのページの最新版（page_versions.seq）。NULL は「まだ版が 1 つも無い
  # ページへの提案」を表す（複合 FK は列のどちらかが NULL なら不問になる — page_templates の
  # space_id と同じ理屈）。
  column "base_seq" {
    null = true
    type = bigint
  }
  # 提案後の ProseMirror ドキュメント全体。page_versions.doc と同じ形・同じ CHECK 式
  # （下の ck_page_suggestions_doc）。
  column "doc" {
    null = false
    type = jsonb
  }
  column "status" {
    null    = false
    type    = text
    default = "open"
  }
  # 記録: FK は RESTRICT（下の fk_page_suggestions_author。段 1）。
  column "author_user_id" {
    null = false
    type = bigint
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  # 採用・却下されるまでは両方 NULL（両方あるか両方無いかは CHECK では縛らない —
  # status='open' のあいだは repository.Resolve が条件付き UPDATE で両方を同時に埋める
  # 唯一の書き込み経路なので、アプリ側の不変条件で足りる）。
  column "resolved_at" {
    null = true
    type = timestamptz
  }
  # 記録: FK は RESTRICT（下の fk_page_suggestions_resolved_by。段 1）。
  column "resolved_by_user_id" {
    null = true
    type = bigint
  }
  primary_key {
    columns = [column.id]
  }
  # comment_threads.fk_comment_threads_page と同じ書き方（複合 FK でテナント越えを塞ぐ）。
  foreign_key "fk_page_suggestions_page" {
    columns     = [column.workspace_id, column.page_id]
    ref_columns = [table.pages.column.workspace_id, table.pages.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # page_versions の PK が複合 (page_id, seq) なので、この 2 列で参照する。NO_ACTION —
  # このテーブルの doc コメント参照（30 日掃除が参照中の版を消せないようにするのは
  # アプリ側 = DeleteOldPageVersions の EXISTS 除外であって、この FK 自体は掃除を妨げない。
  # 掃除側の除外を書き忘れたときに初めて FK 違反として表面化する最後の網）。
  foreign_key "fk_page_suggestions_base_version" {
    columns     = [column.page_id, column.base_seq]
    ref_columns = [table.page_versions.column.page_id, table.page_versions.column.seq]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  foreign_key "fk_page_suggestions_author" {
    columns     = [column.author_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  foreign_key "fk_page_suggestions_resolved_by" {
    columns     = [column.resolved_by_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  index "idx_page_suggestions_page" {
    columns = [column.workspace_id, column.page_id]
  }
  # DeleteOldPageVersions が毎回の本文保存のたびに引く correlated EXISTS
  # （page_suggestions.page_id = page_versions.page_id AND base_seq = seq AND status = 'open'）
  # のための索引。open な行だけに絞った部分索引にして、解決済みの行を無駄に載せない。
  index "idx_page_suggestions_open_base_seq" {
    columns = [column.page_id, column.base_seq]
    where   = "(status = 'open'::text)"
  }
  check "ck_page_suggestions_doc" {
    expr = "(jsonb_typeof(doc) = 'object'::text) AND ((doc ->> 'type'::text) = 'doc'::text)"
  }
  check "ck_page_suggestions_status" {
    expr = "status = ANY (ARRAY['open'::text, 'accepted'::text, 'rejected'::text])"
  }
  # comment_threads.ck_comment_threads_resolved_pair と同じ発想だが、こちらは status 列を
  # 持つのでその値まで縛る。resolved_at/resolved_by_user_id の唯一の書き込み経路
  # （ResolvePageSuggestion）が常に3つを同時に更新するので実害は無い想定だが、将来別の経路が
  # 増えたときに壊れた状態を作らせない最後の網。
  check "ck_page_suggestions_resolution_consistency" {
    expr = "(status = 'open'::text AND resolved_at IS NULL AND resolved_by_user_id IS NULL) OR (status <> 'open'::text AND resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL)"
  }
}

# comments: スレッドに付いた 1 件の発言（スレッドを開いた最初の発言も返信も同じ形で持つ）。
table "comments" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "thread_id" {
    null = false
    type = uuid
  }
  # 記録: FK は RESTRICT（下の fk_comments_author。段 1）。
  column "author_user_id" {
    null = false
    type = bigint
  }
  # blocks.inline と同じ形（ProseMirror インラインノードの配列）。段落 1 つぶんの本文。
  column "body" {
    null = false
    type = jsonb
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  # スレッドが消えれば返信も消える（スレッド削除 API はこの PR には無いが、将来の
  # 管理操作・掃除のための安全網として付けておく）。
  foreign_key "fk_comments_thread" {
    columns     = [column.thread_id]
    ref_columns = [table.comment_threads.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_comments_author" {
    columns     = [column.author_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  index "idx_comments_thread" {
    columns = [column.thread_id]
  }
  check "ck_comments_body_array" {
    expr = "jsonb_typeof(body) = 'array'::text"
  }
}

# =====================================================================
# ナレッジの権限（principals / grants / share_links）
# =====================================================================
#
# 設計の柱（骨格の 2 つに加えて）:
#
#   (3) 主体（principal）を 1 つの表に集める。ユーザー・グループ・スペース全員・公開リンクは
#       「権限を与える相手」という点で同じなので、grant 側から見て 1 本の FK で済む。
#       主体ごとに表を分けると grant が主体の種類だけ列（または表）を持つことになり、
#       権限を解く SQL が主体の種類だけ分岐する。
#
#   (4) 種類（kind）によって使う列が変わるので、CHECK で「その kind のときだけ非 NULL」を強制する。
#       任意の key/value に逃がす（EAV）ことはしない。列は意味を持ったまま、
#       「いつ埋まるか」だけを制約で表す。
#
#   (5) 権限は付与（grants）だけで表し、打ち消す層は持たない。
#       入れ物の階層に合わせて 3 段（workspace_grants / space_grants / page_grants）を置き、
#       届いた中で最も強い役割を採る。下の段が上の段を弱めることはない。
#
#       全ページへ ACL を展開する方式は解決が 1 行の取得で済む代わりに、ページを 1 回動かす /
#       メンバーを 1 人足すだけで数万行を書き換える。ページ移動が日常の道具である以上、
#       書き込み側の代償が大きすぎる。付与はごく少数のページにしか付かない性質を使い、
#       行を持つのは付与された段だけにして、解決は page_paths（closure）を 1 回 JOIN するだけで
#       済ませる。

# principals: 権限を与える相手（主体）。
#
# 段 2 以降、所属そのものの正本は workspace_members（招待・受諾・離脱のライフサイクルを
# 持つ）。この表（kind='user' の行）は「権限を張る宛先」に意味を絞り、workspace_members が
# status='active' になった行とだけ対で存在する（workspace_members のコメントにある procedural
# invariant を参照。principal はあるが active な所属が無い / active な所属はあるが principal が
# 無い、という 2 通りのずれを作らないよう、作成・削除は必ず workspace_members の状態遷移と
# 同じトランザクションで行うこと）。
#
# 「未所属」は行が無いことで表す。専用の値（0 や空文字）は置かない。既存の users.company_id が
# NULL と 0 の 2 通りで未所属を表していて層をまたいで混在していた轍を踏まないため。
table "principals" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  # kind の値は domain.PrincipalKind が正（user / group / space_all / share_link）。
  column "kind" {
    null = false
    type = character_varying(16)
  }
  # user_id は kind='user' のときだけ埋まる（既存 users への参照）。
  column "user_id" {
    null = true
    type = bigint
  }
  # space_id は kind='space_all'（そのスペースの全員）のときだけ埋まる。
  column "space_id" {
    null = true
    type = uuid
  }
  # page_id は kind='share_link'（公開リンクの来訪者）のときだけ埋まる。そのリンクの対象ページ。
  # 主体を「それが意味を持つ入れ物」に必ず結び付けるためで、こうするとページを物理削除したときに
  # 主体もリンクも CASCADE で一緒に消える。逆向き（share_links → principals）の FK だけでは、
  # ページを消してもリンクの行だけが消えて主体が残り、誰も指さない行が溜まる。
  column "page_id" {
    null = true
    type = uuid
  }
  # name は kind='group' の表示名。ほかの kind は名前を持たない
  # （ユーザー名は users、スペース名は spaces が正本。ここへ写すと二重管理になる）。
  column "name" {
    null    = false
    type    = character_varying(200)
    default = ""
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_principals_workspace" {
    columns     = [column.workspace_id]
    ref_columns = [table.workspaces.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # users への FK は張る（持ち物。principals はナレッジとアプリのユーザーを結ぶ唯一の接点で、
  # ここが緩いと「消えたユーザーの principal に権限が残る」＝ 別人が同じ id を再取得したときに
  # 権限を引き継いでしまう）。
  foreign_key "fk_principals_user" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # スペース全員の主体は「同じワークスペースの space」にしか結び付かない。
  foreign_key "fk_principals_space" {
    columns     = [column.workspace_id, column.space_id]
    ref_columns = [table.spaces.column.workspace_id, table.spaces.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # 公開リンクの主体は「同じワークスペースの page」にしか結び付かない。
  foreign_key "fk_principals_page" {
    columns     = [column.workspace_id, column.page_id]
    ref_columns = [table.pages.column.workspace_id, table.pages.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_principals_workspace_id" {
    columns = [column.workspace_id]
  }
  index "idx_principals_user_id" {
    columns = [column.user_id]
  }
  index "idx_principals_space_id" {
    columns = [column.space_id]
  }
  index "idx_principals_page_id" {
    columns = [column.page_id]
  }
  # 1 ユーザー 1 ワークスペースにつき主体は 1 つ（重複メンバーを作らない）。
  index "uq_principals_workspace_user" {
    unique  = true
    columns = [column.workspace_id, column.user_id]
    where   = "((kind)::text = 'user'::text)"
  }
  # 1 スペースにつき「全員」の主体は 1 つ。
  index "uq_principals_space_all" {
    unique  = true
    columns = [column.workspace_id, column.space_id]
    where   = "((kind)::text = 'space_all'::text)"
  }
  # グループ名はワークスペース内で一意（同名グループが 2 つあると権限を張る先を人が選べない）。
  index "uq_principals_group_name" {
    unique  = true
    columns = [column.workspace_id, column.name]
    where   = "((kind)::text = 'group'::text)"
  }
  # grant / share_link からの複合 FK の参照先。id の PK があるので実データ上は
  # 冗長だが、「別ワークスペースの principal に権限を張れない」を FK で塞ぐ足場として要る。
  unique "uq_principals_workspace_id" {
    columns = [column.workspace_id, column.id]
  }
  # kind まで含めた足場。参照側が「この列は group の principal でなければならない」を
  # FK で言えるようにする（principal_members / share_links が使う）。
  unique "uq_principals_workspace_kind_id" {
    columns = [column.workspace_id, column.kind, column.id]
  }
  # share_links からの複合 FK の参照先。リンクが持つ page_id と、その主体が持つ page_id が
  # 必ず同じページを指すことを FK で言えるようにする（2 か所に同じ値を持つ以上、
  # 食い違わないことは制約で担保する）。
  unique "uq_principals_workspace_kind_page_id" {
    columns = [column.workspace_id, column.kind, column.page_id, column.id]
  }
  check "ck_principals_kind" {
    expr = "(kind)::text = ANY (ARRAY[('user'::character varying)::text, ('group'::character varying)::text, ('space_all'::character varying)::text, ('share_link'::character varying)::text])"
  }
  # 使う列は kind で決まる。「その kind のときだけ非 NULL」を等式で書き、
  # 片方向（NOT NULL なのに kind が違う）も同時に塞ぐ。
  check "ck_principals_user_id" {
    expr = "((kind)::text = 'user'::text) = (user_id IS NOT NULL)"
  }
  check "ck_principals_space_id" {
    expr = "((kind)::text = 'space_all'::text) = (space_id IS NOT NULL)"
  }
  check "ck_principals_page_id" {
    expr = "((kind)::text = 'share_link'::text) = (page_id IS NOT NULL)"
  }
  check "ck_principals_name" {
    expr = "((kind)::text = 'group'::text) = (name <> ''::character varying)"
  }
}

# principal_members: グループの所属（group principal ↔ member principal）。
#
# グループの入れ子は許さない。member 側を kind='user' に固定することで、
# 「あるユーザーの主体の集合」を再帰なしの 1 回の UNION で出せる
# （入れ子を許すと権限解決に再帰 CTE が要るうえ、グループ同士の循環を防ぐ手当ても要る）。
#
# kind の固定は生成列（GENERATED ALWAYS AS ... STORED）で行う。定数なので INSERT / UPDATE から
# 値を渡せず、書き手が間違えようがない。CHECK 付きの普通の列にすると「書けるが必ず同じ値」に
# なり、実質使われない列を 2 つ抱えることになる。ここは足場であって属性ではない。
#
# これが無いと、たとえば member_principal_id に他人のユーザー主体ではなくグループ主体を
# 入れることでグループを入れ子にでき、解決 SQL（1 段しか辿らない）が黙って権限を取りこぼす。
# 「取りこぼす」＝ 見えるはずのページが見えないだけなので、権限の穴ではないが原因を追いにくい。
table "principal_members" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "group_principal_id" {
    null = false
    type = uuid
  }
  column "member_principal_id" {
    null = false
    type = uuid
  }
  # FK の足場（定数の生成列）。テーブルの属性ではない。
  column "group_kind" {
    null = true
    type = character_varying(16)
    as {
      expr = "'group'::character varying"
      type = STORED
    }
  }
  column "member_kind" {
    null = true
    type = character_varying(16)
    as {
      expr = "'user'::character varying"
      type = STORED
    }
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.group_principal_id, column.member_principal_id]
  }
  foreign_key "fk_principal_members_group" {
    columns     = [column.workspace_id, column.group_kind, column.group_principal_id]
    ref_columns = [table.principals.column.workspace_id, table.principals.column.kind, table.principals.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_principal_members_member" {
    columns     = [column.workspace_id, column.member_kind, column.member_principal_id]
    ref_columns = [table.principals.column.workspace_id, table.principals.column.kind, table.principals.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # 「このユーザーが属するグループ」を引く経路（PK は group 側が先頭なので member 単独では効かない）。
  index "idx_principal_members_member" {
    columns = [column.workspace_id, column.member_principal_id]
  }
}

# workspace_grants: ワークスペース全体での既定の役割。配下の全スペースに効く。
#
# スペース単位の grant だけでは「テナント全体の管理者」を表すのにスペースの数だけ grant を
# 張って回ることになり、スペースが増えるたびに漏れる。入れ物の階層が workspace ⊃ space である
# 以上、既定も同じ 2 段で持つ。
#
# scope_type / scope_id を持つ 1 枚の汎用 grants 表にまとめる案は採らない。scope_id が
# workspaces と spaces の 2 つの表を指すことになり、FK で参照先の実在もテナントの一致も
# 守れなくなる。このスキーマは一貫して「境界を FK で塞ぐ」ことを優先しており、
# 表が 1 枚増える代わりに両方とも複合 FK で守れる形を選ぶ。
#
# workspaces への直接の FK は張らない。principals への複合 FK が (workspace_id, principal_id) で
# 実在する principal との一致を要求し、その principal 自身が workspaces へ FK を持つため、
# ワークスペースの実在も削除時の CASCADE も推移的に効く。
table "workspace_grants" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "principal_id" {
    null = false
    type = uuid
  }
  # "role" の値は domain.GrantRole が正（admin / editor / commenter / viewer）。
  column "role" {
    null = false
    type = character_varying(16)
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.workspace_id, column.principal_id]
  }
  foreign_key "fk_workspace_grants_principal" {
    columns     = [column.workspace_id, column.principal_id]
    ref_columns = [table.principals.column.workspace_id, table.principals.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  check "ck_workspace_grants_role" {
    expr = "(role)::text = ANY (ARRAY[('admin'::character varying)::text, ('editor'::character varying)::text, ('commenter'::character varying)::text, ('viewer'::character varying)::text])"
  }
}

# space_grants: そのスペースでの既定の役割。ページに例外が無いときは、これと workspace_grants の
# うち強い方が実効権限になる（domain.GrantRole.Rank 参照。弱い方を採る規則にすると
# スペースを 1 つ作って viewer を張るだけでワークスペース管理者を締め出せてしまう）。
#
# 1 つの principal がひとつのスペースで持つ役割は 1 つなので、代理キーを置かず自然キーを PK にする
# （代理キーを置くと「同じ principal に viewer と editor の 2 行」が作れてしまい、
# どちらが正かをアプリで決める羽目になる）。
table "space_grants" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "space_id" {
    null = false
    type = uuid
  }
  column "principal_id" {
    null = false
    type = uuid
  }
  column "role" {
    null = false
    type = character_varying(16)
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.workspace_id, column.space_id, column.principal_id]
  }
  foreign_key "fk_space_grants_space" {
    columns     = [column.workspace_id, column.space_id]
    ref_columns = [table.spaces.column.workspace_id, table.spaces.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # workspace_id を含めることで「別ワークスペースの principal への grant」を DB が弾く。
  # principal_id 単独の FK だと、行の workspace_id と principal の workspace_id が
  # 食い違っていても両方の FK を通ってしまう（テナント越えの権限昇格になる）。
  foreign_key "fk_space_grants_principal" {
    columns     = [column.workspace_id, column.principal_id]
    ref_columns = [table.principals.column.workspace_id, table.principals.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # 「この principal の grant」を引く経路（PK は入れ物側が先頭）。principal を消すときの
  # CASCADE 走査にも効く。
  index "idx_space_grants_principal" {
    columns = [column.workspace_id, column.principal_id]
  }
  check "ck_space_grants_role" {
    expr = "(role)::text = ANY (ARRAY[('admin'::character varying)::text, ('editor'::character varying)::text, ('commenter'::character varying)::text, ('viewer'::character varying)::text])"
  }
}

# page_grants: そのページ以下での既定の役割。workspace_grants / space_grants に続く 3 段目で、
# 意味も合成の仕方も上の 2 つと同じ（配下へ降りる・最も強いものを採る）。
#
# これが要るのは「この人にこのページだけ編集を渡す」を書くため。
#
# 経路は page_paths を辿る。祖先のページに editor を張れば、その子孫は既定が editor 以上に
# なる（親に渡したら配下も編集できる、という素直な形）。
#
# **弱める手段はこの層にも、どの層にも無い。** 権限は 3 段の付与を足し合わせて
# 「届いた中で最も強いもの」で決まり、下の段が上の段を打ち消すことはない。
# 「親は共有、この子だけ隠す」は書けない — 狭めたい内容は private のスペースへ置く。
table "page_grants" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "page_id" {
    null = false
    type = uuid
  }
  column "principal_id" {
    null = false
    type = uuid
  }
  column "role" {
    null = false
    type = character_varying(16)
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.workspace_id, column.page_id, column.principal_id]
  }
  foreign_key "fk_page_grants_page" {
    columns     = [column.workspace_id, column.page_id]
    ref_columns = [table.pages.column.workspace_id, table.pages.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # space_grants と同じ理由で workspace_id を含む複合 FK にする（別テナントの principal へ
  # 付与できてしまうと、そのままテナント越えの権限昇格になる）。
  foreign_key "fk_page_grants_principal" {
    columns     = [column.workspace_id, column.principal_id]
    ref_columns = [table.principals.column.workspace_id, table.principals.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # 経路をさかのぼって「祖先に張られた付与」を引く向きの索引。主キーは (workspace_id, page_id,
  # principal_id) なので page_id 先頭では principal から引けない。
  index "idx_page_grants_principal" {
    columns = [column.workspace_id, column.principal_id]
  }
  check "ck_page_grants_role" {
    expr = "(role)::text = ANY (ARRAY[('admin'::character varying)::text, ('editor'::character varying)::text, ('commenter'::character varying)::text, ('viewer'::character varying)::text])"
  }
}

# share_links: ログイン不要の公開 URL。
#
# 来訪者は kind='share_link' の principal として扱う。主体の種類を 1 本に揃えておくと、
# 権限解決の入口が主体ごとに分岐しない。
#
# ただし既定（そのリンクで何ができるか）は grants ではなくこの表の capability で決める。
# リンクの来訪者はワークスペースに所属しないので、付与の 3 段はそもそも届かない。
#
# **共有リンクは広げる方向にしか働かない。** ログインしていない相手へ「見せる」を足すだけで、
# すでに見えている人から取り上げることはない。
#
# token は平文で持たない。DB が漏れた時点で全リンクが開けるのを避けるため、SHA-256 の
# ダイジェストだけを保存して照合はハッシュ同士で行う（トークンは十分な長さの乱数なので
# 総当たりに強く、bcrypt のような遅いハッシュは要らない）。パスワードは人が選ぶ値なので
# 逆に総当たりに弱く、こちらは bcrypt で持つ。
table "share_links" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  # page_id はリンクの対象ページ。このページとその子孫が対象になる。
  column "page_id" {
    null = false
    type = uuid
  }
  column "principal_id" {
    null = false
    type = uuid
  }
  # FK の足場（定数の生成列）。principal_members と同じ理由でここも生成列にする。
  column "principal_kind" {
    null = true
    type = character_varying(16)
    as {
      expr = "'share_link'::character varying"
      type = STORED
    }
  }
  # capability の値は domain.Capability が正（view / edit）。
  column "capability" {
    null = false
    type = character_varying(8)
  }
  # token_hash は共有 URL に載るトークンの SHA-256（32 バイト固定）。
  column "token_hash" {
    null = false
    type = bytea
  }
  # password_hash は bcrypt。NULL ならパスワード無しで開ける。
  column "password_hash" {
    null = true
    type = text
  }
  # expires_at が NULL なら無期限。
  column "expires_at" {
    null = true
    type = timestamptz
  }
  # revoked_at が NULL なら有効。失効は行を消さず日付で残す（誰がいつ止めたかを追えるように）。
  column "revoked_at" {
    null = true
    type = timestamptz
  }
  column "created_by_user_id" {
    null = false
    type = bigint
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_share_links_page" {
    columns     = [column.workspace_id, column.page_id]
    ref_columns = [table.pages.column.workspace_id, table.pages.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # principal は「同じワークスペースの、kind='share_link' の、同じページに結び付いた」主体だけ。
  # page_id まで参照列に含めることで、リンクと主体が別々のページを指す状態を作れなくする。
  foreign_key "fk_share_links_principal" {
    columns     = [column.workspace_id, column.principal_kind, column.page_id, column.principal_id]
    ref_columns = [table.principals.column.workspace_id, table.principals.column.kind, table.principals.column.page_id, table.principals.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_share_links_created_by" {
    columns     = [column.created_by_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_share_links_page" {
    columns = [column.workspace_id, column.page_id]
  }
  index "idx_share_links_created_by" {
    columns = [column.created_by_user_id]
  }
  # 1 つの share_link principal は 1 本のリンクだけを表す（使い回すと失効が効かなくなる）。
  unique "uq_share_links_principal" {
    columns = [column.principal_id]
  }
  # トークンからリンクを 1 件引く経路。UNIQUE はその索引も兼ねる。
  unique "uq_share_links_token_hash" {
    columns = [column.token_hash]
  }
  check "ck_share_links_capability" {
    expr = "(capability)::text = ANY (ARRAY[('view'::character varying)::text, ('edit'::character varying)::text])"
  }
  check "ck_share_links_password_hash" {
    expr = "(password_hash IS NULL) OR (password_hash <> ''::text)"
  }
  # SHA-256 以外（平文トークンをそのまま入れた等）を入口で弾く。
  check "ck_share_links_token_hash_len" {
    expr = "octet_length(token_hash) = 32"
  }
}

# =====================================================================
# チケット（バックログ） — 段 1: 骨格
#
# 表 9 つ（追加のみ）: ticket_counters / ticket_statuses / ticket_types / tickets /
# ticket_assignments / ticket_change_groups / ticket_change_items /
# ticket_page_links / ticket_ticket_links。
#
# 設計: 「PostgreSQL チケット・バックログ設計」を参照。
#
# 共通の作法（既存表と同じ）:
#   - 全表が workspace_id を持ち、親への FK は (workspace_id, …, id) の複合 FK。
#   - 同一プロジェクト内でしか参照できない列（種別 / 状態 / 親）は
#     (workspace_id, project_id, id) の複合 FK にする。
#   - 「人」を指す列は 2 種類。本人の行為の記録（created_by / actor / assigned_by / editor）は
#     users.id を bigint で持ち記録として FK を張る（RESTRICT。冒頭の users テーブル直後の
#     FK 方針コメント参照。反応だけは本人の持ち物として CASCADE）。他人を指名する列
#     （担当者）は principals（ワークスペース所属の正本）への複合 FK にする。
#   - 列挙値は varchar + CHECK。値の正本は internal/domain/ticket.go の定数。
#   - 現役の名前（状態・種別）は大文字小文字を区別せず一意にしたいが、このファイルには
#     複数列にまたがる関数索引の実例が無いため、生成列 name_lower（lower(name) を STORED）を
#     挟んで素の複合部分 UNIQUE にする（principal_members.group_kind と同じ「FK / 索引の足場と
#     しての生成列」という使い方。atlas schema inspect の実機出力で GENERATED ALWAYS AS
#     (lower((name)::text)) STORED が意図どおり生成されることを確認済み）。
#   - date 列（start_date / due_date）は Go 側で 'YYYY-MM-DD' の文字列として運ぶ
#     （backend/sqlc.yaml の override。本番の transaction pooler 越し simple protocol で
#     time.Time を渡すと timezone の丸めで 1 日ずれるため）。
#   - 隠すのは archived_at（NULL が現役）。物理削除は入れ物の削除に伴う CASCADE だけ。
#   - 参照先マスタ（ticket_statuses / ticket_types）への FK は ON DELETE NO ACTION
#     （既存表と同じ。マスタは物理削除しない運用なので連鎖の起点にならない）。
#   - 並び順は分数インデックス（fracindex）の text COLLATE "C"。DEFAULT は置かない。
# =====================================================================

# projects: バックログの入れ物。ワークスペースだけを参照する。
#
# **spaces（ナレッジの入れ物）への外部キーは持たない。** バックログとナレッジは別の製品で、
# 一方の入れ物を消したらもう一方が道連れになる関係を作らないため（持たせると結合が
# 一段上に移るだけで独立にならない）。共有とメンバー招待はワークスペース単位に一本化し、
# チケットの実効権限もワークスペースの役割で決める（spaces の付与は見ない）。
#
# key はチケットの表示キーの接頭辞（FRESTYLE-12 の FRESTYLE）。ワークスペース内で一意。
# 形は spaces.key / workspaces.slug と同じ（domain.ValidProjectKey）。
table "projects" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "key" {
    null = false
    type = character_varying(64)
  }
  column "name" {
    null = false
    type = character_varying(200)
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  # ワークスペースの物理削除で配下も消える（spaces と同じ扱い）。
  foreign_key "fk_projects_workspace" {
    columns     = [column.workspace_id]
    ref_columns = [table.workspaces.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_projects_workspace_id" {
    columns = [column.workspace_id]
  }
  unique "uq_projects_workspace_key" {
    columns = [column.workspace_id, column.key]
  }
  # チケット系からの複合 FK（テナント越えを DB で塞ぐ）の参照先。spaces の
  # uq_spaces_workspace_id と同じ足場。
  unique "uq_projects_workspace_id" {
    columns = [column.workspace_id, column.id]
  }
  check "ck_projects_key_len" {
    expr = "(char_length((key)::text) >= 1) AND (char_length((key)::text) <= 64)"
  }
}

# ticket_counters: プロジェクトごとのチケット番号カウンタ。
#
# tickets.number の MAX+1 で採番すると同時作成が同じ番号を取り合い UNIQUE で片方が落ちる。
# 採番と tickets への INSERT は必ず 1 文の CTE にまとめる（CreateTicket クエリ 1 本だけがこの表と
# tickets の両方に書く）。VALUES に既定値 0 を使うと初回が 0 を返すので必ず 1 を渡す
# （CHECK も > 0 を要求する）。番号は減らさず再利用しない。
table "ticket_counters" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  # 採番の単位。プロジェクト 1 つにつき 1 行（主キーの片方）。
  column "project_id" {
    null = false
    type = uuid
  }
  # 直近に払い出した番号。DEFAULT は置かない（既定値 0 の行を先に作る経路を残さないため）。
  column "last_number" {
    null = false
    type = bigint
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  # プロジェクトが在る限りこの行も在る（削除概念を持たない）。9 表一律の方針に合わせて列だけ足す。
  column "deleted_at" {
    null = true
    type = timestamptz
  }
  primary_key {
    columns = [column.workspace_id, column.project_id]
  }
  foreign_key "fk_ticket_counters_project" {
    columns     = [column.workspace_id, column.project_id]
    ref_columns = [table.projects.column.workspace_id, table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  check "ck_ticket_counters_last_number_positive" {
    expr = "last_number > 0"
  }
}

# ticket_statuses: プロジェクトごとの状態。名前は自由、category は 3 枠（todo/in_progress/done）で
# 固定（domain.TicketStatusCategory）。遷移規則の表は持たない（誰でもどの状態にも変えられる）。
table "ticket_statuses" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  # 所属プロジェクト（バックログの入れ物）。
  column "project_id" {
    null = false
    type = uuid
  }
  column "name" {
    null = false
    type = character_varying(50)
  }
  # FK / 索引の足場としてだけ使う生成列（テーブルの属性ではない）。冒頭の作法を参照。
  column "name_lower" {
    null = true
    type = character_varying(50)
    as {
      expr = "lower((name)::text)"
      type = STORED
    }
  }
  column "category" {
    null = false
    type = character_varying(16)
  }
  column "color" {
    null = false
    type = character_varying(7)
  }
  column "position" {
    null    = false
    type    = text
    collate = "C"
  }
  # 現役の中で 1 つだけ（下の部分 UNIQUE）。「0 個」は有効化 usecase の責務（DB は守れない）。
  column "is_initial" {
    null    = false
    type    = boolean
    default = false
  }
  column "archived_at" {
    null = true
    type = timestamptz
  }
  # 「消えたことにする」。archived_at（一覧から外すだけ・戻せる）とは別概念で、復元 API を持たない。
  column "deleted_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  # tickets.status_id からの複合 FK の参照先。
  unique "uq_ticket_statuses_workspace_project_id" {
    columns = [column.workspace_id, column.project_id, column.id]
  }
  foreign_key "fk_ticket_statuses_project" {
    columns     = [column.workspace_id, column.project_id]
    ref_columns = [table.projects.column.workspace_id, table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_ticket_statuses_workspace_project" {
    columns = [column.workspace_id, column.project_id]
  }
  index "uq_ticket_statuses_project_name" {
    unique  = true
    columns = [column.project_id, column.name_lower]
    where   = "((archived_at IS NULL) AND (deleted_at IS NULL))"
  }
  index "uq_ticket_statuses_project_position" {
    unique  = true
    columns = [column.project_id, column.position]
    where   = "((archived_at IS NULL) AND (deleted_at IS NULL))"
  }
  index "uq_ticket_statuses_project_initial" {
    unique  = true
    columns = [column.project_id]
    where   = "(is_initial AND (archived_at IS NULL) AND (deleted_at IS NULL))"
  }
  check "ck_ticket_statuses_category" {
    expr = "(category)::text = ANY (ARRAY[('todo'::character varying)::text, ('in_progress'::character varying)::text, ('done'::character varying)::text])"
  }
  check "ck_ticket_statuses_name_trimmed" {
    expr = "((name)::text = btrim((name)::text)) AND ((name)::text <> ''::text)"
  }
  check "ck_ticket_statuses_color_hex" {
    expr = "(color)::text ~ '^#[0-9a-f]{6}$'::text"
  }
  check "ck_ticket_statuses_position_not_empty" {
    expr = "position <> ''::text"
  }
  check "ck_ticket_statuses_initial_active" {
    expr = "NOT (is_initial AND (archived_at IS NOT NULL))"
  }
}

# ticket_types: プロジェクトごとの種別。hierarchy_level は階層の段（1=束ね/0=標準/-1=小作業）。
# 親子規則（行をまたぐ）は CHECK では書けないので usecase が親チェーンを読んでから検査する。
table "ticket_types" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  # 所属プロジェクト（バックログの入れ物）。
  column "project_id" {
    null = false
    type = uuid
  }
  column "name" {
    null = false
    type = character_varying(50)
  }
  column "name_lower" {
    null = true
    type = character_varying(50)
    as {
      expr = "lower((name)::text)"
      type = STORED
    }
  }
  column "color" {
    null = false
    type = character_varying(7)
  }
  column "hierarchy_level" {
    null    = false
    type    = integer
    default = 0
  }
  column "position" {
    null    = false
    type    = text
    collate = "C"
  }
  column "is_default" {
    null    = false
    type    = boolean
    default = false
  }
  # 雛形の題名・本文。NULL は「雛形なし」（空文字 / 空 doc は入れない）。
  column "template_title" {
    null = true
    type = character_varying(200)
  }
  column "template_doc" {
    null = true
    type = jsonb
  }
  column "archived_at" {
    null = true
    type = timestamptz
  }
  # 「消えたことにする」。archived_at（一覧から外すだけ・戻せる）とは別概念で、復元 API を持たない。
  column "deleted_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  unique "uq_ticket_types_workspace_project_id" {
    columns = [column.workspace_id, column.project_id, column.id]
  }
  foreign_key "fk_ticket_types_project" {
    columns     = [column.workspace_id, column.project_id]
    ref_columns = [table.projects.column.workspace_id, table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_ticket_types_workspace_project" {
    columns = [column.workspace_id, column.project_id]
  }
  index "uq_ticket_types_project_name" {
    unique  = true
    columns = [column.project_id, column.name_lower]
    where   = "((archived_at IS NULL) AND (deleted_at IS NULL))"
  }
  index "uq_ticket_types_project_position" {
    unique  = true
    columns = [column.project_id, column.position]
    where   = "((archived_at IS NULL) AND (deleted_at IS NULL))"
  }
  index "uq_ticket_types_project_default" {
    unique  = true
    columns = [column.project_id]
    where   = "(is_default AND (archived_at IS NULL) AND (deleted_at IS NULL))"
  }
  check "ck_ticket_types_hierarchy_level" {
    expr = "(hierarchy_level >= '-1'::integer) AND (hierarchy_level <= 1)"
  }
  check "ck_ticket_types_name_trimmed" {
    expr = "((name)::text = btrim((name)::text)) AND ((name)::text <> ''::text)"
  }
  check "ck_ticket_types_color_hex" {
    expr = "(color)::text ~ '^#[0-9a-f]{6}$'::text"
  }
  check "ck_ticket_types_position_not_empty" {
    expr = "position <> ''::text"
  }
  check "ck_ticket_types_template_title_not_blank" {
    expr = "(template_title IS NULL) OR (btrim((template_title)::text) <> ''::text)"
  }
  check "ck_ticket_types_template_doc" {
    expr = "(template_doc IS NULL) OR ((jsonb_typeof(template_doc) = 'object'::text) AND ((template_doc ->> 'type'::text) = 'doc'::text))"
  }
  check "ck_ticket_types_default_active" {
    expr = "NOT (is_default AND (archived_at IS NOT NULL))"
  }
}

# tickets: チケット本体。表示キー（FRESTYLE-12）は保存しない派生値
# （domain.FormatTicketKey が upper(projects.key) || '-' || number を Go 側で組み立てる）。
# 本文は ProseMirror doc の jsonb を NOT NULL で持つ（blocks には分解しない）。
# closed_at / resolution は状態変更 usecase が category から必ず導く（引数から直接受けない）。
table "tickets" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  # 所属プロジェクト（バックログの入れ物）。
  column "project_id" {
    null = false
    type = uuid
  }
  column "number" {
    null = false
    type = bigint
  }
  column "type_id" {
    null = false
    type = uuid
  }
  column "status_id" {
    null = false
    type = uuid
  }
  column "parent_id" {
    null = true
    type = uuid
  }
  column "title" {
    null = false
    type = character_varying(200)
  }
  column "doc" {
    null = false
    type = jsonb
  }
  # pageRef / ticketRef の属性を含まない検索用の写し（本文保存のたびに作り直す派生値）。
  column "plain_text" {
    null    = false
    type    = text
    default = ""
  }
  # 1=高 / 2=中 / 3=低。既定は中（domain.TicketPriorityDefault）。
  column "priority" {
    null    = false
    type    = integer
    default = 2
  }
  # 見積りの大きさ。未見積りは NULL（0 とは別物 —— 0 は「やることが無い」、NULL は
  # 「まだ測っていない」。番兵の 0 で潰すと集計で 2 つが混ざる）。
  # 刻み方（フィボナッチ等）は現場ごとなので DB では縛らず、上限だけ置く。
  column "story_points" {
    null = true
    type = integer
  }
  # 担当チーム。未設定は NULL。プロジェクト単位のチームなので、複合 FK で
  # 「同じプロジェクトのチームしか付かない」ことを DB に守らせる（下の fk_tickets_team）。
  column "team_id" {
    null = true
    type = uuid
  }
  # Go 側で 'YYYY-MM-DD' 文字列として運ぶ（sqlc.yaml の date override。冒頭の作法参照）。
  column "start_date" {
    null = true
    type = date
  }
  column "due_date" {
    null = true
    type = date
  }
  column "closed_at" {
    null = true
    type = timestamptz
  }
  column "resolution" {
    null = true
    type = character_varying(20)
  }
  # 報告者（users.id）。記録: FK は RESTRICT（下の fk_tickets_created_by。段 1）。
  column "created_by_user_id" {
    null = false
    type = bigint
  }
  column "archived_at" {
    null = true
    type = timestamptz
  }
  # 「消えたことにする」。archived_at（一覧から外すだけ・戻せる）とは別概念で、復元 API を持たない。
  column "deleted_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  # コメント・履歴・ウォッチ・リンク・担当（ワークスペース横断で参照する子表）の足場。
  unique "uq_tickets_workspace_id" {
    columns = [column.workspace_id, column.id]
  }
  # 親子（同一プロジェクト内でしか参照できない子表）の足場。
  unique "uq_tickets_workspace_project_id" {
    columns = [column.workspace_id, column.project_id, column.id]
  }
  # 番号はプロジェクト内で一意。表示キーが 1 件を指すことをここで保証する。
  unique "uq_tickets_project_number" {
    columns = [column.workspace_id, column.project_id, column.number]
  }
  foreign_key "fk_tickets_project" {
    columns     = [column.workspace_id, column.project_id]
    ref_columns = [table.projects.column.workspace_id, table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_tickets_type" {
    columns     = [column.workspace_id, column.project_id, column.type_id]
    ref_columns = [table.ticket_types.column.workspace_id, table.ticket_types.column.project_id, table.ticket_types.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  foreign_key "fk_tickets_status" {
    columns     = [column.workspace_id, column.project_id, column.status_id]
    ref_columns = [table.ticket_statuses.column.workspace_id, table.ticket_statuses.column.project_id, table.ticket_statuses.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  # 親は同じプロジェクトのチケットに限る。親が消えれば子も消える（入れ物の削除に伴う場合だけ。
  # 通常運用の削除は無くアーカイブで隠す）。
  foreign_key "fk_tickets_parent" {
    columns     = [column.workspace_id, column.project_id, column.parent_id]
    ref_columns = [table.tickets.column.workspace_id, table.tickets.column.project_id, table.tickets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # チームは同じプロジェクトのものだけ。team_id が NULL の行は FK の対象外になる
  # （複合 FK は列のどれかが NULL なら検査されない。MATCH SIMPLE の既定）。
  #
  # on_delete は NO_ACTION。**SET_NULL は使えない** —— PostgreSQL は FK を構成する列を
  # すべて NULL にするので、workspace_id / project_id まで NULL になって NOT NULL 違反で
  # 落ちる（実測）。チームを消すときは、先にチケットから外す（ClearTicketsTeam）。
  foreign_key "fk_tickets_team" {
    columns     = [column.workspace_id, column.project_id, column.team_id]
    ref_columns = [table.teams.column.workspace_id, table.teams.column.project_id, table.teams.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  foreign_key "fk_tickets_created_by" {
    columns     = [column.created_by_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  index "idx_tickets_project_status" {
    columns = [column.workspace_id, column.project_id, column.status_id]
  }
  index "idx_tickets_project_type" {
    columns = [column.workspace_id, column.project_id, column.type_id]
  }
  index "idx_tickets_parent_id" {
    columns = [column.parent_id]
  }
  index "idx_tickets_archived_at" {
    columns = [column.archived_at]
  }
  index "idx_tickets_deleted_at" {
    columns = [column.deleted_at]
  }
  # pg_trgm の GIN トライグラム索引（ファイル冒頭の「pg_trgm 拡張について」参照）。
  # 題名検索（q）の ILIKE '%needle%' 高速化用。あいまい検索はクエリ側の word_similarity。
  index "idx_tickets_title_trgm" {
    type = GIN
    on {
      column = column.title
      ops    = gin_trgm_ops
    }
  }
  index "idx_tickets_plain_text_trgm" {
    type = GIN
    on {
      column = column.plain_text
      ops    = gin_trgm_ops
    }
  }
  check "ck_tickets_number_positive" {
    expr = "number > 0"
  }
  check "ck_tickets_title_not_blank" {
    expr = "btrim((title)::text) <> ''::text"
  }
  check "ck_tickets_doc" {
    expr = "(jsonb_typeof(doc) = 'object'::text) AND ((doc ->> 'type'::text) = 'doc'::text)"
  }
  check "ck_tickets_story_points_range" {
    expr = "story_points IS NULL OR (story_points >= 0 AND story_points <= 1000)"
  }
  check "ck_tickets_priority" {
    expr = "priority = ANY (ARRAY[1, 2, 3])"
  }
  check "ck_tickets_parent_not_self" {
    expr = "(parent_id IS NULL) OR (parent_id <> id)"
  }
  check "ck_tickets_dates_ordered" {
    expr = "(start_date IS NULL) OR (due_date IS NULL) OR (start_date <= due_date)"
  }
  check "ck_tickets_resolution" {
    expr = "(resolution IS NULL) OR ((resolution)::text = ANY (ARRAY[('done'::character varying)::text, ('wont_do'::character varying)::text, ('invalid'::character varying)::text, ('duplicate'::character varying)::text, ('cannot_reproduce'::character varying)::text]))"
  }
  check "ck_tickets_closed_pair" {
    expr = "(closed_at IS NULL) = (resolution IS NULL)"
  }
}

# ticket_assignments: 担当者（1 人）。principals への複合 FK で所属に縛る
# （別ワークスペースの人を担当にでき、その人の通知一覧に題名が届く穴を実測して塞いだ判断）。
table "ticket_assignments" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "ticket_id" {
    null = false
    type = uuid
  }
  column "assignee_principal_id" {
    null = false
    type = uuid
  }
  # FK の足場（定数の生成列）。principal_members.group_kind と同じ作法。
  column "assignee_kind" {
    null = true
    type = character_varying(16)
    as {
      expr = "'user'::character varying"
      type = STORED
    }
  }
  # 記録: FK は RESTRICT（下の fk_ticket_assignments_assigned_by。段 1）。
  column "assigned_by_user_id" {
    null = false
    type = bigint
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  # PK が ticket_id 自体（1 チケット 1 行）なので、外した行を残したまま付け直すことはできない。
  # 9 表一律の方針で列だけ足す。運用（UPDATE のままにするか）は着手時に確定する。
  column "deleted_at" {
    null = true
    type = timestamptz
  }
  primary_key {
    columns = [column.ticket_id]
  }
  foreign_key "fk_ticket_assignments_ticket" {
    columns     = [column.workspace_id, column.ticket_id]
    ref_columns = [table.tickets.column.workspace_id, table.tickets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_ticket_assignments_principal" {
    columns     = [column.workspace_id, column.assignee_kind, column.assignee_principal_id]
    ref_columns = [table.principals.column.workspace_id, table.principals.column.kind, table.principals.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_ticket_assignments_assigned_by" {
    columns     = [column.assigned_by_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  index "idx_ticket_assignments_principal" {
    columns = [column.workspace_id, column.assignee_principal_id]
  }
}

# ticket_change_groups / ticket_change_items: 変更履歴。1 回の保存 = 1 グループ、項目ごとに 1 行。
# 表示名を焼き込むのは、状態や種別が後で改名・アーカイブされても履歴をそのまま読むため。
table "ticket_change_groups" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "ticket_id" {
    null = false
    type = uuid
  }
  # 記録: FK は RESTRICT（下の fk_ticket_change_groups_actor。段 1）。
  column "actor_user_id" {
    null = false
    type = bigint
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  # 親チケットを消したとき、同一トランザクションで履歴にも伝播させる（Ⅳ-J の推奨どおり）。
  column "deleted_at" {
    null = true
    type = timestamptz
  }
  primary_key {
    columns = [column.id]
  }
  unique "uq_ticket_change_groups_workspace_id" {
    columns = [column.workspace_id, column.id]
  }
  foreign_key "fk_ticket_change_groups_ticket" {
    columns     = [column.workspace_id, column.ticket_id]
    ref_columns = [table.tickets.column.workspace_id, table.tickets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_ticket_change_groups_actor" {
    columns     = [column.actor_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  index "idx_ticket_change_groups_ticket_created" {
    columns = [column.ticket_id, column.created_at]
  }
}

table "ticket_change_items" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "group_id" {
    null = false
    type = uuid
  }
  # 値の正本は domain.TicketChangeField。段 3・段 4 の値も最初から列挙する
  # （段ごとに CHECK を DROP + ADD し直さないための判断）。
  column "field" {
    null = false
    type = character_varying(32)
  }
  column "old_value" {
    null = true
    type = text
  }
  column "new_value" {
    null = true
    type = text
  }
  column "old_label" {
    null = true
    type = text
  }
  column "new_label" {
    null = true
    type = text
  }
  # 親（グループ）が消えたときに一緒に伝播させる。グループ単体では消えないので実質グループに追随する。
  column "deleted_at" {
    null = true
    type = timestamptz
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_ticket_change_items_group" {
    columns     = [column.workspace_id, column.group_id]
    ref_columns = [table.ticket_change_groups.column.workspace_id, table.ticket_change_groups.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_ticket_change_items_group_id" {
    columns = [column.group_id]
  }
  check "ck_ticket_change_items_field" {
    expr = "(field)::text = ANY (ARRAY[('title'::character varying)::text, ('doc'::character varying)::text, ('status'::character varying)::text, ('type'::character varying)::text, ('priority'::character varying)::text, ('assignee'::character varying)::text, ('parent'::character varying)::text, ('start_date'::character varying)::text, ('due_date'::character varying)::text, ('resolution'::character varying)::text, ('position'::character varying)::text, ('archived'::character varying)::text, ('category'::character varying)::text, ('milestone'::character varying)::text, ('link'::character varying)::text, ('deleted'::character varying)::text])"
  }
  check "ck_ticket_change_items_changed" {
    expr = "(old_value IS DISTINCT FROM new_value) OR (old_label IS DISTINCT FROM new_label) OR ((field)::text = 'doc'::text)"
  }
}

# ticket_page_links / ticket_ticket_links: 本文からの参照（派生表）。本文保存のたびに
# usecase が作り直す（正本は tickets.doc、この表は壊れても本文から再生成できる索引）。
table "ticket_page_links" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "source_ticket_id" {
    null = false
    type = uuid
  }
  column "target_page_id" {
    null = false
    type = uuid
  }
  # 参照元チケットが消えたとき伝播させる。派生索引なので本文保存時にも作り直される。
  column "deleted_at" {
    null = true
    type = timestamptz
  }
  primary_key {
    columns = [column.source_ticket_id, column.target_page_id]
  }
  foreign_key "fk_ticket_page_links_source" {
    columns     = [column.workspace_id, column.source_ticket_id]
    ref_columns = [table.tickets.column.workspace_id, table.tickets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_ticket_page_links_target" {
    columns     = [column.workspace_id, column.target_page_id]
    ref_columns = [table.pages.column.workspace_id, table.pages.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_ticket_page_links_target" {
    columns = [column.target_page_id]
  }
}

table "ticket_ticket_links" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "source_ticket_id" {
    null = false
    type = uuid
  }
  column "target_ticket_id" {
    null = false
    type = uuid
  }
  # 参照元・参照先どちらかのチケットが消えたとき伝播させる。派生索引なので本文保存時にも作り直される。
  column "deleted_at" {
    null = true
    type = timestamptz
  }
  primary_key {
    columns = [column.source_ticket_id, column.target_ticket_id]
  }
  foreign_key "fk_ticket_ticket_links_source" {
    columns     = [column.workspace_id, column.source_ticket_id]
    ref_columns = [table.tickets.column.workspace_id, table.tickets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_ticket_ticket_links_target" {
    columns     = [column.workspace_id, column.target_ticket_id]
    ref_columns = [table.tickets.column.workspace_id, table.tickets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_ticket_ticket_links_target" {
    columns = [column.target_ticket_id]
  }
  check "ck_ticket_ticket_links_not_self" {
    expr = "source_ticket_id <> target_ticket_id"
  }
}
# sprints: バックログの仕事を「いつやるか」でまとめる区切り。
#
# プロジェクトに属する（ワークスペース単位ではない）。スプリントはチームの作業の単位で、
# 案件が違えば期間も別々に回るため。
table "sprints" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "project_id" {
    null = false
    type = uuid
  }
  column "name" {
    null = false
    type = character_varying(200)
  }
  # planned（まだ始めていない）/ active（進行中）/ completed（終わった）の 3 つだけ。
  # 状態の名前を利用者に足させない —— 期間の進み方は業務で変わらないため（チケットの
  # 状態が自由に足せるのとは性質が違う）。
  column "state" {
    null = false
    type = character_varying(16)
  }
  # 期間。計画中は未定のことがあるので両方 NULL 可。開始したのに終わりが未定はありうる。
  column "start_date" {
    null = true
    type = date
  }
  column "end_date" {
    null = true
    type = date
  }
  # プロジェクト内での並び（fracindex）。照合順序は環境に依存させない。
  column "position" {
    null    = false
    type    = text
    collate = "C"
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  # チケット系からの複合 FK の参照先。
  unique "uq_sprints_workspace_id" {
    columns = [column.workspace_id, column.id]
  }
  foreign_key "fk_sprints_project" {
    columns     = [column.workspace_id, column.project_id]
    ref_columns = [table.projects.column.workspace_id, table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_sprints_project_position" {
    columns = [column.workspace_id, column.project_id, column.position]
  }
  unique "uq_sprints_project_position" {
    columns = [column.workspace_id, column.project_id, column.position]
  }
  check "ck_sprints_state" {
    expr = "(state)::text = ANY (ARRAY[('planned'::character varying)::text, ('active'::character varying)::text, ('completed'::character varying)::text])"
  }
  check "ck_sprints_name_not_empty" {
    expr = "btrim((name)::text) <> ''::text"
  }
  # 終わりが始まりより前になっている行を作らせない。片方 NULL のときは比較しない。
  check "ck_sprints_period_order" {
    expr = "start_date IS NULL OR end_date IS NULL OR start_date <= end_date"
  }
}

# ticket_sprint_ranks: スプリントに入れたチケットと、その中での並び。
#
# 旧 ticket_ranks のように 1 表へ文脈を詰め込まず、**文脈ごとに表を分ける**
# （ticket_backlog_ranks のコメント参照）。分けたことで sprint_id へ実際に FK を張れる。
#
# PK が (workspace_id, ticket_id) なので、1 件のチケットが同時に 2 つのスプリントへ
# 入ることはない。表の形でそう決める。
table "ticket_sprint_ranks" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "sprint_id" {
    null = false
    type = uuid
  }
  column "ticket_id" {
    null = false
    type = uuid
  }
  column "position" {
    null    = false
    type    = text
    collate = "C"
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.workspace_id, column.ticket_id]
  }
  foreign_key "fk_ticket_sprint_ranks_ticket" {
    columns     = [column.workspace_id, column.ticket_id]
    ref_columns = [table.tickets.column.workspace_id, table.tickets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_ticket_sprint_ranks_sprint" {
    columns     = [column.workspace_id, column.sprint_id]
    ref_columns = [table.sprints.column.workspace_id, table.sprints.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_ticket_sprint_ranks_sprint_position" {
    columns = [column.workspace_id, column.sprint_id, column.position]
  }
  # 同じスプリントの中で順位が重複しない。
  unique "uq_ticket_sprint_ranks_sprint_position" {
    columns = [column.workspace_id, column.sprint_id, column.position]
  }
  check "ck_ticket_sprint_ranks_position_not_empty" {
    expr = "position <> ''::text"
  }
}

# ticket_watchers: そのチケットの動きを追いたい人。
#
# 「担当」とは別物。担当は 1 人（責任の所在）、監視は何人でも（気にしている人）。
# 表を分けているのはそのため —— 同じ表に役割の列を足すと、担当を外した拍子に監視も
# 消えるような書き方ができてしまう。
#
# users への FK は張らない（pages / tickets の created_by_user_id と同じ分担。
# 利用者の削除はアプリ側の手順で扱う）。
# =============================================================================
# リリース版（修正バージョン）とチーム
# =============================================================================

# project_versions はプロジェクトのリリース版。チケットの「修正バージョン」の選択肢になる。
#
# プロジェクト単位にするのは、版が製品ごとの概念だから（同じワークスペースでも別製品の
# 「1.2.0」は別物）。ticket_statuses / ticket_types と同じ足場を持たせてある。
table "project_versions" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "project_id" {
    null = false
    type = uuid
  }
  column "name" {
    null = false
    type = character_varying(60)
  }
  # FK / 索引の足場としてだけ使う生成列（冒頭の作法を参照）。
  column "name_lower" {
    null = true
    type = character_varying(60)
    as {
      expr = "lower((name)::text)"
      type = STORED
    }
  }
  # リリース済みになった時刻。NULL は「まだ出していない」。
  column "released_at" {
    null = true
    type = timestamptz
  }
  # 並び順（fracindex）。版は番号順に並べたいが、番号の付け方は現場ごとなので
  # 文字列として比べる（ticket_statuses.position と同じ作法）。
  column "position" {
    null    = false
    type    = text
    collate = "C"
  }
  column "archived_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  # ticket_fix_versions からの複合 FK の参照先。プロジェクトまで含めることで、
  # 別プロジェクトの版をチケットに付けられなくする。
  unique "uq_project_versions_workspace_project_id" {
    columns = [column.workspace_id, column.project_id, column.id]
  }
  foreign_key "fk_project_versions_project" {
    columns     = [column.workspace_id, column.project_id]
    ref_columns = [table.projects.column.workspace_id, table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # 同じプロジェクトで同じ名前の版は作れない（大文字小文字の違いも同じ扱い）。
  # アーカイブ済みは対象から外す（版名を再利用できるように）。
  index "uq_project_versions_project_name" {
    unique  = true
    columns = [column.project_id, column.name_lower]
    where   = "(archived_at IS NULL)"
  }
  index "idx_project_versions_project_position" {
    columns = [column.workspace_id, column.project_id, column.position]
  }
  check "ck_project_versions_name_not_blank" {
    expr = "btrim((name)::text) <> ''::text"
  }
  check "ck_project_versions_position_not_empty" {
    expr = "position <> ''::text"
  }
}

# ticket_fix_versions はチケットと修正バージョンの組（多対多）。
#
# project_id を持つのは飾りではない。**チケットと版が同じプロジェクトに属することを
# DB に守らせる**ための鍵で、両方の FK にこの列を含める。持たせないと、別プロジェクトの
# 版を付ける組が作れてしまう（旧 ticket_ranks が範囲を鍵に書かずに壊れたのと同じ形）。
table "ticket_fix_versions" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "project_id" {
    null = false
    type = uuid
  }
  column "ticket_id" {
    null = false
    type = uuid
  }
  column "version_id" {
    null = false
    type = uuid
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.workspace_id, column.ticket_id, column.version_id]
  }
  foreign_key "fk_ticket_fix_versions_ticket" {
    columns     = [column.workspace_id, column.project_id, column.ticket_id]
    ref_columns = [table.tickets.column.workspace_id, table.tickets.column.project_id, table.tickets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_ticket_fix_versions_version" {
    columns     = [column.workspace_id, column.project_id, column.version_id]
    ref_columns = [table.project_versions.column.workspace_id, table.project_versions.column.project_id, table.project_versions.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_ticket_fix_versions_version" {
    columns = [column.workspace_id, column.version_id]
  }
}

# teams はプロジェクトのチーム。チケットの「Team」の選択肢になる。
table "teams" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "project_id" {
    null = false
    type = uuid
  }
  column "name" {
    null = false
    type = character_varying(60)
  }
  column "name_lower" {
    null = true
    type = character_varying(60)
    as {
      expr = "lower((name)::text)"
      type = STORED
    }
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  # tickets.team_id からの複合 FK の参照先（別プロジェクトのチームを付けさせない）。
  unique "uq_teams_workspace_project_id" {
    columns = [column.workspace_id, column.project_id, column.id]
  }
  # team_members からの複合 FK の参照先。
  unique "uq_teams_workspace_id" {
    columns = [column.workspace_id, column.id]
  }
  foreign_key "fk_teams_project" {
    columns     = [column.workspace_id, column.project_id]
    ref_columns = [table.projects.column.workspace_id, table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "uq_teams_project_name" {
    unique  = true
    columns = [column.project_id, column.name_lower]
  }
  check "ck_teams_name_not_blank" {
    expr = "btrim((name)::text) <> ''::text"
  }
}

# team_members はチームに属する人。
#
# users への FK は RESTRICT にしない（CASCADE）。人が消えたら所属も消えるのが自然で、
# 所属が残っていることを理由に利用者の削除を止める理由が無いため。
table "team_members" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "team_id" {
    null = false
    type = uuid
  }
  column "user_id" {
    null = false
    type = bigint
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.workspace_id, column.team_id, column.user_id]
  }
  foreign_key "fk_team_members_team" {
    columns     = [column.workspace_id, column.team_id]
    ref_columns = [table.teams.column.workspace_id, table.teams.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_team_members_user" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_team_members_user" {
    columns = [column.user_id]
  }
}

table "ticket_watchers" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "ticket_id" {
    null = false
    type = uuid
  }
  column "user_id" {
    null = false
    type = bigint
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  # 同じ人が同じチケットを二重に監視することはない。
  primary_key {
    columns = [column.workspace_id, column.ticket_id, column.user_id]
  }
  foreign_key "fk_ticket_watchers_ticket" {
    columns     = [column.workspace_id, column.ticket_id]
    ref_columns = [table.tickets.column.workspace_id, table.tickets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # 「自分が監視しているチケット」を引くための索引。
  index "idx_ticket_watchers_user" {
    columns = [column.workspace_id, column.user_id]
  }
}

# ticket_backlog_ranks: バックログの並び順（設計 Ⅳ-F）。
#
# 旧 ticket_ranks（context_kind / context_id で文脈を判別する 1 表）から置き換えた。旧設計は
# 2 つの問題を抱えていた。
#
# 1. **一意制約が効く範囲が壊れていた。** UNIQUE は (context_kind, context_id, position) で、
#    backlog では context_id がゼロ UUID 固定だったため「position が表全体で一意」の意味に
#    なっていた。2 つ目のプロジェクトが最初のチケットを作ると必ず position が衝突し、
#    本番でも実際に起きていた（あるスペースのチケットだけ rank 行が 1 件も無い状態）。
# 2. **外部キーが張れなかった。** context_id は context_kind 次第で sprints.id にも
#    board_columns.id にもなる想定で、参照先が定まらないため FK を宣言できない。存在しない
#    ID を指す行を DB が止められない（このリポジトリが EAV を禁じている理由と同じ）。
#
# 文脈が増えたら**表を増やす**（スプリントなら ticket_sprint_ranks）。表ごとに参照先が 1 つに
# 定まるので FK が張れ、一意制約もその文脈の正しい範囲に書ける。
table "ticket_backlog_ranks" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  # project_id を持つのが旧設計との決定的な違い。並びは「プロジェクト 1 つの中の 1 系列」
  # なので、その範囲を鍵に書けなければ一意制約が意味を成さない。
  column "project_id" {
    null = false
    type = uuid
  }
  column "ticket_id" {
    null = false
    type = uuid
  }
  # 並び順の正本。辞書順で比べる文字列（fracindex 作法）で、照合順序は環境に依存させない。
  # かつて tickets.position が同じ役目を持っていたが、並びの範囲（プロジェクト）を
  # 表せない場所に順序を置いていたので、この表へ移してから落とした。
  column "position" {
    null    = false
    type    = text
    collate = "C"
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  # チケット 1 件はバックログの並びに 1 回だけ現れる。
  primary_key {
    columns = [column.workspace_id, column.ticket_id]
  }
  foreign_key "fk_ticket_backlog_ranks_ticket" {
    columns     = [column.workspace_id, column.ticket_id]
    ref_columns = [table.tickets.column.workspace_id, table.tickets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_ticket_backlog_ranks_project" {
    columns     = [column.workspace_id, column.project_id]
    ref_columns = [table.projects.column.workspace_id, table.projects.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # 一覧はプロジェクト単位で position 順に引く。
  index "idx_ticket_backlog_ranks_project_position" {
    columns = [column.workspace_id, column.project_id, column.position]
  }
  # 同じプロジェクトの中で順位が重複しない。同時に同じ場所へ移動したら片方が落ちる
  # （usecase 側が 1 回だけ位置を取り直して再試行する）。
  unique "uq_ticket_backlog_ranks_project_position" {
    columns = [column.workspace_id, column.project_id, column.position]
  }
  check "ck_ticket_backlog_ranks_position_not_empty" {
    expr = "position <> ''::text"
  }
}

# ticket_status_transitions: 状態が変わるたびに 1 行（段 3・設計 Ⅵ「状態遷移だけを別に記録する
# 表」）。汎用の ticket_change_items（field='status'）と役割が違う — あちらは「何が変わったか」を
# 人が読む履歴として残す（旧値・新値を ID と表示文字列の両方で）、こちらは「いつどの状態に
# いたか」を集計で引くための専用ログ（状態の当時の表示名は持たず、常に ticket_statuses への
# FK を辿る。改名されれば集計は現在の名前で出る想定）。ChangeTicketStatusUseCase が
# 同一の状態変更で ticket_change_items と両方に書く（recordStatusChange 参照）。
table "ticket_status_transitions" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  # ticket_statuses への複合 FK（workspace_id, project_id, id）に要る。tickets 経由で
  # 辿ればわかる値だが、集計クエリと FK の両方でこの表単体から要るので非正規化して持つ。
  # projects への FK は張らない（集計専用のログで、入れ物の実在は tickets 側が保証する）。
  column "project_id" {
    null = false
    type = uuid
  }
  column "ticket_id" {
    null = false
    type = uuid
  }
  column "from_status_id" {
    null = false
    type = uuid
  }
  column "to_status_id" {
    null = false
    type = uuid
  }
  # 記録: FK は RESTRICT（下の fk_ticket_status_transitions_changed_by。段 1）。
  column "changed_by_user_id" {
    null = false
    type = bigint
  }
  column "changed_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_ticket_status_transitions_ticket" {
    columns     = [column.workspace_id, column.ticket_id]
    ref_columns = [table.tickets.column.workspace_id, table.tickets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_ticket_status_transitions_from" {
    columns     = [column.workspace_id, column.project_id, column.from_status_id]
    ref_columns = [table.ticket_statuses.column.workspace_id, table.ticket_statuses.column.project_id, table.ticket_statuses.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  foreign_key "fk_ticket_status_transitions_to" {
    columns     = [column.workspace_id, column.project_id, column.to_status_id]
    ref_columns = [table.ticket_statuses.column.workspace_id, table.ticket_statuses.column.project_id, table.ticket_statuses.column.id]
    on_update   = NO_ACTION
    on_delete   = NO_ACTION
  }
  foreign_key "fk_ticket_status_transitions_changed_by" {
    columns     = [column.changed_by_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  index "idx_ticket_status_transitions_ticket_changed" {
    columns = [column.ticket_id, column.changed_at]
  }
  check "ck_ticket_status_transitions_distinct" {
    expr = "from_status_id <> to_status_id"
  }
}

# ticket_comments: チケットへの発言（段 3）。ノート側の comment_threads/comments とは別表
# （設計判断・着手前にユーザー確認済み）— ノート側は本文の特定位置への「錨付け」が主目的で
# page_id が NOT NULL の専用の形をしており、チケットには錨の概念が無い（チケット全体への
# フラットな発言列で足りる）。parent_comment_id で返信をスレッド化する（深さの上限は設けない
# — 表示側がインデントを畳めばよく、チケットの親子のような周期検出は要らない）。
table "ticket_comments" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "ticket_id" {
    null = false
    type = uuid
  }
  # NULL はトップレベルの発言。返信は親発言を指す（同じチケット内に限る制約は usecase 側）。
  column "parent_comment_id" {
    null = true
    type = uuid
  }
  # 記録: FK は RESTRICT（下の fk_ticket_comments_author。段 1）。
  column "author_user_id" {
    null = false
    type = bigint
  }
  # Body は ProseMirror インラインノードの配列。ノート側 comments.body と同じ形・同じ検証
  # （domain.ValidateCommentBody を流用）。
  column "body" {
    null = false
    type = jsonb
  }
  # 編集済みかどうかの印。NULL は未編集。編集履歴の本体（以前の本文）は
  # ticket_comment_edits に積む（この列はここでは正本を持たない）。
  column "edited_at" {
    null = true
    type = timestamptz
  }
  column "deleted_at" {
    null = true
    type = timestamptz
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  unique "uq_ticket_comments_workspace_id" {
    columns = [column.workspace_id, column.id]
  }
  foreign_key "fk_ticket_comments_ticket" {
    columns     = [column.workspace_id, column.ticket_id]
    ref_columns = [table.tickets.column.workspace_id, table.tickets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # 自己参照。親発言は物理削除しない（deleted_at で隠すだけ）ので CASCADE は実質発火しないが、
  # 万一の整合性のために張っておく（他の派生表と同じ防御的な扱い）。
  foreign_key "fk_ticket_comments_parent" {
    columns     = [column.workspace_id, column.parent_comment_id]
    ref_columns = [table.ticket_comments.column.workspace_id, table.ticket_comments.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_ticket_comments_author" {
    columns     = [column.author_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  index "idx_ticket_comments_ticket_created" {
    columns = [column.ticket_id, column.created_at]
  }
  index "idx_ticket_comments_parent" {
    columns = [column.parent_comment_id]
  }
  check "ck_ticket_comments_body_array" {
    expr = "jsonb_typeof(body) = 'array'::text"
  }
}

# ticket_comment_edits: 発言 1 件の編集履歴（段 3）。編集のたびに「編集前」の本文をここへ
# 積んでから ticket_comments.body を書き換える（page_versions と同じ「古い方を退避する」作法）。
# 最新の本文は常に ticket_comments.body にあるので、この表は「昔どうだったか」だけを持つ。
table "ticket_comment_edits" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "comment_id" {
    null = false
    type = uuid
  }
  # 記録: FK は RESTRICT（下の fk_ticket_comment_edits_editor。段 1）。
  column "editor_user_id" {
    null = false
    type = bigint
  }
  column "previous_body" {
    null = false
    type = jsonb
  }
  column "edited_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_ticket_comment_edits_comment" {
    columns     = [column.workspace_id, column.comment_id]
    ref_columns = [table.ticket_comments.column.workspace_id, table.ticket_comments.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_ticket_comment_edits_editor" {
    columns     = [column.editor_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  index "idx_ticket_comment_edits_comment" {
    columns = [column.comment_id, column.edited_at]
  }
  check "ck_ticket_comment_edits_previous_body_array" {
    expr = "jsonb_typeof(previous_body) = 'array'::text"
  }
}

# ticket_comment_reactions: 発言への絵文字反応（段 3）。principals ではなく users.id を直接
# 持つ（担当・ウォッチャーと違い、反応は「その場にいる本人」の行為で、グループ/チームを
# 代理に立てる余地が無いため。ticket_change_groups.actor_user_id と同じ分担）。
table "ticket_comment_reactions" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "comment_id" {
    null = false
    type = uuid
  }
  # 持ち物: 本人の反応なので、本人の行が消えれば一緒に消える（下の fk_ticket_comment_reactions_user。段 1）。
  column "user_id" {
    null = false
    type = bigint
  }
  # 絵文字そのもの（例 "👍"）。ZWJ 連結の家族絵文字等でバイト数が伸びる余地を見て上限は
  # 緩め（32 byte）に取る。1 grapheme かどうかは検証しない（kb ページアイコンと同じ判断）。
  column "emoji" {
    null = false
    type = text
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.comment_id, column.user_id, column.emoji]
  }
  foreign_key "fk_ticket_comment_reactions_comment" {
    columns     = [column.workspace_id, column.comment_id]
    ref_columns = [table.ticket_comments.column.workspace_id, table.ticket_comments.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_ticket_comment_reactions_user" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  check "ck_ticket_comment_reactions_emoji_not_empty" {
    expr = "(emoji <> ''::text) AND (octet_length(emoji) <= 32)"
  }
}

# labels: ワークスペースごとのラベル（名前 + 色）。同名は空白・大文字小文字違いも含めて
# ワークスペース内で作れない（uq_labels_workspace_name の一意。ticket_statuses/ticket_types の
# name_lower と同じ「索引の足場としてだけ使う生成列」の作法だが、ここは trim も畳む — 空白違い
# だけの重複も同じラベル扱いにするため）。
#
# ラベルはページ（page_labels）とチケット（ticket_labels）の両方が引く唯一の語彙で、どちらか
# 一方の入れ物（スペース / プロジェクト）に属させると、もう一方から引けない。ワークスペースを
# 語彙の単位にすることで、ナレッジとバックログを切り離したまま共有できる。
table "labels" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "name" {
    null = false
    type = character_varying(64)
  }
  column "name_key" {
    null = true
    type = character_varying(64)
    as {
      expr = "lower(btrim((name)::text))"
      type = STORED
    }
  }
  column "color" {
    null = false
    type = character_varying(7)
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  column "updated_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  # ticket_labels からの複合 FK の参照先。
  unique "uq_labels_workspace_id" {
    columns = [column.workspace_id, column.id]
  }
  index "uq_labels_workspace_name" {
    unique  = true
    columns = [column.workspace_id, column.name_key]
  }
  check "ck_labels_name_trimmed" {
    expr = "((name)::text = btrim((name)::text)) AND ((name)::text <> ''::text)"
  }
  check "ck_labels_color_hex" {
    expr = "(color)::text ~ '^#[0-9a-f]{6}$'::text"
  }
}

# ticket_labels: チケットとラベルの多対多。付け外しは冪等（複合主キーが重複を吸収する。
# ticket_comment_reactions と同じ形）。
table "ticket_labels" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "ticket_id" {
    null = false
    type = uuid
  }
  column "label_id" {
    null = false
    type = uuid
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.ticket_id, column.label_id]
  }
  foreign_key "fk_ticket_labels_ticket" {
    columns     = [column.workspace_id, column.ticket_id]
    ref_columns = [table.tickets.column.workspace_id, table.tickets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_ticket_labels_label" {
    columns     = [column.workspace_id, column.label_id]
    ref_columns = [table.labels.column.workspace_id, table.labels.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_ticket_labels_label" {
    columns = [column.label_id]
  }
}

# page_labels: ページとラベルの多対多。ticket_labels と同じ形（付け外しは冪等・
# 複合主キーが重複を吸収する）。labels 表そのものはチケット由来だが語彙は共有する
# （ページ専用の labels は作らない）。語彙はワークスペース単位なので、ページ・チケット
# どちらから引いても同じ行を指す。
table "page_labels" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "page_id" {
    null = false
    type = uuid
  }
  column "label_id" {
    null = false
    type = uuid
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.page_id, column.label_id]
  }
  foreign_key "fk_page_labels_page" {
    columns     = [column.workspace_id, column.page_id]
    ref_columns = [table.pages.column.workspace_id, table.pages.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_page_labels_label" {
    columns     = [column.workspace_id, column.label_id]
    ref_columns = [table.labels.column.workspace_id, table.labels.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_page_labels_label" {
    columns = [column.label_id]
  }
}

# ticket_attachments: チケットに添付したファイルのメタデータ。本体は Cloud Storage
# （IMAGES_BUCKET を tickets/<workspaceId>/<ticketId>/ prefix で kb ページ画像等と共有する）。
# 論理削除は持たない（このテーブルを指す子表が無く、undo が要る運用も無いため。ticket_comments
# と違い「消したら本当に消える」でよい判断。段 4・設計 Ⅵ）。
table "ticket_attachments" {
  schema = schema.public
  column "id" {
    null = false
    type = uuid
  }
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "ticket_id" {
    null = false
    type = uuid
  }
  # Cloud Storage のオブジェクトキー。ファイル名をそのままキーへ使わない（経路の組み立て・
  # 特殊文字を避けるため。実際のファイル名は filename に別で持つ。kb ページ画像と同じ流儀）。
  column "key" {
    null = false
    type = text
  }
  column "filename" {
    null = false
    type = character_varying(255)
  }
  column "content_type" {
    null = false
    type = text
  }
  column "size_bytes" {
    null = false
    type = bigint
  }
  # アップロード者（users.id）。記録: FK は RESTRICT（下の fk_ticket_attachments_uploaded_by。段 1）。
  column "uploaded_by_user_id" {
    null = false
    type = bigint
  }
  column "created_at" {
    null    = false
    type    = timestamptz
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
  foreign_key "fk_ticket_attachments_ticket" {
    columns     = [column.workspace_id, column.ticket_id]
    ref_columns = [table.tickets.column.workspace_id, table.tickets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_ticket_attachments_uploaded_by" {
    columns     = [column.uploaded_by_user_id]
    ref_columns = [table.users.column.id]
    on_update   = NO_ACTION
    on_delete   = RESTRICT
  }
  index "idx_ticket_attachments_ticket_created" {
    columns = [column.ticket_id, column.created_at]
  }
  check "ck_ticket_attachments_filename_not_empty" {
    expr = "btrim((filename)::text) <> ''::text"
  }
  check "ck_ticket_attachments_content_type_not_empty" {
    expr = "content_type <> ''::text"
  }
  check "ck_ticket_attachments_size_positive" {
    expr = "size_bytes > 0"
  }
}

# ticket_paths: チケット親子（tickets.parent_id）の閉包表。page_paths と同じ設計
# （祖先・子孫の全組み合わせを depth 付きで持つ派生表。正本は tickets.parent_id、
# 壊れても parent_id から作り直せる）。tickets 側は最大深さ 3 なので ListTicketParentChain
# の再帰 CTE でも検証には足りるが、パンくず表示のような読み取りを O(1) の索引で
# 済ませるためにこの表を持つ（設計 Ⅳ-G）。
table "ticket_paths" {
  schema = schema.public
  column "workspace_id" {
    null = false
    type = uuid
  }
  column "ticket_id" {
    null = false
    type = uuid
  }
  column "ancestor_id" {
    null = false
    type = uuid
  }
  # 祖先までの距離。自分自身が 0、親が 1。
  column "depth" {
    null = false
    type = integer
  }
  primary_key {
    columns = [column.ticket_id, column.ancestor_id]
  }
  # page_paths と同じ理由（コメント参照）: 行自身の workspace_id を軸にした複合 FK にして、
  # 組になる 2 チケットが同じワークスペースに属することを DB 側で保証する。
  foreign_key "fk_ticket_paths_ticket" {
    columns     = [column.workspace_id, column.ticket_id]
    ref_columns = [table.tickets.column.workspace_id, table.tickets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_ticket_paths_ancestor" {
    columns     = [column.workspace_id, column.ancestor_id]
    ref_columns = [table.tickets.column.workspace_id, table.tickets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  index "idx_ticket_paths_workspace_id" {
    columns = [column.workspace_id]
  }
  # 祖先からサブツリーを引く経路（PK は (ticket_id, ancestor_id) なので ancestor_id 単独では効かない）。
  index "idx_ticket_paths_ancestor_id" {
    columns = [column.ancestor_id]
  }
  check "ck_ticket_paths_depth" {
    expr = "(depth >= 0) AND ((depth = 0) = (ticket_id = ancestor_id))"
  }
}

# page_ticket_links: ページ本文の ticketRef ノードから抽出する「ページ→チケット」の派生索引
# （page_links の対の表。ticket_page_links の逆方向ではなく、ページ側が持つ埋め込みの参照）。
# page_links と同じ流儀: source_block_id は単独 FK（テナント境界は書き込み・読み取り側の
# JOIN で決める。schema.hcl の page_links コメント参照）、target_ticket_id も tickets.id への
# 単独 FK（tickets.id 自体が主キーで全テナント一意なので単独 FK で足りる）。
table "page_ticket_links" {
  schema = schema.public
  column "source_block_id" {
    null = false
    type = uuid
  }
  column "target_ticket_id" {
    null = false
    type = uuid
  }
  primary_key {
    columns = [column.source_block_id, column.target_ticket_id]
  }
  foreign_key "fk_page_ticket_links_source_block" {
    columns     = [column.source_block_id]
    ref_columns = [table.blocks.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "fk_page_ticket_links_target_ticket" {
    columns     = [column.target_ticket_id]
    ref_columns = [table.tickets.column.id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  # 逆参照一覧（target_ticket_id からの検索）用の索引。主キーは (source_block_id,
  # target_ticket_id) なので target_ticket_id 単独では効かない。
  index "idx_page_ticket_links_target_ticket_id" {
    columns = [column.target_ticket_id]
  }
}
