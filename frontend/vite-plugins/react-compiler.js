import babel from '@rolldown/plugin-babel';
import { reactCompilerPreset } from '@vitejs/plugin-react';
import { REACT_COMPILER_DIRS, REACT_COMPILER_IGNORES } from './react-compiler-scope.js';

/*
 * React Compiler。部品と hook に「前と同じ値なら計算も描き直しもしない」を自動で付ける
 * （手で React.memo / useCallback / useMemo を書く代わり。手書きは、後から誰かが行へ
 * `() => ...` を 1 つ足しただけで黙って効かなくなる）。
 *
 * Babel 経由で入れる。@vitejs/plugin-react の `compiler: true`（Rust 版）は説明書で
 * 「実験的」とされているので使わない。
 *
 * かける範囲は react-compiler-scope.js。ビルド（vite.config.js）とテスト（vitest.config.js）の
 * 両方で同じものを使う。片方だけだと、テストはコンパイラの無いコードを確かめることになる。
 * 除外（REACT_COMPILER_IGNORES）も同じ定数から読む。ここだけ自前の除外を持つと、lint と
 * check:compiler が外しているフォルダをビルドだけがコンパイルする食い違いが起きる。
 */
export function reactCompiler() {
  const preset = reactCompilerPreset();
  preset.rolldown.filter.id = compilerIdFilter();
  return babel({ presets: [preset] });
}

/**
 * compilerIdFilter はコンパイラをかけるファイルの判定（rolldown の id フィルタ）。
 * 範囲と除外を react-compiler-scope.js から組み立てる。テストから直接確かめられるよう分けてある。
 */
export function compilerIdFilter() {
  return {
    include: REACT_COMPILER_DIRS.map((dir) => new RegExp(`/${dirPattern(dir)}/.+\\.tsx?$`)),
    exclude: REACT_COMPILER_IGNORES.map(ignorePattern),
  };
}

/** 範囲のフォルダを正規表現へ。`*` はフォルダ名 1 つ（`src/pages/<画面>/ui` をまとめて指せる）。 */
function dirPattern(dir) {
  return dir
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]+');
}

/**
 * 除外の glob を正規表現へ。`**` は任意の深さ（0 段も可）、`*` は名前の一部（`/` を含まない）。
 * id は絶対パスなので、先頭を `/` で区切ってから glob を当てる（`src/...` を途中のフォルダ名の
 * 一部に誤って当てない）。
 */
function ignorePattern(glob) {
  // 字句（`**/`・`**`・`*`・それ以外）ごとに置き換える。文字列の replace を重ねると、
  // `**` を置き換えた `.*` の `*` が次の置き換えでまた `[^/]*` に化ける。
  const source = (glob.match(/\*\*\/|\*\*|\*|[^*]+/g) ?? [])
    .map((token) => {
      if (token === '**/') return '(?:.*/)?';
      if (token === '**') return '.*';
      if (token === '*') return '[^/]*';
      return token.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`/${source}$`);
}
