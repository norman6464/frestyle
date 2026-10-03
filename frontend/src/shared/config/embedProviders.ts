/**
 * 本文に埋め込める外部の動画の提供元と、提供元ごとの動画の ID の形。
 *
 * backend の `domain.EmbedProvider`（internal/domain/block.go）と 1 対 1 で揃える。提供元を足すときは
 * 3 か所を一緒に変える: backend の許可リスト、ここ（frontend の認識と検査）、index.html の CSP の
 * frame-src。どれか 1 つでも欠けると、保存は通るのに再生できない（または保存で断られる）埋め込みができる。
 */
export const EMBED_PROVIDERS = ['youtube'] as const;
export type EmbedProvider = (typeof EMBED_PROVIDERS)[number];

/**
 * 動画の ID の形。ID は iframe の URL のパスにそのまま入るので、形で縛る（任意の文字を通すと URL を
 * 組み替えられる）。
 */
const EMBED_VIDEO_ID_PATTERNS: Record<EmbedProvider, RegExp> = {
  youtube: /^[A-Za-z0-9_-]{11}$/,
};

/** 埋め込みの題名（書いた人が入れる文字）の上限（文字数。backend の EmbedTitleMaxRunes と同じ）。 */
export const EMBED_TITLE_MAX_LENGTH = 200;

/** isValidEmbedVideo は、提供元が許可リストにあり、動画の ID がその提供元の形かを返す。 */
export function isValidEmbedVideo(provider: unknown, videoId: unknown): provider is EmbedProvider {
  if (typeof provider !== 'string' || typeof videoId !== 'string') return false;
  if (!(EMBED_PROVIDERS as readonly string[]).includes(provider)) return false;
  return EMBED_VIDEO_ID_PATTERNS[provider as EmbedProvider].test(videoId);
}
