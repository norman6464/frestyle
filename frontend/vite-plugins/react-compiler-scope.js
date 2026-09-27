/*
 * React Compiler をかける範囲。コンパイラ（vite-plugins/react-compiler.js）と、
 * コンパイラと同じ解析で決まりに反する書き方を見つける lint（eslint.config.js）の両方が読む。
 * 片方だけ広げると、lint の無いところでコンパイラが黙って部品を対象から外したり、
 * コンパイラの無いところで lint だけが書き直しを求めたりする。
 *
 * ナレッジのサイドバー（ページの木）から始め、ビルド時間の伸びと効果を測りながら広げている。
 * 広げるときはここにフォルダを足す。`*` はフォルダ名 1 つ（`src/pages/<画面>/ui` をまとめて指せる）で、
 * 新しい画面を足しても範囲に入れ忘れない。
 *
 * shared/ui はまだ入れない。本文エディタの書式バーなど、描いている途中で tiptap の editor
 * （変わりうる外の物）を読む部品が多く、コンパイラが結果を控えると押下状態が変わらなくなる。
 * useEditorState へ置き換えてから入れる。
 *
 * 画面の部品（ui）だけを入れ、データ取得の hook（model）はまだ入れない。取得の hook は
 * 共有キャッシュ（TanStack Query）へ置き換える予定で、その書き直しのときに入れる。
 */
export const REACT_COMPILER_DIRS = [
  'src/widgets/kb-sidebar',
  'src/pages/*/ui',
  'src/widgets/*/ui',
  'src/features/*/ui',
  'src/entities/*/ui',
];

/**
 * 範囲の中でもかけないフォルダ。どの画面でも最初に読む塊（アプリの枠）に入る部品は、
 * コンパイラが足す控えの比較コードの分だけ最初の表示が重くなる。最初の塊には予算
 * （.size-limit.json）があり、枠は描き直しの負荷も小さいので外す。
 */
export const REACT_COMPILER_EXCLUDED_DIRS = ['src/widgets/app-shell'];

/** テストと見本は描画の外で数えたり差し替えたりするので、コンパイラにも lint にもかけない。 */
export const REACT_COMPILER_IGNORES = [
  '**/__tests__/**',
  '**/*.stories.tsx',
  ...REACT_COMPILER_EXCLUDED_DIRS.map((dir) => `${dir}/**`),
];
