import { queryOptions } from '@tanstack/react-query';
import ProfileRepository from './profileRepository';

/** 自分のプロフィールの鍵。書き換えたら setQueryData で差し替える（ヘッダーの名前・アバターへ届く）。 */
export const profileKeys = {
  me: () => ['profile', 'me'] as const,
};

/** 自分のプロフィール（/profile/me）。ヘッダー・設定・「自分か」の判定が同じ結果を共有する。 */
export function myProfileQuery() {
  return queryOptions({
    queryKey: profileKeys.me(),
    queryFn: () => ProfileRepository.fetchProfile(),
  });
}
