import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { devCsp } from './vite-plugins/dev-csp';
import { reactCompiler } from './vite-plugins/react-compiler';

// 本番ビルドでは console.log/info/debug を除去し、必要最小限のログにする
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');

  return {
    // index.html の CSP は本番の API / OIDC オリジンしか許可していない。ローカル開発は
    // VITE_API_BASE_URL(例: http://localhost:8080)・VITE_OIDC_TOKEN_URI(ローカルの
    // OIDC 発行者 Dex。例: http://localhost:5556/dex/token)が SPA と別オリジンになり
    // fetch が CSP で遮断されるため、dev のときだけ connect-src にそれらのオリジンを足す
    // (apply: 'serve' なので npm run build の成果物には影響しない)。
    plugins: [react(), reactCompiler(), devCsp([env.VITE_API_BASE_URL, env.VITE_OIDC_TOKEN_URI])],
    // '@' → src の絶対パス。FSD は層をまたぐ参照を絶対パスで書く前提なので、
    // tsconfig.json の paths と同じ内容をビルド側にも定義する。
    // 型チェック・ビルド・テストの 3 か所すべてに無いと、
    // 「型は通るがビルドで落ちる」状態になるため必ず揃える。
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    define: {
      global: 'window', // ここで global をブラウザの window に置き換える
    },
    esbuild: mode === 'production'
      ? {
          // console.error / console.warn は残し、info/log/debug は削除
          pure: ['console.log', 'console.debug', 'console.info'],
        }
      : undefined,
    build: {
      rollupOptions: {
        output: {
          // vite 8 のデフォルトバンドラ(Rolldown)はオブジェクト形式の manualChunks を
          // 受け付けず関数形式のみ対応するため、id ベースの関数で同じ分割を表現する。
          // react-router-dom / react-dom を react より先に判定する(部分一致の取りこぼし防止)。
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            // TanStack Query はここに入れない。使うのはログイン後の画面だけで、キャッシュの置き場
            // （app/layouts/AuthenticatedLayout）ごと遅延読み込みにしてある。名指しで最初に読む塊へ
            // 入れると、ログイン画面でも読むことになる。
            if (
              id.includes('node_modules/@reduxjs/toolkit') ||
              id.includes('node_modules/react-redux')
            ) {
              return 'vendor-state';
            }
            if (
              id.includes('node_modules/react-router-dom') ||
              id.includes('node_modules/react-dom') ||
              id.includes('node_modules/react/')
            ) {
              return 'vendor-react';
            }
            return undefined;
          },
        },
      },
    },
  };
});
