import Toast from '@/shared/ui/Toast';
import { useToast } from '@/shared/lib/hooks/useToast';

/**
 * 画面上部中央に Toast を積む。pointer-events-none で本体クリックを邪魔しないように
 * しつつ、Toast 1 つ 1 つは pointer-events-auto で閉じるボタンを押せる。
 *
 * 成功・お知らせを読ませる polite の領域（live region）は**トーストが 0 件でも常に置いておく**。
 * 領域ごと後から差し込むと、読み上げソフトが変化を拾わないことがある（中身が変わったことしか
 * 監視していないため）。失敗は Toast 自身が `role="alert"` で、差し込んだ時点で読まれるので
 * live region で包まない（包むと二重に読まれる）。見た目の順は失敗を上にする。
 */
export default function ToastContainer() {
  const { toasts, removeToast } = useToast();
  const errors = toasts.filter((toast) => toast.type === 'error');
  const others = toasts.filter((toast) => toast.type !== 'error');

  return (
    <div className="pointer-events-none fixed top-4 left-1/2 -translate-x-1/2 z-50 flex w-full max-w-md flex-col items-center px-4">
      <div className="flex w-full flex-col items-center gap-2">
        {errors.map((toast) => (
          <Toast key={toast.id} type={toast.type} message={toast.message} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
      <div
        aria-live="polite"
        aria-atomic="false"
        className={`flex w-full flex-col items-center gap-2 ${errors.length > 0 && others.length > 0 ? 'mt-2' : ''}`}
      >
        {others.map((toast) => (
          <Toast key={toast.id} type={toast.type} message={toast.message} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </div>
  );
}
