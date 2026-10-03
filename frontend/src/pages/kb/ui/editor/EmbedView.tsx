import { useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { isValidEmbedVideo } from '@/shared/config/embedProviders';
import { EMBED_DEFAULT_TITLE } from './schemaExtensions';
import { embedPlayerSrc } from './embedUrl';

/**
 * EmbedView は埋め込みノードの NodeView。**押すまで外部を一切読み込まない**カードを描く。
 *
 * 本文を開いただけで外部の動画サイトへ繋ぐと、読んだ人の IP・時刻・閲覧の事実が書いた人の選んだ相手へ
 * 渡る（外部画像を断っているのと同じ理由）。そこで最初は題名（書いた人が入れた文字）と再生ボタンだけを
 * 描き、サムネイル（i.ytimg.com）も取らない。押したときに初めて iframe を作る。
 *
 * iframe の決まり:
 * - sandbox: allow-scripts allow-same-origin allow-presentation（再生に要る最小限。ポップアップ・
 *   画面の移動・フォームは許さない）
 * - allow: autoplay（押したあとに二度押しさせない）・encrypted-media・fullscreen・picture-in-picture
 * - referrerpolicy: strict-origin-when-cross-origin（送るのはオリジンだけで、ページの URL は送らない）。
 *   no-referrer にすると YouTube の埋め込みプレイヤーが「Error 153（プレイヤーの設定エラー）」で
 *   再生を断る（YouTube は埋め込み先の識別に Referer を求める）
 *
 * 閲覧モードでも同じ動き。押した状態は保存しない（開き直すとまたカードに戻る）。
 */
export default function EmbedView({ node, selected }: NodeViewProps) {
  const [playing, setPlaying] = useState(false);
  const provider = node.attrs.provider;
  const videoId = node.attrs.videoId;
  const valid = isValidEmbedVideo(provider, videoId);
  const title =
    typeof node.attrs.title === 'string' && node.attrs.title !== '' ? node.attrs.title : EMBED_DEFAULT_TITLE;

  return (
    <NodeViewWrapper
      className={`rte-embed${selected ? ' is-selected' : ''}${playing ? ' is-playing' : ''}`}
      data-provider={valid ? provider : undefined}
    >
      {playing && valid ? (
        <iframe
          className="rte-embed-player"
          src={embedPlayerSrc({ provider, videoId: videoId as string })}
          title={title}
          sandbox="allow-scripts allow-same-origin allow-presentation"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      ) : (
        <div className="rte-embed-card">
          <span className="rte-embed-provider">YouTube</span>
          <span className="rte-embed-title">{title}</span>
          <button
            type="button"
            className="rte-embed-play"
            onClick={() => setPlaying(true)}
            disabled={!valid}
            aria-label={`${title} を再生（YouTube を読み込みます）`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="rte-embed-play-icon">
              <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
            </svg>
            <span>再生</span>
          </button>
          <span className="rte-embed-note">押すまで YouTube には接続しません</span>
        </div>
      )}
    </NodeViewWrapper>
  );
}
