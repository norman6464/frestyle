/*
 * React Compiler をかける範囲。コンパイラ（vite-plugins/react-compiler.js）と、
 * コンパイラと同じ解析で決まりに反する書き方を見つける lint（eslint.config.js）の両方が読む。
 * 片方だけ広げると、lint の無いところでコンパイラが黙って部品を対象から外したり、
 * コンパイラの無いところで lint だけが書き直しを求めたりする。
 *
 * ナレッジのサイドバー（ページの木）から始め、ビルド時間の伸びと効果を測りながら広げている。
 * 広げるときはここにフォルダを足す。
 *
 * 画面の部品（ui）だけを入れ、データ取得の hook（model）はまだ入れない。取得の hook は
 * 共有キャッシュ（TanStack Query）へ置き換える予定で、その書き直しのときに入れる。
 */
export const REACT_COMPILER_DIRS = ['src/widgets/kb-sidebar', 'src/pages/kb/ui'];

/** テストと見本は描画の外で数えたり差し替えたりするので、コンパイラにも lint にもかけない。 */
export const REACT_COMPILER_IGNORES = ['**/__tests__/**', '**/*.stories.tsx'];
