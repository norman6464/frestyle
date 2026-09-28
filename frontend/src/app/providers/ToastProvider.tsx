import { useCallback, useMemo, useState, ReactNode } from 'react';
import { ToastActionsContext, ToastListContext, type ToastItem } from '@/shared/lib/hooks/useToastContext';
import type { ToastType } from '@/shared/ui';

let toastId = 0;

// 同時表示の上限。連続操作でも画面が埋まらないよう古いものから落とす。
const MAX_TOASTS = 3;

/**
 * ToastProvider は通知の Context Provider。
 *
 * showToast / removeToast を `useToast()`、いま出ている一覧を `useToastList()` 経由で
 * 任意の component から使えるようにする。2 つを別の Context で配る理由は
 * useToastContext.ts を参照。HMR を壊さないため hook と同居させず単体ファイルに切り出している。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((type: ToastType, message: string) => {
    setToasts((prev) => {
      // 同一 (type, message) が表示中なら、新規追加せず件数をまとめる。
      // id を振り直して末尾へ移すことで Toast が再マウントし、自動消滅タイマーもリフレッシュされる。
      const existing = prev.find((t) => t.type === type && t.message === message);
      if (existing) {
        const rest = prev.filter((t) => t !== existing);
        const merged: ToastItem = { ...existing, id: String(++toastId), count: existing.count + 1 };
        return [...rest, merged].slice(-MAX_TOASTS);
      }
      const next: ToastItem = { id: String(++toastId), type, message, count: 1 };
      return [...prev, next].slice(-MAX_TOASTS);
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // 関数の箱は一度作ったら中身を変えない（showToast / removeToast は useCallback で固定）。
  const actions = useMemo(() => ({ showToast, removeToast }), [showToast, removeToast]);

  return (
    <ToastActionsContext.Provider value={actions}>
      <ToastListContext.Provider value={toasts}>{children}</ToastListContext.Provider>
    </ToastActionsContext.Provider>
  );
}
