import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
const dirname = path.dirname(fileURLToPath(import.meta.url));

// Storybook の story をブラウザで実行するプロジェクトは **明示的に有効にしたときだけ** 足す。
// 常に足すと 3 つ困る:
//   1. headless Chromium を入れていない環境の `npm test` が毎回落ちる
//   2. unit テストの反復のたびに Storybook のビルドとブラウザ起動が乗る
//   3. Stryker（ミューテーションテスト）が同じ設定で vitest を起動するため、
//      初回のテスト実行がブラウザ側の都合で失敗して丸ごと止まる
// CI は Chromium を入れたうえで WITH_STORYBOOK_TESTS=1 を付けて別ステップで走らせる。
const withStorybookTests = process.env.WITH_STORYBOOK_TESTS === '1';

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  plugins: [react()],
  // vite.config.js / tsconfig.json と同じ '@' → src のエイリアス。
  // ここが無いと、テストだけが絶対パスを解決できず一斉に落ちる。
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    // 閾値は設けない（数値を満たすためだけのテストが書かれるのを避ける）。手元で `vitest run --coverage` を見る用。
    coverage: {
      provider: 'v8'
    },
    projects: [{
      extends: true,
      test: {
        name: 'unit',
        environment: 'jsdom',
        globals: true,
        setupFiles: './src/test/setup.ts',
        // Playwright E2E は別 runner（npm run e2e）で実行する。
        // Vitest が e2e/*.spec.ts を拾うと @playwright/test の test.describe が
        // 「configuration から呼ばれた」扱いになって落ちるので明示的に除外する。
        exclude: ['node_modules', 'dist', 'e2e/**', '**/playwright-report/**']
      }
    }, ...(withStorybookTests ? [{
      extends: true,
      plugins: [
      // story をそのままテストとして実行する（play の assertion が落ちれば失敗になる）。
      // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
      storybookTest({
        configDir: path.join(dirname, '.storybook')
      })],
      test: {
        name: 'storybook',
        // preview の設定と a11y 検査を story のテスト実行にも効かせる。
        setupFiles: ['./.storybook/vitest.setup.ts'],
        browser: {
          enabled: true,
          headless: true,
          provider: playwright({}),
          instances: [{
            browser: 'chromium'
          }]
        }
      }
    }] : [])]
  }
});