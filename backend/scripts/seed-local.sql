-- ローカル開発 / 性能検証用のダミーデータ投入。
--
-- 使い方(Makefile 経由が楽):
--   make local-seed                 # small (既定)
--   make local-seed SIZE=medium
--   make local-seed SIZE=large
--
-- 直接流す場合:
--   psql "$DSN" -v size=medium -f scripts/seed-local.sql
--
-- 前提: backend を一度起動してスキーマ適用済みであること(このスクリプトは
-- テーブルを作らない。スキーマの正本は infra/database/schema/*.sql + migrations/*.sql)。
--
-- 設計方針:
--   - ORM のループ INSERT ではなく generate_series で一括生成する(桁違いに速い)
--   - setseed() で乱数を固定し、誰が何度流しても同じデータになるようにする
--     (実行計画の比較には再現性が必須。ばらつくと前後比較が意味を失う)
--   - 冪等にする。再実行時は自分が入れた範囲だけを消してから入れ直す
--   - 本物の教材本文は非公開リポが正本のため、ここでは触れずダミー文言を使う
--   - ナレッジ(workspace/space/page/block)だけは SIZE に関わらず固定セットを入れる。
--     bulk データ(users 等)と違って「実行計画の比較用の量」ではなく、運営管理者
--     (admin@example.com)でログインしたときにナレッジ機能が空っぽに見えないようにする
--     のが目的のため、量を増やす理由が無い。ワークスペース切り替え UI を確認できるよう、
--     個人ワークスペース 1 つ + チーム共有ワークスペース 2 つの計 3 つを用意する

\set ON_ERROR_STOP on

-- サイズ未指定なら small。
\if :{?size}
\else
  \set size 'small'
\endif

-- 乱数の固定。以降の random() はこの seed から決まる。
SELECT setseed(0.42);

-- 規模の定義。ダミーデータの範囲を判別できるよう、ID は SEED_ID_BASE 以降に採番する
-- (既存の実データや教材 seed と衝突させない。撤去もこの範囲だけ消せばよい)。
-- courses / course_chapters は全廃済みのテーブルなので n_courses / chapters_per_course は
-- 持たない(かつては courses / course_chapters / user_chapter_progress / user_chapter_views の
-- 規模指定に使っていたが、いずれも現行 schema.hcl に存在しない)。
CREATE TEMP TABLE _cfg AS
SELECT
  CASE :'size' WHEN 'small' THEN 100 WHEN 'medium' THEN 1000 WHEN 'large' THEN 10000 END::int  AS n_users,
  CASE :'size' WHEN 'small' THEN  30 WHEN 'medium' THEN  180 WHEN 'large' THEN   365 END::int  AS activity_days,
  1000000::bigint AS id_base;

-- 許可外の size を弾く。CASE がどれにも一致しないと NULL になり、
-- generate_series(1, NULL) が 0 行を返すため「DELETE だけが効いて何も入らない」
-- という最悪の結果になる(既存のシードを消したうえで空になる)。
-- 破壊的な DELETE が走る前にここで止める。
DO $$
BEGIN
  IF (SELECT n_users FROM _cfg) IS NULL THEN
    RAISE EXCEPTION 'size は small / medium / large のいずれかを指定してください';
  END IF;
END $$;

-- 規模の値を psql 変数へ取り込む(以降 :n_users のように埋め込んで使う)。
SELECT n_users, activity_days
  FROM _cfg \gset

\echo '=== seed-local: size =' :'size' '/ users =' :n_users

-- ナレッジ(workspace/space/page/block)に使う固定 ID。
--
-- bulk データ(users 等)と違って UUID 主キーなので「id >= 1000000」のような範囲では
-- 判別できない。その代わり、再実行しても同じ値になるよう決め打ちの UUID を使う
-- (id の第 2 グループに 16 進として読める "5eed" を置いているのは、pg_stat 等で
-- このスクリプトが入れた行だと一目で分かるようにするための目印で、値そのものに意味はない)。
-- ページ本文の blocks だけは gen_random_uuid()(PostgreSQL 13+ 組み込み。pgcrypto 拡張は不要)
-- で採番する — 他のどこからも固定値で参照されないため、再実行のたびに変わっても問題ない。
-- ワークスペース 1: 運営管理者(1000000)の個人ワークスペース。
\set kb_workspace_id '00000000-5eed-0000-0000-000000000001'
\set kb_principal_admin_id '00000000-5eed-0000-0000-000000000002'
\set kb_space_dev_id '00000000-5eed-0000-0000-0000000000a1'
\set kb_space_handbook_id '00000000-5eed-0000-0000-0000000000a2'
\set kb_page_onboarding_id '00000000-5eed-0000-0000-0000000000b1'
\set kb_page_local_setup_id '00000000-5eed-0000-0000-0000000000b2'
\set kb_page_local_setup_faq_id '00000000-5eed-0000-0000-0000000000b3'
\set kb_page_architecture_id '00000000-5eed-0000-0000-0000000000b4'
\set kb_page_faq_id '00000000-5eed-0000-0000-0000000000b5'
-- バックログ（プロジェクト）。ナレッジのスペースとは無関係の別の入れ物。
\set pj_project_id '00000000-5eed-0000-0000-0000000000e1'
\set pj_status_todo_id '00000000-5eed-0000-0000-0000000000e2'
\set pj_status_doing_id '00000000-5eed-0000-0000-0000000000e3'
\set pj_status_done_id '00000000-5eed-0000-0000-0000000000e4'
\set pj_type_task_id '00000000-5eed-0000-0000-0000000000e5'
\set pj_type_bug_id '00000000-5eed-0000-0000-0000000000e6'
-- チケットの id も固定する。並び順は別表（ticket_backlog_ranks）に入れるので、
-- gen_random_uuid() だと後から参照できない。
\set pj_ticket_setup_id '00000000-5eed-0000-0000-0000000000e7'
\set pj_ticket_backlog_id '00000000-5eed-0000-0000-0000000000e8'
\set pj_ticket_search_id '00000000-5eed-0000-0000-0000000000e9'

-- ワークスペース 2: チーム共有ワークスペースの例(personal_owner_user_id は NULL)。
-- メンバーは運営管理者(admin)に加え、bulk の seed1 / seed2(editor / viewer)。
\set kb_workspace_alpha_id '00000000-5eed-0000-0000-000000000011'
\set kb_principal_alpha_admin_id '00000000-5eed-0000-0000-000000000021'
\set kb_principal_alpha_seed1_id '00000000-5eed-0000-0000-000000000022'
\set kb_principal_alpha_seed2_id '00000000-5eed-0000-0000-000000000023'
\set kb_space_requirements_id '00000000-5eed-0000-0000-0000000000c1'
\set kb_page_requirements_doc_id '00000000-5eed-0000-0000-0000000000d1'
\set kb_page_screen_list_id '00000000-5eed-0000-0000-0000000000d2'

-- ワークスペース 3: もう 1 つのチーム共有ワークスペースの例。メンバーは admin と seed3(editor)。
\set kb_workspace_support_id '00000000-5eed-0000-0000-000000000012'
\set kb_principal_support_admin_id '00000000-5eed-0000-0000-000000000031'
\set kb_principal_support_seed3_id '00000000-5eed-0000-0000-000000000032'
\set kb_space_operations_id '00000000-5eed-0000-0000-0000000000c2'
\set kb_page_support_manual_id '00000000-5eed-0000-0000-0000000000d3'
\set kb_page_escalation_id '00000000-5eed-0000-0000-0000000000d4'

-- 依存の子から消す(FK が無くても順序は揃えておく)。
BEGIN;

-- ナレッジ(workspaces 配下)を先に消す。pages.created_by_user_id が users を指す
-- RESTRICT 系の外部キー(fk_pages_created_by。段 1「users.id を指す列に外部キーを張る」で
-- 追加)を持つため、users を先に消すと「まだ pages から参照されている」で 2 回目以降の
-- 実行が失敗する(1 回目は pages が空なので気づけない)。workspaces を消せば配下
-- (spaces / pages / blocks / page_paths / page_snapshots / principals / workspace_grants /
-- space_grants / page_grants)が ON DELETE CASCADE で全部まとめて消える(schema.hcl 参照)。
-- bulk データのように子テーブルから順に DELETE する必要は無い。3 つとも
-- (個人ワークスペース + チーム共有ワークスペース 2 つ)ここでまとめて消す。
DELETE FROM workspaces
WHERE id IN (:'kb_workspace_id', :'kb_workspace_alpha_id', :'kb_workspace_support_id');

DELETE FROM profiles
WHERE user_id >= 1000000;

DELETE FROM user_oidc_identities
WHERE user_id >= 1000000;

DELETE FROM users
WHERE id >= 1000000;

-- ---- users ----------------------------------------------------------------
-- companies / roles テーブルは会社→ワークスペース移行のレガシー橋渡し撤去(#2413)で
-- 全廃済みなので、もう company_id 経由で workspace_id を引けないし role_id 列自体も無い。
-- アプリ全体の運営管理者という概念自体を持たない（権限は workspace/space/page 単位の
-- grant だけで表現する。domain.GrantRole 参照）ため、ここに判定材料を持たせる必要も無い。
-- パスワード検証は DB 側ではなく Dex(docker/idp/config.yaml の staticPasswords)側が持つ。
-- users.password_hash 列自体が撤去済みなので、そもそも投入するものが無い。
-- 所属先は users 側にはもう無い(users.workspace_id は段 2 で撤去済み)。所属は
-- workspace_members が正本(下のナレッジのセクションで運営管理者だけ実際に作る)。
INSERT INTO users (id, email, name, status, created_at, updated_at)
SELECT
  1000000 + i,
  'seed' || i || '@example.test',
  'シード利用者' || i,
  'active',
  now() - (random() * 365)::int * interval '1 day',
  now()
FROM generate_series(1, :n_users) AS i;

-- オフラインで管理画面まで触れるよう、運営管理者を 1 人入れる
-- (admin@example.com / password。Dex 側の docker/idp/config.yaml staticPasswords で認証する)。
-- id 1000000 は連番（1000000 + i, i >= 1）と衝突しない。
INSERT INTO users (id, email, name, status, created_at, updated_at)
VALUES (
  1000000, 'admin@example.com', 'シード運営管理者', 'active', now(), now()
);

-- OIDC identity（正規化後のログイン突き合わせの正）。
--
-- bulk の seed1..N@example.test には Dex 側に対応する staticPasswords が無く、実際には
-- 誰もログインしない(実行計画の比較用にダミーデータの量を作るためだけに存在する)ので、
-- subject はダミー文字列のままでよい。provider は "oidc" 固定
-- (domain.OidcProviderDefault。特定の発行者を指さない既定の鍵なので、
-- 発行者を Dex に変えてもこの値は変えない)。
INSERT INTO user_oidc_identities (user_id, provider, subject, created_at, updated_at)
SELECT 1000000 + i, 'oidc', 'seed-sub-' || i, now(), now()
FROM generate_series(1, :n_users) AS i;

-- 運営管理者(id 1000000)は実際に Dex でログインするため、Dex が本当に発行する sub と
-- 一致させる必要がある。Dex の password connector が返す sub は、
-- userID(docker/idp/config.yaml の staticPasswords[].userID)とコネクタ名の固定値
-- "local" を internal.IDTokenSubject 相当の protobuf メッセージ
-- (field 1 = userID, field 2 = connector id)に詰めて base64url(パディング無し)した値
-- になる(公式ドキュメントには明記が無いため、実際に Dex が発行した id_token をデコードして
-- 実測・確認済み)。以下は生の protobuf バイト列を手で組み立てて同じ値を再現している:
--   \x0a <userID の長さ(1 byte)> <userID>  -- タグ 0x0a = field 1, wiretype 2(length-delimited)
--   \x12 <"local" の長さ(1 byte)> local    -- タグ 0x12 = field 2, wiretype 2
-- 長さを 1 byte(set_byte)で埋めているため、userID / "local" が 128 byte 未満
-- (protobuf のごく短い varint 長が 1 byte に収まる範囲)であることが前提
-- (このユースケースでは常に成立する)。
-- 標準 base64 の '+' '/' を '-' '_' に translate し、'=' パディングを rtrim で落として
-- base64url 化している。
--
-- ここで使う userID('seed-sub-admin')は docker/idp/config.yaml の
-- staticPasswords[].userID と完全に一致させること。ずれると、Dex が発行する sub が
-- ここに登録した subject と一致せず、ログイン時に「未知の sub」として
-- 新規サインアップが走り、既に使われている admin@example.com で 409 email_taken になる。
INSERT INTO user_oidc_identities (user_id, provider, subject, created_at, updated_at)
SELECT
  1000000,
  'oidc',
  rtrim(translate(encode(
    '\x0a'::bytea || set_byte('\x00'::bytea, 0, octet_length(u)) || convert_to(u, 'UTF8') ||
    '\x12'::bytea || set_byte('\x00'::bytea, 0, octet_length('local')) || convert_to('local', 'UTF8'),
    'base64'
  ), E'+/\n', '-_'), '='),
  now(),
  now()
FROM (SELECT 'seed-sub-admin'::text AS u) AS dex_local_subject;

INSERT INTO profiles (user_id, bio, avatar_url, status_text, updated_at)
SELECT 1000000 + i, 'シード用の自己紹介文です。', '', '学習中', now()
FROM generate_series(1, :n_users) AS i;

INSERT INTO profiles (user_id, bio, avatar_url, status_text, updated_at)
VALUES (1000000, 'シード運営管理者です。', '', '運用中', now());

-- ---- ナレッジ(workspace/space/page/block) ------------------------------------
-- 運営管理者(id 1000000)専用の個人ワークスペースを 1 つ用意する。
--
-- EnsurePersonalWorkspaceUseCase はログインのたびに
-- 「personal_owner_user_id = 自分 の workspace が無ければ作る」を実行する
-- (kb_ensure_personal_workspace_usecase.go)。ここで先に 1 行入れておけば、
-- ローカルで admin@example.com としてログインしたときに新規の空ワークスペースを
-- 作らせず、この seed の内容がそのまま「自分のワークスペース」として使われる
-- (GetPersonalWorkspaceByOwner は personal_owner_user_id の一致だけを見る
-- 単純な SELECT なので、slug やレコードの作成経路までは区別しない)。
--
-- 本物のワークスペース作成(ProvisionWorkspace)がやることを SQL でそのまま再現する:
--   workspaces を 1 行 → 作成者を workspace_members へ active で記録する(段 2)
--   → principals(kind='user') で所属させる → workspace_grants で admin を張る
--   (所属だけでは何も見えない)。
INSERT INTO workspaces (id, slug, name, personal_owner_user_id)
VALUES (:'kb_workspace_id', 'local-dev', 'ローカル開発サンプル', 1000000);

INSERT INTO workspace_members (workspace_id, user_id, status, joined_at)
VALUES (:'kb_workspace_id', 1000000, 'active', now());

INSERT INTO principals (id, workspace_id, kind, user_id)
VALUES (:'kb_principal_admin_id', :'kb_workspace_id', 'user', 1000000);

INSERT INTO workspace_grants (workspace_id, principal_id, role)
VALUES (:'kb_workspace_id', :'kb_principal_admin_id', 'admin');

-- スペースは 2 つとも visibility='workspace'(既定の共有スペース)。上の workspace_grants
-- がそのまま届くので、private スペースと違って space_grants を別に張る必要は無い。
INSERT INTO spaces (id, workspace_id, "key", name, visibility)
VALUES
  (:'kb_space_dev_id',      :'kb_workspace_id', 'dev',      '開発ナレッジ',   'workspace'),
  (:'kb_space_handbook_id', :'kb_workspace_id', 'handbook', 'ハンドブック', 'workspace');

-- ページは親→子の順で INSERT する(pages.parent_id は同じ workspace_id/space_id の
-- 既存ページしか参照できない複合 FK なので、子を先には入れられない)。
-- position は fracindex.Between が実際に振る値と同じ形("a0" が 1 件目、"a1" が 2 件目 …)。
-- ここでは件数が少なく並べ替えも起きないため、採番ロジックを呼ばずに決め打ちで足りる。
INSERT INTO pages (id, workspace_id, space_id, parent_id, "position", title, created_by_user_id)
VALUES (:'kb_page_onboarding_id', :'kb_workspace_id', :'kb_space_dev_id', NULL, 'a0', 'オンボーディング', 1000000);

INSERT INTO pages (id, workspace_id, space_id, parent_id, "position", title, created_by_user_id)
VALUES (:'kb_page_local_setup_id', :'kb_workspace_id', :'kb_space_dev_id', :'kb_page_onboarding_id', 'a0', 'ローカル環境構築', 1000000);

INSERT INTO pages (id, workspace_id, space_id, parent_id, "position", title, created_by_user_id)
VALUES (:'kb_page_local_setup_faq_id', :'kb_workspace_id', :'kb_space_dev_id', :'kb_page_local_setup_id', 'a0', 'よくある詰まりどころ', 1000000);

INSERT INTO pages (id, workspace_id, space_id, parent_id, "position", title, created_by_user_id)
VALUES (:'kb_page_architecture_id', :'kb_workspace_id', :'kb_space_dev_id', NULL, 'a1', 'アーキテクチャ概要', 1000000);

INSERT INTO pages (id, workspace_id, space_id, parent_id, "position", title, created_by_user_id)
VALUES (:'kb_page_faq_id', :'kb_workspace_id', :'kb_space_handbook_id', NULL, 'a0', 'よくある質問', 1000000);

-- page_paths は pages.parent_id から導ける派生データ(closure table)。正本である
-- pages 側は上で正しく作ってあるので、ここは木の形どおりに depth を手で書き下すだけでよい
-- (自分自身の depth=0 の行も必須。ck_page_paths_depth が「depth=0 ⇔ 自己参照」を強制する)。
INSERT INTO page_paths (workspace_id, page_id, ancestor_id, depth)
VALUES
  (:'kb_workspace_id', :'kb_page_onboarding_id',      :'kb_page_onboarding_id',      0),
  (:'kb_workspace_id', :'kb_page_local_setup_id',      :'kb_page_local_setup_id',      0),
  (:'kb_workspace_id', :'kb_page_local_setup_id',      :'kb_page_onboarding_id',       1),
  (:'kb_workspace_id', :'kb_page_local_setup_faq_id',  :'kb_page_local_setup_faq_id',  0),
  (:'kb_workspace_id', :'kb_page_local_setup_faq_id',  :'kb_page_local_setup_id',      1),
  (:'kb_workspace_id', :'kb_page_local_setup_faq_id',  :'kb_page_onboarding_id',       2),
  (:'kb_workspace_id', :'kb_page_architecture_id',     :'kb_page_architecture_id',     0),
  (:'kb_workspace_id', :'kb_page_faq_id',               :'kb_page_faq_id',              0);

-- ブロック(ページ本文)。page_snapshots(読み取りキャッシュ)は書かない — GetPageUseCase は
-- snapshot が無ければ blocks から組み立てて返すので無くても表示できる(kb_page_usecase.go)。
-- attrs は「属性が無いノードでも {}」という規約(ck_blocks_attrs_object)。
-- inline は葉ノード(見出し/段落/コードブロック)だけが持ち、容器ノード(bulletList/listItem)は
-- NULL のまま子をブロック行として持つ。
--
-- 「オンボーディング」— フラットな見出し + 段落だけなので 1 回の多行 INSERT で足りる。
INSERT INTO blocks (id, workspace_id, page_id, parent_id, "position", type, attrs, inline)
VALUES
  (gen_random_uuid(), :'kb_workspace_id', :'kb_page_onboarding_id', NULL, 'a0', 'heading',
   '{"level":2}'::jsonb, '[{"type":"text","text":"はじめに"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_id', :'kb_page_onboarding_id', NULL, 'a1', 'paragraph',
   '{}'::jsonb, '[{"type":"text","text":"このワークスペースは backend ディレクトリで make local-seed を実行すると作られるサンプルのナレッジです。"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_id', :'kb_page_onboarding_id', NULL, 'a2', 'paragraph',
   '{}'::jsonb, '[{"type":"text","text":"ログインは admin@example.com / password(Dex の staticPasswords によるダミーアカウント)です。"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_id', :'kb_page_onboarding_id', NULL, 'a3', 'paragraph',
   '{}'::jsonb, '[{"type":"text","text":"左のサイドバーから他のページも開いてみてください。"}]'::jsonb);

-- 「ローカル環境構築」— codeBlock は language を attrs に持つ。
INSERT INTO blocks (id, workspace_id, page_id, parent_id, "position", type, attrs, inline)
VALUES
  (gen_random_uuid(), :'kb_workspace_id', :'kb_page_local_setup_id', NULL, 'a0', 'heading',
   '{"level":2}'::jsonb, '[{"type":"text","text":"起動手順"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_id', :'kb_page_local_setup_id', NULL, 'a1', 'codeBlock',
   '{"language":"bash"}'::jsonb, '[{"type":"text","text":"docker compose up -d"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_id', :'kb_page_local_setup_id', NULL, 'a2', 'paragraph',
   '{}'::jsonb, '[{"type":"text","text":"初回起動時に schema.gen.sql が db コンテナへ自動で適用されます。"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_id', :'kb_page_local_setup_id', NULL, 'a3', 'paragraph',
   '{}'::jsonb, '[{"type":"text","text":"サンプルデータの投入は backend ディレクトリで make local-seed を実行します。"}]'::jsonb);

-- 「よくある詰まりどころ」— bulletList(容器)> listItem(容器)> paragraph(葉) の入れ子を含む。
-- 親のブロック id を後続の INSERT が参照する必要があるため、多行 VALUES ではなく
-- INSERT ... RETURNING を CTE で繋いで 1 文にする(WITH の最後は必ず本体の INSERT/SELECT に
-- なる必要があるので、最後の 1 行だけ CTE の外に出している)。
WITH
  heading AS (
    INSERT INTO blocks (id, workspace_id, page_id, parent_id, "position", type, attrs, inline)
    VALUES (gen_random_uuid(), :'kb_workspace_id', :'kb_page_local_setup_faq_id', NULL, 'a0', 'heading',
            '{"level":2}'::jsonb, '[{"type":"text","text":"ポートが競合する"}]'::jsonb)
    RETURNING id
  ),
  intro AS (
    INSERT INTO blocks (id, workspace_id, page_id, parent_id, "position", type, attrs, inline)
    VALUES (gen_random_uuid(), :'kb_workspace_id', :'kb_page_local_setup_faq_id', NULL, 'a1', 'paragraph',
            '{}'::jsonb, '[{"type":"text","text":"既定では 5432 番ポートを db コンテナが使います。手元で別の PostgreSQL が動いていると起動に失敗します。"}]'::jsonb)
    RETURNING id
  ),
  list AS (
    INSERT INTO blocks (id, workspace_id, page_id, parent_id, "position", type, attrs, inline)
    VALUES (gen_random_uuid(), :'kb_workspace_id', :'kb_page_local_setup_faq_id', NULL, 'a2', 'bulletList',
            '{}'::jsonb, NULL)
    RETURNING id
  ),
  item1 AS (
    INSERT INTO blocks (id, workspace_id, page_id, parent_id, "position", type, attrs, inline)
    SELECT gen_random_uuid(), :'kb_workspace_id', :'kb_page_local_setup_faq_id', list.id, 'a0', 'listItem', '{}'::jsonb, NULL
    FROM list
    RETURNING id
  ),
  item1_text AS (
    INSERT INTO blocks (id, workspace_id, page_id, parent_id, "position", type, attrs, inline)
    SELECT gen_random_uuid(), :'kb_workspace_id', :'kb_page_local_setup_faq_id', item1.id, 'a0', 'paragraph',
           '{}'::jsonb, '[{"type":"text","text":"確認: lsof -i :5432"}]'::jsonb
    FROM item1
    RETURNING id
  ),
  item2 AS (
    INSERT INTO blocks (id, workspace_id, page_id, parent_id, "position", type, attrs, inline)
    SELECT gen_random_uuid(), :'kb_workspace_id', :'kb_page_local_setup_faq_id', list.id, 'a1', 'listItem', '{}'::jsonb, NULL
    FROM list
    RETURNING id
  )
INSERT INTO blocks (id, workspace_id, page_id, parent_id, "position", type, attrs, inline)
SELECT gen_random_uuid(), :'kb_workspace_id', :'kb_page_local_setup_faq_id', item2.id, 'a0', 'paragraph',
       '{}'::jsonb, '[{"type":"text","text":"対処: 既存の PostgreSQL を止めるか、.env の LOCAL_DB_PORT を変更する"}]'::jsonb
FROM item2;

-- 「アーキテクチャ概要」
INSERT INTO blocks (id, workspace_id, page_id, parent_id, "position", type, attrs, inline)
VALUES
  (gen_random_uuid(), :'kb_workspace_id', :'kb_page_architecture_id', NULL, 'a0', 'heading',
   '{"level":2}'::jsonb, '[{"type":"text","text":"レイヤー構成"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_id', :'kb_page_architecture_id', NULL, 'a1', 'paragraph',
   '{}'::jsonb, '[{"type":"text","text":"handler → usecase → repository/infra → domain の一方向依存です。"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_id', :'kb_page_architecture_id', NULL, 'a2', 'paragraph',
   '{}'::jsonb, '[{"type":"text","text":"詳しくはリポジトリ直下の AGENTS.md を参照してください。"}]'::jsonb);

-- 「よくある質問」(ハンドブック側)
INSERT INTO blocks (id, workspace_id, page_id, parent_id, "position", type, attrs, inline)
VALUES
  (gen_random_uuid(), :'kb_workspace_id', :'kb_page_faq_id', NULL, 'a0', 'heading',
   '{"level":2}'::jsonb, '[{"type":"text","text":"Q. ログインできない"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_id', :'kb_page_faq_id', NULL, 'a1', 'paragraph',
   '{}'::jsonb, '[{"type":"text","text":"A. docker compose up -d で idp(Dex)コンテナが起動しているか確認してください。"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_id', :'kb_page_faq_id', NULL, 'a2', 'heading',
   '{"level":2}'::jsonb, '[{"type":"text","text":"Q. ナレッジのページが空っぽ"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_id', :'kb_page_faq_id', NULL, 'a3', 'paragraph',
   '{}'::jsonb, '[{"type":"text","text":"A. backend ディレクトリで make local-seed を実行するとサンプルのナレッジが作られます。"}]'::jsonb);

-- ---- 複数ワークスペースの例 --------------------------------------------------
-- ワークスペース一覧・切り替え UI が実際に複数件を返す状態を確認できるよう、上の
-- 個人ワークスペースとは別にチーム共有のワークスペース(personal_owner_user_id は NULL)を
-- 2 つ追加する。運営管理者(1000000)に加え、bulk で作った seed1〜3(1000001〜1000003。
-- :n_users は SIZE=small でも最低 100 なので必ず存在する)をメンバーに加え、
-- メンバー一覧・権限一覧の画面も admin 単独では見えない「他のロール」を確認できるようにする。
INSERT INTO workspaces (id, slug, name, personal_owner_user_id)
VALUES
  (:'kb_workspace_alpha_id',   'project-alpha', 'プロジェクトαチーム', NULL),
  (:'kb_workspace_support_id', 'support-team',  'サポートチーム',       NULL);

INSERT INTO workspace_members (workspace_id, user_id, status, joined_at)
VALUES
  (:'kb_workspace_alpha_id',   1000000, 'active', now()),
  (:'kb_workspace_alpha_id',   1000001, 'active', now()),
  (:'kb_workspace_alpha_id',   1000002, 'active', now()),
  (:'kb_workspace_support_id', 1000000, 'active', now()),
  (:'kb_workspace_support_id', 1000003, 'active', now());

INSERT INTO principals (id, workspace_id, kind, user_id)
VALUES
  (:'kb_principal_alpha_admin_id',   :'kb_workspace_alpha_id',   'user', 1000000),
  (:'kb_principal_alpha_seed1_id',   :'kb_workspace_alpha_id',   'user', 1000001),
  (:'kb_principal_alpha_seed2_id',   :'kb_workspace_alpha_id',   'user', 1000002),
  (:'kb_principal_support_admin_id', :'kb_workspace_support_id', 'user', 1000000),
  (:'kb_principal_support_seed3_id', :'kb_workspace_support_id', 'user', 1000003);

INSERT INTO workspace_grants (workspace_id, principal_id, role)
VALUES
  (:'kb_workspace_alpha_id',   :'kb_principal_alpha_admin_id',   'admin'),
  (:'kb_workspace_alpha_id',   :'kb_principal_alpha_seed1_id',   'editor'),
  (:'kb_workspace_alpha_id',   :'kb_principal_alpha_seed2_id',   'viewer'),
  (:'kb_workspace_support_id', :'kb_principal_support_admin_id', 'admin'),
  (:'kb_workspace_support_id', :'kb_principal_support_seed3_id', 'editor');

INSERT INTO spaces (id, workspace_id, "key", name, visibility)
VALUES
  (:'kb_space_requirements_id', :'kb_workspace_alpha_id',   'requirements', '要件定義', 'workspace'),
  (:'kb_space_operations_id',   :'kb_workspace_support_id', 'operations',   '運用',     'workspace');

INSERT INTO pages (id, workspace_id, space_id, parent_id, "position", title, created_by_user_id)
VALUES (:'kb_page_requirements_doc_id', :'kb_workspace_alpha_id', :'kb_space_requirements_id', NULL, 'a0', '要件定義書', 1000000);

INSERT INTO pages (id, workspace_id, space_id, parent_id, "position", title, created_by_user_id)
VALUES (:'kb_page_screen_list_id', :'kb_workspace_alpha_id', :'kb_space_requirements_id', NULL, 'a1', '画面一覧', 1000000);

INSERT INTO pages (id, workspace_id, space_id, parent_id, "position", title, created_by_user_id)
VALUES (:'kb_page_support_manual_id', :'kb_workspace_support_id', :'kb_space_operations_id', NULL, 'a0', '問い合わせ対応マニュアル', 1000000);

INSERT INTO pages (id, workspace_id, space_id, parent_id, "position", title, created_by_user_id)
VALUES (:'kb_page_escalation_id', :'kb_workspace_support_id', :'kb_space_operations_id', :'kb_page_support_manual_id', 'a0', 'エスカレーション基準', 1000000);

INSERT INTO page_paths (workspace_id, page_id, ancestor_id, depth)
VALUES
  (:'kb_workspace_alpha_id',   :'kb_page_requirements_doc_id', :'kb_page_requirements_doc_id', 0),
  (:'kb_workspace_alpha_id',   :'kb_page_screen_list_id',      :'kb_page_screen_list_id',      0),
  (:'kb_workspace_support_id', :'kb_page_support_manual_id',   :'kb_page_support_manual_id',   0),
  (:'kb_workspace_support_id', :'kb_page_escalation_id',       :'kb_page_escalation_id',       0),
  (:'kb_workspace_support_id', :'kb_page_escalation_id',       :'kb_page_support_manual_id',   1);

-- 「要件定義書」
INSERT INTO blocks (id, workspace_id, page_id, parent_id, "position", type, attrs, inline)
VALUES
  (gen_random_uuid(), :'kb_workspace_alpha_id', :'kb_page_requirements_doc_id', NULL, 'a0', 'heading',
   '{"level":2}'::jsonb, '[{"type":"text","text":"背景"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_alpha_id', :'kb_page_requirements_doc_id', NULL, 'a1', 'paragraph',
   '{}'::jsonb, '[{"type":"text","text":"ダミーの要件定義ページです。実際の要件はここに書きます。"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_alpha_id', :'kb_page_requirements_doc_id', NULL, 'a2', 'heading',
   '{"level":2}'::jsonb, '[{"type":"text","text":"スコープ"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_alpha_id', :'kb_page_requirements_doc_id', NULL, 'a3', 'paragraph',
   '{}'::jsonb, '[{"type":"text","text":"このワークスペースは、ワークスペースが複数あるときの表示を確認するための seed データです。"}]'::jsonb);

-- 「画面一覧」
INSERT INTO blocks (id, workspace_id, page_id, parent_id, "position", type, attrs, inline)
VALUES
  (gen_random_uuid(), :'kb_workspace_alpha_id', :'kb_page_screen_list_id', NULL, 'a0', 'heading',
   '{"level":2}'::jsonb, '[{"type":"text","text":"画面一覧"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_alpha_id', :'kb_page_screen_list_id', NULL, 'a1', 'paragraph',
   '{}'::jsonb, '[{"type":"text","text":"トップ画面・詳細画面・設定画面の 3 つを予定(ダミー文言)。"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_alpha_id', :'kb_page_screen_list_id', NULL, 'a2', 'paragraph',
   '{}'::jsonb, '[{"type":"text","text":"詳細はデザイン担当と調整中です。"}]'::jsonb);

-- 「問い合わせ対応マニュアル」
INSERT INTO blocks (id, workspace_id, page_id, parent_id, "position", type, attrs, inline)
VALUES
  (gen_random_uuid(), :'kb_workspace_support_id', :'kb_page_support_manual_id', NULL, 'a0', 'heading',
   '{"level":2}'::jsonb, '[{"type":"text","text":"対応の流れ"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_support_id', :'kb_page_support_manual_id', NULL, 'a1', 'paragraph',
   '{}'::jsonb, '[{"type":"text","text":"受付 → 一次回答 → エスカレーション判断 → クローズ、の 4 ステップです(ダミー文言)。"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_support_id', :'kb_page_support_manual_id', NULL, 'a2', 'paragraph',
   '{}'::jsonb, '[{"type":"text","text":"詳細な手順は各チームのハンドブックを参照してください。"}]'::jsonb);

-- 「エスカレーション基準」(「問い合わせ対応マニュアル」の子ページ)
INSERT INTO blocks (id, workspace_id, page_id, parent_id, "position", type, attrs, inline)
VALUES
  (gen_random_uuid(), :'kb_workspace_support_id', :'kb_page_escalation_id', NULL, 'a0', 'heading',
   '{"level":2}'::jsonb, '[{"type":"text","text":"エスカレーションする条件"}]'::jsonb),
  (gen_random_uuid(), :'kb_workspace_support_id', :'kb_page_escalation_id', NULL, 'a1', 'paragraph',
   '{}'::jsonb, '[{"type":"text","text":"重大度が高い、または一次回答から 24 時間解決しない場合(ダミー文言)。"}]'::jsonb);

-- ---- バックログ（プロジェクト・チケット・版・チーム・スプリント）----------------
--
-- 画面を目で確かめるには「1 件だけ」では足りない。並べ替え・絞り込み・スプリントの
-- 出し分け・チームや版の付け外しは、どれも**複数あって初めて**確かめられる。
-- そこで 3 プロジェクト / 約 50 チケット / 10 人のメンバーを入れる。
--
-- 固定 ID を使うのは最初のプロジェクトの土台だけ。チケットやその派生は
-- generate_series で作り、以降は tickets を読み直して組み立てる（id を数え上げない）。

-- 運営管理者に加えて 9 人をこのワークスペースのメンバーにする（bulk で作った
-- seed1..N の先頭を使い回す）。principals はチケットの担当に要る。
INSERT INTO workspace_members (workspace_id, user_id, status, joined_at)
SELECT :'kb_workspace_id', 1000000 + i, 'active', now()
FROM generate_series(1, 9) AS i
ON CONFLICT DO NOTHING;

INSERT INTO principals (id, workspace_id, kind, user_id)
SELECT
  ('00000000-5eed-0001-0000-' || lpad(i::text, 12, '0'))::uuid,
  :'kb_workspace_id', 'user', 1000000 + i
FROM generate_series(1, 9) AS i
ON CONFLICT DO NOTHING;

INSERT INTO workspace_grants (workspace_id, principal_id, role)
SELECT :'kb_workspace_id', p.id, CASE WHEN p.user_id % 3 = 0 THEN 'admin' ELSE 'editor' END
FROM principals p
WHERE p.workspace_id = :'kb_workspace_id' AND p.user_id BETWEEN 1000001 AND 1000009
ON CONFLICT DO NOTHING;

-- プロジェクトは 3 つ。切替・横断（自分の担当）を確かめるために複数要る。
INSERT INTO projects (id, workspace_id, "key", name)
VALUES
  (:'pj_project_id',                                   :'kb_workspace_id', 'local', 'ローカル開発'),
  ('00000000-5eed-0002-0000-000000000001'::uuid,       :'kb_workspace_id', 'app',   'アプリ本体'),
  ('00000000-5eed-0002-0000-000000000002'::uuid,       :'kb_workspace_id', 'infra', '基盤・運用');

-- 状態・種別・採番カウンタは 3 プロジェクトぶん同じ形で作る。
INSERT INTO ticket_statuses (id, workspace_id, project_id, name, category, color, "position", is_initial)
SELECT
  ('00000000-5eed-0003-' || lpad(pj.n::text, 4, '0') || '-' || lpad(s.n::text, 12, '0'))::uuid,
  :'kb_workspace_id', pj.id, s.name, s.category, s.color, s.pos, s.n = 1
FROM (VALUES
  (1, :'pj_project_id'::uuid),
  (2, '00000000-5eed-0002-0000-000000000001'::uuid),
  (3, '00000000-5eed-0002-0000-000000000002'::uuid)
) AS pj(n, id)
CROSS JOIN (VALUES
  (1, 'To Do',    'todo',        '#5b6b7a', 'a0'),
  (2, '開発',     'in_progress', '#a0661a', 'a1'),
  (3, 'レビュー', 'in_progress', '#1d4ed8', 'a2'),
  (4, 'リリース', 'done',        '#2f6b47', 'a3')
) AS s(n, name, category, color, pos);

INSERT INTO ticket_types (id, workspace_id, project_id, name, hierarchy_level, color, "position", is_default)
SELECT
  ('00000000-5eed-0004-' || lpad(pj.n::text, 4, '0') || '-' || lpad(t.n::text, 12, '0'))::uuid,
  :'kb_workspace_id', pj.id, t.name, 0, t.color, t.pos, t.n = 1
FROM (VALUES
  (1, :'pj_project_id'::uuid),
  (2, '00000000-5eed-0002-0000-000000000001'::uuid),
  (3, '00000000-5eed-0002-0000-000000000002'::uuid)
) AS pj(n, id)
CROSS JOIN (VALUES
  (1, '開発タスク', '#2563eb', 'a0'),
  (2, 'バグ',       '#9a3b2e', 'a1'),
  (3, '調査',       '#7c5cbf', 'a2')
) AS t(n, name, color, pos);

-- ラベルはワークスペース単位（プロジェクトに属さない）。
INSERT INTO labels (id, workspace_id, name, color)
VALUES
  ('00000000-5eed-0005-0000-000000000001'::uuid, :'kb_workspace_id', '不具合',   '#9a3b2e'),
  ('00000000-5eed-0005-0000-000000000002'::uuid, :'kb_workspace_id', '要調査',   '#7c5cbf'),
  ('00000000-5eed-0005-0000-000000000003'::uuid, :'kb_workspace_id', '改善',     '#2f6b47'),
  ('00000000-5eed-0005-0000-000000000004'::uuid, :'kb_workspace_id', '至急',     '#dc2626');

-- リリース版（修正バージョンの選択肢）。プロジェクトごとに 3 つ。
INSERT INTO project_versions (id, workspace_id, project_id, name, "position", released_at)
SELECT
  ('00000000-5eed-0006-' || lpad(pj.n::text, 4, '0') || '-' || lpad(v.n::text, 12, '0'))::uuid,
  :'kb_workspace_id', pj.id, v.name, v.pos,
  CASE WHEN v.n = 1 THEN now() - interval '30 day' ELSE NULL END
FROM (VALUES
  (1, :'pj_project_id'::uuid),
  (2, '00000000-5eed-0002-0000-000000000001'::uuid),
  (3, '00000000-5eed-0002-0000-000000000002'::uuid)
) AS pj(n, id)
CROSS JOIN (VALUES
  (1, '1.0.0', 'a0'),
  (2, '1.1.0', 'a1'),
  (3, '2.0.0', 'a2')
) AS v(n, name, pos);

-- チーム（プロジェクト単位）。
INSERT INTO teams (id, workspace_id, project_id, name)
SELECT
  ('00000000-5eed-0007-' || lpad(pj.n::text, 4, '0') || '-' || lpad(t.n::text, 12, '0'))::uuid,
  :'kb_workspace_id', pj.id, t.name
FROM (VALUES
  (1, :'pj_project_id'::uuid),
  (2, '00000000-5eed-0002-0000-000000000001'::uuid),
  (3, '00000000-5eed-0002-0000-000000000002'::uuid)
) AS pj(n, id)
CROSS JOIN (VALUES (1, '開発チーム'), (2, '基盤チーム')) AS t(n, name);

-- チームの所属。1 人が複数チームに属することもある形にする。
INSERT INTO team_members (workspace_id, team_id, user_id)
SELECT :'kb_workspace_id', t.id, 1000000 + m.i
FROM teams t
CROSS JOIN generate_series(1, 9) AS m(i)
WHERE t.workspace_id = :'kb_workspace_id' AND (m.i + length(t.name)) % 3 = 0
ON CONFLICT DO NOTHING;

-- スプリント。プロジェクトごとに「進行中 1・計画中 1」。柱に並ぶ様子を確かめるため。
INSERT INTO sprints (id, workspace_id, project_id, name, state, start_date, end_date, "position")
SELECT
  ('00000000-5eed-0008-' || lpad(pj.n::text, 4, '0') || '-' || lpad(s.n::text, 12, '0'))::uuid,
  :'kb_workspace_id', pj.id, s.name, s.state,
  CASE WHEN s.state = 'active' THEN (now() - interval '7 day')::date ELSE NULL END,
  CASE WHEN s.state = 'active' THEN (now() + interval '7 day')::date ELSE NULL END,
  s.pos
FROM (VALUES
  (1, :'pj_project_id'::uuid),
  (2, '00000000-5eed-0002-0000-000000000001'::uuid),
  (3, '00000000-5eed-0002-0000-000000000002'::uuid)
) AS pj(n, id)
CROSS JOIN (VALUES
  (1, 'スプリント 1', 'active',  'a0'),
  (2, 'スプリント 2', 'planned', 'a1')
) AS s(n, name, state, pos);

-- チケット本体。3 プロジェクトに 17 件ずつ（計 51 件）。
--
-- 題名は「何の画面を見ているか」が分かる具体名にする（「ダミー 12」だと並べ替えや
-- 絞り込みの確認で自分がどれを動かしたか見失う）。
INSERT INTO tickets
  (id, workspace_id, project_id, number, type_id, status_id, title, doc, plain_text,
   priority, story_points, start_date, due_date, team_id, created_by_user_id, created_at, updated_at)
SELECT
  ('00000000-5eed-0009-' || lpad(pj.n::text, 4, '0') || '-' || lpad(i::text, 12, '0'))::uuid,
  :'kb_workspace_id', pj.id, i,
  ('00000000-5eed-0004-' || lpad(pj.n::text, 4, '0') || '-' || lpad((1 + i % 3)::text, 12, '0'))::uuid,
  ('00000000-5eed-0003-' || lpad(pj.n::text, 4, '0') || '-' || lpad((1 + i % 4)::text, 12, '0'))::uuid,
  pj.prefix || ' ' || (ARRAY[
    'ログインの導線を整理する', '一覧の並べ替えが効かない', '検索の日本語が拾えない',
    '添付の上限を決める', 'コメントの通知を出す', '権限の既定値を見直す',
    'ダッシュボードの初期表示を速くする', '期限切れの色を調整する', 'CSV の書き出しを足す',
    '監査ログの保持期間を決める', 'モバイルの折り返しが崩れる', 'API のページングを入れる',
    '設定画面の文言を統一する', '重複チケットの検知', 'アーカイブの復元手順を書く',
    'エラー画面の案内を親切にする', '初回起動の手順をまとめる'
  ])[i],
  '{"type":"doc","content":[]}'::jsonb, '', 1 + (i % 3),
  CASE WHEN i % 4 = 0 THEN NULL ELSE (ARRAY[1,2,3,5,8])[1 + (i % 5)] END,
  CASE WHEN i % 5 = 0 THEN (now() - interval '3 day')::date ELSE NULL END,
  CASE WHEN i % 6 = 0 THEN (now() - interval '2 day')::date
       WHEN i % 7 = 0 THEN (now() + interval '10 day')::date ELSE NULL END,
  CASE WHEN i % 3 = 0
       THEN ('00000000-5eed-0007-' || lpad(pj.n::text, 4, '0') || '-' || lpad((1 + i % 2)::text, 12, '0'))::uuid
       ELSE NULL END,
  1000000, now() - (i || ' day')::interval, now()
FROM (VALUES
  (1, :'pj_project_id'::uuid, 'ローカル:'),
  (2, '00000000-5eed-0002-0000-000000000001'::uuid, 'アプリ:'),
  (3, '00000000-5eed-0002-0000-000000000002'::uuid, '基盤:')
) AS pj(n, id, prefix)
CROSS JOIN generate_series(1, 17) AS i;

-- 採番カウンタは tickets の最大番号と必ず揃える（ズレると次の作成が UNIQUE で落ちる）。
INSERT INTO ticket_counters (workspace_id, project_id, last_number)
SELECT workspace_id, project_id, max(number) FROM tickets
WHERE workspace_id = :'kb_workspace_id'
GROUP BY workspace_id, project_id;

-- バックログの並び順。tickets は並び順の列を持たない（この表が正本）。
-- 鍵は fracindex の作法に合わせる（'a' + base62 1 桁。17 件なので 1 桁で足りる）。
INSERT INTO ticket_backlog_ranks (workspace_id, project_id, ticket_id, "position")
SELECT t.workspace_id, t.project_id, t.id,
  'a' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'::text, t.number::int, 1)
FROM tickets t
WHERE t.workspace_id = :'kb_workspace_id';

-- 担当。3 件に 2 件ほど割り当て、残りは未割り当てのまま（「未割り当て」の絞り込みを試すため）。
INSERT INTO ticket_assignments (workspace_id, ticket_id, assignee_principal_id, assigned_by_user_id)
SELECT t.workspace_id, t.id, p.id, 1000000
FROM tickets t
JOIN LATERAL (
  SELECT id FROM principals
  WHERE workspace_id = t.workspace_id AND kind = 'user'
  ORDER BY user_id
  OFFSET (t.number % 9) LIMIT 1
) p ON true
WHERE t.workspace_id = :'kb_workspace_id' AND t.number % 3 <> 0;

-- ラベル。数件に付ける。
INSERT INTO ticket_labels (workspace_id, ticket_id, label_id)
SELECT t.workspace_id, t.id,
  ('00000000-5eed-0005-0000-' || lpad((1 + t.number % 4)::text, 12, '0'))::uuid
FROM tickets t
WHERE t.workspace_id = :'kb_workspace_id' AND t.number % 2 = 0;

-- 修正バージョン（多対多）。4 件に 1 件は 2 つ付けて、複数持てることを目で確かめられるようにする。
INSERT INTO ticket_fix_versions (workspace_id, project_id, ticket_id, version_id)
SELECT t.workspace_id, t.project_id, t.id, v.id
FROM tickets t
JOIN project_versions v ON v.workspace_id = t.workspace_id AND v.project_id = t.project_id
WHERE t.workspace_id = :'kb_workspace_id'
  AND ((t.number % 4 = 1 AND v.name = '1.1.0')
    OR (t.number % 4 = 2 AND v.name IN ('1.1.0', '2.0.0')));

-- 進行中のスプリントに、各プロジェクトの先頭 5 件を入れる。
INSERT INTO ticket_sprint_ranks (workspace_id, sprint_id, ticket_id, "position")
SELECT t.workspace_id, s.id, t.id,
  'a' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'::text, t.number::int, 1)
FROM tickets t
JOIN sprints s ON s.workspace_id = t.workspace_id AND s.project_id = t.project_id AND s.state = 'active'
WHERE t.workspace_id = :'kb_workspace_id' AND t.number <= 5;


COMMIT;

-- ---- 統計の更新 ------------------------------------------------------------
-- ANALYZE を忘れるとプランナが古い統計で判断し、実行計画の比較が無意味になる。
\echo '=== ANALYZE 実行中 ...'
ANALYZE users, profiles, workspaces, principals, workspace_grants, spaces, pages, page_paths, blocks,
        projects, ticket_statuses, ticket_types, ticket_counters, tickets, ticket_backlog_ranks,
        ticket_assignments, ticket_labels, labels, project_versions, ticket_fix_versions,
        teams, team_members, sprints, ticket_sprint_ranks;

-- 規模の受け渡しに使った一時テーブルは、この後の集計に混ざらないよう捨てる。
DROP TABLE _cfg;

-- ---- 結果 ------------------------------------------------------------------
\echo ''
\echo '=== 投入結果 ==='
SELECT relname AS table_name,
       to_char(n_live_tup, 'FM999,999,999') AS rows,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size
  FROM pg_stat_user_tables
 WHERE n_live_tup > 0
 ORDER BY n_live_tup DESC;
