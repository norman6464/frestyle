import { useEffect } from 'react';
import FsIcon from './icons/FsIcon';
import { fsIcon } from './icons/fsIconFactory';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  type: ToastType;
  message: string;
  onClose: () => void;
}

const ICON_MAP = {
  success: fsIcon('check-circle'),
  error: fsIcon('alert-circle'),
  info: fsIcon('info'),
};

// 塗りスタイル: 濃い面 + 白文字・白アイコンで視認性を上げる。成功は黄緑。
const COLOR_MAP = {
  // 白文字に対し lime-600 は 3.08:1 で未達。700 で 4.7:1。
  success: 'bg-success text-white',
  error: 'bg-danger text-white',
  info: 'bg-taupe-700 text-white',
};

/**
 * Toast — 画面上部から落ちてバウンドする通知。
 *
 * 配置は ToastContainer 側（fixed top center）。 本コンポーネントは見た目と
 * 4 秒オートクローズ + アニメーションのみ責任を持つ。
 */
export default function Toast({ type, message, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const Icon = ICON_MAP[type];

  return (
    <div
      role="alert"
      className={`pointer-events-auto flex items-start gap-3 px-5 py-3.5 rounded-lg shadow-xl min-w-[280px] max-w-md ${COLOR_MAP[type]} animate-toast-drop`}
    >
      <Icon className="w-6 h-6 flex-shrink-0 text-white" />
      <p className="text-sm leading-relaxed flex-1">{message}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        className="-mr-1 -mt-0.5 p-1 rounded hover:bg-white/20 transition-colors"
      >
        <FsIcon name="x" className="w-4 h-4" />
      </button>
    </div>
  );
}
