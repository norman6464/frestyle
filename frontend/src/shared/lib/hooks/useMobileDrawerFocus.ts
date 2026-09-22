import { useEffect, useRef } from 'react';

/** 狭い画面の引き出しだけで、初期フォーカス・Tab循環・Escape・復帰を扱う。 */
export function useMobileDrawerFocus(open: boolean, onClose?: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const panel = ref.current;
    if (!panel || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 767px)');
    let release: (() => void) | undefined;
    const activate = () => {
      release?.();
      release = undefined;
      if (!media.matches) return;
      const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden], [inert]'));
      // visibility を含む開閉アニメーションの開始フレームは、まだ hidden のことがある。
      // その間の focus() はブラウザに無視されるので、表示されたフレームで移す。
      let focusFrame: number | undefined;
      const focusInitial = () => {
        if (getComputedStyle(panel).visibility === 'hidden') {
          focusFrame = requestAnimationFrame(focusInitial);
          return;
        }
        (focusable()[0] ?? panel).focus();
      };
      focusInitial();
      const handleKey = (event: KeyboardEvent) => {
        if (event.defaultPrevented) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeRef.current?.();
        }
        if (event.key !== 'Tab') return;
        const items = focusable();
        const first = items[0];
        const last = items.at(-1);
        if (!first) { event.preventDefault(); panel.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
          event.preventDefault(); first.focus();
        }
      };
      panel.addEventListener('keydown', handleKey);
      release = () => {
        if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
        panel.removeEventListener('keydown', handleKey);
        if (previous?.isConnected && (panel.contains(document.activeElement) || document.activeElement === document.body)) previous.focus();
      };
    };
    activate();
    media.addEventListener('change', activate);
    return () => { media.removeEventListener('change', activate); release?.(); };
  }, [open]);
  return ref;
}
