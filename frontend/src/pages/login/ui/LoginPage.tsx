import { useLoginPage } from '../model/useLoginPage';
import LoginView from './LoginView';

/**
 * ログイン画面。発行者が 2 通りある——本番（GCIP・Firebase JS SDK）はメールとパスワードを
 * この画面がその場で受け取ってよい（発行者の SDK が直接検証するので、二要素・ロックアウト・
 * パスワードの強さといった守りはアプリを経由しない）。ローカル開発（Dex）は発行者のログイン
 * 画面へ丸ごと送るだけで、パスワードは受け取らない。どちらを出すかはビルド時の設定で決まる。
 *
 * 見た目は LoginView が持ち、ここはフックをつなぐだけ。
 */
export default function LoginPage() {
  return <LoginView {...useLoginPage()} />;
}
