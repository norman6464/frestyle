import type { Preview } from '@storybook/react-vite';
// アプリと同じ見た目で検証できるよう、本体のグローバル CSS を通す。
// これが無いと --color-* トークンも prose も効かず、見本にならない。
import '../src/app/styles/index.css';
// inkwell（触感的な UI 部品の一群）は Roboto 前提で寸法を決めてある。アプリ側は
// `shared/ui/inkwell` の入口を読んだときに書体も一緒に読み込むが、story は部品を
// 直接指すのでその入口を通らない。ここで読んでおかないと、書体だけ違う見本になる。
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },

    a11y: {
      // 見つけたら落とす。story は CI でテストとして走るので、
      // 'todo'（表示だけ）にしておくと違反が積もっては誰も気づけない。
      test: 'error',
      context: {
        // Base UI が焦点を閉じ込めるために置く見えない番兵だけを外す。
        // 番兵は aria-hidden かつ tabindex="0" なので axe の aria-hidden-focus に必ず触れるが、
        // これは焦点トラップの実装そのもの（Tab が番兵に入った瞬間に反対の端へ送り返す）で、
        // こちらのマークアップの問題ではないし、直す手立ても無い。
        //
        // 外すのはこのセレクタに一致する要素だけ。aria-hidden-focus の検査自体は生きているので、
        // 自分たちが aria-hidden の中に押せるものを置いてしまった場合は今までどおり落ちる。
        exclude: [['[data-base-ui-focus-guard]']],
      },
    }
  },
};

export default preview;