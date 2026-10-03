/*
 * 数式（KaTeX）と図（mermaid）を、使うページでだけ読み込んでいることをビルドの結果で確かめる。
 *
 * 本文エディタの塊（lazyRenderers.ts の文言を含む塊）から静的な import でたどれる範囲に、KaTeX と
 * mermaid の中身が入っていないこと。入っていると、数式や図の無いページでも本文エディタと一緒に
 * 読まれる（KaTeX は書体込みで数百 KB、mermaid は数 MB）。誰かがうっかり `import katex from 'katex'`
 * と書くと、画面もテストも通ったまま、ここだけが落ちる。
 *
 * 中身は目印の文字列で見分ける。目印が成果物のどこにも無いときは失敗にする（ライブラリの更新で
 * 目印が消えると、何も確かめないまま通ってしまうため）。
 *
 * 使い方: pnpm run build のあとに node scripts/check-lazy-renderers.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { staticClosure } from './static-imports.mjs';

/** 本文エディタの塊の目印（src/pages/kb/ui/editor/lazyRenderers.ts の文言）。 */
const EDITOR_MARKER = '数式の描画の道具を読み込めませんでした';

/** 遅延読み込みにしている道具と、その中身の目印。 */
const LAZY_LIBRARIES = [
  { name: 'KaTeX', marker: 'KaTeX parse error' },
  { name: 'mermaid', marker: 'mermaidAPI' },
];

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const files = readdirSync(path.join(dist, 'assets'))
  .filter((name) => name.endsWith('.js'))
  .map((name) => `assets/${name}`);
if (files.length === 0) {
  console.error('dist/assets に JS が見つかりません。先にビルドしてください。');
  process.exit(1);
}
const sources = new Map(files.map((file) => [file, readFileSync(path.join(dist, file), 'utf8')]));

const editorChunks = files.filter((file) => sources.get(file).includes(EDITOR_MARKER));
if (editorChunks.length === 0) {
  console.error(`本文エディタの塊（目印「${EDITOR_MARKER}」）が見つかりません。目印の文言が変わっていないか確かめてください。`);
  process.exit(1);
}

const closure = staticClosure(dist, editorChunks);
let failed = false;
for (const { name, marker } of LAZY_LIBRARIES) {
  const holders = files.filter((file) => sources.get(file).includes(marker));
  if (holders.length === 0) {
    console.error(`${name} の中身（目印「${marker}」）が成果物のどこにもありません。目印を見直してください。`);
    failed = true;
    continue;
  }
  const eager = holders.filter((file) => closure.has(file));
  if (eager.length > 0) {
    console.error(`${name} が本文エディタと一緒に読まれます（静的な import でたどれる）: ${eager.join(', ')}`);
    failed = true;
  } else {
    console.log(`${name}: 遅延読み込み（${holders.join(', ')}）`);
  }
}
if (failed) process.exit(1);
console.log(`本文エディタの塊 ${editorChunks.join(', ')} から静的にたどれる ${closure.size} ファイルに、遅延読み込みの道具は入っていません。`);
