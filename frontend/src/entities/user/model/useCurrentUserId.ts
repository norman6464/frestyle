import { useQuery } from '@tanstack/react-query';
import { myProfileQuery } from '../api/profileQueries';
import type { Profile } from './types';

const selectUserId = (profile: Profile) => profile.userId;

/**
 * useCurrentUserId は自分の userId を返す。自分のプロフィール（myProfileQuery）と同じ結果を使う
 * ので、ヘッダーなどが既に取っていれば取り直さない。
 *
 * 「自分の発言だけに操作を出す」「自分自身には操作を出さない」判定や、端末に覚える選択を
 * アカウントごとに分ける鍵に使う（Redux の auth スライスは isAuthenticated / loading しか
 * 持たないので、ここで引く）。
 *
 * 引けなかった（未認証・通信失敗・取得中）ときは null。呼び出し側は「自分か分からない」を
 * 安全側に倒す（他人と同じ扱いにする・覚えた選択を使わない）。
 */
export function useCurrentUserId(): number | null {
  const { data } = useQuery({ ...myProfileQuery(), select: selectUserId });
  return data ?? null;
}
