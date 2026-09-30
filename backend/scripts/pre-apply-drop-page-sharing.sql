-- ページ単位の共有（page_grants / share_links / 共有リンクの主体 / ページ宛の招待）をやめたときに、
-- `make schema-apply` の前に 1 回だけ流す下ごしらえ。本番も手元も同じ手順で使う。
--
-- なぜ要るのか:
--   - Atlas の宣言的 apply は「principals.page_id を消す」を「share_links を消す」より先に並べる。
--     share_links の複合 FK が principals の (workspace_id, kind, page_id, id) を指しているので、
--     その順では DROP COLUMN が依存で落ちる。先に表を消しておけば、残りは Atlas の plan どおりに通る。
--   - kind='share_link' の主体や scope='page' の招待が 1 行でも残っていると、新しい CHECK
--     （kind は user / group / space_all、scope は workspace / space）を張れない。
--
-- 消えるもの: ページに足した権限、共有リンク、共有リンクの来訪者を表す主体、ページ宛の招待
-- （招待の送信履歴は FK の CASCADE で一緒に消える）。どれも新しいコードからは読まれない。
--
-- 使い方:
--   psql "$TARGET" -v ON_ERROR_STOP=1 -f scripts/pre-apply-drop-page-sharing.sql
--   make schema-apply TARGET="$TARGET"
--
-- 何度流しても同じ結果になる（IF EXISTS と、条件付きの DELETE だけで書いてある）。
BEGIN;

DROP TABLE IF EXISTS share_links;
DROP TABLE IF EXISTS page_grants;

DELETE FROM principals WHERE kind = 'share_link';
DELETE FROM invitations WHERE scope = 'page';

COMMIT;
