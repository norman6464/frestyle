import { useEffect, useRef, useState } from 'react';
import FsIcon from './icons/FsIcon';
import { fsIcon } from './icons/fsIconFactory';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  type: ToastType;
  message: string;
  onClose: () => void;
}

/** 成功・お知らせが自動で消えるまでの時間。失敗は自動では消さない。 */
export const TOAST_AUTO_CLOSE_MS = 4000;

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
 * Toast — 画面上部から落ちてくる通知 1 件。
 *
 * 読み上げの受け持ちは種類で分ける。失敗はこの要素自身が `role="alert"`（差し込まれた時点で
 * 割り込んで読まれる）。成功・お知らせは role を持たず、ToastContainer が常に置いている
 * polite の領域の中に入る（role="status" の要素を後から差し込んでも読まれないことがあるため）。
 *
 * - 成功・お知らせは {@link TOAST_AUTO_CLOSE_MS} で消える。マウスを乗せている間と、
 *   中のボタンにフォーカスがある間は止める（読み終える前に消さない。WCAG 2.2.1）
 * - 失敗は自動では消さない。読み逃すと何が起きたか分からなくなるので、閉じるまで残す
 */
export default function Toast({ type, message, onClose }: ToastProps) {
  const autoClose = type !== 'error';
  // マウスとフォーカスは別々に持つ。1 つの印で持つと、閉じるボタンにフォーカスしたまま
  // マウスを離しただけで（あるいはマウスを乗せたままフォーカスを外しただけで）再開してしまう。
  // 両方が外れたときだけ数え直す。
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  // 呼び出し側は描画のたびに新しい onClose を渡してくる。依存に入れるとタイマーが
  // 描画ごとに巻き戻るので、最新の関数だけを参照で持つ。
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!autoClose || paused) return;
    const timer = setTimeout(() => onCloseRef.current(), TOAST_AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [autoClose, paused]);

  const Icon = ICON_MAP[type];

  return (
    <div
      role={type === 'error' ? 'alert' : undefined}
      data-toast-type={type}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      className={`pointer-events-auto flex items-start gap-3 px-5 py-3.5 rounded-lg shadow-xl min-w-[280px] max-w-md ${COLOR_MAP[type]} animate-toast-drop`}
    >
      <Icon className="w-6 h-6 flex-shrink-0 text-white" />
      <p className="text-sm leading-relaxed flex-1">{message}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        // 既定のフォーカスの輪（青）は赤・緑の塗りの上でほとんど見えない。白にする。
        className="-mr-1.5 -mt-1 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-white/20 focus-visible:outline-white"
      >
        <FsIcon name="x" className="w-4 h-4" />
      </button>
    </div>
  );
}
