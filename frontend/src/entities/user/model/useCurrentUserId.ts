import { useEffect, useState } from 'react';
import ProfileRepository from '../api/profileRepository';

/**
 * useCurrentUserId は自分の userId を 1 回引く。
 *
 * 「自分の発言だけに操作を出す」「自分自身には操作を出さない」判定や、端末に覚える選択を
 * アカウントごとに分ける鍵に使う（Redux の auth スライスは isAuthenticated / loading しか
 * 持たないので、ここで引く）。
 *
 * 引けなかった（未認証・通信失敗）ときは null のまま。呼び出し側は「自分か分からない」を
 * 安全側に倒す（他人と同じ扱いにする・覚えた選択を使わない）。
 */
export function useCurrentUserId(): number | null {
  const [userId, setUserId] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    ProfileRepository.fetchProfile()
      .then((profile) => {
        if (active) setUserId(profile.userId);
      })
      .catch(() => {
        if (active) setUserId(null);
      });
    return () => {
      active = false;
    };
  }, []);

  return userId;
}
