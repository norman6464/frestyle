/*
 * features/auth の Public API。
 *
 * 認証（現在ユーザーの取得・サインイン・サインアップ・パスワード再設定・ログアウト）の
 * ユーザーシナリオ。認証状態そのものは entities/user の Redux slice が持ち、
 * ここはそれを操作する feature。
 *
 * 発行者は本番（GCIP・Firebase Authentication 互換）とローカル開発（Dex）の
 * 2 通りがあり、ビルド時の設定でどちらが有効かが決まる（`resolveAuthMode`）。
 * Firebase 向けは `useFirebaseAuth`、Dex 向けは `useOidcLogin` を使う——形が
 * 大きく違う（Firebase はメール/パスワードをその場で受け取る同期的な操作、
 * Dex は発行者の画面へ丸ごとリダイレクトする）ため、共通インターフェースには
 * まとめていない。呼び出す側（画面）が `resolveAuthMode` で分岐する。
 */
export { useAuth } from './model/useAuth';
export { useOidcLogin } from './model/useOidcLogin';
export type { OidcLogin } from './model/useOidcLogin';
export { useFirebaseAuth } from './model/useFirebaseAuth';
export type { FirebaseAuthActions } from './model/useFirebaseAuth';
export type { FirebaseErrorField } from '@/shared/lib/auth/firebaseErrorMessage';
export { useEmailVerification } from './model/useEmailVerification';
export type { EmailVerification } from './model/useEmailVerification';
export { default as AuthUnavailableNotice } from './ui/AuthUnavailableNotice';
// トークン取得・発行者との通信そのもの（config 読み取り・Dex トークン交換・
// Firebase App 初期化）は `shared/lib/auth` に置く。`shared/api/axios.ts`
// （shared 層）が ID トークンを必要とし、shared は自分より上の層（features）を
// import できない（FSD の一方通行）ため、この feature より下に置く必要がある。
// ここでは画面（pages）から見た「認証機能の入口」として re-export するだけ。
export {
  buildAuthorizeUrl,
  consumeAuthFlowState,
  exchangeCodeForToken,
  verifyIdTokenNonce,
  DexTokenExchangeError,
} from '@/shared/lib/auth/oidcAuthUrl';
export { readAuthConfig, DEFAULT_SCOPE } from '@/shared/lib/auth/authConfig';
export type { AuthConfig, ConfiguredAuth, UnconfiguredAuth } from '@/shared/lib/auth/authConfig';
export { readFirebaseAuthConfig } from '@/shared/lib/auth/firebaseConfig';
export type {
  FirebaseAuthConfig,
  ConfiguredFirebaseAuth,
  UnconfiguredFirebaseAuth,
} from '@/shared/lib/auth/firebaseConfig';
export { saveDexSession } from '@/shared/lib/auth/dexSession';
export {
  resolveAuthMode,
  getCurrentIdToken,
  subscribeAuthState,
  signOutCurrentProvider,
} from '@/shared/lib/auth/currentIdToken';
export type { AuthMode } from '@/shared/lib/auth/currentIdToken';
