import { useMemo, useState } from 'react';
import type { KbWorkspace } from '@/entities/kb';
import { useCurrentUserId } from '@/entities/user';

const storageKey = (userId: number) => `frestyle.home.favoritesWorkspace.${userId}`;

function readRemembered(userId: number): string | null {
  try {
    return localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

function remember(userId: number, slug: string) {
  try {
    localStorage.setItem(storageKey(userId), slug);
  } catch {
    // 端末に覚えられないだけで、選んだ範囲はこの画面の間は効く。
  }
}

/**
 * お気に入りを出すワークスペース（1 つ）。最後に選んだものを端末に覚え、覚えた値が今の所属に
 * 無ければ所属一覧の先頭にする。
 *
 * 覚える鍵はアカウントごとに分ける（同じ端末で別のアカウントに切り替えたとき、前の人の選択を
 * 引き継がない）。自分の ID が分からない間は覚えた値を使わない。
 */
export function useFavoritesWorkspace(workspaces: KbWorkspace[]): [string | null, (slug: string) => void] {
  const userId = useCurrentUserId();
  // 端末に覚えた値は、自分の ID が決まるたびに読む（effect で読むと、読む前の値で 1 回描く）。
  const remembered = useMemo(() => (userId === null ? null : readRemembered(userId)), [userId]);
  // この画面で選び直した値は、誰が選んだかと組で持つ（アカウントが替わったら使わない）。
  const [picked, setPicked] = useState<{ userId: number | null; slug: string } | null>(null);
  const chosen = picked !== null && picked.userId === userId ? picked.slug : remembered;

  const current = chosen !== null && workspaces.some((w) => w.slug === chosen) ? chosen : (workspaces[0]?.slug ?? null);

  const select = (slug: string) => {
    setPicked({ userId, slug });
    if (userId !== null) remember(userId, slug);
  };

  return [current, select];
}
