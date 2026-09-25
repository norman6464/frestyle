import { usePasswordResetPage } from '../model/usePasswordResetPage';
import PasswordResetView from './PasswordResetView';

/**
 * パスワード再設定画面。GCIP（Firebase）だけの機能。ローカル開発（Dex）はこの機能を
 * 持たないため、画面自体は隠さずその旨を案内する。見た目は PasswordResetView が持つ。
 */
export default function PasswordResetPage() {
  return <PasswordResetView {...usePasswordResetPage()} />;
}
