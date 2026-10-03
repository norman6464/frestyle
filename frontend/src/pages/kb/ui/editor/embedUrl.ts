import { isValidEmbedVideo, type EmbedProvider } from '@/shared/config/embedProviders';

/** 埋め込みとして読み取れた動画。 */
export interface EmbedVideo {
  provider: EmbedProvider;
  videoId: string;
}

/** YouTube として受け付けるホスト（先頭の www. と m. は外して比べる）。 */
const YOUTUBE_HOSTS = new Set(['youtube.com', 'youtube-nocookie.com']);

/**
 * parseEmbedUrl は貼り付け・入力された URL から、埋め込める動画を読み取る。読み取れなければ null
 * （その URL は今までどおり素のリンクのまま扱う）。
 *
 * 受け付ける形（YouTube）:
 * - https://www.youtube.com/watch?v=ID（ほかの問い合わせ文字列が付いていてもよい）
 * - https://youtu.be/ID
 * - https://www.youtube.com/shorts/ID・/embed/ID・/live/ID、youtube-nocookie.com/embed/ID
 *
 * 動画の ID は提供元の形（isValidEmbedVideo）で確かめる。提供元を足すときは backend の許可リスト・
 * ここ・index.html の CSP の frame-src の 3 か所を一緒に変える（shared/config/embedProviders.ts）。
 */
export function parseEmbedUrl(input: string): EmbedVideo | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  let videoId: string | null = null;
  if (host === 'youtu.be') {
    videoId = url.pathname.split('/')[1] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch') {
      videoId = url.searchParams.get('v');
    } else {
      videoId = /^\/(?:shorts|embed|live)\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? null;
    }
  }
  return videoId !== null && isValidEmbedVideo('youtube', videoId) ? { provider: 'youtube', videoId } : null;
}

/**
 * embedPlayerSrc は再生に使う iframe の URL。YouTube は Cookie を使わない youtube-nocookie.com で開き、
 * 押してから作るので autoplay を付ける（押したのに、もう一度 YouTube の再生ボタンを押させない）。
 * この接続先は index.html の CSP の frame-src に入っている必要がある。
 */
export function embedPlayerSrc(video: EmbedVideo): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.videoId)}?autoplay=1`;
}
