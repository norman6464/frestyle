/*
 * 最初に読む JavaScript の大きさ（gzip）を、ビルドの結果から実際にたどって数える。
 *
 * dist/index.html が読み込む JS（script と modulepreload）から始め、そこから静的に import される塊を
 * すべてたどる（`import("./x.js")` の遅延読み込みは数えない）。ファイル名の決め打ちで数えると、ビルドが
 * 共有の部分を別の名前の塊（例: 認証まわり・アイコン）へ分けたときに数え漏れ、コードを少し変えただけで
 * 数字が大きく揺れる。
 *
 * 使い方: pnpm run build のあとに pnpm run size（ビルドもする）/ node scripts/check-initial-load.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { staticClosure } from './static-imports.mjs';

/** 予算（gzip）。超えたら失敗にする（CI では知らせるだけ）。 */
const BUDGET_KB = 150;

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const html = readFileSync(path.join(dist, 'index.html'), 'utf8');

const entries = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
if (entries.length === 0) {
  console.error('dist/index.html から読み込む JS が見つかりません。先にビルドしてください。');
  process.exit(1);
}

// 静的な import だけをたどる（scripts/static-imports.mjs）。
const seen = staticClosure(dist, entries);

const rows = [...seen]
  .map((file) => ({ file, gzip: gzipSync(readFileSync(path.join(dist, file))).length }))
  .sort((a, b) => b.gzip - a.gzip);
const totalKb = rows.reduce((sum, row) => sum + row.gzip, 0) / 1024;

console.log(`最初に読む JavaScript（gzip）: ${rows.length} ファイル`);
for (const row of rows) console.log(`  ${(row.gzip / 1024).toFixed(2).padStart(8)} KB  ${row.file}`);
console.log(`  ${totalKb.toFixed(2).padStart(8)} KB  合計（予算 ${BUDGET_KB} KB）`);

if (totalKb > BUDGET_KB) {
  console.error(`予算を ${(totalKb - BUDGET_KB).toFixed(2)} KB 超えています。`);
  process.exit(1);
}
