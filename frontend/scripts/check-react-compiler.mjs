/*
 * React Compiler をかける範囲（vite-plugins/react-compiler-scope.js）のファイルを、ビルドと同じ
 * コンパイラに通し、1 つでも部品や hook を諦めたら失敗にする。
 *
 * コンパイラは書き方を扱えないと、壊しはしないがその部品や hook を黙って対象から外す（速くならない
 * だけで、テストも画面も通る）。`try … finally` や try の中の条件式がそうで、lint の
 * react-hooks/todo では捕まらないもの（try の中の条件式）もあるので、実際に通して確かめる。
 *
 * 使い方: pnpm run check:compiler
 */
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformAsync } from '@babel/core';
import reactCompiler from 'babel-plugin-react-compiler';
import { REACT_COMPILER_DIRS, REACT_COMPILER_IGNORES } from '../vite-plugins/react-compiler-scope.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const files = globSync(
  REACT_COMPILER_DIRS.map((dir) => `${dir}/**/*.{ts,tsx}`),
  { cwd: root, exclude: REACT_COMPILER_IGNORES },
).sort();

// 範囲の書き方やフォルダの構成が変わって 1 件も当たらないと、何も調べずに通ってしまう。
if (files.length === 0) {
  console.error('React Compiler: 範囲に当てはまるファイルがありません。react-compiler-scope.js の指定を確かめてください。');
  process.exit(1);
}

/** コンパイラが部品・hook を諦めた知らせ（成功・対象外・診断は数えない）。 */
const BAILOUTS = new Set(['CompileError', 'PipelineError']);

const failures = [];
for (const file of files) {
  const events = [];
  await transformAsync(readFileSync(path.join(root, file), 'utf8'), {
    filename: file,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['typescript', 'jsx'] },
    plugins: [[reactCompiler, { panicThreshold: 'none', logger: { logEvent: (_file, event) => events.push(event) } }]],
  });
  for (const event of events) {
    if (!BAILOUTS.has(event.kind)) continue;
    const detail = event.detail ?? {};
    const reason = detail.reason ?? detail.options?.reason ?? event.data ?? '';
    const line = detail.loc?.start?.line ?? detail.options?.loc?.start?.line ?? event.fnLoc?.start?.line ?? '?';
    failures.push(`${file}:${line} ${event.fnName ?? ''} ${String(reason).split('\n')[0]}`);
  }
}

if (failures.length > 0) {
  console.error(`React Compiler が ${failures.length} か所で部品・hook を諦めました（その部品・hook は最適化されません）:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`React Compiler: 範囲の ${files.length} ファイルをすべて扱えました。`);
