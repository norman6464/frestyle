// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import { readdirSync } from 'node:fs';
import tseslint from 'typescript-eslint';
import { REACT_COMPILER_DIRS, REACT_COMPILER_IGNORES } from './vite-plugins/react-compiler-scope.js';

/*
 * FSD の層間依存ルール。
 *
 * 公式仕様:
 *   「Slice 内のモジュールは、厳密に下の層にある Slice しか import できない」
 *   app > pages > widgets > features > entities > shared
 *   （processes は公式で非推奨のため採用しない）
 *
 * 例外: app と shared のあいだは相互に import してよい。
 *
 * FSD 移行（Phase 0〜7）が完了したので **'error'** で強制する。移行中は旧新構造の
 * 混在で CI が常時赤にならないよう 'warn' に留めていたが、レイヤー移行が完了し
 * 違反 0 になったため Phase 7 で 'error' へ昇格した。以後、層の
 * 逆流・Slice 間の直接 import・Slice の自己参照は CI（`--max-warnings 0`）で弾かれる。
 */
const FSD_LAYERS = ['app', 'pages', 'widgets', 'features', 'entities', 'shared'];

/*
 * app と shared は Slice を持たない層（公式仕様）。
 * 「App と Shared は互いに自由に import してよく、層内の Segment 同士も同様」とされているため、
 * この 2 層については自分自身と相手を禁止対象から外す。
 */
const SLICELESS_LAYERS = ['app', 'shared'];

/** その層が import してはいけない層（＝自分と同じか上の層）のパターンを作る。 */
function forbiddenLayersFor(layer) {
  const index = FSD_LAYERS.indexOf(layer);
  const upperOrSame = FSD_LAYERS.slice(0, index + 1).filter((l) => {
    // app / shared は相互参照可 + 層内の Segment 同士も可（公式の例外）。
    if (SLICELESS_LAYERS.includes(layer) && SLICELESS_LAYERS.includes(l)) return false;
    return true;
  });
  return upperOrSame.flatMap((l) => [`@/${l}/*`, `@/${l}`]);
}

/*
 * entities 層の「同一レイヤー参照」だけは `@x` 記法を例外として許可する（公式仕様）。
 *
 * 例: `entities/user` が `entities/course/@x/user` を参照する。
 * 参照される側が「誰に何を見せるか」を明示的に宣言する形になるため、
 * 無制限な Slice 間 import とは区別して許可する（出す内容は最小限に保つこと）。
 *
 * なぜ group ではなく regex なのか:
 * `group` は gitignore 記法で評価されるため「親ディレクトリが除外されていると
 * 子を再包含できない」という制約があり、`@/entities/*` を禁止したうえで
 * `!@/entities/*'/@x/*` で戻すことができない（実際に効かなかった）。
 * 否定先読みを書ける regex なら 1 つのパターンで表現できる。
 */
const ENTITIES_SAME_LAYER_REGEX = '^@/entities(?:/(?![^/]+/@x/).*)?$';

/*
 * テストは層構造の対象外にする。
 * テストは対象を描画するために上位層の Provider でラップすることが正当にあり
 * （例: pages のテストが app の ToastProvider を使う）、これを違反として扱うと
 * 実装の依存グラフとは無関係なノイズになるため。
 */
const TEST_FILE_PATTERNS = ['**/__tests__/**', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'];

const BOUNDARY_MESSAGE = (layer) =>
  `FSD 違反: ${layer} 層は自分と同じか上の層を import できません（下向きの一方通行）。` +
  ' 共通化したいものは下の層へ降ろすか、上の層で組み合わせてください。';

const fsdBoundaryConfigs = FSD_LAYERS
  // app は最上位なので禁止対象が空になる。ESLint は空の group を受け付けないため設定自体を出さない。
  .filter((layer) => forbiddenLayersFor(layer).length > 0)
  .map((layer) => ({
    files: [`src/${layer}/**/*.{ts,tsx}`],
    ignores: TEST_FILE_PATTERNS,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns:
            layer === 'entities'
              ? [
                  // 上位層（pages / widgets / features）は無条件に禁止。
                  {
                    group: forbiddenLayersFor(layer).filter((p) => !p.startsWith('@/entities')),
                    message: BOUNDARY_MESSAGE(layer),
                  },
                  // 同一レイヤー（entity 同士）は `@x` 経由のみ許可。
                  {
                    regex: ENTITIES_SAME_LAYER_REGEX,
                    message:
                      'FSD 違反: entity 同士は直接 import できません。' +
                      ' どうしても参照し合う場合は `@x` 記法（entities/<相手>/@x/<自分>）で明示してください。' +
                      ' 自分の Slice 内は相対パスで参照します。',
                  },
                ]
              : [{ group: forbiddenLayersFor(layer), message: BOUNDARY_MESSAGE(layer) }],
        },
      ],
    },
  }));

