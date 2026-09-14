import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SidebarSlotContext, useSidebarSlot, type SidebarSlotValue } from '../lib/hooks/useSidebarSlot';

/** 柱と画面のあいだに立つ。AppShell が画面ぜんぶを包む。 */
export function SidebarSlotProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [count, setCount] = useState(0);

  const register = useCallback(() => {
    setCount((n) => n + 1);
    return () => setCount((n) => n - 1);
  }, []);

  const value = useMemo<SidebarSlotValue>(
    () => ({ host, setHost, filled: count > 0, register }),
    [host, count, register],
  );

  return <SidebarSlotContext.Provider value={value}>{children}</SidebarSlotContext.Provider>;
}

/**
 * 柱の中に置く差し込み口。**1 本の柱につき 1 つだけ**置く
 * （2 つ置くと後から描かれたほうが口を奪い、区画が片方から消える）。
 */
export function SidebarSlotTarget({ className }: { className?: string }) {
  const slot = useSidebarSlot();
  return <div ref={slot?.setHost ?? null} className={className} />;
}

/**
 * 画面側が使う入口。この中に書いたものが柱の差し込み口へ出る。
 *
 * 柱が無い場所（単体テストや story で画面だけを描くとき）では何も出さない
 * —— 柱が無いだけで画面が壊れるのは筋が通らないため。
 */
export function SidebarSection({ children }: { children: ReactNode }) {
  const slot = useSidebarSlot();
  const register = slot?.register;

  useEffect(() => {
    if (!register) return;
    return register();
  }, [register]);

  if (!slot?.host) return null;
  return createPortal(children, slot.host);
}
