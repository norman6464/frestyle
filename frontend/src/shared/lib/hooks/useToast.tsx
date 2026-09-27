import { useContext } from 'react';
import { ToastActionsContext, ToastListContext, type ToastActions, type ToastItem } from './useToastContext';

/**
 * useToast は通知を出す・消す関数（showToast / removeToast）を取り出す hook。
 *
 * いま出ている一覧は返さない（一覧は useToastList）。一覧まで読むと、通知が出る・消える
 * たびにこの hook を使う部品が描き直される。
 *
 * ToastProvider component は src/app/providers/ToastProvider.tsx に分離した（FSD の app 層）。
 * 同一ファイルで component + hook を export していると Vite React HMR の
 * react-refresh/only-export-components ルールに引っかかるため。
 */
export function useToast(): ToastActions {
  const context = useContext(ToastActionsContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

/** useToastList はいま出ている通知の一覧を取り出す hook。表示係（ToastContainer）が使う。 */
export function useToastList(): ToastItem[] {
  const toasts = useContext(ToastListContext);
  if (!toasts) {
    throw new Error('useToastList must be used within a ToastProvider');
  }
  return toasts;
}
