/*
 * ビルドの結果（dist/assets の JS）を、静的な import だけでたどる。
 *
 * `import{a as b}from"./x.js"` と `import"./x.js"` を拾い、`import("./x.js")` の遅延読み込みは
 * たどらない（＝その塊を読んだときに一緒に読まれる範囲だけを集める）。
 * check-initial-load.mjs（最初に読む JS の大きさ）と check-lazy-renderers.mjs（数式と図を使う
 * ページでだけ読むこと）が共有する。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const STATIC_IMPORT = /(?:^|[;\n}])\s*import\s*(?:[^'"()]*?from\s*)?["'](\.\/[^"']+\.js)["']/g;

/**
 * staticClosure は entries（dist からの相対パス）から静的な import でたどれるファイルの集合を返す。
 * @param {string} dist
 * @param {string[]} entries
 * @returns {Set<string>}
 */
export function staticClosure(dist, entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(path.join(dist, file), 'utf8');
    for (const match of source.matchAll(STATIC_IMPORT)) {
      queue.push(path.posix.join(path.posix.dirname(file), match[1]));
    }
  }
  return seen;
}
