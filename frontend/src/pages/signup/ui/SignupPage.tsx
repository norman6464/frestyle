import { useSignupPage } from '../model/useSignupPage';
import SignupView from './SignupView';

/**
 * アカウント作成画面。`pages/login/ui/LoginPage.tsx` と対になる。本番（GCIP）はメールと
 * パスワードをこの場で受け取り、その場でアカウントを作る。ローカル開発（Dex）は自己登録の
 * 手段を持たないため、発行者の画面へ送る入口だけを出す。見た目は SignupView が持つ。
 */
export default function SignupPage() {
  return <SignupView {...useSignupPage()} />;
}
