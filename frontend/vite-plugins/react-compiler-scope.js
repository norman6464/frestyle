/*
 * React Compiler をかける範囲。コンパイラ（vite-plugins/react-compiler.js）と、
 * コンパイラと同じ解析で決まりに反する書き方を見つける lint（eslint.config.js）と、
 * コンパイラが黙って諦めていないかを確かめる検査（scripts/check-react-compiler.mjs）が読む。
 * 片方だけ広げると、lint の無いところでコンパイラが黙って部品を対象から外したり、
 * コンパイラの無いところで lint だけが書き直しを求めたりする。
 *
 * 部品（ui）と hook（model）はすべて入れる。`*` はフォルダ名 1 つ（`src/pages/<画面>/ui` を
 * まとめて指せる）で、新しい画面や Slice を足しても範囲に入れ忘れない。
 *
 * shared/ui はまだ入れない（inkwell など、描画の外で読む前提の部品が残っている）。
 * ナレッジの本文エディタ（src/pages/kb/ui/editor）は pages の中にあるが、下の IGNORES で外す。
 * 書式バーなど、描いている途中で tiptap の editor（変わりうる外の物）を読む部品が多く、
 * コンパイラが結果を控えると押下状態が変わらなくなる。useEditorState へ置き換え、Storybook で
 * 押下状態を確かめてから入れる（shared/ui にあった頃から同じ理由で対象外だった）。
 */
export const REACT_COMPILER_DIRS = [
  'src/pages/*/ui',
  'src/pages/*/model',
  'src/widgets/*/ui',
  'src/widgets/*/model',
  'src/features/*/ui',
  'src/features/*/model',
  'src/entities/*/ui',
  'src/entities/*/model',
];

/**
 * テストと見本は描画の外で数えたり差し替えたりするので、コンパイラにも lint にもかけない。
 * ナレッジの本文エディタは上の理由（描画中に tiptap の editor を読む）で、乗せる準備ができるまで外す。
 */
export const REACT_COMPILER_IGNORES = ['**/__tests__/**', '**/*.stories.tsx', 'src/pages/kb/ui/editor/**'];
