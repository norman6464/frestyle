import { Link } from 'react-router-dom';

export interface BrandLogoProps {
  /** 大きさ。header は上部の帯、hero はログイン画面の左の面。 */
  size?: 'header' | 'hero';
  className?: string;
}

const SIZE = {
  header: { mark: 'h-7 w-7', word: 'text-lg' },
  hero: { mark: 'h-9 w-9', word: 'text-3xl' },
};

/**
 * FreStyle のロゴ（飛翔の印＋名前）。アプリの上部と同じ印で、押すとホーム（/）へ。
 *
 * 読み上げ名は行き先に合わせて「FreStyle ホーム」。未ログインで / を開くとログイン画面へ
 * 送られるが、行き先そのものは常に / なので名前は変えない。印の画像は飾り（名前はリンクが持つ）。
 */
export default function BrandLogo({ size = 'header', className = '' }: BrandLogoProps) {
  const s = SIZE[size];
  return (
    <Link
      to="/"
      aria-label="FreStyle ホーム"
      className={`inline-flex min-h-11 items-center gap-2 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${className}`}
    >
      <img src="/favicon.svg" alt="" aria-hidden="true" className={`${s.mark} shrink-0`} />
      <span className={`${s.word} font-bold tracking-tight text-[var(--color-text-primary)]`}>FreStyle</span>
    </Link>
  );
}
