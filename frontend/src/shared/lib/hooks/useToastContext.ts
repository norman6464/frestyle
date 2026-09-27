import { createContext } from 'react';
import type { ToastType } from '@/shared/ui/Toast';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  /** 同一メッセージが連続したときのまとめ件数（1 のときは無表示）。 */
  count: number;
}

export interface ToastActions {
  showToast: (type: ToastType, message: string) => void;
  removeToast: (id: string) => void;
}

/**
 * ToastProvider と useToast / useToastList で共有する React Context。
 *
 * 「出す関数」と「いま出ている一覧」を別の Context に分けてある。Context は値が変わると
 * それを読む部品を全部描き直す。画面のほとんどは showToast しか使わないので、一覧と同じ
 * 箱で配ると、通知が出る・消えるたびにそれらが全部描き直される（ナレッジならサイドバーの
 * 木の全行まで）。関数の箱は一度作ったら中身を変えないので、読む部品は描き直されない。
 * 一覧を読むのは表示係（ToastContainer）だけ。
 *
 * ToastProvider (component) と hook を同一ファイルから export すると
 * react-refresh/only-export-components のルールに抵触し HMR が壊れるため、
 * Context オブジェクトをこの専用ファイルに切り出した。
 */
export const ToastActionsContext = createContext<ToastActions | null>(null);
export const ToastListContext = createContext<ToastItem[] | null>(null);
