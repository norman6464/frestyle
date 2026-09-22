import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // taupe: 非インタラクティブなアクセント（アバター背景 / ボーダー / アイコン / バッジ等）。
        // stone 系の暖色ニュートラルで、brand-* と干渉せず落ち着いた存在感を出す。
        // 使い分けルール:
        //   brand-* → CTA ボタン / フォーカスリング / インタラクティブ要素
        //   taupe-* → アバター背景 / アイコン装飾 / バッジ / ボーダーアクセントなどの非ボタンアクセント
        taupe: {
          50: '#F0EFED',
          100: '#E3E2DF',
          200: '#D3D1CD',
          300: '#B5B2AC',
          400: '#918D85',
          500: '#5C5850',
          600: '#474440',
          700: '#353330',
          800: '#242220',
          900: '#181716',
        },
        // FreStyle ブランドカラー（Tailwind blue スケール準拠）。
        // #2E7DF6 は彩度が高すぎて長時間凝視すると目が疲れるため、
        // 科学的に「認知負荷が低く集中力が上がる」中明度青（#3B82F6 = Tailwind blue-500）に調整。
        // 使い分けルール（再掲）:
        //   brand-* → CTA ボタン / フォーカスリング / インタラクティブ要素
        //   taupe-* → 非インタラクティブアクセント
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        surface: 'var(--color-surface)',
        'surface-1': 'var(--color-surface-1)',
        'surface-2': 'var(--color-surface-2)',
        'surface-3': 'var(--color-surface-3)',
        // 状態色。「結果」を表す色で、brand-*（押せる）とは役割が違うので混ぜない。
        // 値は index.css の --fs-success / --fs-danger 側が正本。
        // 使い分けルール:
        //   danger                  → 面と枠（削除ボタンの地・入力の枠）。白抜き文字を載せる側
        //   danger-ink              → 文字とアイコン。面の色より一段濃い
        //   success / warning       → 文字・アイコン・枠線（白地でも淡色地でも 4.5:1 以上）
        //   *-soft                  → その文字を載せる淡い地
        //   action-soft             → 青の淡い地（選択・強調の面。文字色には使わない）
        // danger だけ文字と面を分けているのは、面の色をそのまま淡赤の地に載せると 4.42:1 で
        // 基準を割るため。success / warning は 1 色で両方満たすので分けていない。
        // 色だけで意味を伝えないこと。必ず文言かアイコンを添える。
        success: 'var(--fs-success)',
        'success-soft': 'var(--fs-success-soft)',
        danger: 'var(--fs-danger)',
        'danger-ink': 'var(--fs-danger-ink)',
        'danger-hover': 'var(--fs-danger-hover)',
        'danger-active': 'var(--fs-danger-active)',
        'danger-soft': 'var(--fs-danger-soft)',
        'danger-border': 'var(--fs-danger-border)',
        warning: 'var(--fs-warning)',
        'warning-soft': 'var(--fs-warning-soft)',
        'warning-border': 'var(--fs-warning-border)',
        'action-soft': 'var(--fs-action-soft)',
        // inkwell: 押下波紋 + 標高シャドウの触感的コンポーネント群専用パレット。
        inkwell: {
          primary: '#1976d2',
          'primary-dark': '#1565c0',
          'primary-light': '#42a5f5',
          secondary: '#9c27b0',
          'secondary-dark': '#7b1fa2',
          'secondary-light': '#ba68c8',
          error: '#d32f2f',
          'error-dark': '#c62828',
          // テキスト（黒に対する不透明度で階調を作る）
          'text-primary': 'rgba(0,0,0,0.87)',
          'text-secondary': 'rgba(0,0,0,0.6)',
          'text-disabled': 'rgba(0,0,0,0.38)',
          // アウトライン / 区切り線
          outline: 'rgba(0,0,0,0.23)',
          divider: 'rgba(0,0,0,0.12)',
        },
      },
      // 角丸ルール:
      //   rounded-xl  → カード / パネル / モーダル / フローティングメニュー
      //   rounded-lg  → ボタン / インプット / セレクト / タグ / バッジ
      //   rounded-full → アバター / 円形アイコンボタン / ドット / ピル
      //   rounded-md  → 小さいインライン要素（コードブロック枠 / ミニアイコンボタン等）
      // 値はスケールごと一段控えめ（角を少し立てるユーザー要望）。
      // 使い分けルールは変えず、トークン値だけで全画面に一括反映する。
      borderRadius: {
        md: '0.1875rem',
        lg: '0.25rem',
        xl: '0.375rem',
        '2xl': '0.5rem',
      },
      fontFamily: {
        // 既定を Noto Sans JP に差し替える。Tailwind の preflight が html に
        // fontFamily.sans を敷くので、ここを変えるとアプリ全体の地の書体が変わる。
        // 実体（代替の並びも含む）は index.css の --fs-font-sans。
        sans: ['var(--fs-font-sans)'],
        mono: ['var(--fs-font-mono)'],
        // font-roboto を付けた要素だけに適用（inkwell の開発用カタログが使う）。
        roboto: ['Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
      transitionDuration: {
        // 動きの長さは 3 段だけ。画面ごとに 150 / 200 / 300 を選び直さない。
        // fast=状態の切り替え / base=出現・移動 / slow=面の入退場。
        // 退場は入場より短く（base で出して fast で消す）。
        fast: 'var(--fs-duration-fast)',
        base: 'var(--fs-duration-base)',
        slow: 'var(--fs-duration-slow)',
      },
      transitionTimingFunction: {
        // 止まるときは減速、去るときは加速。往復するものは standard。
        'fs-standard': 'var(--fs-ease-standard)',
        'fs-decelerate': 'var(--fs-ease-decelerate)',
        'fs-accelerate': 'var(--fs-ease-accelerate)',
        // 名前付きイージング。standard=往復 / decelerate=出現 / accelerate=退場 / sharp=即戻り。
        'inkwell-standard': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'inkwell-decelerate': 'cubic-bezier(0, 0, 0.2, 1)',
        'inkwell-accelerate': 'cubic-bezier(0.4, 0, 1, 1)',
        'inkwell-sharp': 'cubic-bezier(0.4, 0, 0.6, 1)',
      },
      boxShadow: {
        // 標高シャドウ: 数字が大きいほど浮いて見える（3 層合成）。
        'inkwell-1': '0px 2px 1px -1px rgba(0,0,0,0.2), 0px 1px 1px 0px rgba(0,0,0,0.14), 0px 1px 3px 0px rgba(0,0,0,0.12)',
        'inkwell-2': '0px 3px 1px -2px rgba(0,0,0,0.2), 0px 2px 2px 0px rgba(0,0,0,0.14), 0px 1px 5px 0px rgba(0,0,0,0.12)',
        'inkwell-3': '0px 3px 3px -2px rgba(0,0,0,0.2), 0px 3px 4px 0px rgba(0,0,0,0.14), 0px 1px 8px 0px rgba(0,0,0,0.12)',
        'inkwell-4': '0px 2px 4px -1px rgba(0,0,0,0.2), 0px 4px 5px 0px rgba(0,0,0,0.14), 0px 1px 10px 0px rgba(0,0,0,0.12)',
        'inkwell-8': '0px 5px 5px -3px rgba(0,0,0,0.2), 0px 8px 10px 1px rgba(0,0,0,0.14), 0px 3px 14px 2px rgba(0,0,0,0.12)',
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-in',
        'scale-in': 'scaleIn 0.2s ease-out',
        'skeleton': 'skeleton 1.5s ease-in-out infinite',
        // Toast 用: 上から落ちてバウンドする 0.6s のアニメーション。
        'toast-drop': 'toastDrop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
        // 押した位置から広がりながら消える波紋。
        'inkwell-ripple': 'inkwellRipple 0.55s linear',
        // 成功チェックの線を描く。
        'inkwell-draw': 'inkwellDraw 0.22s ease-out forwards',
        // 線形プログレスの indeterminate 帯（左から右へ流れる）。
        'inkwell-bar': 'inkwellBar 1.4s ease-in-out infinite',
        // LP ヒーローの「タイプ → 採点 → 合格」演出。delay は使用側で
        // [animation-delay:*] を付けて段差を作る（初期状態は opacity-0 を併用）。
        'lp-type': 'lpAppear 0.01s linear forwards',
        'lp-stamp': 'lpStamp 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.2) 2.4s forwards',
        'lp-blink': 'lpBlink 1s steps(1) infinite',
        'lp-drift': 'lpDrift 7s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        skeleton: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        toastDrop: {
          '0%': { transform: 'translateY(-120%)', opacity: '0' },
          '60%': { transform: 'translateY(12px)', opacity: '1' },
          '80%': { transform: 'translateY(-6px)' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        inkwellRipple: {
          '0%': { transform: 'scale(0)', opacity: '0.3' },
          '100%': { transform: 'scale(1)', opacity: '0' },
        },
        inkwellDraw: {
          to: { strokeDashoffset: '0' },
        },
        inkwellBar: {
          '0%': { transform: 'translateX(-100%) scaleX(0.3)' },
          '50%': { transform: 'translateX(0%) scaleX(0.6)' },
          '100%': { transform: 'translateX(100%) scaleX(0.3)' },
        },
        lpAppear: {
          to: { opacity: '1' },
        },
        lpStamp: {
          to: { opacity: '1', transform: 'none' },
        },
        lpBlink: {
          '50%': { opacity: '0' },
        },
        lpDrift: {
          '50%': { transform: 'translateY(-7px)' },
        },
      },
    },
  },
  // @tailwindcss/typography: Markdown 描画 (ノート / 教材 / AI チャット) で `prose` クラスを使う。
  // これで `# 見出し` `表` `リスト` `引用` などが標準の Typography スタイルで描画される。
  plugins: [typography],
};
