import { useQuery } from '@tanstack/react-query';
import { myProfileQuery } from '../api/profileQueries';

/** 自分のプロフィール。取得結果は画面をまたいで共有する（同じ鍵を何か所で使っても 1 回だけ取る）。 */
export function useMyProfile() {
  return useQuery(myProfileQuery());
}
