import { useEffect, useState } from 'react';
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
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    setChosen(userId === null ? null : readRemembered(userId));
  }, [userId]);

  const current = chosen !== null && workspaces.some((w) => w.slug === chosen) ? chosen : (workspaces[0]?.slug ?? null);

  const select = (slug: string) => {
    setChosen(slug);
    if (userId !== null) remember(userId, slug);
  };

  return [current, select];
}
