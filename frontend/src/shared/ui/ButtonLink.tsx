import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { buttonClassName, type ButtonSize, type ButtonVariant } from './buttonStyles';

export interface ButtonLinkProps {
  to: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: ReactNode;
}

/**
 * ボタンの見た目をした、アプリ内の別の画面へのリンク（ログイン画面の「新規登録」など）。
 *
 * 押すと画面を移るだけなので、要素はリンク（a）のまま。Link の中に Button を入れると、
 * 押せるものの中に押せるものが入り、読み上げもキーボードの止まり方も二重になる。
 */
export default function ButtonLink({ to, variant = 'primary', size = 'md', fullWidth = false, children }: ButtonLinkProps) {
  return (
    <Link to={to} className={buttonClassName({ variant, size, fullWidth })}>
      {children}
    </Link>
  );
}