/*
 * Slice の自己参照禁止（テストも対象にする）。
 *
 * `entities/note/api/noteRepository.ts` が `@/entities/note`（自分の barrel）を参照すると
 * 循環になるうえ、テストで自分の barrel を読むと Slice 内の全ファイルが読み込まれて
 * カバレッジの分母に未テストのファイルまで入る。自分の Slice 内は相対パスで参照する。
 *
 * 上の層間ルールはテストを対象外にしている（テストが上位層の Provider で包むのは正当なため）が、
 * 自己参照は正当なケースが無いのでテストにも適用する。
 */
const entitySlices = readdirSync(new URL('./src/entities', import.meta.url), { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('@'))
  .map((e) => e.name);

const selfReferenceConfigs = entitySlices.map((slice) => ({
  files: [`src/entities/${slice}/**/*.{ts,tsx}`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: [`@/entities/${slice}`, `@/entities/${slice}/*`, `@/entities/${slice}/**`],
            message:
              `FSD 違反: entities/${slice} の中から自分自身（@/entities/${slice}）を参照しないでください。` +
              ' 循環になり、テストでは Slice 全体を読み込んでカバレッジの分母も膨らみます。相対パスで参照してください。',
          },
        ],
      },
    ],
  },
}));

export default defineConfig([globalIgnores(['dist', 'coverage']), {
  files: ['**/*.{js,jsx,ts,tsx}'],
  extends: [
    js.configs.recommended,
    ...tseslint.configs.recommended,
    reactRefresh.configs.vite,
  ],
  plugins: { 'react-hooks': reactHooks },
  languageOptions: {
    ecmaVersion: 2020,
    globals: globals.browser,
    parserOptions: {
      ecmaVersion: 'latest',
      ecmaFeatures: { jsx: true },
      sourceType: 'module',
    },
  },
  rules: {
    // フックの呼び方の 2 つの検査は全体に効かせる。
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
  },
}, {
  // React Compiler をかける範囲には、コンパイラと同じ解析で「React の決まりに反する書き方」
  // （描画中に ref を読み書きする・props や state を書き換える など）を見つける検査も
  // 効かせる。反する部品はコンパイラが黙って対象から外す（壊れはしないが速くもならない）ので、
  // lint で気づけるようにする。全体に効かせると既存のコードの書き直しが要るので、範囲は
  // コンパイラと同じ定数から読む（vite-plugins/react-compiler-scope.js）。
  files: REACT_COMPILER_DIRS.map((dir) => `${dir}/**/*.{ts,tsx}`),
  ignores: REACT_COMPILER_IGNORES,
  rules: {
    ...reactHooks.configs.flat['recommended-latest'].rules,
    // effect の中で同期的に state を変える書き方（描いた直後にもう 1 回描き直す）は、コンパイラの
    // 最適化を止めない（止めるのは描画中の ref の読み書きなど）。サイドバーには 10 か所あり、
    // 直すには木の読み込み（useKbTree）の組み立て直しが要るので、この検査だけ切っておく。
    // 一覧と扱いは FRESTYLE-634 に記録した。直したら外す。
    'react-hooks/set-state-in-effect': 'off',
  },
}, {
  // ビルド・テストの設定ファイルは Node で動く（src はブラウザ）。
  // preview.tsx はブラウザで動くので含めない（Node のグローバルを許すと
  // ブラウザに無い識別子の間違いを ESLint が見逃す）。
  files: ['*.config.{js,ts,mjs}', '.storybook/main.ts'],
  languageOptions: { globals: globals.node },
}, ...fsdBoundaryConfigs, ...selfReferenceConfigs, ...storybook.configs["flat/recommended"], {
  // story 名もテスト名と同じく日本語で書く（このリポジトリの流儀）。PascalCase の強制だけ外す。
  files: ['**/*.stories.@(ts|tsx)'],
  rules: { 'storybook/prefer-pascal-case': 'off' },
}]);
