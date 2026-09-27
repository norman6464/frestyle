import babel from '@rolldown/plugin-babel';
import { reactCompilerPreset } from '@vitejs/plugin-react';
import { REACT_COMPILER_DIRS } from './react-compiler-scope.js';

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
 */
export function reactCompiler() {
  const preset = reactCompilerPreset();
  preset.rolldown.filter.id = {
    include: REACT_COMPILER_DIRS.map((dir) => new RegExp(`/${escapeRegExp(dir)}/.+\\.tsx?$`)),
    exclude: [/\/__tests__\//, /\.stories\.tsx$/],
  };
  return babel({ presets: [preset] });
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
