// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import pluginQuery from '@tanstack/eslint-plugin-query';
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
 * 層の逆流・Slice 間の直接 import・Slice の自己参照・公開口（index.ts）を通らない import は
 * **'error'** で止める（CI は `--max-warnings 0`）。
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

/*
 * 公開口を通す決まり。Slice の中（`@/entities/kb/api/kbQueries` など）へ直接 import せず、
 * `@/entities/kb` のように公開口（index.ts）から取る。例外は entity 同士の `@x`（相手が
 * 「誰に何を見せるか」を宣言した口）。テストは対象外（取得の本体を偽物に差し替えるため、深い
 * パスを指すのが正しい）。
 */
const SLICE_PUBLIC_API_PATTERN = {
  regex: '^@/(?:pages|widgets|features|entities)/[^/]+/(?!@x/).+',
  message:
    'FSD 違反: Slice の中へ直接 import できません。公開口（@/<層>/<Slice>）から取ってください。' +
    ' 公開口に無いものは、その Slice の index.ts に名前付きで足します。',
};

/*
 * shared/ui も公開口（`@/shared/ui`）から取る。例外は、公開口に載せない理由がある 1 つの
 * 下位の公開口だけ: 読み込むだけで書体の CSS を効かせる inkwell。
 * （ナレッジの本文エディタはかつてここの例外だったが、pages/kb/ui/editor へ移した。
 * pages 同士は import できないので、バックログから読めないことは層の決まりで保証される。）
 */
const SHARED_UI_PUBLIC_API_PATTERN = {
  regex: '^@/shared/ui/(?!inkwell$).+',
  message:
    'shared/ui は公開口（@/shared/ui）から取ってください。公開口に無い部品は shared/ui/index.ts に足します' +
    '（例外は @/shared/ui/inkwell）。',
};

const ENTITY_SAME_LAYER_PATTERN = {
  regex: ENTITIES_SAME_LAYER_REGEX,
  message:
    'FSD 違反: entity 同士は直接 import できません。' +
    ' どうしても参照し合う場合は `@x` 記法（entities/<相手>/@x/<自分>）で明示してください。' +
    ' 自分の Slice 内は相対パスで参照します。',
};

/*
 * Slice の自己参照禁止（テストも対象にする）。
 *
 * `entities/kb/api/kbRepository.ts` が `@/entities/kb`（自分の公開口）を参照すると
 * 循環になるうえ、テストで自分の barrel を読むと Slice 内の全ファイルが読み込まれて
 * カバレッジの分母に未テストのファイルまで入る。自分の Slice 内は相対パスで参照する。
 *
 * 上の層間ルールはテストを対象外にしている（テストが上位層の Provider で包むのは正当なため）が、
 * 自己参照は正当なケースが無いのでテストにも適用する。
 */
const selfReferencePattern = (slice) => ({
  group: [`@/entities/${slice}`, `@/entities/${slice}/*`, `@/entities/${slice}/**`],
  message:
    `FSD 違反: entities/${slice} の中から自分自身（@/entities/${slice}）を参照しないでください。` +
    ' 循環になり、テストでは Slice 全体を読み込んでカバレッジの分母も膨らみます。相対パスで参照してください。',
});

const restrictImports = (patterns) => ({ 'no-restricted-imports': ['error', { patterns }] });

const entitySlices = readdirSync(new URL('./src/entities', import.meta.url), { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('@') && e.name !== '__tests__')
  .map((e) => e.name);

/*
 * import の制限は、1 つのファイルに効く決まり（層の向き・自己参照・公開口）を**1 つの設定に
 * まとめて**渡す。同じ規則（no-restricted-imports）を別々の設定に書くと、後の設定が前の設定を
 * 丸ごと上書きする（中身は足し合わされない）。entity ごとの自己参照の設定を後から足していたため、
 * entities では層の向きと entity 同士の禁止が効いていなかった。
 */
const fsdImportConfigs = FSD_LAYERS.flatMap((layer) => {
  const boundary = forbiddenLayersFor(layer);
  const publicApi = layer === 'shared' ? [] : [SLICE_PUBLIC_API_PATTERN, SHARED_UI_PUBLIC_API_PATTERN];
  if (layer !== 'entities') {
    // app は最上位なので層の禁止が空になる。ESLint は空の group を受け付けないため入れない。
    const layerPatterns = boundary.length > 0 ? [{ group: boundary, message: BOUNDARY_MESSAGE(layer) }] : [];
    const patterns = [...layerPatterns, ...publicApi];
    return patterns.length > 0
      ? [{ files: [`src/${layer}/**/*.{ts,tsx}`], ignores: TEST_FILE_PATTERNS, rules: restrictImports(patterns) }]
      : [];
  }
  return entitySlices.flatMap((slice) => [
    {
      files: [`src/entities/${slice}/**/*.{ts,tsx}`],
      ignores: TEST_FILE_PATTERNS,
      rules: restrictImports([
        selfReferencePattern(slice),
        // 上位層（pages / widgets / features）は無条件に禁止。
        { group: boundary.filter((p) => !p.startsWith('@/entities')), message: BOUNDARY_MESSAGE(layer) },
        ENTITY_SAME_LAYER_PATTERN,
        ...publicApi,
      ]),
    },
    {
      files: TEST_FILE_PATTERNS.map((pattern) => `src/entities/${slice}/${pattern}`),
      rules: restrictImports([selfReferencePattern(slice)]),
    },
  ]);
});

export default defineConfig([globalIgnores(['dist', 'coverage']),
  // TanStack Query の決まり（鍵に使う値の漏れ・不安定な依存・QueryClient の作り直しなど）。
  // 取得の置き場の決まりは shared/README.md の「サーバーの状態」。
  ...pluginQuery.configs['flat/recommended'],
{
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
  // （描画中に ref を読み書きする・effect の中で同期的に state を変える など）を見つける検査も
  // 効かせる。反する部品はコンパイラが黙って対象から外す（壊れはしないが速くもならない）ので、
  // lint で気づけるようにする。全体に効かせると既存のコードの書き直しが要るので、範囲は
  // コンパイラと同じ定数から読む（vite-plugins/react-compiler-scope.js）。
  files: REACT_COMPILER_DIRS.map((dir) => `${dir}/**/*.{ts,tsx}`),
  ignores: REACT_COMPILER_IGNORES,
  rules: {
    ...reactHooks.configs.flat['recommended-latest'].rules,
    // コンパイラがまだ扱えない書き方（try … finally など）。部品や hook ごと黙って対象から外れるので、
    // 推奨の設定には無いが止める。lint で捕まらないもの（try の中の条件式）は
    // scripts/check-react-compiler.mjs が実際にコンパイラへ通して確かめる。
    'react-hooks/todo': 'error',
  },
}, {
  // ビルド・テストの設定ファイルは Node で動く（src はブラウザ）。
  // preview.tsx はブラウザで動くので含めない（Node のグローバルを許すと
  // ブラウザに無い識別子の間違いを ESLint が見逃す）。
  files: ['*.config.{js,ts,mjs}', '.storybook/main.ts'],
  languageOptions: { globals: globals.node },
}, ...fsdImportConfigs, ...storybook.configs["flat/recommended"], {
  // story 名もテスト名と同じく日本語で書く（このリポジトリの流儀）。PascalCase の強制だけ外す。
  files: ['**/*.stories.@(ts|tsx)'],
  rules: { 'storybook/prefer-pascal-case': 'off' },
}]);
